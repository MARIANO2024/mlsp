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
        backgroundColor: '#ffffff',
        border: '1px solid #d8d8e0',
        borderRadius: '8px',
        overflowX: 'hidden',
      }}
    >
      <AudioNmfFactorizationPlots audio={audio} />
    </div>
  );
}
