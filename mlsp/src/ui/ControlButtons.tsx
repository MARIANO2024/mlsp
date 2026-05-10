import { BTN_BASE } from './layoutConstants';

export interface ControlButtonsProps {
  width: string;
  showFileList: boolean;
  controlsLocked: boolean;
  selectLabel: string;
  playDisabled: boolean;
  playLabel: string;
  isPlaying: boolean;
  onToggleFileList: () => void;
  onPlayStop: () => void;
}

export function ControlButtons({
  width,
  showFileList,
  controlsLocked,
  selectLabel,
  playDisabled,
  playLabel,
  isPlaying,
  onToggleFileList,
  onPlayStop,
}: ControlButtonsProps) {
  return (
    <div
      style={{
        width,
        display: 'flex',
        gap: '14px',
        marginTop: '16px',
      }}
    >
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
        onClick={() => {
          if (!controlsLocked) onToggleFileList();
        }}
        onMouseEnter={e => {
          if (!controlsLocked) e.currentTarget.style.filter = 'brightness(1.2)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.filter = '';
        }}
      >
        {selectLabel}
      </button>

      <button
        type="button"
        style={{
          ...BTN_BASE,
          backgroundColor: isPlaying ? '#7b1a1a' : '#1a1a2e',
          opacity: playDisabled ? 0.4 : 1,
          cursor: playDisabled ? 'not-allowed' : 'pointer',
        }}
        onClick={onPlayStop}
        disabled={playDisabled}
        onMouseEnter={e => {
          if (!playDisabled) e.currentTarget.style.filter = 'brightness(1.2)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.filter = '';
        }}
      >
        {playLabel}
      </button>
    </div>
  );
}
