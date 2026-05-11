import './index.css';
import { musicFiles } from './musicFiles';
import { useSyncCaptureSession } from './capture/useSyncCaptureSession';
import { CONTENT_WIDTH } from './ui/layoutConstants';
import { CameraPanel } from './ui/CameraPanel';
import { PlaybackBars } from './ui/PlaybackBars';
import { RecordingStatusRow } from './ui/RecordingStatusRow';
import { SyncConsole } from './ui/SyncConsole';
import { MusicFileDropdown } from './ui/MusicFileDropdown';
import { ControlButtons } from './ui/ControlButtons';
import { MatrixPreviewStrip } from './ui/MatrixPreviewStrip';
import { NmfPlotsSection } from './ui/NmfPlotsSection';
import { ProcessingOverlay } from './ui/ProcessingOverlay';
import { AudioArtifactsPanel } from './ui/AudioArtifactsPanel';

function App() {
  const session = useSyncCaptureSession();

  const w = CONTENT_WIDTH;

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: '3vh',
        paddingBottom: '5vh',
        backgroundColor: 'transparent',
      }}
    >
      <CameraPanel
        width={w}
        videoRef={session.videoRef}
        cameraStatus={session.cameraStatus}
        overlayText={session.overlayText}
        controlsLocked={session.controlsLocked}
        onResetPlots={session.actions.handleResetNmfPlots}
      />

      <PlaybackBars
        width={w}
        timeline={session.timeline}
        phaseLabel={session.phaseLabel}
        elapsedLabel={session.elapsedLabel}
      />

      <RecordingStatusRow
        width={w}
        recordingStatus={session.recordingStatus}
        message={session.recordingLabel[session.recordingStatus]}
      />

      <SyncConsole width={w} lines={session.syncConsoleLines} />

      {session.showFileList && (
        <MusicFileDropdown
          width={w}
          files={musicFiles}
          controlsLocked={session.controlsLocked}
          selectedAudio={session.selectedAudio}
          onPick={session.actions.selectFile}
        />
      )}

      <ControlButtons
        width={w}
        showFileList={session.showFileList}
        controlsLocked={session.controlsLocked}
        selectLabel={session.selectLabel}
        playDisabled={session.playDisabled}
        playLabel={session.playLabel}
        isPlaying={session.isPlaying}
        onToggleFileList={session.actions.toggleShowFileList}
        onPlayStop={session.actions.handlePlayStop}
      />

      <MatrixPreviewStrip width={w} frames={session.previewFrames} matrixShape={session.matrixShape} />

      {session.audioNmf && <NmfPlotsSection width={w} audio={session.audioNmf} />}

      <AudioArtifactsPanel width={w} artifacts={session.audioArtifacts} />

      <div
        style={{
          width: w,
          marginTop: '14px',
          textAlign: 'center',
          fontSize: '13px',
          color: 'var(--ink-muted)',
          minHeight: '18px',
        }}
      >
        {session.selectedAudio && (
          <span>
            Now playing:{' '}
            <span style={{ color: session.isPlaying ? 'var(--accent)' : 'var(--ink-body)' }}>
              {session.selectedAudio}
            </span>
          </span>
        )}
      </div>

      <ProcessingOverlay visible={session.isCalculating} phase={session.capturePipelinePhase} />
    </div>
  );
}

export default App;
