import type { CSSProperties, ReactNode } from 'react';
import type { AudioNmfFactorization } from './PostCaptureNmfOrchestrator';
import { NmfPlotGeometry } from './NmfPlotGeometry';

const PLOT_W = 300;
const PLOT_H = 88;
const PAD_T = 12;
const PAD_L = 36;
const PAD_B = 22;
const TOTAL_W = PLOT_W + PAD_L;
const TOTAL_H = PLOT_H + PAD_T + PAD_B;
const STROKE_W = 1.8;
const TICK_LEN = 4;
const AXIS_FONT = 8;
const AXIS_COLOR = '#999';

const W_STROKES = ['#3a3aff', '#c46a10', '#1f9e6c'] as const;
const H_STROKES = ['#3a3aff', '#c46a10', '#1f9e6c'] as const;
/** Upscaled video init — dashed so it reads as "prior", not a fitted row of H. */
const H_INIT_STROKE = '#444';

const panelStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const chartWrapStyle: CSSProperties = {
  borderRadius: '6px',
  overflow: 'hidden',
  backgroundColor: '#ffffff',
  border: '1px solid #e0e0e8',
  lineHeight: 0,
};

function AxisLayer({ xCount }: { xCount: number }) {
  const plotTop = PAD_T;
  const plotBot = PAD_T + PLOT_H;

  const yTicks = [
    { y: plotTop,              label: '1.0' },
    { y: plotTop + PLOT_H / 2, label: '0.5' },
    { y: plotBot,              label: '0.0' },
  ];

  const xTicks = Array.from({ length: 5 }, (_, i) => {
    const frac = i / 4;
    return {
      x: PAD_L + frac * PLOT_W,
      label: String(Math.round(frac * (xCount - 1))),
    };
  });

  return (
    <>
      <line x1={PAD_L} y1={plotTop} x2={PAD_L} y2={plotBot} stroke={AXIS_COLOR} strokeWidth={0.7} />
      <line x1={PAD_L} y1={plotBot} x2={TOTAL_W} y2={plotBot} stroke={AXIS_COLOR} strokeWidth={0.7} />

      {yTicks.map(({ y, label }) => (
        <g key={y}>
          <line x1={PAD_L - TICK_LEN} y1={y} x2={PAD_L} y2={y} stroke={AXIS_COLOR} strokeWidth={0.7} />
          <text
            x={PAD_L - TICK_LEN - 2}
            y={y}
            textAnchor="end"
            dominantBaseline="central"
            fill={AXIS_COLOR}
            fontSize={AXIS_FONT}
          >
            {label}
          </text>
        </g>
      ))}

      {xTicks.map(({ x, label }) => (
        <g key={x}>
          <line x1={x} y1={plotBot} x2={x} y2={plotBot + TICK_LEN} stroke={AXIS_COLOR} strokeWidth={0.7} />
          <text
            x={x}
            y={plotBot + TICK_LEN + 2}
            textAnchor="middle"
            dominantBaseline="hanging"
            fill={AXIS_COLOR}
            fontSize={AXIS_FONT}
          >
            {label}
          </text>
        </g>
      ))}
    </>
  );
}

function ChartSvg({ children, xCount }: { children: ReactNode; xCount: number }) {
  return (
    <div style={chartWrapStyle}>
      <svg
        viewBox={`0 0 ${TOTAL_W} ${TOTAL_H}`}
        width="100%"
        role="img"
        style={{ display: 'block' }}
      >
        <rect x="0" y="0" width={TOTAL_W} height={TOTAL_H} fill="#ffffff" />
        <AxisLayer xCount={xCount} />
        <g transform={`translate(${PAD_L}, ${PAD_T})`}>
          {children}
        </g>
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
      <div style={{ color: '#1a1a1a', fontSize: '12px', textAlign: 'center' }}>
        Audio NMF on |STFT| — W columns (frequency x component){' '}
        <span style={{ color: '#666' }}>
          · {audio.freqBins} bins x {audio.timeFrames} frames · KL loss = {audio.reconstructionError.toExponential(4)}
        </span>
      </div>

      {wColumns.map((col, j) => (
        <div key={`w-${j}`}>
          <div style={{ color: W_STROKES[j % W_STROKES.length]!, fontSize: '12px', marginBottom: '6px' }}>
            W[:, {j}] (spectral component)
          </div>
          <ChartSvg xCount={audio.freqBins}>
            <polyline
              fill="none"
              stroke={W_STROKES[j % W_STROKES.length]}
              strokeWidth={STROKE_W}
              vectorEffect="non-scaling-stroke"
              points={NmfPlotGeometry.polylinePointsY(col, PLOT_W, PLOT_H)}
            />
          </ChartSvg>
        </div>
      ))}

      <div>
        <div style={{ color: '#1a1a1a', fontSize: '12px', marginBottom: '4px' }}>
          H activations vs STFT time + upscaled video h_init
        </div>
        <div style={{ color: '#555', fontSize: '10px', marginBottom: '8px', lineHeight: 1.35, textAlign: 'center' }}>
          Overlay uses <strong style={{ color: '#333' }}>per-trace min-max normalization</strong> (display only).
          Raw magnitudes differ: h_init is ~O(1) after gating while fitted H often scales with W in WH = |STFT|.
        </div>
        <ChartSvg xCount={audio.timeFrames}>
          <polyline
            fill="none"
            stroke={H_INIT_STROKE}
            strokeWidth={STROKE_W}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
            points={NmfPlotGeometry.polylinePointsYInRange(
              hInitForOverlay,
              PLOT_W,
              PLOT_H,
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
                PLOT_H,
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
