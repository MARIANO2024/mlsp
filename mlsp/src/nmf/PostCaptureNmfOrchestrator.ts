/**
 * Post–video-capture analysis: best video NMF (k=2) → dominant activation (process_activation)
 * → upscale to spectrogram time → h_init with that row on top and random lower rows → STFT |D|
 * → best audio NMF (k=3) with h_init. Returns plain arrays for UI; owns all tensor dispose paths.
 */

import * as tf from '@tensorflow/tfjs';
import MatrixManager, {
  NMF_ALPHA_PRIOR_DEFAULT,
  type ChooseBestNmmfOptions,
} from '../MatrixManager';

export const POST_CAPTURE_NMF = {
  VIDEO_K: 2,
  AUDIO_K: 3,
  N_ITER: 200,
  N_RESTARTS: 10,
} as const;

export interface AudioNmfFactorization {
  freqBins: number;
  timeFrames: number;
  /** Each column of W (length = freqBins), spectrogram-frequency template. */
  wColumns: number[][];
  /** Each row of H (length = timeFrames), activation over STFT time. */
  hRows: number[][];
  /** Upscaled video-derived row used only as h_init row 0 (for overlay plot, not the fitted H). */
  hInitUpscaledRow: number[];
  reconstructionError: number;
}

export interface PostCaptureNmfResult {
  audio: AudioNmfFactorization;
  /** Time-domain resynthesis with STFT magnitude ≈ W[:,1:] @ H[1:,:] and original phase (biased comp 0 removed). */
  residualNoComp0Mono: Float32Array;
  sampleRate: number;
}

export interface PostCaptureRemixResult {
  /** Same W as round 1; H row 0 from second video; rows 1–2 from round 1. */
  audio: AudioNmfFactorization;
  remixedMono: Float32Array;
  sampleRate: number;
}

/** Report pipeline phase to UI (e.g. loading overlay). */
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
    for (let j = 0; j < k; j++) {
      data[i * k + j] = wColumns[j]![i]!;
    }
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

export class PostCaptureNmfOrchestrator {
  /**
   * Both video and audio factorizations use `chooseBestNmmf` (multiple random restarts, lowest KL).
   *
   * @param onStep optional UI hook; called before each heavy block. Waits one animation frame after each
   *   report so the overlay can paint between synchronous TF steps.
   */
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

    let xTensor: tf.Tensor2D | null = tf.tensor2d(videoMatrix);
    let D: tf.Tensor2D | null = null;
    let hInit: tf.Tensor2D | null = null;

