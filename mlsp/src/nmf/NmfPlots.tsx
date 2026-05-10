import type { CSSProperties, ReactNode } from 'react';
import type { AudioNmfFactorization } from './PostCaptureNmfOrchestrator';
import { NmfPlotGeometry } from './NmfPlotGeometry';

const PLOT_W = 300;
const PLOT_H_SINGLE = 88;
const STROKE_W = 1.8;

const W_STROKES = ['#a0a0ff', '#e5a050', '#5dd39e'] as const;
const H_STROKES = ['#a0a0ff', '#e5a050', '#5dd39e'] as const;
/** Upscaled video init — dashed so it reads as “prior”, not a fitted row of H. */
const H_INIT_STROKE = '#e8e8f0';

const panelStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const chartWrapStyle: CSSProperties = {
  borderRadius: '6px',
  overflow: 'hidden',
  backgroundColor: '#08080c',
  lineHeight: 0,
};

function ChartSvg({ children, heightPx = 100 }: { children: ReactNode; heightPx?: number }) {
  return (
    <div style={chartWrapStyle}>
      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H_SINGLE}`}
        preserveAspectRatio="none"
        width="100%"
        height={heightPx}
        role="img"
        style={{
          display: 'block',
          verticalAlign: 'top',
          overflow: 'hidden',
        }}
      >
        <rect x="0" y="0" width={PLOT_W} height={PLOT_H_SINGLE} fill="#08080c" />
        {children}
      </svg>
    </div>
  );
}

export function AudioNmfFactorizationPlots({ audio }: { audio: AudioNmfFactorization }) {
  const { wColumns, hRows, hInitUpscaledRow } = audio;
  const hInitForOverlay = NmfPlotGeometry.normalizeMinMaxSeries(hInitUpscaledRow);
  const hRowsForOverlay = hRows.map(r => NmfPlotGeometry.normalizeMinMaxSeries(r));
  const overlayYMin = 0;
  const overlayYMax = 1;

  return (
    <div style={panelStyle}>
      <div style={{ color: '#b7b7d8', fontSize: '12px', textAlign: 'center' }}>
        Audio NMF on |STFT| — W columns (frequency × component){' '}
        <span style={{ color: '#666' }}>
          · {audio.freqBins} bins × {audio.timeFrames} frames · KL loss ≈ {audio.reconstructionError.toExponential(4)}
        </span>
      </div>

      {wColumns.map((col, j) => (
        <div key={`w-${j}`}>
          <div style={{ color: W_STROKES[j % W_STROKES.length]!, fontSize: '12px', marginBottom: '6px' }}>
            W[:, {j}] (spectral component)
          </div>
          <ChartSvg>
            <polyline
              fill="none"
              stroke={W_STROKES[j % W_STROKES.length]}
              strokeWidth={STROKE_W}
              vectorEffect="non-scaling-stroke"
              points={NmfPlotGeometry.polylinePointsY(col, PLOT_W, PLOT_H_SINGLE)}
            />
          </ChartSvg>
        </div>
      ))}

      <div>
        <div style={{ color: '#c8c8e8', fontSize: '12px', marginBottom: '4px' }}>
          H activations vs STFT time + upscaled video h_init
        </div>
        <div style={{ color: '#666', fontSize: '10px', marginBottom: '8px', lineHeight: 1.35, textAlign: 'center' }}>
          Overlay uses <strong style={{ color: '#888' }}>per-trace min–max normalization</strong> (display only).
          Raw magnitudes differ: h_init is ~O(1) after gating while fitted H often scales with W in WH ≈ |STFT|.
        </div>
        <ChartSvg>
          <polyline
            fill="none"
            stroke={H_INIT_STROKE}
            strokeWidth={STROKE_W}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
            points={NmfPlotGeometry.polylinePointsYInRange(
              hInitForOverlay,
              PLOT_W,
              PLOT_H_SINGLE,
              overlayYMin,
              overlayYMax,
            )}
          />
          {hRowsForOverlay.map((row, j) => (
            <polyline
              key={`h-${j}`}
              fill="none"
              stroke={H_STROKES[j % H_STROKES.length]}
              strokeWidth={STROKE_W}
              vectorEffect="non-scaling-stroke"
              points={NmfPlotGeometry.polylinePointsYInRange(
                row,
                PLOT_W,
                PLOT_H_SINGLE,
                overlayYMin,
                overlayYMax,
              )}
            />
          ))}
        </ChartSvg>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '8px', justifyContent: 'center' }}>
          <span style={{ color: H_INIT_STROKE, fontSize: '11px' }}>h_init row (video upscaled, dashed)</span>
          {hRows.map((_, j) => (
            <span key={`leg-${j}`} style={{ color: H_STROKES[j % H_STROKES.length], fontSize: '11px' }}>
              H[{j}, :] fitted
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
