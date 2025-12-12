import { useEffect, useRef, useState } from 'react';

type PermissionState = 'idle' | 'pending' | 'granted' | 'error' | 'unsupported';

interface WebcamCaptureProps {
  onCapture?: (blob: Blob) => void;
}

export function WebcamCapture({ onCapture }: WebcamCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [permission, setPermission] = useState<PermissionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    async function enableWebcam() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermission('unsupported');
        setError('Webcam capture is not supported in this browser.');
        return;
      }
      try {
        setPermission('pending');
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setPermission('granted');
        }
      } catch (err) {
        setPermission('error');
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Unable to access webcam');
        }
      }
    }

    enableWebcam();

    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const previewUrl = URL.createObjectURL(blob);
      setSnapshot(previewUrl);
      onCapture?.(blob);
    }, 'image/jpeg');
  };

  return (
    <div className="card webcam">
      <header className="card__header">
        <div>
          <p className="eyebrow">Webcam capture</p>
          <strong>Step 1 • webcam_scan task</strong>
        </div>
        <button className="button button--ghost" onClick={handleCapture} disabled={permission !== 'granted'}>
          Capture frame
        </button>
      </header>
      <div className="webcam__grid">
        <div className="webcam__preview">
          <video ref={videoRef} playsInline muted autoPlay className={permission === 'granted' ? '' : 'is-paused'} />
          {permission === 'pending' && <p className="webcam__status">Requesting camera access…</p>}
          {permission === 'error' && <p className="webcam__status">{error}</p>}
          {permission === 'unsupported' && <p className="webcam__status">{error}</p>}
        </div>
        <div className="webcam__snapshot">
          <p className="eyebrow">Latest capture</p>
          {snapshot ? <img src={snapshot} alt="Captured frame preview" /> : <p>No capture yet.</p>}
        </div>
      </div>
      <canvas ref={canvasRef} className="webcam__canvas" aria-hidden />
    </div>
  );
}
