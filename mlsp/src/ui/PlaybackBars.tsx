import type { PlaybackTimeline } from '../AudioManager';

export interface PlaybackBarsProps {
  width: string;
  timeline: PlaybackTimeline;
  phaseLabel: string;
  elapsedLabel: string;
}

export function PlaybackBars({ width, timeline, phaseLabel, elapsedLabel }: PlaybackBarsProps) {
  return (
    <>
      <div
        style={{
          width,
          height: '6px',
          marginTop: '10px',
          backgroundColor: '#1a1a2e',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${timeline.playProgress * 100}%`,
            backgroundColor: '#a0a0ff',
          }}
        />
      </div>

      <div
        style={{
          width,
          height: '6px',
          marginTop: '16px',
          backgroundColor: '#1a1a2e',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${timeline.gapProgress * 100}%`,
            backgroundColor: '#e5a050',
          }}
        />
      </div>

      <div
        style={{
          width,
          marginTop: '10px',
          display: 'flex',
          justifyContent: 'space-between',
          color: '#8585a8',
          fontSize: '12px',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        <span>{phaseLabel}</span>
        <span>{elapsedLabel}</span>
      </div>
    </>
  );
}
