import * as tf from '@tensorflow/tfjs';
import MatrixManager, { type ChooseBestNmmfOptions } from '../MatrixManager';

export const POST_CAPTURE_NMF = {
  VIDEO_K: 2,
  AUDIO_K: 3,
  N_ITER: 200,
  N_RESTARTS: 10,
} as const;

export interface ComponentSimilarityScore {
  componentIndex: number;
  cosine: number;
  onsetCosine: number;
  pearson: number;
  score: number;
  shiftedScore: number;
}

export interface AudioNmfFactorization {
  freqBins: number;
  timeFrames: number;
  wColumns: number[][];
  hRows: number[][];
  visualPrior: number[];
  visualActivationFrames: number[];
  selectedComponentIndex: number;
  componentScores: ComponentSimilarityScore[];
  shiftedPriorBestScore: number;
  nullComparisonLabel: string;
  reconstructionError: number;
  originalPeak: number;
  selectedComponentPeak: number;
  residualPeak: number;
  round2TargetPeak?: number;
  round2RemixPeak?: number;
  round2Mode?: 'fixed-w' | 'grain-demo';
}

export interface PostCaptureNmfResult {
  audio: AudioNmfFactorization;
  selectedComponentMono: Float32Array;
  residualMono: Float32Array;
  sampleRate: number;
  debug: unknown;
}

export interface PostCaptureRemixResult {
  audio: AudioNmfFactorization;
  newTargetMono: Float32Array;
  remixedMono: Float32Array;
  sampleRate: number;
  mode: 'fixed-w' | 'grain-demo';
  debug: unknown;
}

export type CaptureNmfStepReporter = (headline: string, body: string) => void | Promise<void>;

async function yieldToBrowser(): Promise<void> {
  await new Promise<void>(resolve => {
    requestAnimationFrame(() => resolve());
  });
}

function extractWColumns(w: tf.Tensor2D): number[][] {
  const [f, k] = w.shape;
  const buf = w.dataSync();
  const cols: number[][] = [];
  for (let j = 0; j < k; j++) {
    const col = new Array<number>(f);
    for (let i = 0; i < f; i++) col[i] = buf[i * k + j]!;
    cols.push(col);
  }
  return cols;
}

function extractHRows(h: tf.Tensor2D): number[][] {
  const [k, n] = h.shape;
  const buf = h.dataSync();
  const rows: number[][] = [];
  for (let r = 0; r < k; r++) {
    rows.push(Array.from(buf.subarray(r * n, (r + 1) * n)));
  }
  return rows;
}

function tensorWFromColumns(wColumns: number[][]): tf.Tensor2D {
  const k = wColumns.length;
  if (k === 0) throw new Error('tensorWFromColumns: empty W');
  const f = wColumns[0]!.length;
  const data = new Float32Array(f * k);
  for (let i = 0; i < f; i++) {
    for (let j = 0; j < k; j++) data[i * k + j] = wColumns[j]![i]!;
  }
  return tf.tensor2d(data, [f, k]);
}

function tensorHFromRows(rows: number[][]): tf.Tensor2D {
  const k = rows.length;
  if (k === 0) throw new Error('tensorHFromRows: empty H');
  const n = rows[0]!.length;
  const data = new Float32Array(k * n);
  for (let r = 0; r < k; r++) {
    if (rows[r]!.length !== n) {
      throw new Error(`tensorHFromRows: row length mismatch (${rows[r]!.length} vs ${n})`);
    }
    data.set(rows[r]!, r * n);
  }
  return tf.tensor2d(data, [k, n]);
}

function assertFiniteMatrix(name: string, matrix: number[][]): void {
  if (matrix.length === 0) throw new Error(`${name}: empty matrix`);
  const cols = matrix[0]?.length ?? 0;
  if (cols === 0) throw new Error(`${name}: matrix has no frames`);
  for (let r = 0; r < matrix.length; r++) {
    if (matrix[r]!.length !== cols) throw new Error(`${name}: ragged row ${r}`);
    for (let c = 0; c < cols; c++) {
      if (!Number.isFinite(matrix[r]![c]!)) throw new Error(`${name}: non-finite value at ${r},${c}`);
    }
  }
}

