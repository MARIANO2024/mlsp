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
        backgroundColor: '#11111b',
        border: '1px solid #252542',
        borderRadius: '8px',
        overflowX: 'hidden',
      }}
    >
      <AudioNmfFactorizationPlots audio={audio} />
    </div>
  );
}
