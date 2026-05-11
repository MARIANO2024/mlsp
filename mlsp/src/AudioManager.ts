export type AudioStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'error';

export type PlaybackPhase = 'idle' | 'lead-in' | 'audio' | 'gap' | 'ended';

export interface PlaybackTimeline {
  phase: PlaybackPhase;
  playProgress: number;
  gapProgress: number;
  elapsedSeconds: number;
  totalSeconds: number;
  currentPlay: number;
  totalPlays: number;
}

export interface PlaybackWindow {
  playNumber: number;
  startWallMs: number;
  endWallMs: number;
  durationSeconds: number;
}

export interface AudioBufferInfo {
  durationSeconds: number;
  sampleRate: number;
  sampleFrames: number;
  channels: number;
}

export class AudioManager {
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;

  /**
   * Mono mix of the file last passed to `load()` - always the original track for STFT / phase.
   * `replacePlaybackWithMono` swaps `buffer` only (playback); analysis stays here.
   */
  private analysisMono: Float32Array | null = null;
  private analysisSampleRate: number | null = null;

  private sources: AudioBufferSourceNode[] = [];
  private _gapSeconds = 0;
  private _totalPlays = 0;

  private _isPlaying = false;

  playbackStartedAtAudio: number | null = null;
  playbackStartedAtWall:  number | null = null;

  private getContext(): AudioContext {
    if (!this.context) this.context = new AudioContext();
    return this.context;
  }