function assertFiniteTensor(name: string, tensor: tf.Tensor): void {
  const values = tensor.dataSync();
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i]!)) throw new Error(`${name}: NMF returned a non-finite value`);
  }
}

function frameDifferencePreserveLength(matrix: number[][]): number[][] {
  assertFiniteMatrix('video matrix', matrix);
  const rowCount = matrix.length;
  const frameCount = matrix[0]!.length;
  if (frameCount < 3) throw new Error(`Need at least 3 captured frames; got ${frameCount}.`);

  const diff = Array.from({ length: rowCount }, () => new Array<number>(frameCount).fill(0));
  let maxVal = 0;
  for (let r = 0; r < rowCount; r++) {
    const src = matrix[r]!;
    const dst = diff[r]!;
    for (let t = 1; t < frameCount; t++) {
      const v = Math.abs(src[t]! - src[t - 1]!);
      dst[t] = v;
      if (v > maxVal) maxVal = v;
    }
  }

  if (maxVal > 0) {
    for (const row of diff) {
      for (let t = 0; t < row.length; t++) row[t] = row[t]! / maxVal;
    }
  }
  return diff;
}

function normalizeMinMax(values: number[]): number[] {
  if (values.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return values.map(() => 0);
  }
  return values.map(v => (Number.isFinite(v) ? (v - min) / (max - min) : 0));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx]!;
}

function positiveDerivative(values: number[]): number[] {
  return values.map((v, i) => Math.max(0, v - (values[i - 1] ?? 0)));
}

function smooth3(values: number[]): number[] {
  return values.map((v, i) => {
    const prev = values[i - 1] ?? v;
    const next = values[i + 1] ?? v;
    return prev * 0.25 + v * 0.5 + next * 0.25;
  });
}

function shapeVisualPrior(values: number[]): number[] {
  const base = normalizeMinMax(values);
  const gate = Math.max(0.15, percentile(base, 0.6));
  const gated = base.map(v => (v >= gate ? (v - gate) / Math.max(1 - gate, 1e-6) : 0));
  const transient = positiveDerivative(gated).map((v, i) => v + gated[i]! * 0.2);
  const shaped = normalizeMinMax(smooth3(transient));
  const peak = Math.max(...shaped, 0);
  return peak > 0 ? shaped : base;
}

function circularShift(values: number[], amount: number): number[] {
  if (values.length === 0) return [];
  const n = values.length;
  const shift = ((amount % n) + n) % n;
  return values.map((_, i) => values[(i - shift + n) % n]!);
}

function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let out = 0;
  for (let i = 0; i < n; i++) out += a[i]! * b[i]!;
  return out;
}

function cosineSimilarity(aIn: number[], bIn: number[]): number {
  const a = normalizeMinMax(aIn);
  const b = normalizeMinMax(bIn);
  const denom = Math.sqrt(dot(a, a) * dot(b, b));
  return denom > 1e-12 ? dot(a, b) / denom : 0;
}

function pearsonSimilarity(aIn: number[], bIn: number[]): number {
  const n = Math.min(aIn.length, bIn.length);
  if (n < 2) return 0;
  const a = normalizeMinMax(aIn).slice(0, n);
  const b = normalizeMinMax(bIn).slice(0, n);
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  return denom > 1e-12 ? num / denom : 0;
}

function scoreComponents(hRows: number[][], visualPrior: number[]): ComponentSimilarityScore[] {
  const shiftedPrior = circularShift(visualPrior, Math.max(1, Math.floor(visualPrior.length / 2)));
  return hRows.map((row, componentIndex) => {
    const cosine = cosineSimilarity(row, visualPrior);
    const onsetCosine = cosineSimilarity(positiveDerivative(row), positiveDerivative(visualPrior));
    const pearson = pearsonSimilarity(row, visualPrior);
    const shiftedScore =
      0.6 * cosineSimilarity(row, shiftedPrior) +
      0.4 * cosineSimilarity(positiveDerivative(row), positiveDerivative(shiftedPrior));
    return {
      componentIndex,
      cosine,
      onsetCosine,
      pearson,
      score: 0.6 * cosine + 0.4 * onsetCosine,
      shiftedScore,
    };
  });
}

