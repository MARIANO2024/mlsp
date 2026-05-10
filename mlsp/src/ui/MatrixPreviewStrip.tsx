import type { PreviewFrame } from '../capture/videoMatrix';

export interface MatrixPreviewStripProps {
  width: string;
  frames: PreviewFrame[];
  matrixShape: string | null;
}

export function MatrixPreviewStrip({ width, frames, matrixShape }: MatrixPreviewStripProps) {
  if (frames.length === 0) return null;

  return (
    <div
      style={{
        width,
        marginTop: '14px',
        padding: '12px',
        boxSizing: 'border-box',
        backgroundColor: '#11111b',
        border: '1px solid #252542',
        borderRadius: '8px',
      }}
    >
      <div
        style={{
          color: '#b7b7d8',
          fontSize: '12px',
          marginBottom: '10px',
          textAlign: 'center',
        }}
      >
        Matrix preview from reconstructed columns
        {matrixShape && <span style={{ color: '#777' }}> · X shape: {matrixShape}</span>}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '10px',
        }}
      >
        {frames.map(frame => (
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
  );
}
