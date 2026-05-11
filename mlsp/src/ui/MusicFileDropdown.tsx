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
        backgroundColor: 'var(--bg-panel)',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid var(--border-soft)',
        boxShadow: 'var(--shadow-soft)',
      }}
    >
      {files.length === 0 ? (
        <div style={{ padding: '14px 16px', color: 'var(--ink-body)', fontSize: '14px' }}>
          No audio files found. Drop .wav/.mp3 files into{' '}
          <code style={{ color: 'var(--ink-muted)' }}>public/music/</code> and restart
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
              background: filename === selectedAudio ? 'var(--accent-soft)' : 'transparent',
              border: 'none',
              borderBottom: '1px solid var(--border-soft)',
              color: filename === selectedAudio ? 'var(--accent)' : 'var(--ink-body)',
              fontSize: '14px',
              textAlign: 'left',
              cursor: controlsLocked ? 'not-allowed' : 'pointer',
              opacity: controlsLocked ? 0.45 : 1,
            }}
            onMouseEnter={e => {
              if (!controlsLocked) e.currentTarget.style.backgroundColor = 'var(--bg-surface-2)';
            }}
            onMouseLeave={e =>
              (e.currentTarget.style.backgroundColor =
                filename === selectedAudio ? 'var(--accent-soft)' : 'transparent')
            }
          >
            {filename}
          </button>
        ))
      )}
    </div>
  );
}
