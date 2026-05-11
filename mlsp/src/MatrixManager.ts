import * as tf from '@tensorflow/tfjs';

const EPS = 1e-9;

/** Default prior weight when `nnmf` runs in `alpha` mode (can override via `alphaAtIter`). */
export const NMF_ALPHA_PRIOR_DEFAULT = 0.12;

export type VideoColorOrder = 'bgr' | 'rgb';

export type NnmfRng = () => number;

export interface ProcessAudioOptions {
  nFft?: number;
  hopLength?: number;
  /** When true, zero-pad `n_fft // 2` samples at start and end (librosa-style simplification). */
  center?: boolean;
}

/** Metadata for ISTFT matching {@link MatrixManager.stftMagnitudeAndComplex} / `processAudioMono`. */
export interface StftIstftMeta {
  nFft: number;
  hopLength: number;
  center: boolean;
  originalLength: number;
  paddedLength: number;
}

export interface StftMagnitudeAndPhase {
  /** Magnitude |STFT|, shape `[n_fft // 2 + 1, numFrames]` (same as `processAudioMono`). */
  D: tf.Tensor2D;
  /** Complex STFT from `tf.signal.stft`, shape `[numFrames, n_fft // 2 + 1]` (phase for resynthesis). */
  stftComplex: tf.Tensor;
  meta: StftIstftMeta;
}

export interface PeakLimitedAudio {
  samples: Float32Array;
  inputPeak: number;
  outputPeak: number;
  scale: number;
  wasSilent: boolean;
}

export interface RatioMaskResynthesis {
  selectedComponentMono: Float32Array;
  residualMono: Float32Array;
  selectedComponentPeak: number;
  residualPeak: number;
  selectedComponentWasSilent: boolean;
  residualWasSilent: boolean;
}

export interface ChooseBestNmmfOptions {
  nRestarts?: number;
  nIter?: number;
  rng?: NnmfRng;
  /** Forwarded to every `nnmf` restart. */
  nnmfOptions?: NnmfOptions;
}

/** Options for multiplicative NMF / KL (`nnmf`). */
export interface NnmfOptions {
  /** Optional legacy visual-prior diagnostic. The main demo uses blind audio NMF and selects components afterward. */
  alpha?: boolean;
  /** Prior strength at iteration `iter` for legacy alpha mode. */
  alphaAtIter?: (iter: number) => number;
}

export class MatrixManager {
  /**
   * Resize each frame to `newW` × `newH`, grayscale (OpenCV BGR or RGB luminance),
   * flatten each frame with Fortran (column-major) order, stack columns → `X` with
   * shape `[newW * newH, numFrames]` (matches notebook `process_video`).
   */
  static processVideo(
    frames: tf.Tensor4D,
    newW: number,
    sourceWidth: number,
    sourceHeight: number,
    colorOrder: VideoColorOrder = 'bgr',
  ): { X: tf.Tensor2D; newW: number; newH: number } {
    const newH = Math.max(1, Math.round((newW * sourceHeight) / sourceWidth));

    return tf.tidy(() => {
      const resized = tf.image.resizeBilinear(frames, [newH, newW]);
      const b = resized.slice([0, 0, 0, 0], [-1, -1, -1, 1]);
      const gCh = resized.slice([0, 0, 0, 1], [-1, -1, -1, 1]);
      const r = resized.slice([0, 0, 0, 2], [-1, -1, -1, 1]);
      const gray =
        colorOrder === 'bgr'
          ? tf.add(tf.add(tf.mul(b, 0.114), tf.mul(gCh, 0.587)), tf.mul(r, 0.299))
          : tf.add(tf.add(tf.mul(b, 0.299), tf.mul(gCh, 0.587)), tf.mul(r, 0.114));

      const grayMap = gray.squeeze([-1]) as tf.Tensor3D;
      const framesList = tf.unstack(grayMap, 0);
      const columns = framesList.map(f => MatrixManager.flattenFrameFortran2d(f as tf.Tensor2D));
      framesList.forEach(t => t.dispose());

      const X = tf.stack(columns, 1) as tf.Tensor2D;
      columns.forEach(t => t.dispose());

      return { X, newW, newH };
    });
  }

  /** Column-major flatten of a `[H, W]` grayscale frame (matches `order="F"`). */
  static flattenFrameFortran2d(grayHw: tf.Tensor2D): tf.Tensor1D {
    return tf.tidy(() => {
      const transposed = grayHw.transpose([1, 0]);
      return transposed.flatten() as tf.Tensor1D;
    });
  }

