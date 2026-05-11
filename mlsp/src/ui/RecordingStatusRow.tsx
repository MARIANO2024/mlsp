import type { RecordingStatus } from '../capture/recordingTypes';

export interface RecordingStatusRowProps {
  width: string;
  recordingStatus: RecordingStatus;
  message: string;
}

export function RecordingStatusRow({ width, recordingStatus, message }: RecordingStatusRowProps) {
  return (
    <div
      style={{
        width,
        marginTop: '8px',
        color:
          recordingStatus === 'RECORDING'
            ? 'var(--accent-warm)'
            : recordingStatus === 'ERROR'
              ? 'var(--danger)'
              : recordingStatus === 'COMPLETE'
                ? 'var(--success)'
                : 'var(--ink-muted)',
        fontSize: '12px',
        textAlign: 'center',
      }}
    >
      {message}
    </div>
  );
}
