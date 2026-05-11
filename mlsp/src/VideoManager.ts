export type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'error';

export interface VideoStreamInfo {
  width: number | null;
  height: number | null;
  fps: number | null;
}

export class VideoManager {
  private stream: MediaStream | null = null;

  async initialize(): Promise<MediaStream> {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    return this.stream;
  }

  attachToElement(el: HTMLVideoElement) {
    el.srcObject = this.stream;
  }

  detachFromElement(el: HTMLVideoElement) {
    el.srcObject = null;
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  getStreamInfo(): VideoStreamInfo {
    const track = this.stream?.getVideoTracks()[0];
    const settings = track?.getSettings();
    return {
      width: settings?.width ?? null,
      height: settings?.height ?? null,
      fps: settings?.frameRate ?? null,
    };
  }
}

export const videoManager = new VideoManager();
