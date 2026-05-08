// =============================================================================
// App.tsx
// =============================================================================
//
// CONNECTION CHAIN — how the camera ends up on screen:
//
//   App mounts
//     └─ useEffect calls startCamera()
//           └─ videoManager.initialize()
//                 └─ navigator.mediaDevices.getUserMedia()   [browser API]
//                       └─ returns MediaStream
//                             └─ stored in videoManager.stream
//                             └─ videoManager.attachToElement(videoRef.current)
//                                   └─ sets <video>.srcObject = stream
//                                         └─ browser decodes + renders frames
//
// React's role here is minimal: it owns the <video> DOM node via `useRef` and
// re-renders the overlay/button labels in response to `cameraStatus` changes.
// The actual pixels flowing to the screen are handled entirely by the browser's
// media pipeline, not by React.
//
// =============================================================================

import { useEffect, useRef } from 'react';
import './index.css';
import { videoManager } from './VideoManager';
import { useAppStore } from './stores/useAppStore';

// Shared base style for all three buttons, spread with per-button overrides.
const BTN_BASE: React.CSSProperties = {
  flex: 1,
  padding: '14px 0',
  fontSize: '15px',
  fontWeight: 600,
  border: 'none',
  borderRadius: '8px',
  color: '#fff',
  cursor: 'pointer',
  letterSpacing: '0.5px',
  transition: 'background-color 0.2s, opacity 0.2s',
};

function App() {
  // ── Refs ──────────────────────────────────────────────────────────────────
  //
  // useRef gives us a stable reference to the <video> DOM element across
  // re-renders. Unlike useState, changing a ref does NOT cause a re-render —
  // which is exactly what we want: the video element is infrastructure, not UI.
  const videoRef = useRef<HTMLVideoElement>(null);

  // ── Store slices ──────────────────────────────────────────────────────────
  //
  // We subscribe only to the fields we need. If other fields in the store
  // change (e.g. selectedAudio), this component will NOT re-render.
  const cameraStatus    = useAppStore(s => s.cameraStatus);
  const setCameraStatus = useAppStore(s => s.setCameraStatus);

  // ── startCamera ───────────────────────────────────────────────────────────
  //
  // Drives the camera through its status states:
  //   idle / denied / error  →  requesting  →  active   (happy path)
  //                                         →  denied   (user said no)
  //                                         →  error    (hardware problem)
  //
  // Guard at the top prevents re-entry if already requesting or active.
  async function startCamera() {
    if (cameraStatus === 'active' || cameraStatus === 'requesting') return;
    setCameraStatus('requesting');
    try {
      await videoManager.initialize();
      setCameraStatus('active');
      // Attach here as well as in the effect below — initialize() is async so
      // by the time it resolves, videoRef.current is guaranteed to exist.
      if (videoRef.current) videoManager.attachToElement(videoRef.current);
    } catch (err) {
      // The browser throws a DOMException with specific names we can inspect:
      //   NotAllowedError / PermissionDeniedError  → user declined
      //   NotFoundError                            → no camera hardware
      //   NotReadableError                         → camera in use by another app
      const isDenied =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setCameraStatus(isDenied ? 'denied' : 'error');
    }
  }

  // ── Mount effect ─────────────────────────────────────────────────────────
  //
  // Modern browsers allow getUserMedia() to be called on page load without
  // a user gesture — they will show the OS permission dialog automatically.
  // (This is unlike autoplay of <video src="...">, which DOES require a gesture.)
  //
  // Cleanup: when the component unmounts (page closed / HMR reload), stop all
  // MediaStreamTracks so the camera indicator light turns off.
  useEffect(() => {
    startCamera();
    return () => videoManager.stop();
  // startCamera closes over setCameraStatus from the store, which is stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-attach effect ──────────────────────────────────────────────────────
  //
  // Edge case: if React re-renders and recreates the <video> element (e.g. due
  // to conditional rendering), srcObject is lost. This effect re-wires the
  // stream whenever cameraStatus transitions to 'active'.
  useEffect(() => {
    if (cameraStatus === 'active' && videoRef.current) {
      videoManager.attachToElement(videoRef.current);
    }
  }, [cameraStatus]);

  // ── Overlay copy ──────────────────────────────────────────────────────────
  const showOverlay = cameraStatus !== 'active';
  const overlayMessage: Record<string, string> = {
    idle:       '',
    requesting: 'Requesting camera access…',
    denied:     'Camera access was denied. Please allow it in browser settings.',
    error:      'Could not access camera.',
  };

  return (
    <div style={{
      width: '100%',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: '8vh',
      backgroundColor: '#0f0f13',
    }}>

      {/* ── Video container ─────────────────────────────────────────────────
          `position: relative` + `overflow: hidden` lets the overlay sit flush
          inside the rounded box without clipping issues.                     */}
      <div style={{
        position: 'relative',
        width: '60%',
        height: '50vh',
        backgroundColor: '#1a0000',
        borderRadius: '12px',
        overflow: 'hidden',
      }}>

        {/* The <video> element is always in the DOM so videoRef stays valid.
            We just hide it visually until the stream is ready.
            Key attributes:
              autoPlay   — starts playback as soon as srcObject is set
              playsInline — required on iOS to prevent full-screen takeover
              muted      — required by Chrome's autoplay policy (no audio anyway)
            scaleX(-1)  — horizontally flips the frame so it acts like a mirror,
                          which feels natural for a front-facing camera            */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: cameraStatus === 'active' ? 'block' : 'none',
            transform: 'scaleX(-1)',
          }}
        />

        {/* Overlay shown while camera is not yet live */}
        {showOverlay && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            color: '#ccc',
            fontSize: '14px',
          }}>
            {cameraStatus === 'requesting' && (
              <div style={{
                width: '36px',
                height: '36px',
                border: '3px solid #555',
                borderTop: '3px solid #e55',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
            )}
            <span>{overlayMessage[cameraStatus]}</span>
          </div>
        )}
      </div>

      {/* ── Buttons ──────────────────────────────────────────────────────────
          Camera starts automatically on mount, so no button owns that action.
          All three slots are free for the upcoming features:
            • Select Audio  — open a list of available audio files
            • Record        — arm → countdown → synchronized capture           */}
      <div style={{
        width: '60%',
        display: 'flex',
        gap: '12px',
        marginTop: '16px',
      }}>
        <button
          style={{ ...BTN_BASE, backgroundColor: '#1a1a2e' }}
          onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
          onMouseLeave={e => (e.currentTarget.style.filter = '')}
        >
          Button 1
        </button>

        <button
          style={{ ...BTN_BASE, backgroundColor: '#1a1a2e' }}
          onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
          onMouseLeave={e => (e.currentTarget.style.filter = '')}
        >
          Select Audio
        </button>

        <button
          style={{ ...BTN_BASE, backgroundColor: '#1a1a2e' }}
          onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
          onMouseLeave={e => (e.currentTarget.style.filter = '')}
        >
          Record
        </button>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

export default App;
