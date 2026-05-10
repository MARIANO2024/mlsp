export interface MusicFileDropdownProps {
  width: string;
  files: { filename: string; url: string }[];
  controlsLocked: boolean;
  selectedAudio: string | null;
  onPick: (filename: string, url: string) => void;
}

export function MusicFileDropdown({
  width,
  files,
  controlsLocked,
  selectedAudio,
  onPick,
}: MusicFileDropdownProps) {
  return (
    <div
      style={{
        width,
        marginTop: '12px',
        backgroundColor: '#1a1a2e',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid #2e2e4e',
      }}
    >
      {files.length === 0 ? (
        <div style={{ padding: '14px 16px', color: '#666', fontSize: '14px' }}>
          No audio files found. Drop .wav/.mp3 files into{' '}
          <code style={{ color: '#aaa' }}>public/music/</code> and restart
          the dev server.
        </div>
      ) : (
        files.map(({ filename, url }) => (
          <button
            key={url}
            type="button"
            disabled={controlsLocked}
            onClick={() => onPick(filename, url)}
            style={{
              display: 'block',
              width: '100%',
              padding: '12px 16px',
              background: filename === selectedAudio ? '#2e2e50' : 'transparent',
              border: 'none',
              borderBottom: '1px solid #2e2e4e',
              color: filename === selectedAudio ? '#a0a0ff' : '#ccc',
              fontSize: '14px',
              textAlign: 'left',
              cursor: controlsLocked ? 'not-allowed' : 'pointer',
              opacity: controlsLocked ? 0.45 : 1,
            }}
            onMouseEnter={e => {
              if (!controlsLocked) e.currentTarget.style.backgroundColor = '#25254a';
            }}
            onMouseLeave={e =>
              (e.currentTarget.style.backgroundColor =
                filename === selectedAudio ? '#2e2e50' : 'transparent')
            }
          >
            {filename}
          </button>
        ))
      )}
    </div>
  );
}
