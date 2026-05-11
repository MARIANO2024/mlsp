export interface SyncConsoleProps {
  width: string;
  lines: string[];
}

export function SyncConsole({ width, lines }: SyncConsoleProps) {
  return (
    <div
      style={{
        width,
        marginTop: '12px',
        padding: '12px 14px',
        boxSizing: 'border-box',
        backgroundColor: 'var(--bg-panel)',
        border: '1px solid var(--border-soft)',
        borderRadius: '8px',
        color: 'var(--ink-body)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '11px',
        lineHeight: 1.45,
        maxHeight: '18vh',
        overflowY: 'auto',
        whiteSpace: 'pre-wrap',
        boxShadow: 'var(--shadow-soft)',
      }}
    >
      <div style={{ color: 'var(--accent-warm)', marginBottom: '6px', fontWeight: 700 }}>
        Master Clock Sync Console
      </div>
      {lines.map((line, index) => (
        <div key={`${index}-${line}`}>{line}</div>
      ))}
    </div>
  );
}
