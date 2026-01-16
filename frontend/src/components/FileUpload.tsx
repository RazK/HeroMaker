import { useState, useRef, DragEvent, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './FileUpload.css';

interface FileUploadProps {
  onUpload: (file: File, characterName?: string) => void;
  disabled?: boolean;
  showWebcamOnMount?: boolean;
  onClose?: () => void;
  creditBalance?: number;  // User's current credit balance (undefined if not logged in)
  creationCost?: number;  // Cost to create a hero
}

export function FileUpload({ onUpload, disabled = false, showWebcamOnMount = false, onClose, creditBalance, creationCost }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [characterName, setCharacterName] = useState('');
  const [showWebcam, setShowWebcam] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const currentFileRef = useRef<File | null>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    currentFileRef.current = file;

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    if (disabled) return;

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleClick = () => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  };

  const handleStartPipeline = () => {
    const file = currentFileRef.current || fileInputRef.current?.files?.[0];
    if (preview && file) {
      onUpload(file, characterName || undefined);
    }
  };

  const handleClear = () => {
    setPreview(null);
    setCharacterName('');
    currentFileRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    stopWebcam();
  };

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
            currentFileRef.current = file;
            
            // Stop the video stream
            if (streamRef.current) {
              streamRef.current.getTracks().forEach(track => track.stop());
              streamRef.current = null;
            }
            if (videoRef.current) {
              videoRef.current.srcObject = null;
            }
            
            // Directly upload after capturing, skip crop
            stopWebcam();
            onUpload(file, characterName || undefined);
          }
        }, 'image/jpeg', 0.95);
      }
    }
  };


  // Cleanup on unmount
  useEffect(() => {
    if (showWebcamOnMount && !showWebcam) {
      startWebcam();
    }
  }, [showWebcamOnMount]);

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
      {!showWebcamOnMount && (
        <div className="file-upload-container">
          {!preview && (
            <div className="file-upload-options">
              <button
                className="file-upload-option-button"
                onClick={handleClick}
                disabled={disabled}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>Upload</span>
              </button>
              <button
                className="file-upload-option-button"
                onClick={startWebcam}
                disabled={disabled}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span>Capture</span>
              </button>
            </div>
          )}

        <div
          className={`file-upload-dropzone ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''} ${preview ? 'has-preview' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={!preview ? handleClick : undefined}
          style={{ display: preview ? 'block' : 'none' }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileInput}
            disabled={disabled}
            style={{ display: 'none' }}
          />

          {preview && (
            <div className="file-upload-preview">
              <img src={preview} alt="Preview" />
              <button className="file-upload-clear" onClick={(e) => { e.stopPropagation(); handleClear(); }}>
                ×
              </button>
            </div>
          )}
        </div>

        {!showWebcamOnMount && preview && (
          <div className="file-upload-actions">
            <input
              type="text"
              placeholder="Character name (optional)"
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              className="file-upload-name-input"
              disabled={disabled}
            />
            <div className="file-upload-start-section">
              {creationCost !== undefined && (
                <span className="file-upload-cost">Cost: {creationCost} credits</span>
              )}
              {creditBalance !== undefined && creationCost !== undefined && creditBalance < creationCost && (
                <span className="file-upload-insufficient">
                  Insufficient credits (have {creditBalance})
                </span>
              )}
              <button
                onClick={handleStartPipeline}
                disabled={disabled || (creditBalance !== undefined && creationCost !== undefined && creditBalance < creationCost)}
                className="file-upload-start-button"
              >
                Start Pipeline
              </button>
            </div>
          </div>
        )}
        </div>
      )}

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





