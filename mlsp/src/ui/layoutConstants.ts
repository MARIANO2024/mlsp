import type { CSSProperties } from 'react';
import type { PlaybackTimeline } from '../AudioManager';

export const CONTENT_WIDTH = '78%';

export const BTN_BASE: CSSProperties = {
  flex: 1,
  padding: '18px 0',
  fontSize: '16px',
  fontWeight: 600,
  border: '1px solid var(--border-soft)',
  borderRadius: '10px',
  color: 'var(--ink-strong)',
  cursor: 'pointer',
  letterSpacing: '0.5px',
  backgroundColor: 'var(--bg-panel)',
  boxShadow: 'var(--shadow-soft)',
  transition: 'filter 0.15s, background-color 0.15s, border-color 0.15s',
};

export const EMPTY_TIMELINE: PlaybackTimeline = {
  phase: 'idle',
  playProgress: 0,
  gapProgress: 0,
  elapsedSeconds: 0,
  totalSeconds: 0,
  currentPlay: 0,
  totalPlays: 0,
};
