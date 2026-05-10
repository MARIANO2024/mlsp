// =============================================================================
// App.tsx
// =============================================================================
//
// CONNECTION CHAINS:
//
//  CAMERA:
//   App mounts → startCamera() → videoManager.initialize()
//     → getUserMedia() → MediaStream → videoManager.attachToElement(videoRef)
//       → <video>.srcObject = stream → browser renders frames
//
//  AUDIO:
//   musicFiles.ts discovers files under public/music at build/dev-server start
//   User clicks "Select Audio" → dropdown opens → user picks file
//     → audioManager.load("/music/<file>") → fetch + decodeAudioData → AudioBuffer
//   User clicks "Play Sync Proof" → audioManager.playSequence(...)
//     → AudioBufferSourceNodes are scheduled on AudioContext.currentTime
//     → App reads audioManager.getTimeline() every animation frame for both bars
//
//  VIDEO SYNC:
//   audioManager exposes the second play's scheduled wall-clock window
//   → MediaRecorder starts/stops against that same window and downloads WebM
//
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import './index.css';
import { videoManager } from './VideoManager';
import { audioManager, type PlaybackTimeline, type PlaybackWindow } from './AudioManager';
import { useAppStore } from './stores/useAppStore';
import { musicFiles } from './musicFiles';
import { PostCaptureNmfOrchestrator, POST_CAPTURE_NMF, type AudioNmfFactorization } from './nmf/PostCaptureNmfOrchestrator';
import { AudioNmfFactorizationPlots } from './nmf/NmfPlots';

// Single source of truth for the column width — change here to resize everything.
const W = '78%';

const BTN_BASE: React.CSSProperties = {
  flex: 1,
  padding: '18px 0',
  fontSize: '16px',
  fontWeight: 600,
  border: 'none',
  borderRadius: '10px',
  color: '#fff',
  cursor: 'pointer',
  letterSpacing: '0.5px',
  transition: 'filter 0.15s',
};

const EMPTY_TIMELINE: PlaybackTimeline = {
  phase: 'idle',
  playProgress: 0,
  gapProgress: 0,
  elapsedSeconds: 0,
  totalSeconds: 0,
  currentPlay: 0,
  totalPlays: 0,
};

type RecordingStatus = 'idle' | 'waiting' | 'recording' | 'saving' | 'saved' | 'error';

interface PreviewFrame {
  label: string;
  url: string;
}

interface VideoMatrixResult {
  width: number;
  height: number;
  frameCount: number;
  matrix: number[][];
  previews: PreviewFrame[];
}

const VIDEO_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

const MATRIX_FRAME_WIDTH = 80;