  /** Fetch and decode once at file selection so capture playback can be scheduled immediately. */
  async load(url: string): Promise<void> {
    const ctx = this.getContext();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch audio: ${url}`);
    const arrayBuffer = await response.arrayBuffer();
    this.buffer = await ctx.decodeAudioData(arrayBuffer);
    this.analysisSampleRate = this.buffer.sampleRate;
    this.analysisMono = AudioManager.monoMixFromAudioBuffer(this.buffer);
    this._isPlaying = false;
  }

  private static monoMixFromAudioBuffer(audioBuffer: AudioBuffer): Float32Array {
    const n = audioBuffer.length;
    const ch = audioBuffer.numberOfChannels;
    if (ch === 1) return Float32Array.from(audioBuffer.getChannelData(0));
    const out = new Float32Array(n);
    for (let c = 0; c < ch; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += data[i]! / ch;
    }
    return out;
  }

  /**
   * Point `playSequence` at a different mono waveform (e.g. residual or remix) while keeping
   * `getMonoSamples()` on the original mix for STFT phase / NMF.
   */
  replacePlaybackWithMono(samples: Float32Array, sampleRate: number): void {
    this.stop();
    const ctx = this.getContext();
    const buf = ctx.createBuffer(1, samples.length, sampleRate);
    buf.copyToChannel(Float32Array.from(samples), 0);
    this.buffer = buf;
    this._isPlaying = false;
  }

  /** Restore playback buffer from the last `load()` (original decoded file). */
  restoreAnalysisPlayback(): void {
    if (!this.analysisMono || this.analysisSampleRate == null) {
      throw new Error('AudioManager: no analysis buffer — call load() first.');
    }
    this.replacePlaybackWithMono(this.analysisMono, this.analysisSampleRate);
  }

  /** Pre-schedule repeated plays plus gaps on the Web Audio clock; returns the wall-clock start anchor. */
  async playSequence(count: number, gapSeconds: number, onAllEnded?: () => void): Promise<number> {
    if (!this.buffer) throw new Error('AudioManager: no audio loaded. Call load() first.');
    if (!Number.isInteger(count) || count < 1) {
      throw new Error('AudioManager: count must be a positive integer.');
    }
    if (!Number.isFinite(gapSeconds) || gapSeconds < 0) {
      throw new Error('AudioManager: gapSeconds must be zero or greater.');
    }

    const ctx = this.getContext();

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    this._cancelSources();
    this._gapSeconds = gapSeconds;
    this._totalPlays = count;

    const duration    = this.buffer.duration;
    const cycleLength = duration + gapSeconds;
    const startTime   = ctx.currentTime + 0.05;

    for (let i = 0; i < count; i++) {
      const source = ctx.createBufferSource();
      source.buffer = this.buffer;
      source.connect(ctx.destination);
      source.start(startTime + i * cycleLength);
      this.sources.push(source);
    }

    this.sources[count - 1].onended = () => {
      if (this._isPlaying) {
        this._isPlaying = false;
        this._totalPlays = 0;
        this.playbackStartedAtAudio = null;
        this.playbackStartedAtWall  = null;
        onAllEnded?.();
      }
    };

    this.playbackStartedAtAudio = startTime;
    this.playbackStartedAtWall  = performance.now() + Math.max(startTime - ctx.currentTime, 0) * 1000;
    this._isPlaying = true;

    return this.playbackStartedAtWall;
  }

  play(onEnded?: () => void): Promise<number> {
    return this.playSequence(1, 0, onEnded);
  }

  stop(): void {
    this._isPlaying = false;
    this._totalPlays = 0;
    this.playbackStartedAtAudio = null;
    this.playbackStartedAtWall  = null;
    this._cancelSources();
  }

  private _cancelSources(): void {
    for (const src of this.sources) {
      src.onended = null;
      try { src.stop(); } catch { /* already ended */ }
    }
    this.sources = [];
  }

  reset(): void {
    this.stop();
    this.buffer = null;
    this.analysisMono = null;
    this.analysisSampleRate = null;
  }

  getPlaybackPosition(): number | null {
    if (!this._isPlaying || this.playbackStartedAtAudio === null || !this.context || !this.buffer) {
      return null;
    }
    const elapsed      = this.context.currentTime - this.playbackStartedAtAudio;
    const cycleLength  = this.buffer.duration + this._gapSeconds;
    const posInCycle   = elapsed % cycleLength;
    return posInCycle < this.buffer.duration ? posInCycle : null;
  }

  getGapPosition(): number | null {
    if (
      !this._isPlaying ||
      this.playbackStartedAtAudio === null ||
      !this.context ||
      !this.buffer ||
      this._gapSeconds <= 0
    ) return null;

    const elapsed     = this.context.currentTime - this.playbackStartedAtAudio;
    const cycleLength = this.buffer.duration + this._gapSeconds;
    const posInCycle  = elapsed % cycleLength;

    if (posInCycle < this.buffer.duration) return null;
    return (posInCycle - this.buffer.duration) / this._gapSeconds;
  }

  getTimeline(): PlaybackTimeline {
    const empty: PlaybackTimeline = {
      phase: 'idle',
      playProgress: 0,
      gapProgress: 0,
      elapsedSeconds: 0,
      totalSeconds: 0,
      currentPlay: 0,
      totalPlays: this._totalPlays,
    };

    if (!this._isPlaying || this.playbackStartedAtAudio === null || !this.context || !this.buffer) {
      return empty;
    }

    const duration = this.buffer.duration;
    const cycleLength = duration + this._gapSeconds;
    const totalSeconds = this._totalPlays * duration + Math.max(this._totalPlays - 1, 0) * this._gapSeconds;
    const elapsedSeconds = this.context.currentTime - this.playbackStartedAtAudio;

    if (elapsedSeconds < 0) {
      return { ...empty, phase: 'lead-in', totalSeconds, totalPlays: this._totalPlays };
    }

    if (elapsedSeconds >= totalSeconds) {
      return {
        phase: 'ended',
        playProgress: 0,
        gapProgress: 0,
        elapsedSeconds: totalSeconds,
        totalSeconds,
        currentPlay: this._totalPlays,
        totalPlays: this._totalPlays,
      };
    }

    const cycleIndex = Math.floor(elapsedSeconds / cycleLength);
    const posInCycle = elapsedSeconds - cycleIndex * cycleLength;
    const currentPlay = cycleIndex + 1;

    if (posInCycle < duration) {
      return {
        phase: 'audio',
        playProgress: Math.min(posInCycle / duration, 1),
        gapProgress: 0,
        elapsedSeconds,
        totalSeconds,
        currentPlay,
        totalPlays: this._totalPlays,
      };
    }

    return {
      phase: 'gap',
      playProgress: 0,
      gapProgress: this._gapSeconds > 0 ? Math.min((posInCycle - duration) / this._gapSeconds, 1) : 0,
      elapsedSeconds,
      totalSeconds,
      currentPlay,
      totalPlays: this._totalPlays,
    };
  }

  getPlayWindow(playNumber: number): PlaybackWindow | null {
    if (
      playNumber < 1 ||
      playNumber > this._totalPlays ||
      this.playbackStartedAtWall === null ||
      !this.buffer
    ) {
      return null;
    }

    const startOffsetSeconds = (playNumber - 1) * (this.buffer.duration + this._gapSeconds);
    const startWallMs = this.playbackStartedAtWall + startOffsetSeconds * 1000;
    return {
      playNumber,
      startWallMs,
      endWallMs: startWallMs + this.buffer.duration * 1000,
      durationSeconds: this.buffer.duration,
    };
  }

  getBufferInfo(): AudioBufferInfo | null {
    if (!this.buffer) return null;
    return {
      durationSeconds: this.buffer.duration,
      sampleRate: this.buffer.sampleRate,
      sampleFrames: this.buffer.length,
      channels: this.buffer.numberOfChannels,
    };
  }

  isPlaying(): boolean { return this._isPlaying; }
  isLoaded():  boolean { return this.buffer !== null; }
  getDuration(): number | null { return this.buffer?.duration ?? null; }

  /** Mono mix of the **original** loaded file — unchanged when playback buffer is residual/remix. */
  getMonoSamples(): Float32Array | null {
    if (this.analysisMono) return Float32Array.from(this.analysisMono);
    if (!this.buffer) return null;
    return AudioManager.monoMixFromAudioBuffer(this.buffer);
  }
}

export const audioManager = new AudioManager();
