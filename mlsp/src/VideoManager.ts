// =============================================================================
// VideoManager.ts
// =============================================================================
//
// CONCEPT: THE BROWSER CAMERA PIPELINE
// ─────────────────────────────────────────────────────────────────────────────
// Accessing the camera in a browser involves three distinct layers:
//
//   1. MediaStream  — the raw, live data source coming from the hardware.
//                     Think of it as an open pipe from the camera sensor.
//                     It is composed of one or more MediaStreamTrack objects
//                     (one per camera, one per mic, etc.).
//
//   2. HTMLVideoElement — a DOM node that *renders* a MediaStream to the screen.
//                     You connect the stream to it via `el.srcObject = stream`.
//                     The video element does NOT own the stream; it just reads it.
//
//   3. MediaRecorder — (used later) reads the same MediaStream and encodes it
//                     into a file format in memory. Crucially, MediaRecorder and
//                     HTMLVideoElement can both consume the same stream at the same
//                     time — one for display, one for capture.
//
// CHAIN OF CONNECTIONS IN THIS APP:
//
//   navigator.mediaDevices.getUserMedia()
//       │  returns
//       ▼
//   MediaStream  ──────────────────────────────────────────────────┐
//       │  stored in VideoManager.stream                           │
//       │                                                          │
//       │  videoManager.attachToElement(videoRef.current)         │
//       ▼                                                          │
//   <video> element   (live preview on screen)                     │
//                                                                  │ (future)
//                                           new MediaRecorder(stream)
//                                               │  encodes frames
//                                               ▼
//                                           Blob  →  WAV / WebM file
//
// WHY A CLASS?
// A plain module-level object would work, but a class makes it easy to:
//   - hold the stream as private state that can't be accidentally mutated
//   - add MediaRecorder later without touching App.tsx
//   - mock/replace in tests
// =============================================================================

export type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'error';

export class VideoManager {
  // The live stream coming from the camera hardware.
  // null means the camera hasn't been opened yet (or was stopped).
  private stream: MediaStream | null = null;

  // ---------------------------------------------------------------------------
  // initialize()
  //
  // Calls the Web API that asks the browser (and OS) for camera permission.
  // The browser shows its own permission dialog — no custom UI needed.
  //
  // getUserMedia() accepts a MediaStreamConstraints object:
  //   { video: ..., audio: ... }
  // Each side can be `false` (don't request), `true` (accept any device), or
  // an object of MediaTrackConstraints (resolution, facing mode, frame rate…).
  //
  // Returns a Promise that resolves to a MediaStream on approval,
  // or rejects with a DOMException on denial / hardware error.
  // ---------------------------------------------------------------------------
  async initialize(): Promise<MediaStream> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',      // prefer front-facing camera
        width:  { ideal: 1280 }, // request HD; browser will do its best
        height: { ideal: 720 },
      },
      audio: false, // we capture the mic separately via Web Audio API later
    });
    return this.stream;
  }

  // ---------------------------------------------------------------------------
  // attachToElement(el)
  //
  // Connects the live stream to an <video> DOM element for on-screen display.
  //
  // `srcObject` is the modern property for live/stream sources.
  // (The older `src` attribute only accepts URL strings — blob: or http: —
  //  not live MediaStream objects.)
  //
  // After setting srcObject, the video element needs autoPlay (or a .play()
  // call) to actually start rendering frames. We set autoPlay in JSX.
  // ---------------------------------------------------------------------------
  attachToElement(el: HTMLVideoElement) {
    el.srcObject = this.stream;
  }

  // ---------------------------------------------------------------------------
  // detachFromElement(el)
  //
  // Nulls out the srcObject so the element stops rendering. This does NOT stop
  // the underlying stream — other consumers (e.g. MediaRecorder) keep working.
  // ---------------------------------------------------------------------------
  detachFromElement(el: HTMLVideoElement) {
    el.srcObject = null;
  }

  // ---------------------------------------------------------------------------
  // stop()
  //
  // Stops every track inside the stream and releases the hardware.
  // Important: setting srcObject = null alone does NOT release the camera;
  // you must explicitly call .stop() on each MediaStreamTrack.
  // The browser camera indicator light (🟢) only turns off after all tracks stop.
  // ---------------------------------------------------------------------------
  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  // ---------------------------------------------------------------------------
  // getStream()
  //
  // Exposes the raw MediaStream so other parts of the app (e.g. MediaRecorder,
  // Web Audio AnalyserNode) can consume the same stream without going through
  // the DOM element.
  // ---------------------------------------------------------------------------
  getStream(): MediaStream | null {
    return this.stream;
  }
}

// Export a singleton so every module in the app shares the same stream object.
// This means attachToElement(), getStream(), stop() all refer to the exact same
// MediaStream instance regardless of which file calls them.
export const videoManager = new VideoManager();