  /** KL divergence loss matching `reconstruction_error` in the notebook. */
  static reconstructionError(X: tf.Tensor2D, w: tf.Tensor2D, h: tf.Tensor2D): tf.Scalar {
    return tf.tidy(() => {
      const WH = tf.matMul(w, h).add(EPS);
      const Xsafe = X.toFloat().add(EPS);
      return tf.sum(
        Xsafe.mul(Xsafe.div(WH).log()).sub(Xsafe).add(WH),
      ) as tf.Scalar;
    });
  }

  /**
   * Multiplicative NMF/KL updates (same update equations as notebook `nnmf`).
   * Borrowed tensors: caller owns `X` and `h_init` (never disposed here); returned `w`, `h` are new tensors.
   *
   * **Alpha mode** (`options.alpha === true` and `h_init` set): `W` and `H` start random; for the **first
   * half** of iterations only (`i * 2 < nIter`), after each multiplicative **H** update,
   * `H[0,:] += alphaAtIter(i) * h_init[0,:]`, then row-sum normalization of `H` and matching scale of `W`.
   */
  static nnmf(
    X: tf.Tensor2D,
    k: number,
    hInit?: tf.Tensor2D,
    nIter = 200,
    rng: NnmfRng = Math.random,
    options?: NnmfOptions,
  ): { w: tf.Tensor2D; h: tf.Tensor2D } {
    const useAlphaPrior = Boolean(options?.alpha && hInit);
    const alphaAtIter = options?.alphaAtIter ?? (() => NMF_ALPHA_PRIOR_DEFAULT);

    const XFloat = X.toFloat();
    const [M, N] = XFloat.shape;

    let w = MatrixManager.randomUniform2d(M, k, rng);
    let h: tf.Tensor2D;
    let hInitRow0: tf.Tensor2D | null = null;

    if (useAlphaPrior) {
      const hi = hInit!;
      if (hi.shape[0] !== k || hi.shape[1] !== N) {
        w.dispose();
        throw new Error(`h_init shape ${hi.shape} does not match (${k}, ${N})`);
      }
      hInitRow0 = tf.clone(tf.slice(hi, [0, 0], [1, N])).toFloat();
      h = MatrixManager.randomUniform2d(k, N, rng);
    } else if (hInit) {
      h = tf.clone(hInit).toFloat() as tf.Tensor2D;
      if (h.shape[0] !== k || h.shape[1] !== N) {
        w.dispose();
        h.dispose();
        throw new Error(`h_init shape ${h.shape} does not match (${k}, ${N})`);
      }
    } else {
      h = MatrixManager.randomUniform2d(k, N, rng);
    }

    const posEps = tf.scalar(EPS);

    for (let i = 0; i < nIter; i++) {
      const alphaCoeff =
        useAlphaPrior && i * 2 < nIter ? alphaAtIter(i) : 0;
      const next = tf.tidy(() => {
        const Xhat0 = tf.matMul(w, h).add(posEps);
        const ratio0 = XFloat.div(Xhat0);
        const numW = tf.matMul(ratio0, h.transpose());
        const denW = tf.sum(h, 1).reshape([1, k]).add(posEps);
        let wNew = w.mul(numW.div(denW));

        const Xhat1 = tf.matMul(wNew, h).add(posEps);
        const ratio1 = XFloat.div(Xhat1);
        const numH = tf.matMul(wNew.transpose(), ratio1);
        const denH = tf.sum(wNew, 0).reshape([k, 1]).add(posEps);
        let hNew = h.mul(numH.div(denH));

        if (useAlphaPrior && hInitRow0 != null && alphaCoeff !== 0) {
          const bump = hInitRow0.mul(tf.scalar(alphaCoeff));
          const row0 = hNew.slice([0, 0], [1, N]).add(bump);
          const tail = hNew.slice([1, 0], [k - 1, N]);
          hNew = tf.concat([row0, tail], 0) as tf.Tensor2D;
        }

        const scale = tf.sum(hNew, 1).reshape([k, 1]).add(posEps);
        hNew = hNew.div(scale);
        wNew = wNew.mul(scale.transpose());

        return { wNew, hNew };
      });

      w.dispose();
      h.dispose();
      w = next.wNew as tf.Tensor2D;
      h = next.hNew as tf.Tensor2D;
    }

    hInitRow0?.dispose();

    XFloat.dispose();
    posEps.dispose();
    return { w, h };
  }

