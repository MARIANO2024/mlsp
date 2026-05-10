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
        backgroundColor: '#08080c',
        border: '1px solid #252542',
        borderRadius: '8px',
        color: '#b7b7d8',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '11px',
        lineHeight: 1.45,
        maxHeight: '18vh',
        overflowY: 'auto',
        whiteSpace: 'pre-wrap',
      }}
    >
      <div style={{ color: '#e5a050', marginBottom: '6px', fontWeight: 700 }}>
        Master Clock Sync Console
      </div>
      {lines.map((line, index) => (
        <div key={`${index}-${line}`}>{line}</div>
      ))}
    </div>
  );
}
