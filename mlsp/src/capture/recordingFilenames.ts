export function makeMatrixFilename(videoFilename: string): string {
  return videoFilename.replace(/\.webm$/i, '_matrix.json');
}

export function makeResidualWavFilename(videoFilename: string): string {
  return videoFilename.replace(/\.webm$/i, '_nmf_residual_selected_component.wav');
}

export function makeSelectedComponentWavFilename(videoFilename: string): string {
  return videoFilename.replace(/\.webm$/i, '_nmf_selected_component.wav');
}

export function makeRemixWavFilename(videoFilename: string): string {
  return videoFilename.replace(/\.webm$/i, '_nmf_remix_round2.wav');
}

export function makeRound2TargetWavFilename(videoFilename: string): string {
  return videoFilename.replace(/\.webm$/i, '_nmf_round2_new_target.wav');
}

export function makeNmfDebugFilename(videoFilename: string): string {
  return videoFilename.replace(/\.webm$/i, '_nmf_debug.json');
}

export function makePlay2WebmRecordingName(selectedAudioStem: string | null): string {
  const stem = selectedAudioStem?.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_') || 'sync_capture';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stem}_play2_${timestamp}.webm`;
}
