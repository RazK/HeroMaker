import { useRef } from 'react';
import './HeaderUploadButtons.css';

interface HeaderUploadButtonsProps {
  onUpload: (file: File, characterName?: string) => void;
  onStartWebcam: () => void;
  disabled?: boolean;
}

export function HeaderUploadButtons({ onUpload, onStartWebcam, disabled = false }: HeaderUploadButtonsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
    }
  };

  return (
    <div className="header-upload-buttons">
      <button
        className="header-upload-button"
        onClick={onStartWebcam}
        disabled={disabled}
        title="Capture with webcam"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        <span className="header-upload-button-text">Capture</span>
      </button>
      <button
        className="header-upload-button"
        onClick={handleClick}
        disabled={disabled}
        title="Upload image"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span className="header-upload-button-text">Upload</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileInput}
        disabled={disabled}
        style={{ display: 'none' }}
      />
    </div>
  );
}