function getSupportedVideoMimeType(): string | undefined {
  return VIDEO_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function makeMatrixFilename(videoFilename: string) {
  return videoFilename.replace(/\.webm$/i, '_matrix.json');
}

function formatMs(ms: number) {
  return `${ms.toFixed(2)} ms`;
}

function formatMasterTime(ms: number | null) {
  return ms === null ? 'pending' : `${ms.toFixed(2)} ms`;
}

function formatDelta(videoMs: number | null, audioMs: number | null) {
  if (videoMs === null || audioMs === null) return 'pending';
  const delta = videoMs - audioMs;
  const direction = delta > 0 ? 'video late' : delta < 0 ? 'video early' : 'aligned';
  return `${delta >= 0 ? '+' : ''}${formatMs(delta)} (${direction})`;
}

function frameColumnToPreviewUrl(column: Uint8ClampedArray, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create preview canvas.');

  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gray = column[x * height + y]; // undo order="F": row index = x * height + y
      const offset = (y * width + x) * 4;
      image.data[offset] = gray;
      image.data[offset + 1] = gray;
      image.data[offset + 2] = gray;
      image.data[offset + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

async function extractVideoMatrix(blob: Blob, targetWidth = MATRIX_FRAME_WIDTH): Promise<VideoMatrixResult> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  const objectUrl = URL.createObjectURL(blob);
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not load recorded video for matrix extraction.'));
    });

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      throw new Error('Recorded video has no decodable dimensions.');
    }

    const width = targetWidth;
    const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not create extraction canvas.');

    const columns: Uint8ClampedArray[] = [];

    await new Promise<void>((resolve, reject) => {
      video.onerror = () => reject(new Error('Video decode failed during matrix extraction.'));
      video.onended = () => resolve();

      const captureFrame = () => {
        ctx.drawImage(video, 0, 0, width, height);
        const rgba = ctx.getImageData(0, 0, width, height).data;
        const column = new Uint8ClampedArray(width * height);

        for (let x = 0; x < width; x++) {
          for (let y = 0; y < height; y++) {
            const rgbaOffset = (y * width + x) * 4;
            const gray = Math.round(
              0.299 * rgba[rgbaOffset] +
              0.587 * rgba[rgbaOffset + 1] +
              0.114 * rgba[rgbaOffset + 2],
            );
            column[x * height + y] = gray; // flatten frame with order="F"
          }
        }

        columns.push(column);
      };

      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        const onVideoFrame: VideoFrameRequestCallback = () => {
          if (video.ended || video.paused) return;
          captureFrame();
          video.requestVideoFrameCallback(onVideoFrame);
        };
        video.requestVideoFrameCallback(onVideoFrame);
      } else {
        const interval = window.setInterval(() => {
          if (video.ended || video.paused) {
            window.clearInterval(interval);
            return;
          }
          captureFrame();
        }, 1000 / 30);
      }

      video.play().catch(reject);
    });

    if (columns.length === 0) {
      throw new Error('No frames were extracted from the recorded video.');
    }

    const rowCount = width * height;
    const matrix = Array.from({ length: rowCount }, (_, row) =>
      columns.map(column => column[row]),
    );

    const previewIndices = [
      0,
      Math.floor((columns.length - 1) / 2),
      columns.length - 1,
    ];

    const previews = previewIndices.map((frameIndex, i) => ({
      label: i === 0 ? 'First frame' : i === 1 ? 'Middle frame' : 'Last frame',
      url: frameColumnToPreviewUrl(columns[frameIndex], width, height),
    }));

    return { width, height, frameCount: columns.length, matrix, previews };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function App() {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);

  // ── Store slices ──────────────────────────────────────────────────────────
  const cameraStatus       = useAppStore(s => s.cameraStatus);
  const setCameraStatus    = useAppStore(s => s.setCameraStatus);
  const selectedAudio      = useAppStore(s => s.selectedAudio);
  const setSelectedAudio   = useAppStore(s => s.setSelectedAudio);
  const audioLoadStatus    = useAppStore(s => s.audioLoadStatus);
  const setAudioLoadStatus = useAppStore(s => s.setAudioLoadStatus);
  const isPlaying          = useAppStore(s => s.isPlaying);
  const setIsPlaying       = useAppStore(s => s.setIsPlaying);

  // ── Local UI state ────────────────────────────────────────────────────────
  const [showFileList, setShowFileList] = useState(false);

  // One timeline snapshot drives both bars so React never renders mismatched
  // audio/pause progress from separate state updates.
  const [timeline, setTimeline] = useState<PlaybackTimeline>(EMPTY_TIMELINE);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
  const [lastRecordingName, setLastRecordingName] = useState<string | null>(null);
  const [matrixShape, setMatrixShape] = useState<string | null>(null);
  const [previewFrames, setPreviewFrames] = useState<PreviewFrame[]>([]);
  const [audioNmf, setAudioNmf] = useState<AudioNmfFactorization | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  /** Loading-overlay copy while post-capture pipeline runs (step-specific). */
  const [capturePipelinePhase, setCapturePipelinePhase] = useState<{
    headline: string;
    body: string;
  } | null>(null);
  const [syncConsoleLines, setSyncConsoleLines] = useState<string[]>([
    'Run Play + Capture Play 2 to collect sync timing.',
  ]);

  const rafRef = useRef<number>(0);
  const loadRequestRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimersRef = useRef<number[]>([]);
  const discardRecordingRef = useRef(false);
  const audioWindowRef = useRef<PlaybackWindow | null>(null);
  const videoStartWallRef = useRef<number | null>(null);
  const videoEndWallRef = useRef<number | null>(null);

  // ── Camera init ───────────────────────────────────────────────────────────
  async function startCamera() {
    if (cameraStatus === 'active' || cameraStatus === 'requesting') return;
    setCameraStatus('requesting');
    try {
      await videoManager.initialize();
      setCameraStatus('active');
      if (videoRef.current) videoManager.attachToElement(videoRef.current);
    } catch (err) {
      const isDenied =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setCameraStatus(isDenied ? 'denied' : 'error');
    }
  }

  // Re-attach if React re-creates the <video> element
  useEffect(() => {
    if (cameraStatus === 'active' && videoRef.current) {
      videoManager.attachToElement(videoRef.current);
    }
  }, [cameraStatus]);

  // ── Mount / unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    startCamera();
    return () => {
      cancelScheduledRecording(false);
      videoManager.stop();
      audioManager.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetSyncConsole(message = 'Sync console reset.') {
    audioWindowRef.current = null;
    videoStartWallRef.current = null;
    videoEndWallRef.current = null;
    setSyncConsoleLines([message]);
    setMatrixShape(null);
    setPreviewFrames([]);
    setAudioNmf(null);
  }

  function setSyncSummary(audioWindow: PlaybackWindow | null, videoStart: number | null, videoEnd: number | null) {
    setSyncConsoleLines([
      `audio start: ${formatMasterTime(audioWindow?.startWallMs ?? null)}`,
      `audio end:   ${formatMasterTime(audioWindow?.endWallMs ?? null)}`,
      `video start: ${formatMasterTime(videoStart)}`,
      `video end:   ${formatMasterTime(videoEnd)}`,
      `start delta: ${formatDelta(videoStart, audioWindow?.startWallMs ?? null)}`,
      `end delta:   ${formatDelta(videoEnd, audioWindow?.endWallMs ?? null)}`,
    ]);
  }

  function cancelScheduledRecording(updateStatus = true) {
    for (const timer of recordingTimersRef.current) {
      window.clearTimeout(timer);
    }
    recordingTimersRef.current = [];

    const recorder = recorderRef.current;
    discardRecordingRef.current = true;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    recorderRef.current = null;
    if (updateStatus) {
      setRecordingStatus('idle');
      setIsCalculating(false);
      setCapturePipelinePhase(null);
      resetSyncConsole('Attempt cancelled; timing console reset.');
    }
  }

  function makeRecordingName() {
    const stem = selectedAudio?.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_') || 'sync_capture';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${stem}_play2_${timestamp}.webm`;
  }

  function scheduleSecondPlayRecording(windowInfo: PlaybackWindow) {
    const stream = videoManager.getStream();
    if (!stream) {
      throw new Error('Camera stream is not available.');
    }

    const mimeType = getSupportedVideoMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: BlobPart[] = [];
    const filename = makeRecordingName();
    discardRecordingRef.current = false;
    audioWindowRef.current = windowInfo;
    videoStartWallRef.current = null;
    videoEndWallRef.current = null;
    setSyncSummary(windowInfo, null, null);

    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onerror = () => {
      setRecordingStatus('error');
      recorderRef.current = null;
    };

    recorder.onstop = async () => {
      const actualStopWallMs = performance.now();
      videoEndWallRef.current = actualStopWallMs;
      recorderRef.current = null;
      recordingTimersRef.current = [];
      if (discardRecordingRef.current) {
        discardRecordingRef.current = false;
        return;
      }
      if (chunks.length === 0) {
        setRecordingStatus('error');
        return;
      }

      setRecordingStatus('saving');
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      setSyncSummary(windowInfo, videoStartWallRef.current, actualStopWallMs);
      setIsCalculating(true);
      setCapturePipelinePhase({
        headline: 'Video matrix',
        body: 'Decoding WebM and building grayscale matrix X (per-frame columns).',
      });
      setShowFileList(false);
      await new Promise<void>(r => requestAnimationFrame(() => r()));

      try {
        const videoMatrix = await extractVideoMatrix(blob);
        const matrixFilename = makeMatrixFilename(filename);
        const matrixBlob = new Blob([
          JSON.stringify({
            width: videoMatrix.width,
            height: videoMatrix.height,
            frameCount: videoMatrix.frameCount,
            flattenOrder: 'F',
            shape: [videoMatrix.width * videoMatrix.height, videoMatrix.frameCount],
            matrix: videoMatrix.matrix,
          }),
        ], { type: 'application/json' });

        downloadBlob(blob, filename);
        downloadBlob(matrixBlob, matrixFilename);
        setLastRecordingName(matrixFilename);
        setMatrixShape(`${videoMatrix.width * videoMatrix.height} x ${videoMatrix.frameCount}`);
        setPreviewFrames(videoMatrix.previews);

        const mono = audioManager.getMonoSamples();
        if (!mono) {
          throw new Error('No decoded audio in memory. Select and load a track before capture.');
        }
        const { audio } = await PostCaptureNmfOrchestrator.run(
          videoMatrix.matrix,
          mono,
          (headline, body) => setCapturePipelinePhase({ headline, body }),
        );
        setAudioNmf(audio);

        setRecordingStatus('saved');
      } catch (err) {
        setRecordingStatus('error');
        setAudioNmf(null);
        setSyncConsoleLines([
          `Post-capture pipeline failed: ${err instanceof Error ? err.message : 'unknown error'}.`,
        ]);
      } finally {
        setIsCalculating(false);
        setCapturePipelinePhase(null);
      }
    };

    recorderRef.current = recorder;
    setLastRecordingName(null);
    setMatrixShape(null);
    setPreviewFrames([]);
    setAudioNmf(null);
    setRecordingStatus('waiting');

    const startDelayMs = Math.max(windowInfo.startWallMs - performance.now(), 0);
    const stopDelayMs = startDelayMs + windowInfo.durationSeconds * 1000;

    const startTimer = window.setTimeout(() => {
      if (recorder.state === 'inactive') {
        const actualStartWallMs = performance.now();
        videoStartWallRef.current = actualStartWallMs;
        recorder.start();
        setRecordingStatus('recording');
        setSyncSummary(windowInfo, actualStartWallMs, null);
      }
    }, startDelayMs);

    const stopTimer = window.setTimeout(() => {
      if (recorder.state === 'recording') {
        recorder.stop();
      }
    }, stopDelayMs);

    recordingTimersRef.current = [startTimer, stopTimer];
  }

  // ── Playback progress bar ─────────────────────────────────────────────────
  //
  // requestAnimationFrame fires just before each screen repaint (~60 fps).
  //
  // SYNC STRATEGY — use audioContext.currentTime, NOT performance.now():
  //   audioContext.currentTime is the audio engine's own clock, advanced by the
  //   audio hardware at sample-rate precision. It is the exact same clock that
  //   determines which sample is playing right now. Using it means the bar
  //   position is computed from the identical source as the sound you hear —
  //   they literally cannot be out of sync.
  //
  //   performance.now() is the wall clock — it runs independently of the audio
  //   pipeline and can diverge under CPU load or when the browser throttles.
  //
  // audioManager.getTimeline() returns one snapshot from that clock. Both bars
  // come from the same read so the audio and pause indicators cannot disagree.
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    function tick() {
      setTimeline(audioManager.getTimeline());
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying]);

  // ── Audio: select file ────────────────────────────────────────────────────
  async function selectFile(filename: string, url: string) {
    if (isCalculating) return;
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setShowFileList(false);

    if (isPlaying) {
      audioManager.stop();
      cancelScheduledRecording();
      setIsPlaying(false);
      setTimeline(EMPTY_TIMELINE);
    }

    audioManager.reset();
    setSelectedAudio(filename);
    setAudioLoadStatus('loading');
    setMatrixShape(null);
    setPreviewFrames([]);
    setAudioNmf(null);

    try {
      // url is already the correct served path, e.g. "/music/snare.wav"
      await audioManager.load(url);
      if (requestId !== loadRequestRef.current) return;
      setAudioLoadStatus('ready');
    } catch {
      if (requestId !== loadRequestRef.current) return;
      setAudioLoadStatus('error');
    }
  }

  // ── Audio: play / stop toggle ─────────────────────────────────────────────
  //
  // PLAY SEQUENCE: 2 repetitions with a long, explicitly visualized pause.
  //
  // audioManager.playSequence(2, ...) pre-schedules BOTH plays on the audio
  // clock before the first one starts — no JS callback chaining between them,
  // so there is literally no opportunity for a stutter.
  //
  // The progress bar's rAF loop reads the same scheduled timeline that drives
  // the play-2 video capture window.
  //
  // Change TOTAL_PLAYS or GAP_SECONDS to adjust the sequence.
  const TOTAL_PLAYS = 2;
  const GAP_SECONDS = 2; // silence between the two plays

  async function handlePlayStop() {
    if (isCalculating) return;
    if (isPlaying) {
      audioManager.stop();
      cancelScheduledRecording();
      setIsPlaying(false);
      setTimeline(EMPTY_TIMELINE);
      return;
    }
    try {
      await audioManager.playSequence(TOTAL_PLAYS, GAP_SECONDS, () => {
        setIsPlaying(false);
        setTimeline(EMPTY_TIMELINE);
      });
      const firstPlayWindow = audioManager.getPlayWindow(1);
      const secondPlayWindow = audioManager.getPlayWindow(2);
      if (!firstPlayWindow || !secondPlayWindow) {
        throw new Error('Could not calculate scheduled play windows.');
      }
      scheduleSecondPlayRecording(secondPlayWindow);
      setIsPlaying(true);
    } catch (err) {
      audioManager.stop();
      cancelScheduledRecording();
      setRecordingStatus('error');
      setAudioLoadStatus('error');
      setIsPlaying(false);
      setTimeline(EMPTY_TIMELINE);
      setSyncConsoleLines([
        `Attempt failed: ${err instanceof Error ? err.message : 'unknown error'}.`,
      ]);
    }
  }

  // ── Derived UI labels ─────────────────────────────────────────────────────
  const selectLabel = audioLoadStatus === 'loading' ? 'Loading…' : 'Select Audio';

  const playLabel =
    isPlaying                       ? 'Stop'
    : audioLoadStatus === 'loading' ? '…'
    : 'Play + Capture Play 2';

  const playDisabled = (audioLoadStatus !== 'ready' && !isPlaying) || isCalculating;

  const controlsLocked = isCalculating;
  const phaseLabel =
    timeline.phase === 'audio' ? `Audio ${timeline.currentPlay}/${timeline.totalPlays}`
    : timeline.phase === 'gap' ? 'Long pause'
    : timeline.phase === 'lead-in' ? 'Scheduled'
    : 'Idle';

  const elapsedLabel = timeline.totalSeconds > 0
    ? `${timeline.elapsedSeconds.toFixed(2)}s / ${timeline.totalSeconds.toFixed(2)}s`
    : 'Select an audio file to run the sync proof';

  const recordingLabel: Record<RecordingStatus, string> = {
    idle: 'Second-play video capture is armed when playback starts.',
    waiting: 'Video capture waiting for play 2.',
    recording: 'Recording play 2 video now.',
    saving: 'Saving captured video.',
    saved: lastRecordingName ? `Saved ${lastRecordingName}` : 'Saved play 2 video.',
    error: 'Video capture failed.',
  };

  const showOverlay = cameraStatus !== 'active';
  const overlayMessage: Record<string, string> = {
    idle:       '',
    requesting: 'Requesting camera access…',
    denied:     'Camera access was denied. Please allow it in browser settings.',
    error:      'Could not access camera.',
  };

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingTop: '2vh',
      paddingBottom: '4vh',
      backgroundColor: '#0f0f13',
    }}>

      {/* ── Video container ──────────────────────────────────────────────── */}
      <div style={{
        position: 'relative',
        width: W,
        height: '58vh',
        backgroundColor: '#1a0000',
        borderRadius: '12px',
        overflow: 'hidden',
      }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: cameraStatus === 'active' ? 'block' : 'none',
            transform: 'scaleX(-1)',
          }}
        />
        {showOverlay && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            color: '#ccc',
            fontSize: '14px',
          }}>
            {cameraStatus === 'requesting' && (
              <div style={{
                width: '36px', height: '36px',
                border: '3px solid #555', borderTop: '3px solid #e55',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              }} />
            )}
            <span>{overlayMessage[cameraStatus]}</span>
          </div>
        )}
      </div>

      {/* ── Audio playback bar — fills while sound is playing ───────────── */}
      <div style={{
        width: W,
        height: '6px',
        marginTop: '10px',
        backgroundColor: '#1a1a2e',
        borderRadius: '2px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${timeline.playProgress * 100}%`,
          backgroundColor: '#a0a0ff',
        }} />
      </div>

      {/* ── Gap / silence bar — fills during the pause between plays ─────── */}
      <div style={{
        width: W,
        height: '6px',
        marginTop: '16px',
        backgroundColor: '#1a1a2e',
        borderRadius: '2px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${timeline.gapProgress * 100}%`,
          backgroundColor: '#e5a050',
        }} />
      </div>

      <div style={{
        width: W,
        marginTop: '10px',
        display: 'flex',
        justifyContent: 'space-between',
        color: '#8585a8',
        fontSize: '12px',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>
        <span>{phaseLabel}</span>
        <span>{elapsedLabel}</span>
      </div>

      <div style={{
        width: W,
        marginTop: '8px',
        color: recordingStatus === 'recording' ? '#e5a050' : '#777',
        fontSize: '12px',
        textAlign: 'center',
      }}>
        {recordingLabel[recordingStatus]}
      </div>

      <div style={{
        width: W,
        marginTop: '12px',
        padding: '12px 14px',
        boxSizing: 'border-box',
        backgroundColor: '#08080c',
        border: '1px solid #252542',
        borderRadius: '8px',
        color: '#b7b7d8',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '11px',
        lineHeight: 1.45,
        maxHeight: '18vh',
        overflowY: 'auto',
        whiteSpace: 'pre-wrap',
      }}>
        <div style={{ color: '#e5a050', marginBottom: '6px', fontWeight: 700 }}>
          Master Clock Sync Console
        </div>
        {syncConsoleLines.map((line, index) => (
          <div key={`${index}-${line}`}>{line}</div>
        ))}
      </div>

      {/* ── Audio file picker — appears between the video and the buttons ──
          Rendered only when the dropdown is open.
          Each row shows a filename; clicking it loads that file.            */}
      {showFileList && (
        <div style={{
          width: W,
          marginTop: '12px',
          backgroundColor: '#1a1a2e',
          borderRadius: '8px',
          overflow: 'hidden',
          border: '1px solid #2e2e4e',
        }}>
          {musicFiles.length === 0 ? (
            <div style={{ padding: '14px 16px', color: '#666', fontSize: '14px' }}>
              No audio files found. Drop .wav/.mp3 files into{' '}
              <code style={{ color: '#aaa' }}>public/music/</code> and restart
              the dev server.
            </div>
          ) : musicFiles.map(({ filename, url }) => (
            <button
              key={url}
              type="button"
              disabled={controlsLocked}
              onClick={() => selectFile(filename, url)}
              style={{
                display: 'block',
                width: '100%',
                padding: '12px 16px',
                background: filename === selectedAudio ? '#2e2e50' : 'transparent',
                border: 'none',
                borderBottom: '1px solid #2e2e4e',
                color: filename === selectedAudio ? '#a0a0ff' : '#ccc',
                fontSize: '14px',
                textAlign: 'left',
                cursor: controlsLocked ? 'not-allowed' : 'pointer',
                opacity: controlsLocked ? 0.45 : 1,
              }}
              onMouseEnter={e => {
                if (!controlsLocked) e.currentTarget.style.backgroundColor = '#25254a';
              }}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor =
                filename === selectedAudio ? '#2e2e50' : 'transparent')}
            >
              {filename}
            </button>
          ))}
        </div>
      )}

      {/* ── Buttons ──────────────────────────────────────────────────────── */}
      <div style={{
        width: W,
        display: 'flex',
        gap: '14px',
        marginTop: '16px',
      }}>

        {/* Button 1 — Select Audio: opens/closes the file picker dropdown */}
        <button
          type="button"
          style={{
            ...BTN_BASE,
            backgroundColor: showFileList ? '#2e2e50' : '#1a1a2e',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            opacity: controlsLocked ? 0.4 : 1,
            cursor: controlsLocked ? 'not-allowed' : 'pointer',
          }}
          disabled={controlsLocked}
          onClick={() => { if (!controlsLocked) setShowFileList(v => !v); }}
          onMouseEnter={e => { if (!controlsLocked) e.currentTarget.style.filter = 'brightness(1.2)'; }}
          onMouseLeave={e => (e.currentTarget.style.filter = '')}
        >
          {selectLabel}
        </button>

        {/* Button 2 — Play / Stop: label and color flip based on isPlaying */}
        <button
          type="button"
          style={{
            ...BTN_BASE,
            backgroundColor: isPlaying ? '#7b1a1a' : '#1a1a2e',
            opacity: playDisabled ? 0.4 : 1,
            cursor: playDisabled ? 'not-allowed' : 'pointer',
          }}
          onClick={handlePlayStop}
          disabled={playDisabled}
          onMouseEnter={e => { if (!playDisabled) e.currentTarget.style.filter = 'brightness(1.2)'; }}
          onMouseLeave={e => (e.currentTarget.style.filter = '')}
        >
          {playLabel}
        </button>
      </div>

      {previewFrames.length > 0 && (
        <div style={{
          width: W,
          marginTop: '14px',
          padding: '12px',
          boxSizing: 'border-box',
          backgroundColor: '#11111b',
          border: '1px solid #252542',
          borderRadius: '8px',
        }}>
          <div style={{
            color: '#b7b7d8',
            fontSize: '12px',
            marginBottom: '10px',
            textAlign: 'center',
          }}>
            Matrix preview from reconstructed columns
            {matrixShape && <span style={{ color: '#777' }}> · X shape: {matrixShape}</span>}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '10px',
          }}>
            {previewFrames.map(frame => (
              <div key={frame.label} style={{ textAlign: 'center' }}>
                <img
                  src={frame.url}
                  alt={frame.label}
                  style={{
                    width: '100%',
                    imageRendering: 'pixelated',
                    borderRadius: '6px',
                    border: '1px solid #2e2e4e',
                    backgroundColor: '#000',
                  }}
                />
                <div style={{ marginTop: '6px', color: '#8585a8', fontSize: '11px' }}>
                  {frame.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {audioNmf && (
        <div style={{
          width: W,
          marginTop: '14px',
          padding: '14px 16px',
          boxSizing: 'border-box',
          backgroundColor: '#11111b',
          border: '1px solid #252542',
          borderRadius: '8px',
          overflowX: 'hidden',
        }}>
          <AudioNmfFactorizationPlots audio={audioNmf} />
        </div>
      )}

      {/* ── Now playing ──────────────────────────────────────────────────── */}
      <div style={{
        width: W,
        marginTop: '14px',
        textAlign: 'center',
        fontSize: '13px',
        color: '#666',
        minHeight: '18px', // reserve space so layout doesn't shift
      }}>
        {selectedAudio && (
          <span>
            Now playing:{' '}
            <span style={{ color: isPlaying ? '#a0a0ff' : '#999' }}>
              {selectedAudio}
            </span>
          </span>
        )}
      </div>


      {isCalculating && (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            backgroundColor: 'rgba(8, 8, 12, 0.88)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '24px',
          }}
        >
          <div style={{
            width: '76px',
            height: '76px',
            border: '5px solid #2a2a3a',
            borderTopColor: '#a0a0ff',
            borderRadius: '50%',
            animation: 'spin 0.85s linear infinite',
          }} />
          <div style={{ color: '#d8d8f0', fontSize: '20px', fontWeight: 700, letterSpacing: '0.06em' }}>
            {capturePipelinePhase?.headline ?? 'Processing…'}
          </div>
          <div style={{ color: '#777', fontSize: '14px', maxWidth: '440px', textAlign: 'center', lineHeight: 1.5 }}>
            {capturePipelinePhase?.body
              ?? `Pipeline: video k=${POST_CAPTURE_NMF.VIDEO_K} & audio k=${POST_CAPTURE_NMF.AUDIO_K}, each stage runs choose_best_nmmf (${POST_CAPTURE_NMF.N_RESTARTS} restarts).`}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

export default App;
