function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

export function formatMasterTime(ms: number | null): string {
  return ms === null ? 'pending' : `${ms.toFixed(2)} ms`;
}

export function formatDelta(videoMs: number | null, audioMs: number | null): string {
  if (videoMs === null || audioMs === null) return 'pending';
  const delta = videoMs - audioMs;
  const direction = delta > 0 ? 'video late' : delta < 0 ? 'video early' : 'aligned';
  return `${delta >= 0 ? '+' : ''}${formatMs(delta)} (${direction})`;
}
