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
//   • State lives outside the React tree, so non-React code (like VideoManager
//     or a future AudioEngine class) can read it too via
//     `useAppStore.getState()`.
//
// SHAPE OF THIS STORE:
// ─────────────────────────────────────────────────────────────────────────────
//
//   cameraStatus  ── what the camera hardware is currently doing
//   audioFiles    ── list of available audio file names/paths
//   selectedAudio ── whichever file the user picked
//   phase         ── the overall session lifecycle (see AppPhase below)
//
// =============================================================================

import { create } from 'zustand';
import type { CameraStatus } from '../VideoManager';

// ---------------------------------------------------------------------------
// AppPhase — the session lifecycle state machine
//
//   idle  ──(user picks audio)──► armed
//   armed ──(user clicks Record)──► countdown
//   countdown ──(timer expires)──► recording
//   recording ──(audio ends)──► done
//   done ──(user resets)──► idle
//
// Having a single `phase` field (rather than several booleans like
// `isRecording`, `isCountingDown`) makes it impossible to be in two
// contradictory states at once and is easy to render conditionally.
// ---------------------------------------------------------------------------
export type AppPhase =
  | 'idle'        // nothing happening — initial state
  | 'armed'       // audio selected, ready to trigger
  | 'countdown'   // brief pause before playback + capture begin
  | 'recording'   // audio playing AND camera being recorded simultaneously
  | 'done';       // session finished; data ready to download / process

interface AppStore {
  // --- Camera ---
  cameraStatus: CameraStatus;
  setCameraStatus: (s: CameraStatus) => void;

  // --- Audio ---
  audioFiles: string[];          // populated from the public/ folder listing
  selectedAudio: string | null;  // file path chosen by the user
  setAudioFiles: (files: string[]) => void;
  setSelectedAudio: (file: string | null) => void;

  // --- Session phase ---
  phase: AppPhase;
  setPhase: (p: AppPhase) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  // Camera — starts idle; VideoManager.initialize() will push it to 'active'
  cameraStatus: 'idle',
  setCameraStatus: (cameraStatus) => set({ cameraStatus }),

  // Audio — files will be loaded (e.g. from /public) before the user interacts
  audioFiles: [],
  selectedAudio: null,
  setAudioFiles:    (audioFiles)    => set({ audioFiles }),
  setSelectedAudio: (selectedAudio) => set({ selectedAudio }),

  // Session — begins at idle; driven by user actions in App.tsx
  phase: 'idle',
  setPhase: (phase) => set({ phase }),
}));
