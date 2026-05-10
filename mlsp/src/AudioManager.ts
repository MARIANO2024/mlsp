// =============================================================================
// AudioManager.ts
// =============================================================================
//
// CONCEPT: WEB AUDIO API vs HTMLAudioElement
// ─────────────────────────────────────────────────────────────────────────────
// There are two ways to play audio in a browser:
//
//   HTMLAudioElement  (<audio> tag or `new Audio(url)`)
//     • Easy to use, good for simple playback
//     • Timing is imprecise — play() can drift by 10–50 ms
//
//   Web Audio API  (AudioContext + AudioBufferSourceNode)
//     • Designed for games, music apps, anything needing sample-accurate scheduling
//     • AudioContext.currentTime is a high-resolution clock advanced at sample rate
//     • source.start(when) schedules playback to the exact sample
//     • This is what we use here
//
// CHAIN OF CONNECTIONS:
//
//   fetch(url)
//       │  ArrayBuffer (raw bytes)
//       ▼
//   audioContext.decodeAudioData()
//       │  AudioBuffer (decoded PCM samples in memory)
//       ▼
//   AudioBufferSourceNode × N   ← all pre-scheduled before the first plays
//       │  .connect()
//       ▼
//   AudioDestinationNode    (the speakers / system output)
//
// WHY PRE-SCHEDULE ALL REPETITIONS?
// ─────────────────────────────────────────────────────────────────────────────
// Naively, you might think: play once → wait for onended → play again.
// The problem is that onended fires slightly AFTER the last sample, on the JS
// main thread, which then schedules the next source.start(0). This introduces
// a gap proportional to the JS event loop latency (often 5–30 ms) — audible
// as a stutter or blip between repetitions.
//
// The correct approach: before the first sound plays, create ALL N source nodes
// and schedule them at staggered absolute times on the audio clock:
//
//   source[0].start( T )              ← plays at audio time T
//   source[1].start( T + duration )   ← plays exactly when [0] ends
//   source[2].start( T + 2*duration ) ← etc.
//
// The audio engine handles all the timing internally in its render thread,
// independently of JS — transitions are sample-perfect with zero gap.
//
// TIMING ANCHORS FOR VIDEO SYNC:
//   playbackStartedAtAudio = T (the scheduled start on the audio clock)
//   playbackStartedAtWall  = performance.now() at the moment we called start()
//   → pass playbackStartedAtWall to MediaRecorder.start() for tight sync.
//
// =============================================================================

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
  // The root of the Web Audio graph. Created lazily — browsers may suspend
  // an AudioContext created before a user gesture.
  private context: AudioContext | null = null;

  // Decoded PCM data — reused across all source nodes and repetitions.
  private buffer: AudioBuffer | null = null;

  // All pre-scheduled source nodes for the current sequence.
  // Kept so stop() can cancel every node, not just the first.
  private sources: AudioBufferSourceNode[] = [];

  // Gap in seconds between repetitions (0 = seamless loop).
  // Stored so getPlaybackPosition() can correctly report null during silences.
  private _gapSeconds = 0;
  private _totalPlays = 0;

  private _isPlaying = false;

  // ---------------------------------------------------------------------------
  // TIMING ANCHORS
  //
  //   playbackStartedAtAudio:  audioContext.currentTime of the first scheduled
  //                            source.start(). The audio clock's T=0.
  //
  //   playbackStartedAtWall:   performance.now() captured at the same instant.
  //                            Used to correlate audio time with MediaRecorder.
  // ---------------------------------------------------------------------------
  playbackStartedAtAudio: number | null = null;
  playbackStartedAtWall:  number | null = null;

  private getContext(): AudioContext {
    if (!this.context) this.context = new AudioContext();
    return this.context;
  }

  // ---------------------------------------------------------------------------
  // load(url)
  //
  // Fetches an audio file and decodes it into an AudioBuffer once.
  // Decoding is CPU-intensive; doing it at selection time avoids any latency
  // at the moment the user clicks Play.
  // ---------------------------------------------------------------------------
  async load(url: string): Promise<void> {
    const ctx = this.getContext();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch audio: ${url}`);
    const arrayBuffer = await response.arrayBuffer();
    this.buffer = await ctx.decodeAudioData(arrayBuffer);
    this._isPlaying = false;
  }

  // ---------------------------------------------------------------------------
  // playSequence(count, gapSeconds, onAllEnded?)
  //
  // Pre-schedules `count` plays of the buffer, separated by `gapSeconds` of
  // silence, all on the audio clock before the first sound plays.
  //
  // HOW THE SCHEDULING WORKS:
  //   cycleLength = buffer.duration + gapSeconds
  //   T = audioContext.currentTime
  //   source[i].start( T + i * cycleLength )
  //
  //   play 0: T  →  T + duration          (sound)
  //   gap   : T + duration  →  T + cycleLength  (silence, nothing scheduled)
  //   play 1: T + cycleLength  →  T + cycleLength + duration  (sound)
  //   …
  //
  // The gap is pure scheduled silence — the audio engine idles during that
  // window with no JS involvement, so there is no stutter or callback latency.
  //
  // Only the LAST source gets an onended callback.
  //
  // Returns: playbackStartedAtWall — wall-clock ms anchor for MediaRecorder sync.
  // ---------------------------------------------------------------------------
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
    // Schedule slightly ahead of the current audio clock so the first source is
    // not late if the main thread is doing layout or React work.
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

  // Convenience wrapper for a single play with no gap
  play(onEnded?: () => void): Promise<number> {
    return this.playSequence(1, 0, onEnded);
  }

  // ---------------------------------------------------------------------------
  // stop()
  //
  // Cancels all scheduled source nodes immediately. The buffer stays loaded.
  // Flipping _isPlaying before calling .stop() suppresses the onended callback
  // so onAllEnded doesn't fire for a user-initiated stop.
  // ---------------------------------------------------------------------------
  stop(): void {
    this._isPlaying = false;
    this._totalPlays = 0;
    this.playbackStartedAtAudio = null;
    this.playbackStartedAtWall  = null;
    this._cancelSources();
  }

  private _cancelSources(): void {
    for (const src of this.sources) {
      src.onended = null; // prevent stale callbacks
      try { src.stop(); } catch { /* already ended */ }
    }
    this.sources = [];
  }

  // ---------------------------------------------------------------------------
  // reset()
  //
  // stop() + clear the buffer. Use when switching audio files.
  // ---------------------------------------------------------------------------
  reset(): void {
    this.stop();
    this.buffer = null;
  }

  // ---------------------------------------------------------------------------
  // getPlaybackPosition()
  //
  // Returns the playhead position in seconds within the CURRENT play cycle,
  // using audioContext.currentTime — the audio engine's own clock.
  //
  // During the gap (silence) between repetitions, returns null so the
  // progress bar can go dark rather than freezing at 100%.
  //
  //   cycleLength = duration + gapSeconds
  //   posInCycle  = elapsed % cycleLength
  //   posInCycle < duration  → playing  → return posInCycle
  //   posInCycle ≥ duration  → in gap   → return null
  //
  // Returns null when not playing at all (bar should be empty).
  // ---------------------------------------------------------------------------
  getPlaybackPosition(): number | null {
    if (!this._isPlaying || this.playbackStartedAtAudio === null || !this.context || !this.buffer) {
      return null;
    }
    const elapsed      = this.context.currentTime - this.playbackStartedAtAudio;
    const cycleLength  = this.buffer.duration + this._gapSeconds;
    const posInCycle   = elapsed % cycleLength;
    return posInCycle < this.buffer.duration ? posInCycle : null;
  }

  // ---------------------------------------------------------------------------
  // getGapPosition()
  //
  // Mirror of getPlaybackPosition() but for the silence window.
  // Returns a 0→1 value representing progress through the gap, or null when
  // audio is actively playing (or when there is no gap, or not playing at all).
  //
  //   posInCycle ≥ duration  → in gap  → return (posInCycle - duration) / gapSeconds
  //   posInCycle < duration  → playing → return null
  // ---------------------------------------------------------------------------
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

    if (posInCycle < this.buffer.duration) return null; // still playing
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

  /** Mono mix (or single channel) as a **copy** suited for offline STFT/NMF. */
  getMonoSamples(): Float32Array | null {
    if (!this.buffer) return null;
    const n = this.buffer.length;
    const ch = this.buffer.numberOfChannels;
    if (ch === 1) return Float32Array.from(this.buffer.getChannelData(0));
    const out = new Float32Array(n);
    for (let c = 0; c < ch; c++) {
      const data = this.buffer.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += data[i]! / ch;
    }
    return out;
  }
}

export const audioManager = new AudioManager();
