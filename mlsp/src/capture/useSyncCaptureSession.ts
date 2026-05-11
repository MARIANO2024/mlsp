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
  makeNmfDebugFilename,
  makeMatrixFilename,
  makePlay2WebmRecordingName,
  makeRemixWavFilename,
  makeRound2TargetWavFilename,
  makeResidualWavFilename,
  makeSelectedComponentWavFilename,
} from './recordingFilenames';
import { formatDelta, formatMasterTime } from './syncConsoleFormat';
import { SecondPlayRecorder } from './SecondPlayRecorder';
import type { RecordingStatus } from './recordingTypes';
import { EMPTY_TIMELINE } from '../ui/layoutConstants';
import type { AudioArtifact } from '../ui/AudioArtifactsPanel';

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
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('NOT_RECORDING');
  const [lastRecordingName, setLastRecordingName] = useState<string | null>(null);
  const [matrixShape, setMatrixShape] = useState<string | null>(null);
  const [previewFrames, setPreviewFrames] = useState<PreviewFrame[]>([]);
  const [audioNmf, setAudioNmf] = useState<AudioNmfFactorization | null>(null);
  const [audioArtifacts, setAudioArtifacts] = useState<AudioArtifact[]>([]);
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
  const artifactObjectUrlsRef = useRef<string[]>([]);

  const TOTAL_PLAYS = 2;
  const GAP_SECONDS = 1;

  const revokeGeneratedArtifactUrls = useCallback(() => {
    for (const url of artifactObjectUrlsRef.current) URL.revokeObjectURL(url);
    artifactObjectUrlsRef.current = [];
  }, []);

  const setOriginalArtifact = useCallback(
    (filename: string, url: string) => {
      revokeGeneratedArtifactUrls();
      setAudioArtifacts([
        {
          key: 'original',
          label: 'Original',
          url,
          filename,
          note: filename,
        },
      ]);
    },
    [revokeGeneratedArtifactUrls],
  );

  const keepOnlyOriginalArtifact = useCallback(() => {
    revokeGeneratedArtifactUrls();
    setAudioArtifacts(prev => prev.filter(a => a.key === 'original'));
  }, [revokeGeneratedArtifactUrls]);

  const addWavArtifact = useCallback(
    (key: string, label: string, samples: Float32Array, sampleRate: number, filename: string, note?: string) => {
      const wav = encodeWavMono16(samples, sampleRate);
      const blob = new Blob([wav], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      artifactObjectUrlsRef.current.push(url);
      downloadBlob(blob, filename);
      setAudioArtifacts(prev => [
        ...prev.filter(a => a.key !== key),
        { key, label, url, filename, note },
      ]);
    },
    [],
  );

  const downloadDebugJson = useCallback((payload: unknown, filename: string) => {
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      filename,
    );
  }, []);

  useEffect(() => () => revokeGeneratedArtifactUrls(), [revokeGeneratedArtifactUrls]);

  const resetSyncConsole = useCallback((message = 'Sync console reset.') => {
    audioWindowRef.current = null;
    videoStartWallRef.current = null;
    videoEndWallRef.current = null;
    setSyncConsoleLines([message]);
    setMatrixShape(null);
    setPreviewFrames([]);
    setAudioNmf(null);
    keepOnlyOriginalArtifact();
  }, [keepOnlyOriginalArtifact]);

  const cancelScheduledRecording = useCallback(
    (updateStatus = true) => {
      secondPlayRecorderRef.current.cancel();
      pendingFilenameRef.current = null;
      if (updateStatus) {
        setRecordingStatus('NOT_RECORDING');
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
    keepOnlyOriginalArtifact();
    if (audioManager.isLoaded()) {
      try {
        audioManager.restoreAnalysisPlayback();
      } catch {
        /* ignore */
      }
    }
  }, [keepOnlyOriginalArtifact]);

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

  const setSyncSummary = useCallback((
    audioWindow: PlaybackWindow | null,
    videoStart: number | null,
    videoEnd: number | null,
    matrix?: { frameCount: number; shape: string },
  ) => {
    const captureDuration =
      videoStart != null && videoEnd != null ? `${((videoEnd - videoStart) / 1000).toFixed(3)} s` : 'pending';
    setSyncConsoleLines([
      `audio start: ${formatMasterTime(audioWindow?.startWallMs ?? null)}`,
      `audio end:   ${formatMasterTime(audioWindow?.endWallMs ?? null)}`,
      `video start: ${formatMasterTime(videoStart)}`,
      `video end:   ${formatMasterTime(videoEnd)}`,
      `start delta: ${formatDelta(videoStart, audioWindow?.startWallMs ?? null)}`,
      `end delta:   ${formatDelta(videoEnd, audioWindow?.endWallMs ?? null)}`,
      `capture duration: ${captureDuration}`,
      `frame count: ${matrix?.frameCount ?? 'pending'}`,
      `matrix shape: ${matrix?.shape ?? 'pending'}`,
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
          setRecordingStatus('WAITING');
        },
        onRecordingStarted: actualStartWallMs => {
          videoStartWallRef.current = actualStartWallMs;
          setRecordingStatus('RECORDING');
          setSyncSummary(windowInfo, actualStartWallMs, null);
        },
        onRecorderError: () => {
          setRecordingStatus('ERROR');
          setSyncConsoleLines(['MediaRecorder failed during capture.']);
        },
        onComplete: async ({ blob, actualStopWallMs }) => {
          const windowInfoSnapshot = windowInfo;
          const filenameSafe = pendingFilenameRef.current ?? filename;
          videoEndWallRef.current = actualStopWallMs;
          pendingFilenameRef.current = null;
          setSyncSummary(windowInfoSnapshot, videoStartWallRef.current, actualStopWallMs);
          setRecordingStatus('PROCESSING');
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
            const shape = `${videoMatrix.width * videoMatrix.height} x ${videoMatrix.frameCount}`;
            setMatrixShape(shape);
            setPreviewFrames(videoMatrix.previews);
            setSyncSummary(windowInfoSnapshot, videoStartWallRef.current, actualStopWallMs, {
              frameCount: videoMatrix.frameCount,
              shape,
            });

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
              const {
                audio,
                selectedComponentMono,
                residualMono,
                sampleRate: rateOut,
                debug,
              } = await PostCaptureNmfOrchestrator.run(
                videoMatrix.matrix,
                mono,
                sampleRate,
                (headline, body) => setCapturePipelinePhase({ headline, body }),
              );
              setAudioNmf(audio);
              round1BundleRef.current = {
                audio: cloneAudioFactorization(audio),
                selectedComponentMono: Float32Array.from(selectedComponentMono),
                residualMono: Float32Array.from(residualMono),
                sampleRate: rateOut,
              };
              setCaptureRoundUi(2);
              addWavArtifact(
                'selected-component',
                'Extracted selected component',
                selectedComponentMono,
                rateOut,
                makeSelectedComponentWavFilename(filenameSafe),
                `Selected visual-matched component H[${audio.selectedComponentIndex}]`,
              );
              addWavArtifact(
                'residual',
                'Residual after removing selected component',
                residualMono,
                rateOut,
                makeResidualWavFilename(filenameSafe),
                `Ratio-mask residual after H[${audio.selectedComponentIndex}] removal`,
              );
              downloadDebugJson(debug, makeNmfDebugFilename(filenameSafe));
            } else {
              const round1 = round1BundleRef.current;
              const {
                audio,
                newTargetMono,
                remixedMono,
                sampleRate: rateOut,
                mode,
                debug,
              } = await PostCaptureNmfOrchestrator.runRound2Remix(
                videoMatrix.matrix,
                mono,
                sampleRate,
                round1.audio,
                round1.selectedComponentMono,
                round1.residualMono,
                headlineRound2,
              );
              setAudioNmf(audio);
              addWavArtifact(
                'round2-target',
                mode === 'grain-demo' ? 'Round 2 new target (grain demo mode)' : 'Round 2 new target',
                newTargetMono,
                rateOut,
                makeRound2TargetWavFilename(filenameSafe),
                mode === 'grain-demo'
                  ? 'Grain demo mode: selected Round 1 grains triggered by new gesture onsets'
                  : `Fixed-W target using selected component H[${audio.selectedComponentIndex}]`,
              );
              addWavArtifact(
                'round2-remix',
                'Round 2 remix/new gesture result',
                remixedMono,
                rateOut,
                makeRemixWavFilename(filenameSafe),
                mode === 'grain-demo' ? 'Residual plus gesture-triggered grains' : 'Residual plus fixed-W new target',
              );
              downloadDebugJson(debug, makeNmfDebugFilename(filenameSafe));
              round1BundleRef.current = null;
              setCaptureRoundUi(1);
              try {
                audioManager.restoreAnalysisPlayback();
              } catch {
                /* ignore */
              }
              setLastRecordingName(matrixFilename);
            }

            setRecordingStatus('COMPLETE');
          } catch (err) {
            setRecordingStatus('ERROR');
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
    [addWavArtifact, downloadDebugJson, selectedAudio, setSyncSummary],
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
      setLastRecordingName(null);
      setRecordingStatus('NOT_RECORDING');
      setSyncConsoleLines(['Audio selected. Press Play + Capture 1 for preview, 1 second gap, then video capture.']);
      keepOnlyOriginalArtifact();

      try {
        await audioManager.load(url);
        if (requestId !== loadRequestRef.current) return;
        setAudioLoadStatus('ready');
        setOriginalArtifact(filename, url);
      } catch {
        if (requestId !== loadRequestRef.current) return;
        setAudioLoadStatus('error');
        setAudioArtifacts([]);
      }
    },
    [
      cancelScheduledRecording,
      isCalculating,
      isPlaying,
      keepOnlyOriginalArtifact,
      setAudioLoadStatus,
      setOriginalArtifact,
      setSelectedAudio,
      setIsPlaying,
    ],
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
    if (cameraStatus !== 'active' || !videoManager.getStream()) {
      setRecordingStatus('ERROR');
      setSyncConsoleLines(['Camera is not active. Allow camera access before running the two-play capture demo.']);
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
      setRecordingStatus('ERROR');
      setIsPlaying(false);
      setTimeline(EMPTY_TIMELINE);
      setSyncConsoleLines([
        `Attempt failed: ${err instanceof Error ? err.message : 'unknown error'}.`,
      ]);
    }
  }, [
    cancelScheduledRecording,
    cameraStatus,
    isCalculating,
    isPlaying,
    preparePlaybackBufferForCapture,
    scheduleSecondPlayRecording,
    setIsPlaying,
  ]);

  const selectLabel = audioLoadStatus === 'loading' ? 'Loading…' : 'Select Audio';
  const playLabel =
    isPlaying ? 'Stop' : audioLoadStatus === 'loading' ? '…' : `Play + Capture ${captureRoundUi}`;
  const playDisabled = (audioLoadStatus !== 'ready' && !isPlaying) || isCalculating;
  const controlsLocked = isCalculating;
  const phaseLabel = (() => {
    if (isCalculating) return 'PROCESSING';
    if (recordingStatus === 'COMPLETE') return 'COMPLETE';
    if (timeline.phase === 'audio' && timeline.currentPlay === 1) return 'PREVIEW';
    if (timeline.phase === 'gap') return 'GAP';
    if (timeline.phase === 'audio' && timeline.currentPlay === 2) return 'CAPTURE';
    return 'IDLE';
  })();
  const elapsedLabel =
    timeline.totalSeconds > 0
      ? `${timeline.elapsedSeconds.toFixed(2)}s / ${timeline.totalSeconds.toFixed(2)}s`
      : 'Select audio, then run preview / 1s gap / capture';

  const recordingLabelDict: Record<RecordingStatus, string> = (() => {
    const c = captureRoundUi;
    return {
      NOT_RECORDING:
        c === 1
          ? 'Capture 1: start playback to record video on the second play.'
          : 'Capture 2: residual guide will play, then record the new gesture on the second play.',
      WAITING: `Capture ${c}: waiting for second play to start recording.`,
      RECORDING: `Capture ${c}: recording video now.`,
      PROCESSING: `Capture ${c}: decoding video, extracting motion, and running NMF.`,
      COMPLETE: lastRecordingName ? `COMPLETE: saved ${lastRecordingName}` : `COMPLETE: capture ${c} finished.`,
      ERROR: 'ERROR: video capture or pipeline failed.',
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
    audioArtifacts,
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