  static chooseBestNmmf(
    X: tf.Tensor2D,
    k: number,
    hInit?: tf.Tensor2D,
    options: ChooseBestNmmfOptions = {},
  ): { error: number; w: tf.Tensor2D; h: tf.Tensor2D } {
    const nRestarts = options.nRestarts ?? 10;
    const nIter = options.nIter ?? 200;
    const rng = options.rng ?? Math.random;
    const nnmfOptions = options.nnmfOptions;

    type Cand = { error: number; w: tf.Tensor2D; h: tf.Tensor2D };
    const results: Cand[] = [];

    for (let r = 0; r < nRestarts; r++) {
      const { w, h } = MatrixManager.nnmf(X, k, hInit, nIter, rng, nnmfOptions);
      const errTensor = MatrixManager.reconstructionError(X, w, h);
      const error = errTensor.dataSync()[0];
      errTensor.dispose();
      results.push({ error, w, h });
    }

    results.sort((a, b) => a.error - b.error);
    const best = results[0]!;

    for (let i = 1; i < results.length; i++) {
      results[i]!.w.dispose();
      results[i]!.h.dispose();
    }

    return best;
  }

  /** Pick the strongest video-H row and return a gated, max-normalized activation. */
  static processActivation(h: tf.Tensor2D): tf.Tensor1D {
    return tf.tidy(() => {
      const peakPerRow = tf.max(h, 1);
      const bestIdx = tf.argMax(peakPerRow, 0).dataSync()[0]!;
      const bestRow = tf.slice(h, [bestIdx, 0], [1, h.shape[1]]).squeeze([0]).toFloat();

      const rowMin = tf.min(bestRow);
      const rowMax = tf.max(bestRow);
      const rangeOk = rowMax.sub(rowMin).greater(0);
      const thresholdVal = rowMin.add(rowMax.sub(rowMin).mul(0.5));
      let gated = tf.where(bestRow.greaterEqual(thresholdVal), bestRow, tf.zerosLike(bestRow));
      const gMax = tf.max(gated);
      gated = tf.where(gMax.greater(0), gated.div(gMax), gated);
      return tf.where(rangeOk, gated, tf.zerosLike(bestRow)) as tf.Tensor1D;
    });
  }

  /**
   * STFT magnitude `|D|` with shape `[n_fft // 2 + 1, numFrames]` (frequency × time,
   * same layout as librosa after `np.abs(D)`).
   */
  static processAudioMono(
    x: tf.Tensor1D | Float32Array | number[],
    options: ProcessAudioOptions = {},
  ): tf.Tensor2D {
    const { D } = MatrixManager.stftMagnitudeAndComplex(x, options);
    return D;
  }

  /**
   * Same framing as `processAudioMono`, but also returns complex STFT for phase–locked magnitude resynthesis.
   */
  static stftMagnitudeAndComplex(
    x: tf.Tensor1D | Float32Array | number[],
    options: ProcessAudioOptions = {},
  ): StftMagnitudeAndPhase {
    const nFft = options.nFft ?? 512;
    const hopLength = options.hopLength ?? 256;
    const center = options.center ?? true;

    return tf.tidy(() => {
      const signal: tf.Tensor1D =
        x instanceof tf.Tensor ? (x as tf.Tensor1D).toFloat() : tf.tensor1d(x);
      const originalLength = signal.size;
      let y: tf.Tensor1D = signal;
      let paddedLength = originalLength;
      if (center) {
        const pad = Math.floor(nFft / 2);
        y = tf.pad(signal, [[pad, pad]], 0);
        paddedLength = y.size;
      }

      const stftC = tf.signal.stft(y, nFft, hopLength, nFft, tf.signal.hannWindow);
      const mag = tf.abs(stftC) as tf.Tensor2D;
      const D = mag.transpose([1, 0]) as tf.Tensor2D;

      return {
        D,
        stftComplex: stftC as tf.Tensor,
        meta: { nFft, hopLength, center, originalLength, paddedLength },
      };
    });
  }

