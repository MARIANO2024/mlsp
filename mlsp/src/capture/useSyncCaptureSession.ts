import { useCallback, useEffect, useRef, useState } from 'react';
import { audioManager, type PlaybackTimeline, type PlaybackWindow } from '../AudioManager';
import { encodeWavMono16 } from '../nmf/wavEncode';
import type { AudioNmfFactorization } from '../nmf/PostCaptureNmfOrchestrator';
import { PostCaptureNmfOrchestrator } from '../nmf/PostCaptureNmfOrchestrator';
import { cloneAudioFactorization, type Round1Bundle } from '../nmf/audioFactorizationClone';
import { useAppStore } from '../stores/useAppStore';
import type { CameraStatus } from '../VideoManager';
import { videoManager } from '../VideoManager';
import { downloadBlob } from '../lib/download';
import { extractVideoMatrix, type PreviewFrame } from './videoMatrix';
import { getSupportedVideoMimeType } from './videoMimeType';
import {
  makeMatrixFilename,
  makePlay2WebmRecordingName,
  makeRemixWavFilename,
  makeResidualWavFilename,
} from './recordingFilenames';
import { formatDelta, formatMasterTime } from './syncConsoleFormat';
import { SecondPlayRecorder } from './SecondPlayRecorder';
import type { RecordingStatus } from './recordingTypes';
import { EMPTY_TIMELINE } from '../ui/layoutConstants';

