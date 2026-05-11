// Vite resolves public music files at build/dev-server startup.
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
