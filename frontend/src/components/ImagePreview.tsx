import { useState, useEffect } from 'react';
import './ImagePreview.css';

interface ImagePreviewProps {
  src: string;
  alt?: string;
  className?: string;
}

export function ImagePreview({ src, alt = 'Preview', className = '' }: ImagePreviewProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hasError, setHasError] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  // Reset error state and aspect ratio when src changes
  useEffect(() => {
    setHasError(false);
    setAspectRatio(null);
    console.log('[ImagePreview] Loading image:', src);
  }, [src]);

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

  if (hasError) {
    return (
      <div className={`image-preview-thumbnail ${className} image-preview-error`}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '100%',
          color: '#999',
          fontSize: '14px'
        }}>
          Image not available
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`image-preview-thumbnail ${className}`} onClick={handleClick}>
        <div 
          className="image-preview-wrapper"
          style={aspectRatio ? { aspectRatio: String(aspectRatio) } : undefined}
        >
          <img 
            src={src} 
            alt={alt} 
            onError={(e) => {
              console.error('[ImagePreview] Image load error:', src, e);
              setHasError(true);
            }}
            onLoad={(e) => {
              const img = e.currentTarget;
              const ratio = img.naturalWidth / img.naturalHeight;
              setAspectRatio(ratio);
              console.log('[ImagePreview] Image loaded successfully:', src, 'aspect ratio:', ratio);
            }}
          />
          <div className="image-preview-overlay">
            Click to view
          </div>
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
              onError={() => setHasError(true)}
            />
          </div>
        </div>
      )}
    </>
  );
}





