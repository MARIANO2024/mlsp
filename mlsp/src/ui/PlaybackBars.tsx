import type { PlaybackTimeline } from '../AudioManager';

export interface PlaybackBarsProps {
  width: string;
  timeline: PlaybackTimeline;
  phaseLabel: string;
  elapsedLabel: string;
}

export function PlaybackBars({ width, timeline, phaseLabel, elapsedLabel }: PlaybackBarsProps) {
  const overallProgress =
    timeline.totalSeconds > 0 ? Math.min(timeline.elapsedSeconds / timeline.totalSeconds, 1) : 0;

  const phaseColor =
    phaseLabel === 'PREVIEW'
      ? 'var(--accent)'
      : phaseLabel === 'GAP'
        ? 'var(--accent-warm)'
        : phaseLabel === 'CAPTURE'
          ? 'var(--success)'
          : phaseLabel === 'PROCESSING'
            ? '#6a7f9b'
            : 'var(--border-strong)';

  return (
    <>
      <div
        style={{
          width,
          marginTop: '10px',
          padding: '12px 14px',
          borderRadius: '14px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-soft)',
          boxShadow: 'var(--shadow-soft)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
            color: 'var(--ink-body)',
            fontSize: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          <span>{phaseLabel}</span>
          <span>{elapsedLabel}</span>
        </div>
        <div
          style={{
            height: '10px',
            backgroundColor: 'var(--bg-surface-2)',
            borderRadius: '999px',
            overflow: 'hidden',
            border: '1px solid var(--border-soft)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${overallProgress * 100}%`,
              background: `linear-gradient(90deg, ${phaseColor} 0%, color-mix(in srgb, ${phaseColor} 65%, white) 100%)`,
              borderRadius: '999px',
              transition: 'width 0.15s linear, background 0.15s linear',
            }}
          />
        </div>
      </div>
    </>
  );
}
