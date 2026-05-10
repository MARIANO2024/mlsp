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
        color: recordingStatus === 'recording' ? '#e5a050' : '#777',
        fontSize: '12px',
        textAlign: 'center',
      }}
    >
      {message}
    </div>
  );
}