    try {
      await report(
        'Video NMF',
        `choose_best_nmmf: ${POST_CAPTURE_NMF.N_RESTARTS} random restarts, k=${POST_CAPTURE_NMF.VIDEO_K}, keep lowest reconstruction error.`,
      );
      const vid = MatrixManager.chooseBestNmmf(
        xTensor,
        POST_CAPTURE_NMF.VIDEO_K,
        undefined,
        bestOpts,
      );
      xTensor.dispose();
      xTensor = null;

      await report(
        'Video activation',
        'process_activation: H_video row with the largest temporal peak (raw row, no gating).',
      );
      const processedVideoActivation = MatrixManager.processActivation(vid.h);
      vid.w.dispose();
      vid.h.dispose();

      await report(
        'STFT',
        'process_audio_mono: magnitude |D|, n_fft / hop_length per MatrixManager (centered zero-pad).',
      );
      D = MatrixManager.processAudioMono(audioMono);

      await report(
        'Upscale & h_init',
        'upscale_activation to |D| time frames; row 0 = upscaled stem, rows 1–2 random Uniform(0,1).',
      );
      const upRow = MatrixManager.upscaleActivation(processedVideoActivation, D);
      processedVideoActivation.dispose();

      const nFrames = D.shape[1]!;
      const upData = Array.from(upRow.dataSync());
      upRow.dispose();

      const row0 = tf.tensor2d([upData], [1, nFrames]);
      const randRest = MatrixManager.randomUniform2d(POST_CAPTURE_NMF.AUDIO_K - 1, nFrames, Math.random);
      hInit = tf.concat([row0, randRest], 0) as tf.Tensor2D;
      row0.dispose();
      randRest.dispose();

      await report(
        'Audio NMF',
        `choose_best_nmmf: ${POST_CAPTURE_NMF.N_RESTARTS} restarts, k=${POST_CAPTURE_NMF.AUDIO_K}; alpha mode — α·h_init[0,:] on H[0,:] before row-sum scale, first half of iterations only (default α=${NMF_ALPHA_PRIOR_DEFAULT}).`,
      );
      const audioBest = MatrixManager.chooseBestNmmf(
        D,
        POST_CAPTURE_NMF.AUDIO_K,
        hInit,
        {
          ...bestOpts,
          nnmfOptions: { alpha: true },
        },
      );
      hInit.dispose();
      hInit = null;
      D.dispose();
      D = null;

      await report(
        'Residual audio (no comp 0)',
        'ISTFT: magnitude WH with row/column 0 removed, phase from original STFT → WAV export.',
      );
      const residualNoComp0Mono = MatrixManager.synthesizeMonoExcludingLeadingHRows(
        audioMono,
        audioBest.w,
        audioBest.h,
        1,
      );

      const wColumns = extractWColumns(audioBest.w);
      const hRows = extractHRows(audioBest.h);
      const err = audioBest.error;
      audioBest.w.dispose();
      audioBest.h.dispose();

      const freqBins = wColumns[0]?.length ?? 0;
      const timeFrames = hRows[0]?.length ?? 0;

      return {
        audio: {
          freqBins,
          timeFrames,
          wColumns,
          hRows,
          hInitUpscaledRow: upData,
          reconstructionError: err,
        },
        residualNoComp0Mono,
        sampleRate,
      };
    } catch (e) {
      xTensor?.dispose();
      D?.dispose();
      hInit?.dispose();
      throw e;
    }
  }

  /**
   * Second capture: video NMF on new WebM → upscale activation; **W** and **H[1,:], H[2,:]** from
   * round-one `audio`; **H[0,:]** from the new video. ISTFT(|W H|, original-mono phase).
   */
  static async runRound2Remix(
    videoMatrix: number[][],
    audioMono: Float32Array,
    sampleRate: number,
    round1Audio: AudioNmfFactorization,
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

    let xTensor: tf.Tensor2D | null = tf.tensor2d(videoMatrix);
    let D: tf.Tensor2D | null = null;
    let wTensor: tf.Tensor2D | null = null;
    let hTensor: tf.Tensor2D | null = null;
    let magHat: tf.Tensor2D | null = null;
    let stftComplex: tf.Tensor | null = null;

    try {
      await report(
        'Round 2 · Video NMF',
        `choose_best_nmmf: ${POST_CAPTURE_NMF.N_RESTARTS} restarts, k=${POST_CAPTURE_NMF.VIDEO_K} on new capture.`,
      );
      const vid = MatrixManager.chooseBestNmmf(
        xTensor,
        POST_CAPTURE_NMF.VIDEO_K,
        undefined,
        bestOpts,
      );
      xTensor.dispose();
      xTensor = null;

      await report(
        'Round 2 · Video activation',
        'process_activation: dominant H_video row → upscale to spectrogram time (new H row 0).',
      );
      const processedVideoActivation = MatrixManager.processActivation(vid.h);
      vid.w.dispose();
      vid.h.dispose();

      await report('Round 2 · STFT', 'Same |D| framing as round 1 (centered STFT on original mix).');
      const bundle = MatrixManager.stftMagnitudeAndComplex(audioMono);
      D = bundle.D;
      stftComplex = bundle.stftComplex;
      const meta = bundle.meta;

      const nFrames = D.shape[1]!;
      const fBins = D.shape[0]!;

      if (round1Audio.timeFrames !== nFrames || round1Audio.freqBins !== fBins) {
        throw new Error(
          `Round 2 remix: round-1 factors (${round1Audio.freqBins}×${round1Audio.timeFrames}) ` +
            `do not match current STFT (${fBins}×${nFrames}). Load the same track or run round 1 again.`,
        );
      }

      if (round1Audio.hRows.length < 3) {
        throw new Error('Round 2 remix: round-1 H must have 3 rows.');
      }

      const upRow = MatrixManager.upscaleActivation(processedVideoActivation, D);
      processedVideoActivation.dispose();

      const upData = Array.from(upRow.dataSync());
      upRow.dispose();

      const h1 = round1Audio.hRows[1]!;
      const h2 = round1Audio.hRows[2]!;
      if (h1.length !== nFrames || h2.length !== nFrames) {
        throw new Error('Round 2 remix: stored H rows 1–2 length mismatch.');
      }

      await report(
        'Round 2 · Remixing audio',
        'W from round 1; H[0] = new video stem; H[1],H[2] unchanged; ISTFT with original phase → play + WAV.',
      );

      wTensor = tensorWFromColumns(round1Audio.wColumns);
      hTensor = tensorHFromRows([upData, h1, h2]);

      const errTensor = MatrixManager.reconstructionError(D, wTensor, hTensor);
      const reconstructionError = errTensor.dataSync()[0]!;
      errTensor.dispose();

      magHat = tf.matMul(wTensor, hTensor) as tf.Tensor2D;
      const remixedMono = MatrixManager.istftMagnitudeWithOriginalPhase(magHat, stftComplex, meta);

      wTensor.dispose();
      wTensor = null;
      hTensor.dispose();
      hTensor = null;
      magHat.dispose();
      magHat = null;
      D.dispose();
      D = null;
      stftComplex.dispose();
      stftComplex = null;

      const audio: AudioNmfFactorization = {
        freqBins: fBins,
        timeFrames: nFrames,
        wColumns: round1Audio.wColumns,
        hRows: [upData, Array.from(h1), Array.from(h2)],
        hInitUpscaledRow: upData,
        reconstructionError,
      };

      return { audio, remixedMono, sampleRate };
    } catch (e) {
      xTensor?.dispose();
      D?.dispose();
      wTensor?.dispose();
      hTensor?.dispose();
      magHat?.dispose();
      stftComplex?.dispose();
      throw e;
    }
  }
}