  /**
   * Rebuild a real waveform: use `magnitudeFreqTime` as |STFT| but keep phase from the reference STFT.
   * `magnitudeFreqTime` and `stftComplex` must match shapes `[F, T]` and `[T, F]` from the same forward setup.
   */
  static istftMagnitudeWithOriginalPhase(
    magnitudeFreqTime: tf.Tensor2D,
    stftComplex: tf.Tensor,
    meta: StftIstftMeta,
  ): Float32Array {
    const { nFft, hopLength, center, originalLength, paddedLength } = meta;
    const [F, numFrames] = magnitudeFreqTime.shape;
    const [Tdim, Fdim] = stftComplex.shape;
    if (Tdim !== numFrames || Fdim !== F) {
      throw new Error(
        `ISTFT shape mismatch: |D| [${F}, ${numFrames}] vs STFT [${Tdim}, ${Fdim}]`,
      );
    }

    const weightedFrames = tf.tidy(() => {
      const win = tf.signal.hannWindow(nFft).reshape([1, nFft]);
      const magT = tf.relu(tf.transpose(magnitudeFreqTime, [1, 0]));
      const phase = tf.atan2(tf.imag(stftComplex), tf.real(stftComplex));
      const spec = tf.complex(magT.mul(tf.cos(phase)), magT.mul(tf.sin(phase)));
      const frames = tf.irfft(spec) as tf.Tensor2D;
      return tf.mul(frames, win) as tf.Tensor2D;
    });

    const frameData = weightedFrames.dataSync();
    weightedFrames.dispose();

    const out = new Float32Array(paddedLength);
    const denom = new Float32Array(paddedLength);
    const win = tf.signal.hannWindow(nFft).dataSync() as Float32Array;
    const win2 = new Float32Array(nFft);
    for (let i = 0; i < nFft; i++) win2[i] = win[i]! * win[i]!;

    for (let t = 0; t < numFrames; t++) {
      const start = t * hopLength;
      const base = t * nFft;
      for (let i = 0; i < nFft && start + i < paddedLength; i++) {
        const j = start + i!;
        out[j] += frameData[base + i]!;
        denom[j] += win2[i]!;
      }
    }

    const eps = 1e-8;
    for (let i = 0; i < paddedLength; i++) {
      const d = denom[i]!;
      if (d > eps) out[i]! /= d;
    }

    if (!center) {
      return out.length === originalLength ? out : out.slice(0, originalLength);
    }
    const pad = Math.floor(nFft / 2);
    return out.slice(pad, pad + originalLength);
  }

  static peak(samples: Float32Array): number {
    let peak = 0;
    for (const v of samples) {
      const a = Math.abs(v);
      if (Number.isFinite(a) && a > peak) peak = a;
    }
    return peak;
  }

