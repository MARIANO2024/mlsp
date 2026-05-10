const VIDEO_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;

export function getSupportedVideoMimeType(): string | undefined {
  return VIDEO_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type));
}
