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
        `choose_best_nmmf: ${POST_CAPTURE_NMF.N_RESTARTS} restarts, k=${POST_CAPTURE_NMF.AUDIO_K}; alpha mode — H random, each iter H[0,:] += α·h_init[0,:] (default α=${NMF_ALPHA_PRIOR_DEFAULT}).`,
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
      };
    } catch (e) {
      xTensor?.dispose();
      D?.dispose();
      hInit?.dispose();
      throw e;
    }
  }
}