export function useSyncCaptureSession() {
  const videoRef = useRef<HTMLVideoElement>(null);

  const cameraStatus = useAppStore(s => s.cameraStatus);
  const setCameraStatus = useAppStore(s => s.setCameraStatus);
  const selectedAudio = useAppStore(s => s.selectedAudio);
  const setSelectedAudio = useAppStore(s => s.setSelectedAudio);
  const audioLoadStatus = useAppStore(s => s.audioLoadStatus);
  const setAudioLoadStatus = useAppStore(s => s.setAudioLoadStatus);
  const isPlaying = useAppStore(s => s.isPlaying);
  const setIsPlaying = useAppStore(s => s.setIsPlaying);

  const [showFileList, setShowFileList] = useState(false);
  const [timeline, setTimeline] = useState<PlaybackTimeline>(EMPTY_TIMELINE);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
  const [lastRecordingName, setLastRecordingName] = useState<string | null>(null);
  const [matrixShape, setMatrixShape] = useState<string | null>(null);
  const [previewFrames, setPreviewFrames] = useState<PreviewFrame[]>([]);
  const [audioNmf, setAudioNmf] = useState<AudioNmfFactorization | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [captureRoundUi, setCaptureRoundUi] = useState<1 | 2>(1);
  const [capturePipelinePhase, setCapturePipelinePhase] = useState<{
    headline: string;
    body: string;
  } | null>(null);
  const [syncConsoleLines, setSyncConsoleLines] = useState<string[]>([
    'Run Play + Capture Play 2 to collect sync timing.',
  ]);

  const rafRef = useRef(0);
  const loadRequestRef = useRef(0);
  const secondPlayRecorderRef = useRef(new SecondPlayRecorder());
  const round1BundleRef = useRef<Round1Bundle | null>(null);
  const audioWindowRef = useRef<PlaybackWindow | null>(null);
  const videoStartWallRef = useRef<number | null>(null);
  const videoEndWallRef = useRef<number | null>(null);
  const pendingFilenameRef = useRef<string | null>(null);

  const TOTAL_PLAYS = 2;
  const GAP_SECONDS = 2;

  const resetSyncConsole = useCallback((message = 'Sync console reset.') => {
    audioWindowRef.current = null;
    videoStartWallRef.current = null;
    videoEndWallRef.current = null;
    setSyncConsoleLines([message]);
    setMatrixShape(null);
    setPreviewFrames([]);
    setAudioNmf(null);
  }, []);

  const cancelScheduledRecording = useCallback(
    (updateStatus = true) => {
      secondPlayRecorderRef.current.cancel();
      pendingFilenameRef.current = null;
      if (updateStatus) {
        setRecordingStatus('idle');
        setIsCalculating(false);
        setCapturePipelinePhase(null);
        resetSyncConsole('Attempt cancelled; timing console reset.');
      }
    },
    [resetSyncConsole],
  );

  const resetToCapture1Baseline = useCallback(() => {
    round1BundleRef.current = null;
    setPreviewFrames([]);
    setMatrixShape(null);
    setAudioNmf(null);
    setLastRecordingName(null);
    setCaptureRoundUi(1);
    if (audioManager.isLoaded()) {
      try {
        audioManager.restoreAnalysisPlayback();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const preparePlaybackBufferForCapture = useCallback(() => {
    if (round1BundleRef.current) {
      const b = round1BundleRef.current;
      audioManager.replacePlaybackWithMono(b.residualMono, b.sampleRate);
      return;
    }
    if (audioManager.isLoaded()) {
      audioManager.restoreAnalysisPlayback();
    }
  }, []);

  const setSyncSummary = useCallback((audioWindow: PlaybackWindow | null, videoStart: number | null, videoEnd: number | null) => {
    setSyncConsoleLines([
      `audio start: ${formatMasterTime(audioWindow?.startWallMs ?? null)}`,
      `audio end:   ${formatMasterTime(audioWindow?.endWallMs ?? null)}`,
      `video start: ${formatMasterTime(videoStart)}`,
      `video end:   ${formatMasterTime(videoEnd)}`,
      `start delta: ${formatDelta(videoStart, audioWindow?.startWallMs ?? null)}`,
      `end delta:   ${formatDelta(videoEnd, audioWindow?.endWallMs ?? null)}`,
    ]);
  }, []);

  const startCamera = useCallback(async () => {
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
  }, [cameraStatus, setCameraStatus]);

  useEffect(() => {
    if (cameraStatus === 'active' && videoRef.current) {
      videoManager.attachToElement(videoRef.current);
    }
  }, [cameraStatus]);

  useEffect(() => {
    startCamera();
    return () => {
      cancelScheduledRecording(false);
      videoManager.stop();
      audioManager.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleSecondPlayRecording = useCallback(
    (windowInfo: PlaybackWindow) => {
      const stream = videoManager.getStream();
      if (!stream) throw new Error('Camera stream is not available.');

      const mimeType = getSupportedVideoMimeType();
      const filename = makePlay2WebmRecordingName(selectedAudio);
      pendingFilenameRef.current = filename;
      audioWindowRef.current = windowInfo;
      videoStartWallRef.current = null;
      videoEndWallRef.current = null;
      setSyncSummary(windowInfo, null, null);

      secondPlayRecorderRef.current.schedule({
        stream,
        recorderOptions: mimeType ? { mimeType } : undefined,
        windowInfo,
        onWaiting: () => {
          setLastRecordingName(null);
          setRecordingStatus('waiting');
        },
        onRecordingStarted: actualStartWallMs => {
          videoStartWallRef.current = actualStartWallMs;
          setRecordingStatus('recording');
          setSyncSummary(windowInfo, actualStartWallMs, null);
        },
        onRecorderError: () => {
          setRecordingStatus('error');
        },
        onComplete: async ({ blob, actualStopWallMs }) => {
          const windowInfoSnapshot = windowInfo;
          const filenameSafe = pendingFilenameRef.current ?? filename;
          videoEndWallRef.current = actualStopWallMs;
          pendingFilenameRef.current = null;
          setSyncSummary(windowInfoSnapshot, videoStartWallRef.current, actualStopWallMs);
          setRecordingStatus('saving');
          setIsCalculating(true);
          setCapturePipelinePhase({
            headline: 'Video matrix',
            body: 'Decoding WebM and building grayscale matrix X (per-frame columns).',
          });
          setShowFileList(false);
          await new Promise<void>(r => requestAnimationFrame(() => r()));

          try {
            const videoMatrix = await extractVideoMatrix(blob);
            const matrixFilename = makeMatrixFilename(filenameSafe);
            const matrixBlob = new Blob(
              [
                JSON.stringify({
                  width: videoMatrix.width,
                  height: videoMatrix.height,
                  frameCount: videoMatrix.frameCount,
                  flattenOrder: 'F',
                  shape: [videoMatrix.width * videoMatrix.height, videoMatrix.frameCount],
                  matrix: videoMatrix.matrix,
                }),
              ],
              { type: 'application/json' },
            );

            downloadBlob(blob, filenameSafe);
            downloadBlob(matrixBlob, matrixFilename);
            setLastRecordingName(matrixFilename);
            setMatrixShape(`${videoMatrix.width * videoMatrix.height} x ${videoMatrix.frameCount}`);
            setPreviewFrames(videoMatrix.previews);

            const mono = audioManager.getMonoSamples();
            if (!mono) {
              throw new Error('No decoded audio in memory. Select and load a track before capture.');
            }
            const sampleRate = audioManager.getBufferInfo()?.sampleRate ?? 48_000;

            const headlineRound2 = (headline: string, body: string) =>
              setCapturePipelinePhase({
                headline: headline.includes('Round 2') ? headline : `Round 2 · ${headline}`,
                body,
              });

            if (!round1BundleRef.current) {
              const { audio, residualNoComp0Mono, sampleRate: rateOut } = await PostCaptureNmfOrchestrator.run(
                videoMatrix.matrix,
                mono,
                sampleRate,
                (headline, body) => setCapturePipelinePhase({ headline, body }),
              );
              setAudioNmf(audio);
              round1BundleRef.current = {
                audio: cloneAudioFactorization(audio),
                residualMono: Float32Array.from(residualNoComp0Mono),
                sampleRate: rateOut,
              };
              setCaptureRoundUi(2);
              const residualBuf = encodeWavMono16(residualNoComp0Mono, rateOut);
              downloadBlob(new Blob([residualBuf], { type: 'audio/wav' }), makeResidualWavFilename(filenameSafe));
            } else {
              const { remixedMono, sampleRate: rateOut } = await PostCaptureNmfOrchestrator.runRound2Remix(
                videoMatrix.matrix,
                mono,
                sampleRate,
                round1BundleRef.current.audio,
                headlineRound2,
              );
              const remixBuf = encodeWavMono16(remixedMono, rateOut);
              downloadBlob(new Blob([remixBuf], { type: 'audio/wav' }), makeRemixWavFilename(filenameSafe));
              resetToCapture1Baseline();
              setLastRecordingName(matrixFilename);
            }

            setRecordingStatus('saved');
          } catch (err) {
            setRecordingStatus('error');
            if (!round1BundleRef.current) {
              setAudioNmf(null);
            }
            setSyncConsoleLines([
              `Post-capture pipeline failed: ${err instanceof Error ? err.message : 'unknown error'}.`,
            ]);
          } finally {
            setIsCalculating(false);
            setCapturePipelinePhase(null);
          }
        },
      });
    },
    [resetToCapture1Baseline, selectedAudio, setSyncSummary],
  );

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

  const handleResetNmfPlots = useCallback(() => {
    if (isCalculating) return;
    if (isPlaying) {
      audioManager.stop();
      setIsPlaying(false);
      setTimeline(EMPTY_TIMELINE);
    }
    cancelScheduledRecording(false);
    resetToCapture1Baseline();
    setSyncConsoleLines(['NMF plots and remix state cleared. Your audio file is still loaded.']);
  }, [
    cancelScheduledRecording,
    isCalculating,
    isPlaying,
    resetToCapture1Baseline,
    setIsPlaying,
  ]);

  const selectFile = useCallback(
    async (filename: string, url: string) => {
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
      round1BundleRef.current = null;
      setCaptureRoundUi(1);
      setSelectedAudio(filename);
      setAudioLoadStatus('loading');
      setMatrixShape(null);
      setPreviewFrames([]);
      setAudioNmf(null);

      try {
        await audioManager.load(url);
        if (requestId !== loadRequestRef.current) return;
        setAudioLoadStatus('ready');
      } catch {
        if (requestId !== loadRequestRef.current) return;
        setAudioLoadStatus('error');
      }
    },
    [cancelScheduledRecording, isCalculating, isPlaying, setAudioLoadStatus, setSelectedAudio, setIsPlaying],
  );

  const handlePlayStop = useCallback(async () => {
    if (isCalculating) return;
    if (isPlaying) {
      audioManager.stop();
      cancelScheduledRecording();
      setIsPlaying(false);
      setTimeline(EMPTY_TIMELINE);
      return;
    }
    try {
      preparePlaybackBufferForCapture();
      await audioManager.playSequence(TOTAL_PLAYS, GAP_SECONDS, () => {
        setIsPlaying(false);
        setTimeline(EMPTY_TIMELINE);
      });
      const secondPlayWindow = audioManager.getPlayWindow(2);
      const firstPlayWindow = audioManager.getPlayWindow(1);
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
  }, [
    cancelScheduledRecording,
    isCalculating,
    isPlaying,
    preparePlaybackBufferForCapture,
    scheduleSecondPlayRecording,
    setAudioLoadStatus,
    setIsPlaying,
  ]);

  const selectLabel = audioLoadStatus === 'loading' ? 'Loading…' : 'Select Audio';
  const playLabel =
    isPlaying ? 'Stop' : audioLoadStatus === 'loading' ? '…' : `Play + Capture ${captureRoundUi}`;
  const playDisabled = (audioLoadStatus !== 'ready' && !isPlaying) || isCalculating;
  const controlsLocked = isCalculating;
  const phaseLabel =
    timeline.phase === 'audio'
      ? `Audio ${timeline.currentPlay}/${timeline.totalPlays}`
      : timeline.phase === 'gap'
        ? 'Long pause'
        : timeline.phase === 'lead-in'
          ? 'Scheduled'
          : 'Idle';
  const elapsedLabel =
    timeline.totalSeconds > 0
      ? `${timeline.elapsedSeconds.toFixed(2)}s / ${timeline.totalSeconds.toFixed(2)}s`
      : 'Select an audio file to run the sync proof';

  const recordingLabelDict: Record<RecordingStatus, string> = (() => {
    const c = captureRoundUi;
    return {
      idle:
        c === 1
          ? 'Capture 1: start playback to record video on the second play.'
          : 'Capture 2: start playback (residual track) to record on the second play.',
      waiting: `Capture ${c}: waiting for second play to start recording.`,
      recording: `Capture ${c}: recording video now.`,
      saving: `Capture ${c}: saving video and running pipeline…`,
      saved: lastRecordingName ? `Saved ${lastRecordingName}` : `Capture ${c} finished.`,
      error: 'Video capture or pipeline failed.',
    };
  })();

  const overlayMessage: Record<CameraStatus, string> = {
    idle: '',
    requesting: 'Requesting camera access…',
    denied: 'Camera access was denied. Please allow it in browser settings.',
    error: 'Could not access camera.',
    active: '',
  };

  const overlayText = overlayMessage[cameraStatus];

  return {
    videoRef,
    cameraStatus,
    overlayText,

    timeline,
    phaseLabel,
    elapsedLabel,

    recordingStatus,
    recordingLabel: recordingLabelDict,

    syncConsoleLines,

    selectedAudio,
    audioLoadStatus,
    showFileList,
    setShowFileList,
    controlsLocked,

    previewFrames,
    matrixShape,

    audioNmf,
    isCalculating,
    capturePipelinePhase,

    selectLabel,
    playLabel,
    playDisabled,
    captureRoundUi,

    actions: {
      handleResetNmfPlots,
      handlePlayStop,
      selectFile,
      toggleShowFileList: () => setShowFileList(v => !v),
    },
    isPlaying,
  };
}