  static limitPeak(
    samples: Float32Array,
    maxPeak = 0.98,
    minAudiblePeak = 0,
  ): PeakLimitedAudio {
    const inputPeak = MatrixManager.peak(samples);
    const wasSilent = inputPeak <= 1e-7;
    let scale = 1;

    if (!wasSilent && inputPeak > maxPeak) {
      scale = maxPeak / inputPeak;
    } else if (!wasSilent && minAudiblePeak > 0 && inputPeak < minAudiblePeak) {
      scale = minAudiblePeak / inputPeak;
    }

    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i]!;
      out[i] = Number.isFinite(v) ? v * scale : 0;
    }

    return {
      samples: out,
      inputPeak,
      outputPeak: MatrixManager.peak(out),
      scale,
      wasSilent,
    };
  }

  static mixMono(a: Float32Array, b: Float32Array, maxPeak = 0.98): PeakLimitedAudio {
    const n = Math.max(a.length, b.length);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
    return MatrixManager.limitPeak(out, maxPeak);
  }

  static synthesizeMagnitudeWithOriginalPhase(
    mono: Float32Array,
    magnitudeFreqTime: tf.Tensor2D,
    options: ProcessAudioOptions = {},
  ): Float32Array {
    const { D, stftComplex, meta } = MatrixManager.stftMagnitudeAndComplex(mono, options);
    D.dispose();
    const wav = MatrixManager.istftMagnitudeWithOriginalPhase(magnitudeFreqTime, stftComplex, meta);
    stftComplex.dispose();
    return wav;
  }

  /** Resynthesize the visually selected component and residual using a ratio mask and original phase. */
  static synthesizeComponentAndResidualRatioMask(
    mono: Float32Array,
    w: tf.Tensor2D,
    h: tf.Tensor2D,
    componentIndex: number,
    options: ProcessAudioOptions = {},
  ): RatioMaskResynthesis {
    const [Fw, k] = w.shape;
    const [kh, T] = h.shape;
    if (kh !== k) {
      throw new Error(`ratio-mask resynthesis: W columns ${k} vs H rows ${kh}`);
    }
    if (componentIndex < 0 || componentIndex >= k) {
      throw new Error(`ratio-mask resynthesis: component ${componentIndex} outside 0..${k - 1}`);
    }

    const { D, stftComplex, meta } = MatrixManager.stftMagnitudeAndComplex(mono, options);
    const [Fd, Td] = D.shape;
    if (Fd !== Fw || Td !== T) {
      D.dispose();
      stftComplex.dispose();
      throw new Error(`ratio-mask resynthesis: |D| [${Fd}, ${Td}] vs WH [${Fw}, ${T}]`);
    }

    const { selectedMag, residualMag } = tf.tidy(() => {
      const fullMag = tf.matMul(w, h).add(EPS) as tf.Tensor2D;
      const wj = tf.slice(w, [0, componentIndex], [Fw, 1]);
      const hj = tf.slice(h, [componentIndex, 0], [1, T]);
      const compMag = tf.matMul(wj, hj) as tf.Tensor2D;
      const ratio = tf.minimum(tf.maximum(compMag.div(fullMag), 0), 1) as tf.Tensor2D;
      const selected = D.mul(ratio) as tf.Tensor2D;
      const residual = D.mul(tf.scalar(1).sub(ratio)) as tf.Tensor2D;
      return { selectedMag: selected, residualMag: residual };
    });

    const selectedRaw = MatrixManager.istftMagnitudeWithOriginalPhase(selectedMag, stftComplex, meta);
    const residualRaw = MatrixManager.istftMagnitudeWithOriginalPhase(residualMag, stftComplex, meta);
    selectedMag.dispose();
    residualMag.dispose();
    D.dispose();
    stftComplex.dispose();

    const selected = MatrixManager.limitPeak(selectedRaw, 0.98, 0.18);
    const residual = MatrixManager.limitPeak(residualRaw, 0.98);

    return {
      selectedComponentMono: selected.samples,
      residualMono: residual.samples,
      selectedComponentPeak: selected.outputPeak,
      residualPeak: residual.outputPeak,
      selectedComponentWasSilent: selected.wasSilent,
      residualWasSilent: residual.wasSilent,
    };
  }

  static synthesizeMonoExcludingLeadingHRows(
    mono: Float32Array,
    w: tf.Tensor2D,
    h: tf.Tensor2D,
    nDrop: number,
    options: ProcessAudioOptions = {},
  ): Float32Array {
    const [Fw, k] = w.shape;
    const [kh, T] = h.shape;
    if (kh !== k) {
      throw new Error(`synthesizeMonoExcludingLeadingHRows: W columns ${k} vs H rows ${kh}`);
    }
    if (nDrop <= 0) {
      return Float32Array.from(mono);
    }
    if (nDrop >= k) {
      throw new Error(`synthesizeMonoExcludingLeadingHRows: nDrop ${nDrop} >= k ${k}`);
    }

    const { D: _d, stftComplex, meta } = MatrixManager.stftMagnitudeAndComplex(mono, options);
    _d.dispose();

    const magHat = tf.tidy(() => {
      const wKeep = tf.slice(w, [0, nDrop], [Fw, k - nDrop]);
      const hKeep = tf.slice(h, [nDrop, 0], [k - nDrop, T]);
      return tf.matMul(wKeep, hKeep) as tf.Tensor2D;
    });

    const wav = MatrixManager.istftMagnitudeWithOriginalPhase(magHat, stftComplex, meta);
    magHat.dispose();
    stftComplex.dispose();
    return wav;
  }

  /** Matches notebook `upscale_activation` (1-D linear interpolation). */
  static upscaleActivation(h: tf.Tensor1D, D: tf.Tensor2D): tf.Tensor1D {
    const audioLen = D.shape[1];
    const hLen = h.shape[0];

    return tf.tidy(() => {
      if (hLen < 2) {
        const v = hLen > 0 ? h.dataSync()[0]! : 0;
        return tf.fill([audioLen], v);
      }

      const newX = tf.linspace(0, hLen - 1, audioLen);
      const i0 = tf.floor(newX);
      const i1 = tf.minimum(i0.add(1), hLen - 1);
      const y0 = tf.gather(h, tf.cast(i0, 'int32'));
      const y1 = tf.gather(h, tf.cast(i1, 'int32'));
      const t = newX.sub(i0);
      return y0.add(y1.sub(y0).mul(t));
    });
  }

  /** Uniform(0,1) weights; used for NMF restarts and optional `h_init` padding rows. */
  static randomUniform2d(rows: number, cols: number, rng: NnmfRng): tf.Tensor2D {
    const data = new Float32Array(rows * cols);
    for (let i = 0; i < data.length; i++) data[i] = rng();
    return tf.tensor2d(data, [rows, cols]);
  }
}

export default MatrixManager;
