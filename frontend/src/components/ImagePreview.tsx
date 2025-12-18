import { useState } from 'react';
import './ImagePreview.css';

interface ImagePreviewProps {
  src: string;
  alt?: string;
  className?: string;
}

export function ImagePreview({ src, alt = 'Preview', className = '' }: ImagePreviewProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  const handleClick = () => {
    setIsModalOpen(true);
    setZoom(1);
  };

  const handleClose = () => {
    setIsModalOpen(false);
    setZoom(1);
  };

  const handleZoomIn = () => {
    setZoom((z) => Math.min(z + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoom((z) => Math.max(z - 0.25, 0.5));
  };

  return (
    <>
      <div className={`image-preview-thumbnail ${className}`} onClick={handleClick}>
        <img src={src} alt={alt} />
        <div className="image-preview-overlay">
          <span>Click to view</span>
        </div>
      </div>

      {isModalOpen && (
        <div className="image-preview-modal" onClick={handleClose}>
          <div className="image-preview-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="image-preview-close" onClick={handleClose}>
              ×
            </button>
            <div className="image-preview-controls">
              <button onClick={handleZoomIn} disabled={zoom >= 3}>
                +
              </button>
              <button onClick={handleZoomOut} disabled={zoom <= 0.5}>
                −
              </button>
              <span>{Math.round(zoom * 100)}%</span>
            </div>
            <img
              src={src}
              alt={alt}
              style={{ transform: `scale(${zoom})` }}
              className="image-preview-zoomed"
            />
          </div>
        </div>
      )}
    </>
  );
}
