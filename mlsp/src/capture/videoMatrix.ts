export interface PreviewFrame {
  label: string;
  url: string;
}

export interface VideoMatrixResult {
  width: number;
  height: number;
  frameCount: number;
  matrix: number[][];
  previews: PreviewFrame[];
}

export const MATRIX_FRAME_WIDTH = 80;

function frameColumnToPreviewUrl(column: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create preview canvas.');

  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gray = column[x * height + y]!;
      const offset = (y * width + x) * 4;
      image.data[offset] = gray;
      image.data[offset + 1] = gray;
      image.data[offset + 2] = gray;
      image.data[offset + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function extractVideoMatrix(blob: Blob, targetWidth = MATRIX_FRAME_WIDTH): Promise<VideoMatrixResult> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  const objectUrl = URL.createObjectURL(blob);
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not load recorded video for matrix extraction.'));
    });

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      throw new Error('Recorded video has no decodable dimensions.');
    }

    const width = targetWidth;
    const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not create extraction canvas.');

    const columns: Uint8ClampedArray[] = [];

    await new Promise<void>((resolve, reject) => {
      video.onerror = () => reject(new Error('Video decode failed during matrix extraction.'));
      video.onended = () => resolve();

      const captureFrame = () => {
        ctx.drawImage(video, 0, 0, width, height);
        const rgba = ctx.getImageData(0, 0, width, height).data;
        const column = new Uint8ClampedArray(width * height);

        for (let x = 0; x < width; x++) {
          for (let y = 0; y < height; y++) {
            const rgbaOffset = (y * width + x) * 4;
            const gray = Math.round(
              0.299 * rgba[rgbaOffset]! +
              0.587 * rgba[rgbaOffset + 1]! +
              0.114 * rgba[rgbaOffset + 2]!,
            );
            column[x * height + y] = gray;
          }
        }

        columns.push(column);
      };

      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        const onVideoFrame: VideoFrameRequestCallback = () => {
          if (video.ended || video.paused) return;
          captureFrame();
          video.requestVideoFrameCallback(onVideoFrame);
        };
        video.requestVideoFrameCallback(onVideoFrame);
      } else {
        const interval = window.setInterval(() => {
          if (video.ended || video.paused) {
            window.clearInterval(interval);
            return;
          }
          captureFrame();
        }, 1000 / 30);
      }

      video.play().catch(reject);
    });

    if (columns.length === 0) {
      throw new Error('No frames were extracted from the recorded video.');
    }

    const rowCount = width * height;
    const matrix = Array.from({ length: rowCount }, (_, row) =>
      columns.map(column => column[row]!),
    );

    const previewIndices = [
      0,
      Math.floor((columns.length - 1) / 2),
      columns.length - 1,
    ];

    const previews = previewIndices.map((frameIndex, i) => ({
      label: i === 0 ? 'First frame' : i === 1 ? 'Middle frame' : 'Last frame',
      url: frameColumnToPreviewUrl(columns[frameIndex]!, width, height),
    }));

    return { width, height, frameCount: columns.length, matrix, previews };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
