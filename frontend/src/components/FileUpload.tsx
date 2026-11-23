import { useState, useRef, useEffect } from 'react';
import { useOverlayBack } from '../routes';
import { createPortal } from 'react-dom';
import './FileUpload.css';

/**
 * The camera: opens at once, takes one photo, hands it to `onUpload`.
 *
 * It was an upload component with a dropzone, a preview, a name field and a
 * "Start Pipeline" button, but every screen opened it camera-first
 * (App.tsx, class/JoinFlow.tsx), so none of that ever showed. Only the
 * camera is left (cleanup, 2026-11-23).
 */
interface FileUploadProps {
  onUpload: (file: File) => void;
  disabled?: boolean;
  onClose?: () => void;
}

export function FileUpload({ onUpload, disabled = false, onClose }: FileUploadProps) {
  const [showWebcam, setShowWebcam] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startWebcam = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' }
      });
      streamRef.current = mediaStream;
      setShowWebcam(true);

      // Set video source after a brief delay to ensure ref is ready
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      }, 100);
    } catch (error) {
      console.error('Error accessing webcam:', error);
      alert('Unable to access webcam. Please check permissions.');
    }
  };

  const stopWebcam = () => {
    // Stop video stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // Reset state
    setShowWebcam(false);

    // Call onClose callback if provided
    if (onClose) {
      onClose();
    }
  };

  // Back (Android's too) closes the camera, not the screen under it.
  useOverlayBack(showWebcam, stopWebcam);

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Mirror the image horizontally when capturing (flip back to normal)
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], 'webcam-capture.jpg', { type: 'image/jpeg' });
            stopWebcam();
            onUpload(file);
          }
        }, 'image/jpeg', 0.95);
      }
    }
  };

  // Open the camera on mount.
  useEffect(() => {
    if (!showWebcam) {
      startWebcam();
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {showWebcam && createPortal(
        <div className="file-upload-modal-overlay" onClick={stopWebcam}>
          <div className="file-upload-modal" onClick={(e) => e.stopPropagation()}>
            <div className="file-upload-modal-content">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="file-upload-modal-video"
              />
            </div>
            <div className="file-upload-modal-controls">
              <button
                className="file-upload-modal-capture"
                onClick={capturePhoto}
                disabled={disabled}
              >
                Capture
              </button>
              <button
                className="file-upload-modal-cancel"
                onClick={stopWebcam}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
