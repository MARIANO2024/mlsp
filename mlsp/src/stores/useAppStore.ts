import { create } from 'zustand';
import type { CameraStatus } from '../VideoManager';

export type AudioLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AppStore {
  cameraStatus: CameraStatus;
  setCameraStatus: (s: CameraStatus) => void;

  selectedAudio: string | null;
  audioLoadStatus: AudioLoadStatus;
  isPlaying: boolean;
  setSelectedAudio:   (file: string | null) => void;
  setAudioLoadStatus: (s: AudioLoadStatus) => void;
  setIsPlaying:       (v: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  cameraStatus: 'idle',
  setCameraStatus: (cameraStatus) => set({ cameraStatus }),

  selectedAudio:   null,
  audioLoadStatus: 'idle',
  isPlaying:       false,
  setSelectedAudio:   (selectedAudio)   => set({ selectedAudio }),
  setAudioLoadStatus: (audioLoadStatus) => set({ audioLoadStatus }),
  setIsPlaying:       (isPlaying)       => set({ isPlaying }),
}));
