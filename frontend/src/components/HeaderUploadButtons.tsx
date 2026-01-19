import { useRef } from 'react';
import './HeaderUploadButtons.css';

interface HeaderUploadButtonsProps {
  onUpload: (file: File, characterName?: string) => void;
  onStartWebcam: () => void;
  disabled?: boolean;
  isLoggedIn?: boolean;
}

export function HeaderUploadButtons({ onUpload, onStartWebcam, disabled = false, isLoggedIn = false }: HeaderUploadButtonsProps) {
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

  if (!isLoggedIn) {
    return null;
  }

  return (
    <div className="header-upload-buttons">
      <button
        className="header-button"
        onClick={onStartWebcam}
        disabled={disabled}
        title="Capture with webcam"
      >
        <span className="header-button-text">Capture</span>
        <span className="header-button-icon">🤳</span>
      </button>
      <button
        className="header-button"
        onClick={handleClick}
        disabled={disabled}
        title="Upload image"
      >
        <span className="header-button-text">Upload</span>
        <span className="header-button-icon">📤</span>
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




