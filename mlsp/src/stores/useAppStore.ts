// =============================================================================
// useAppStore.ts  —  global Zustand store
// =============================================================================
//
// CONCEPT: WHY ZUSTAND?
// ─────────────────────────────────────────────────────────────────────────────
// React's local `useState` works great inside a single component, but this app
// has several pieces of state that multiple components will need to read or
// write (camera status, selected audio file, session phase, etc.).
//
// Zustand is a tiny (~1 kB) global state library. Key ideas:
//
//   • `create()` defines a store — a plain JS object with fields + setter
//     functions. You define the setters *inside* the store itself.
//
//   • `useAppStore(selector)` is a React hook. Any component that calls it
//     re-renders only when the selected slice of state changes (no wasted
//     renders from unrelated updates).
//
//   • State lives outside the React tree, so non-React code (like AudioManager
//     or VideoManager) can read it via `useAppStore.getState()` and write it
//     via `useAppStore.setState(...)`.
//
// STATE GROUPS IN THIS STORE:
// ─────────────────────────────────────────────────────────────────────────────
//
//   Camera    — what the hardware is currently doing
//   Audio     — available files, which one is loaded, playback status
//   UI        — only state that needs to be shared outside one component
//
// =============================================================================

import { create } from 'zustand';
import type { CameraStatus } from '../VideoManager';

// ---------------------------------------------------------------------------
// AudioLoadStatus — tracks the lifecycle of loading a file into the decoder
//
//   idle      → no file has been requested yet
//   loading   → fetch + decodeAudioData in progress
//   ready     → AudioBuffer is decoded and in memory
//   error     → fetch or decode failed
// ---------------------------------------------------------------------------
export type AudioLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AppStore {
  // --- Camera ---
  cameraStatus: CameraStatus;
  setCameraStatus: (s: CameraStatus) => void;

  // --- Audio ---
  // selectedAudio: filename chosen by the user (display + reset logic)
  // audioLoadStatus: lifecycle of fetch + decodeAudioData for the chosen file
  // isPlaying: true while the AudioBufferSourceNode is running
  //
  // Note: the *list* of available files is NOT stored here — it comes from
  // import.meta.glob in musicFiles.ts and is statically known at build time.
  selectedAudio: string | null;
  audioLoadStatus: AudioLoadStatus;
  isPlaying: boolean;
  setSelectedAudio:   (file: string | null) => void;
  setAudioLoadStatus: (s: AudioLoadStatus) => void;
  setIsPlaying:       (v: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  // Camera — starts idle; VideoManager.initialize() drives it to 'active'
  cameraStatus: 'idle',
  setCameraStatus: (cameraStatus) => set({ cameraStatus }),

  // Audio — file list comes from musicFiles.ts; store only tracks runtime state
  selectedAudio:   null,
  audioLoadStatus: 'idle',
  isPlaying:       false,
  setSelectedAudio:   (selectedAudio)   => set({ selectedAudio }),
  setAudioLoadStatus: (audioLoadStatus) => set({ audioLoadStatus }),
  setIsPlaying:       (isPlaying)       => set({ isPlaying }),
}));
