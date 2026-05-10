import type { RefObject } from 'react';
import type { CameraStatus } from '../VideoManager';

export interface CameraPanelProps {
  width: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraStatus: CameraStatus;
  overlayText: string;
  controlsLocked: boolean;
  onResetPlots: () => void;
}

export function CameraPanel({
  width,
  videoRef,
  cameraStatus,
  overlayText,
  controlsLocked,
  onResetPlots,
}: CameraPanelProps) {
  const showOverlay = cameraStatus !== 'active';

  return (
    <div
      style={{
        width,
        display: 'flex',
        flexDirection: 'row',
        gap: '12px',
        alignItems: 'stretch',
      }}
    >
      <div
        style={{
          position: 'relative',
          flex: 1,
          minWidth: 0,
          height: '58vh',
          backgroundColor: '#1a0000',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      >
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
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              color: '#ccc',
              fontSize: '14px',
            }}
          >
            {cameraStatus === 'requesting' && (
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  border: '3px solid #555',
                  borderTop: '3px solid #e55',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
            )}
            <span>{overlayText}</span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onResetPlots}
        disabled={controlsLocked}
        title="Clear NMF plots and remix state; keep loaded audio file"
        style={{
          flex: '0 0 auto',
          alignSelf: 'stretch',
          width: 'clamp(72px, 12vw, 100px)',
          padding: '10px 8px',
          borderRadius: '12px',
          border: '1px solid #3a3a55',
          background: 'linear-gradient(180deg, #252542 0%, #1a1a2e 100%)',
          color: '#b7b7d8',
          fontSize: '13px',
          fontWeight: 700,
          letterSpacing: '0.04em',
          cursor: controlsLocked ? 'not-allowed' : 'pointer',
          opacity: controlsLocked ? 0.45 : 1,
        }}
      >
        Reset
        <br />
        <span style={{ fontWeight: 500, fontSize: '11px', color: '#777' }}>plots</span>
      </button>
    </div>
  );
}
