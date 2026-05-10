/** Mono 16-bit little-endian PCM WAV (IEEE float samples clipped to [-1, 1]). */

export function encodeWavMono16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const n = samples.length;
  const dataBytes = n * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  let o = 0;
  const wStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i));
  };
  wStr('RIFF');
  view.setUint32(o, 36 + dataBytes, true);
  o += 4;
  wStr('WAVE');
  wStr('fmt ');
  view.setUint32(o, 16, true);
  o += 4;
  view.setUint16(o, 1, true);
  o += 2;
  view.setUint16(o, 1, true);
  o += 2;
  view.setUint32(o, sampleRate, true);
  o += 4;
  view.setUint32(o, sampleRate * 2, true);
  o += 4;
  view.setUint16(o, 2, true);
  o += 2;
  view.setUint16(o, 16, true);
  o += 2;
  wStr('data');
  view.setUint32(o, dataBytes, true);
  o += 4;
  for (let i = 0; i < n; i++) {
    let s = samples[i]!;
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    const q = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(o, Math.round(q), true);
    o += 2;
  }
  return buffer;
}
