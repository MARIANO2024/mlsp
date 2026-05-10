export function makeMatrixFilename(videoFilename: string): string {
  return videoFilename.replace(/\.webm$/i, '_matrix.json');
}

export function makeResidualWavFilename(videoFilename: string): string {
  return videoFilename.replace(/\.webm$/i, '_nmf_residual_no_comp0.wav');
}

export function makeRemixWavFilename(videoFilename: string): string {
  return videoFilename.replace(/\.webm$/i, '_nmf_remix_round2.wav');
}

export function makePlay2WebmRecordingName(selectedAudioStem: string | null): string {
  const stem = selectedAudioStem?.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_') || 'sync_capture';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stem}_play2_${timestamp}.webm`;
}
