import type { AudioNmfFactorization } from './PostCaptureNmfOrchestrator';

export function cloneAudioFactorization(a: AudioNmfFactorization): AudioNmfFactorization {
  return {
    freqBins: a.freqBins,
    timeFrames: a.timeFrames,
    wColumns: a.wColumns.map(col => [...col]),
    hRows: a.hRows.map(row => [...row]),
    visualPrior: [...a.visualPrior],
    visualActivationFrames: [...a.visualActivationFrames],
    selectedComponentIndex: a.selectedComponentIndex,
    componentScores: a.componentScores.map(score => ({ ...score })),
    shiftedPriorBestScore: a.shiftedPriorBestScore,
    nullComparisonLabel: a.nullComparisonLabel,
    reconstructionError: a.reconstructionError,
    originalPeak: a.originalPeak,
    selectedComponentPeak: a.selectedComponentPeak,
    residualPeak: a.residualPeak,
    round2TargetPeak: a.round2TargetPeak,
    round2RemixPeak: a.round2RemixPeak,
    round2Mode: a.round2Mode,
  };
}

export type Round1Bundle = {
  audio: AudioNmfFactorization;
  selectedComponentMono: Float32Array;
  residualMono: Float32Array;
  sampleRate: number;
};
