import { POST_CAPTURE_NMF } from '../nmf/PostCaptureNmfOrchestrator';

export interface ProcessingOverlayProps {
  visible: boolean;
  phase: { headline: string; body: string } | null;
}

export function ProcessingOverlay({ visible, phase }: ProcessingOverlayProps) {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        backgroundColor: 'rgba(245, 241, 232, 0.82)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '24px',
      }}
    >
      <div
        style={{
          width: '76px',
          height: '76px',
          border: '5px solid var(--border-soft)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.85s linear infinite',
        }}
      />
      <div
        style={{ color: 'var(--ink-strong)', fontSize: '20px', fontWeight: 700, letterSpacing: '0.06em' }}
      >
        {phase?.headline ?? 'Processing…'}
      </div>
      <div
        style={{
          color: 'var(--ink-body)',
          fontSize: '14px',
          maxWidth: '440px',
          textAlign: 'center',
          lineHeight: 1.5,
        }}
      >
        {phase?.body
          ?? `Pipeline: video k=${POST_CAPTURE_NMF.VIDEO_K} & audio k=${POST_CAPTURE_NMF.AUDIO_K}, each stage runs choose_best_nmmf (${POST_CAPTURE_NMF.N_RESTARTS} restarts).`}
      </div>
    </div>
  );
}