function chooseSelectedComponent(scores: ComponentSimilarityScore[]): number {
  if (scores.length === 0) throw new Error('No audio NMF components to score.');
  return [...scores].sort((a, b) => b.score - a.score)[0]!.componentIndex;
}

function makeNullLabel(selected: ComponentSimilarityScore, shiftedBest: number): string {
  const margin = selected.score - shiftedBest;
  return `Demo evidence: selected score ${selected.score.toFixed(3)} vs circular-shift best ${shiftedBest.toFixed(3)} (margin ${margin >= 0 ? '+' : ''}${margin.toFixed(3)}).`;
}

function scalePriorToRow(prior: number[], referenceRow: number[]): number[] {
  const priorSum = prior.reduce((s, v) => s + Math.max(0, v), 0);
  const refSum = referenceRow.reduce((s, v) => s + Math.max(0, v), 0);
  if (priorSum <= 1e-9 || refSum <= 1e-9) return referenceRow.map(() => 0);
  const scale = refSum / priorSum;
  return prior.map(v => Math.max(0, v) * scale);
}

function detectPeaks(values: number[], maxPeaks: number): number[] {
  const norm = normalizeMinMax(values);
  const threshold = Math.max(0.25, percentile(norm, 0.72));
  const peaks: number[] = [];
  for (let i = 1; i < norm.length - 1; i++) {
    if (norm[i]! >= threshold && norm[i]! >= norm[i - 1]! && norm[i]! >= norm[i + 1]!) {
      peaks.push(i);
    }
  }
  return peaks
    .sort((a, b) => norm[b]! - norm[a]!)
    .slice(0, maxPeaks)
    .sort((a, b) => a - b);
}

function makeGrainDemo(
  selectedComponentMono: Float32Array,
  residualMono: Float32Array,
  visualPrior: number[],
  sampleRate: number,
): { newTargetMono: Float32Array; remixedMono: Float32Array } {
  const out = new Float32Array(residualMono.length);
  const grainLength = Math.max(256, Math.round(sampleRate * 0.12));
  const half = Math.floor(grainLength / 2);
  const srcPeakSample = selectedComponentMono.reduce(
    (best, v, i) => (Math.abs(v) > Math.abs(selectedComponentMono[best] ?? 0) ? i : best),
    0,
  );
  const srcStart = Math.max(0, Math.min(selectedComponentMono.length - grainLength, srcPeakSample - half));
  const onsets = detectPeaks(visualPrior, 18);

  for (const frameIdx of onsets) {
    const center = Math.round((frameIdx / Math.max(visualPrior.length - 1, 1)) * out.length);
    const dstStart = center - half;
    for (let i = 0; i < grainLength; i++) {
      const dst = dstStart + i;
      const src = srcStart + i;
      if (dst < 0 || dst >= out.length || src < 0 || src >= selectedComponentMono.length) continue;
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(grainLength - 1, 1));
      out[dst] += selectedComponentMono[src]! * win;
    }
  }

  const target = MatrixManager.limitPeak(out, 0.98, 0.18);
  const mix = MatrixManager.mixMono(residualMono, target.samples, 0.98);
  return { newTargetMono: target.samples, remixedMono: mix.samples };
}

function baseDebug(audio: AudioNmfFactorization, extra: Record<string, unknown> = {}) {
  return {
    selectedComponentIndex: audio.selectedComponentIndex,
    componentScores: audio.componentScores,
    shiftedPriorBestScore: audio.shiftedPriorBestScore,
    nullComparisonLabel: audio.nullComparisonLabel,
    reconstructionError: audio.reconstructionError,
    peaks: {
      original: audio.originalPeak,
      selectedComponent: audio.selectedComponentPeak,
      residual: audio.residualPeak,
      round2Target: audio.round2TargetPeak,
      round2Remix: audio.round2RemixPeak,
    },
    ...extra,
  };
}

