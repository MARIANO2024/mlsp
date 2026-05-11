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
const AXIS_COLOR = '#938877';

const W_STROKES = ['#3a3aff', '#c46a10', '#1f9e6c'] as const;
const H_STROKES = ['#3a3aff', '#c46a10', '#1f9e6c'] as const;
const VISUAL_PRIOR_STROKE = '#444';

const panelStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const chartWrapStyle: CSSProperties = {
  borderRadius: '6px',
  overflow: 'hidden',
  backgroundColor: '#fffdf8',
  border: '1px solid #dfd5c7',
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
        <rect x="0" y="0" width={TOTAL_W} height={TOTAL_H} fill="#fffdf8" />
        <AxisLayer xCount={xCount} />
        <g transform={`translate(${PAD_L}, ${PAD_T})`}>
          {children}
        </g>
      </svg>
    </div>
  );
}

export function AudioNmfFactorizationPlots({ audio }: { audio: AudioNmfFactorization }) {
  const { wColumns, hRows, visualPrior, selectedComponentIndex } = audio;
  const visualPriorForOverlay = NmfPlotGeometry.normalizeMinMaxSeries(visualPrior);
  const hRowsForOverlay = hRows.map(r => NmfPlotGeometry.normalizeMinMaxSeries(r));
  const selectedH = hRows[selectedComponentIndex] ?? [];
  const selectedHForOverlay = NmfPlotGeometry.normalizeMinMaxSeries(selectedH);
  const overlayYMin = 0;
  const overlayYMax = 1;
  const selectedScore = audio.componentScores.find(s => s.componentIndex === selectedComponentIndex);

  return (
    <div style={panelStyle}>
      <div style={{ color: 'var(--ink-strong)', fontSize: '12px', textAlign: 'center' }}>
        Audio NMF on |STFT| - W columns (frequency x component){' '}
        <span style={{ color: 'var(--ink-muted)' }}>
          · {audio.freqBins} bins x {audio.timeFrames} frames · KL loss = {audio.reconstructionError.toExponential(4)}
        </span>
      </div>

      <div style={{ color: 'var(--ink-strong)', fontSize: '12px', textAlign: 'center', lineHeight: 1.5 }}>
        <strong>Selected visual-matched component:</strong> H[{selectedComponentIndex}, :]
        {selectedScore && (
          <span style={{ color: H_STROKES[selectedComponentIndex % H_STROKES.length] }}>
            {' '}score {selectedScore.score.toFixed(3)}
          </span>
        )}
        <div style={{ color: 'var(--ink-muted)', fontSize: '11px' }}>{audio.nullComparisonLabel}</div>
      </div>

      {wColumns.map((col, j) => (
        <div key={`w-${j}`}>
          <div style={{ color: W_STROKES[j % W_STROKES.length]!, fontSize: '12px', marginBottom: '6px' }}>
            W[:, {j}] {j === selectedComponentIndex ? '(selected visual-matched component)' : '(spectral component)'}
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
        <div style={{ color: 'var(--ink-strong)', fontSize: '12px', marginBottom: '4px' }}>
          Visual prior and all H rows
        </div>
        <div style={{ color: 'var(--ink-body)', fontSize: '10px', marginBottom: '8px', lineHeight: 1.35, textAlign: 'center' }}>
          Overlay uses <strong style={{ color: 'var(--ink-strong)' }}>per-trace min-max normalization</strong> for display only.
          The dashed trace is the frame-diff motion prior; H rows are fitted by blind audio NMF.
        </div>
        <ChartSvg xCount={audio.timeFrames}>
          <polyline
            fill="none"
            stroke={VISUAL_PRIOR_STROKE}
            strokeWidth={STROKE_W}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
            points={NmfPlotGeometry.polylinePointsYInRange(
              visualPriorForOverlay,
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
          <span style={{ color: VISUAL_PRIOR_STROKE, fontSize: '11px' }}>visual prior (motion, dashed)</span>
          {hRows.map((_, j) => (
            <span key={`leg-${j}`} style={{ color: H_STROKES[j % H_STROKES.length], fontSize: '11px' }}>
              H[{j}, :] {j === selectedComponentIndex ? 'selected' : 'fitted'}
            </span>
          ))}
        </div>
      </div>

      <div>
        <div style={{ color: 'var(--ink-strong)', fontSize: '12px', marginBottom: '6px' }}>
          Selected H row vs visual prior
        </div>
        <ChartSvg xCount={audio.timeFrames}>
          <polyline
            fill="none"
            stroke={VISUAL_PRIOR_STROKE}
            strokeWidth={STROKE_W}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
            points={NmfPlotGeometry.polylinePointsYInRange(
              visualPriorForOverlay,
              PLOT_W,
              PLOT_H,
              overlayYMin,
              overlayYMax,
            )}
          />
          <polyline
            fill="none"
            stroke={H_STROKES[selectedComponentIndex % H_STROKES.length]}
            strokeWidth={STROKE_W + 0.4}
            vectorEffect="non-scaling-stroke"
            points={NmfPlotGeometry.polylinePointsYInRange(
              selectedHForOverlay,
              PLOT_W,
              PLOT_H,
              overlayYMin,
              overlayYMax,
            )}
          />
        </ChartSvg>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '8px',
          color: 'var(--ink-strong)',
          fontSize: '11px',
        }}
      >
        {audio.componentScores.map(score => (
          <div
            key={score.componentIndex}
            style={{
              border: score.componentIndex === selectedComponentIndex ? '2px solid var(--accent)' : '1px solid var(--border-soft)',
              borderRadius: '6px',
              padding: '8px',
              background: score.componentIndex === selectedComponentIndex ? 'var(--accent-soft)' : '#fffdf8',
            }}
          >
            <strong>H[{score.componentIndex}]</strong>
            <div>score {score.score.toFixed(3)}</div>
            <div>cos {score.cosine.toFixed(3)} · onset {score.onsetCosine.toFixed(3)}</div>
            <div>pearson {score.pearson.toFixed(3)}</div>
            <div>shifted {score.shiftedScore.toFixed(3)}</div>
          </div>
        ))}
      </div>

      <div style={{ color: 'var(--ink-body)', fontSize: '11px', textAlign: 'center', lineHeight: 1.55 }}>
        Original peak {audio.originalPeak.toFixed(3)} · selected component peak {audio.selectedComponentPeak.toFixed(3)}
        {' '}· residual peak {audio.residualPeak.toFixed(3)}
        {audio.round2TargetPeak != null && <> · Round 2 target peak {audio.round2TargetPeak.toFixed(3)}</>}
        {audio.round2RemixPeak != null && <> · Round 2 remix peak {audio.round2RemixPeak.toFixed(3)}</>}
        {audio.round2Mode && <> · Round 2 mode: {audio.round2Mode === 'grain-demo' ? 'grain demo mode' : 'fixed-W remix'}</>}
        {selectedComponentIndex !== 0 && (
          <div style={{ color: 'var(--ink-muted)', marginTop: '4px' }}>
            Legacy H0 diagnostic: H[0] is displayed above, but it is not assumed to be the target.
          </div>
        )}
      </div>
    </div>
  );
}
