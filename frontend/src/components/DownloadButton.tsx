import { useState } from 'react';
import { api } from '../api/client';
import './DownloadButton.css';

interface DownloadButtonProps {
  creationId: string;
  filename: string;
  userId?: string;
  label?: string;
}

export function DownloadButton({
  creationId,
  filename,
  userId,
  label,
}: DownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await api.downloadFile(creationId, filename, userId);
    } catch (error) {
      alert(`Failed to download file: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <button
      className="download-button"
      onClick={handleDownload}
      disabled={isDownloading}
    >
      {isDownloading ? (
        <>
          <span className="download-spinner"></span>
          Downloading...
        </>
      ) : (
        <>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {label || `Download ${filename}`}
        </>
      )}
    </button>
  );
}