export class PostCaptureNmfOrchestrator {
  static async run(
    videoMatrix: number[][],
    audioMono: Float32Array,
    sampleRate: number,
    onStep?: CaptureNmfStepReporter,
  ): Promise<PostCaptureNmfResult> {
    const report = async (headline: string, body: string) => {
      await onStep?.(headline, body);
      await yieldToBrowser();
    };

    const bestOpts: ChooseBestNmmfOptions = {
      nIter: POST_CAPTURE_NMF.N_ITER,
      nRestarts: POST_CAPTURE_NMF.N_RESTARTS,
    };

    let xTensor: tf.Tensor2D | null = null;
    let motionTensor: tf.Tensor2D | null = null;
    let D: tf.Tensor2D | null = null;

    try {
      await report('Video motion', 'Frame differencing with preserved frame count; raw appearance pixels are not used for the main visual path.');
      const motionMatrix = frameDifferencePreserveLength(videoMatrix);
      motionTensor = tf.tensor2d(motionMatrix);

      await report('Video NMF', `Motion matrix NMF: k=${POST_CAPTURE_NMF.VIDEO_K}, ${POST_CAPTURE_NMF.N_RESTARTS} restarts.`);
      xTensor = motionTensor;
      motionTensor = null;
      const vid = MatrixManager.chooseBestNmmf(xTensor, POST_CAPTURE_NMF.VIDEO_K, undefined, bestOpts);
      assertFiniteTensor('video W', vid.w);
      assertFiniteTensor('video H', vid.h);
      xTensor.dispose();
      xTensor = null;

      await report('Visual prior', 'Dominant motion activation, gate/normalize, then transient-shape for onset-like timing.');
      const videoActivationTensor = MatrixManager.processActivation(vid.h);
      vid.w.dispose();
      vid.h.dispose();
      const visualActivationFrames = Array.from(videoActivationTensor.dataSync());
      videoActivationTensor.dispose();
      const shapedVisualFrames = shapeVisualPrior(visualActivationFrames);

      await report('STFT', 'Magnitude STFT for blind audio NMF; KL is diagnostic, not a separation claim.');
      const stft = MatrixManager.stftMagnitudeAndComplex(audioMono);
      D = stft.D;
      stft.stftComplex.dispose();

      const visualTensor = tf.tensor1d(shapedVisualFrames);
      const upRow = MatrixManager.upscaleActivation(visualTensor, D);
      visualTensor.dispose();
      const visualPrior = shapeVisualPrior(Array.from(upRow.dataSync()));
      upRow.dispose();

      await report('Audio NMF', `Blind audio NMF: k=${POST_CAPTURE_NMF.AUDIO_K}, ${POST_CAPTURE_NMF.N_RESTARTS} restarts. Component identity is selected after fitting.`);
      const audioBest = MatrixManager.chooseBestNmmf(D, POST_CAPTURE_NMF.AUDIO_K, undefined, bestOpts);
      assertFiniteTensor('audio W', audioBest.w);
      assertFiniteTensor('audio H', audioBest.h);

      await report('Component selection', 'Score every fitted H row against the shaped visual prior; choose the visual-matched component.');
      const wColumns = extractWColumns(audioBest.w);
      const hRows = extractHRows(audioBest.h);
      const componentScores = scoreComponents(hRows, visualPrior);
      const selectedComponentIndex = chooseSelectedComponent(componentScores);
      const selectedScore = componentScores.find(s => s.componentIndex === selectedComponentIndex)!;
      const shiftedPriorBestScore = Math.max(...componentScores.map(s => s.shiftedScore));
      const nullComparisonLabel = makeNullLabel(selectedScore, shiftedPriorBestScore);

      await report('Ratio-mask resynthesis', 'Selected component and residual use ratio masks with original phase, then peak limiting for playback.');
      const resynth = MatrixManager.synthesizeComponentAndResidualRatioMask(
        audioMono,
        audioBest.w,
        audioBest.h,
        selectedComponentIndex,
      );

      const err = audioBest.error;
      audioBest.w.dispose();
      audioBest.h.dispose();
      D.dispose();
      D = null;

      const freqBins = wColumns[0]?.length ?? 0;
      const timeFrames = hRows[0]?.length ?? 0;
      const audio: AudioNmfFactorization = {
        freqBins,
        timeFrames,
        wColumns,
        hRows,
        visualPrior,
        visualActivationFrames: shapedVisualFrames,
        selectedComponentIndex,
        componentScores,
        shiftedPriorBestScore,
        nullComparisonLabel,
        reconstructionError: err,
        originalPeak: MatrixManager.peak(audioMono),
        selectedComponentPeak: resynth.selectedComponentPeak,
        residualPeak: resynth.residualPeak,
      };

      return {
        audio,
        selectedComponentMono: resynth.selectedComponentMono,
        residualMono: resynth.residualMono,
        sampleRate,
        debug: baseDebug(audio, {
          videoFrames: videoMatrix[0]?.length ?? 0,
          videoRows: videoMatrix.length,
          motionPath: 'frameDifferencePreserveLength',
          selectedComponentWasSilent: resynth.selectedComponentWasSilent,
          residualWasSilent: resynth.residualWasSilent,
        }),
      };
    } catch (e) {
      xTensor?.dispose();
      motionTensor?.dispose();
      D?.dispose();
      throw e;
    }
  }

