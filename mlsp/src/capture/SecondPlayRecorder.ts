import type { PlaybackWindow } from '../AudioManager';

export interface SecondPlayRecorderHandlers {
  onWaiting: () => void;
  onRecordingStarted: (actualStartWallMs: number) => void;
  onRecorderError: () => void;
  onComplete: (payload: { blob: Blob; mimeType: string; actualStopWallMs: number }) => void | Promise<void>;
}

export interface SecondPlayScheduleParams extends SecondPlayRecorderHandlers {
  stream: MediaStream;
  recorderOptions?: MediaRecorderOptions;
  windowInfo: PlaybackWindow;
}

/**
 * Browser MediaRecorder for the scheduled second-play window only: timeouts, chunk collection, cancel safety.
 */
export class SecondPlayRecorder {
  private timers: number[] = [];
  private recorder: MediaRecorder | null = null;
  /** Bumped on cancel and on each schedule so stale recorder.onstop never calls handlers. */
  private sessionEpoch = 0;

  cancel(): void {
    this.sessionEpoch++;
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    const r = this.recorder;
    this.recorder = null;
    if (r && r.state !== 'inactive') {
      try {
        r.stop();
      } catch {
        /* already stopped */
      }
    }
  }

  schedule(params: SecondPlayScheduleParams): void {
    this.cancel();
    const epochAtSchedule = ++this.sessionEpoch;

    const { stream, recorderOptions, windowInfo, onWaiting, onRecordingStarted, onRecorderError, onComplete } =
      params;

    const chunks: BlobPart[] = [];

    const recorder = new MediaRecorder(stream, recorderOptions ?? undefined);
    this.recorder = recorder;

    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onerror = () => {
      if (epochAtSchedule !== this.sessionEpoch) return;
      onRecorderError();
      this.recorder = null;
    };

    recorder.onstop = async () => {
      if (epochAtSchedule !== this.sessionEpoch) return;
      const actualStopWallMs = performance.now();
      this.recorder = null;
      this.timers = [];

      if (chunks.length === 0) {
        onRecorderError();
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      await onComplete({ blob, mimeType: recorder.mimeType || 'video/webm', actualStopWallMs });
    };

    onWaiting();

    const startDelayMs = Math.max(windowInfo.startWallMs - performance.now(), 0);
    const stopDelayMs = Math.max(windowInfo.endWallMs - performance.now(), 0);

    const startTimer = window.setTimeout(() => {
      if (epochAtSchedule !== this.sessionEpoch || recorder.state !== 'inactive') return;
      const actualStartWallMs = performance.now();
      onRecordingStarted(actualStartWallMs);
      recorder.start();
    }, startDelayMs);

    const stopTimer = window.setTimeout(() => {
      if (epochAtSchedule !== this.sessionEpoch || recorder.state !== 'recording') return;
      recorder.stop();
    }, stopDelayMs);

    this.timers = [startTimer, stopTimer];
  }
}
