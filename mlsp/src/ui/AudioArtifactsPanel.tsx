export interface AudioArtifact {
  key: string;
  label: string;
  url: string;
  filename: string;
  note?: string;
}

export interface AudioArtifactsPanelProps {
  width: string;
  artifacts: AudioArtifact[];
}

export function AudioArtifactsPanel({ width, artifacts }: AudioArtifactsPanelProps) {
  if (artifacts.length === 0) return null;

  return (
    <div
      style={{
        width,
        marginTop: '14px',
        padding: '12px',
        boxSizing: 'border-box',
        backgroundColor: 'var(--bg-panel)',
        border: '1px solid var(--border-soft)',
        borderRadius: '8px',
        boxShadow: 'var(--shadow-soft)',
      }}
    >
      <div style={{ color: 'var(--ink-body)', fontSize: '12px', marginBottom: '10px', textAlign: 'center' }}>
        Audio artifacts
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px' }}>
        {artifacts.map(artifact => (
          <div key={artifact.key}>
            <div style={{ color: 'var(--ink-strong)', fontSize: '12px', marginBottom: '6px' }}>
              {artifact.label}
            </div>
            <audio controls src={artifact.url} style={{ width: '100%', filter: 'sepia(0.12)' }} />
            <div style={{ color: 'var(--ink-muted)', fontSize: '10px', marginTop: '4px', overflowWrap: 'anywhere' }}>
              {artifact.note ?? artifact.filename}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
