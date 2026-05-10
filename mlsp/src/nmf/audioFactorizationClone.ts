import type { AudioNmfFactorization } from './PostCaptureNmfOrchestrator';

export function cloneAudioFactorization(a: AudioNmfFactorization): AudioNmfFactorization {
  return {
    freqBins: a.freqBins,
    timeFrames: a.timeFrames,
    wColumns: a.wColumns.map(col => [...col]),
    hRows: a.hRows.map(row => [...row]),
    hInitUpscaledRow: [...a.hInitUpscaledRow],
    reconstructionError: a.reconstructionError,
  };
}

export type Round1Bundle = {
  audio: AudioNmfFactorization;
  residualMono: Float32Array;
  sampleRate: number;
};