  static async runRound2Remix(
    videoMatrix: number[][],
    audioMono: Float32Array,
    sampleRate: number,
    round1Audio: AudioNmfFactorization,
    round1SelectedComponentMono: Float32Array,
    round1ResidualMono: Float32Array,
    onStep?: CaptureNmfStepReporter,
  ): Promise<PostCaptureRemixResult> {
    const report = async (headline: string, body: string) => {
      await onStep?.(headline, body);
      await yieldToBrowser();
    };

    const bestOpts: ChooseBestNmmfOptions = {
      nIter: POST_CAPTURE_NMF.N_ITER,
      nRestarts: POST_CAPTURE_NMF.N_RESTARTS,
    };

    let xTensor: tf.Tensor2D | null = null;
    let D: tf.Tensor2D | null = null;
    let wTensor: tf.Tensor2D | null = null;
    let hTensor: tf.Tensor2D | null = null;
    let targetMag: tf.Tensor2D | null = null;

    try {
      await report('Round 2 video motion', 'New gesture uses the same motion-first frame-difference path.');
      const motionMatrix = frameDifferencePreserveLength(videoMatrix);
      xTensor = tf.tensor2d(motionMatrix);

      await report('Round 2 video NMF', `Motion matrix NMF: k=${POST_CAPTURE_NMF.VIDEO_K}, ${POST_CAPTURE_NMF.N_RESTARTS} restarts.`);
      const vid = MatrixManager.chooseBestNmmf(xTensor, POST_CAPTURE_NMF.VIDEO_K, undefined, bestOpts);
      assertFiniteTensor('round 2 video W', vid.w);
      assertFiniteTensor('round 2 video H', vid.h);
      xTensor.dispose();
      xTensor = null;

      const videoActivationTensor = MatrixManager.processActivation(vid.h);
      vid.w.dispose();
      vid.h.dispose();
      const visualActivationFrames = Array.from(videoActivationTensor.dataSync());
      videoActivationTensor.dispose();
      const shapedVisualFrames = shapeVisualPrior(visualActivationFrames);

      await report('Round 2 visual prior', 'Upscale the new gesture timing to the original STFT frame grid.');
      const stft = MatrixManager.stftMagnitudeAndComplex(audioMono);
      D = stft.D;
      stft.stftComplex.dispose();
      const nFrames = D.shape[1]!;
      const fBins = D.shape[0]!;

      if (round1Audio.timeFrames !== nFrames || round1Audio.freqBins !== fBins) {
        throw new Error(
          `Round 2 remix: round-1 factors (${round1Audio.freqBins}x${round1Audio.timeFrames}) do not match current STFT (${fBins}x${nFrames}).`,
        );
      }

      const selected = round1Audio.selectedComponentIndex;
      if (!Number.isInteger(selected) || selected < 0 || selected >= round1Audio.hRows.length) {
        throw new Error('Round 2 remix: missing selectedComponentIndex from Round 1.');
      }

      const visualTensor = tf.tensor1d(shapedVisualFrames);
      const upRow = MatrixManager.upscaleActivation(visualTensor, D);
      visualTensor.dispose();
      const visualPrior = shapeVisualPrior(Array.from(upRow.dataSync()));
      upRow.dispose();

      await report('Round 2 fixed-W remix', 'Reuse the selected W column from Round 1; replace only the selected H row with new gesture timing.');
      const hRows = round1Audio.hRows.map(row => [...row]);
      hRows[selected] = scalePriorToRow(visualPrior, round1Audio.hRows[selected]!);
      wTensor = tensorWFromColumns(round1Audio.wColumns);
      hTensor = tensorHFromRows(hRows);

      const errTensor = MatrixManager.reconstructionError(D, wTensor, hTensor);
      const reconstructionError = errTensor.dataSync()[0]!;
      errTensor.dispose();

      targetMag = tf.tidy(() => {
        const wj = tf.slice(wTensor!, [0, selected], [fBins, 1]);
        const hj = tf.slice(hTensor!, [selected, 0], [1, nFrames]);
        return tf.matMul(wj, hj) as tf.Tensor2D;
      });

      const targetRaw = MatrixManager.synthesizeMagnitudeWithOriginalPhase(audioMono, targetMag);
      const targetLimited = MatrixManager.limitPeak(targetRaw, 0.98, 0.18);
      let newTargetMono = targetLimited.samples;
      let remixedMono = MatrixManager.mixMono(round1ResidualMono, newTargetMono, 0.98).samples;
      let mode: 'fixed-w' | 'grain-demo' = 'fixed-w';

      if (targetLimited.wasSilent || targetLimited.outputPeak < 1e-4) {
        await report('Round 2 grain demo mode', 'Fixed-W target was silent, so short grains from the selected component are triggered by new gesture onsets.');
        const grain = makeGrainDemo(round1SelectedComponentMono, round1ResidualMono, visualPrior, sampleRate);
        newTargetMono = grain.newTargetMono;
        remixedMono = grain.remixedMono;
        mode = 'grain-demo';
      }

      const componentScores = scoreComponents(hRows, visualPrior);
      const shiftedPriorBestScore = Math.max(...componentScores.map(s => s.shiftedScore));
      const selectedScore = componentScores.find(s => s.componentIndex === selected)!;
      const round2Audio: AudioNmfFactorization = {
        ...round1Audio,
        hRows,
        visualPrior,
        visualActivationFrames: shapedVisualFrames,
        componentScores,
        shiftedPriorBestScore,
        nullComparisonLabel: makeNullLabel(selectedScore, shiftedPriorBestScore),
        reconstructionError,
        round2TargetPeak: MatrixManager.peak(newTargetMono),
        round2RemixPeak: MatrixManager.peak(remixedMono),
        round2Mode: mode,
      };

      targetMag.dispose();
      targetMag = null;
      wTensor.dispose();
      wTensor = null;
      hTensor.dispose();
      hTensor = null;
      D.dispose();
      D = null;

      return {
        audio: round2Audio,
        newTargetMono,
        remixedMono,
        sampleRate,
        mode,
        debug: baseDebug(round2Audio, {
          round2Mode: mode,
          selectedComponentIndex: selected,
          videoFrames: videoMatrix[0]?.length ?? 0,
        }),
      };
    } catch (e) {
      xTensor?.dispose();
      D?.dispose();
      wTensor?.dispose();
      hTensor?.dispose();
      targetMag?.dispose();
      throw e;
    }
  }
}
