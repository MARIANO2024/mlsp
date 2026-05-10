// =============================================================================
// musicFiles.ts
// =============================================================================
//
// HOW FILE DISCOVERY WORKS:
// ─────────────────────────────────────────────────────────────────────────────
// `import.meta.glob` is a Vite-specific feature that scans the filesystem at
// build time (and during dev-server startup) and records every file whose path
// matches the given pattern.
//
// We point it at  /public/music/*.{wav,mp3,...}  — the glob runs at build time
// so Vite knows about every file in that folder before the browser even loads.
//
// KEY DESIGN CHOICE — we only use the *keys* (file paths), never the values:
//   • The values would be lazy-import functions (Vite's default) that try to
//     load the file as a JS module — meaningless for binary audio.
//   • The keys are plain strings like "/public/music/snare.wav".
//   • We construct the actual fetch URL from the key by stripping "/public",
//     giving us "/music/snare.wav" — the path Vite's dev server and the
//     production build both serve the file at.
//
// URL MAPPING:
//   Vite copies everything in public/ to the dist root as-is, so:
//     /public/music/snare.wav  (glob key / filesystem path)
//           ↓  strip "/public"
//     /music/snare.wav         (URL in both dev and prod)
//
// TO ADD A NEW AUDIO FILE:
//   1. Drop the file into  mlsp/public/music/
//   2. Restart the dev server (or reload — Vite picks it up on the next cold
//      start; HMR alone may not re-run the glob scan)
//   That's it. No manifest, no config change.
//
// SYNC NOTE (for later):
//   The `url` field is exactly what gets passed to audioManager.load(url),
//   which in turn calls fetch(url) to get the raw bytes for Web Audio decoding.
//   The same URL could also be used to construct a timestamp-aligned download
//   link once we have the recorded video blob.
// =============================================================================

// Vite resolves this glob at build time. We never call the lazy-import
// functions (the values); we only need the keys for path discovery.
const _glob = import.meta.glob(
  '/public/music/*.{wav,WAV,mp3,MP3,ogg,OGG,flac,FLAC,aac,AAC,m4a,M4A}'
);

export interface MusicFile {
  filename: string; // e.g. "snare.wav"
  url: string;      // e.g. "/music/snare.wav"  — ready for fetch() or <audio src>
}

export const musicFiles: MusicFile[] = Object.keys(_glob)
  .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  .map(path => ({
    filename: path.split('/').pop()!,
    url: path.slice('/public'.length), // '/public/music/x.wav' → '/music/x.wav'
  }));
