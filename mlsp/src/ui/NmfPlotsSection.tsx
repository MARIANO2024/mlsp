import type { AudioNmfFactorization } from '../nmf/PostCaptureNmfOrchestrator';
import { AudioNmfFactorizationPlots } from '../nmf/NmfPlots';

export interface NmfPlotsSectionProps {
  width: string;
  audio: AudioNmfFactorization;
}

export function NmfPlotsSection({ width, audio }: NmfPlotsSectionProps) {
  return (
    <div
      style={{
        width,
        marginTop: '14px',
        padding: '14px 16px',
        boxSizing: 'border-box',
        backgroundColor: 'var(--bg-panel)',
        border: '1px solid var(--border-soft)',
        borderRadius: '8px',
        overflowX: 'hidden',
        boxShadow: 'var(--shadow-soft)',
      }}
    >
      <AudioNmfFactorizationPlots audio={audio} />
    </div>
  );
}
