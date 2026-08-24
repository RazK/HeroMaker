import { useState, useEffect } from 'react';
import './ImagePreview.css';

interface ImagePreviewProps {
  src: string;
  alt?: string;
  className?: string;
  /**
   * A small, fast-loading version of the same picture. It is painted first and
   * stays behind the full-size image until that finishes decoding, so the stage
   * is never an empty rectangle while a 1-2 MB render comes down the wire.
   */
  placeholderSrc?: string;
}

export function ImagePreview({ src, alt = 'Preview', className = '', placeholderSrc }: ImagePreviewProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hasError, setHasError] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [fullLoaded, setFullLoaded] = useState(false);

  // Reset error state and aspect ratio when src changes
  useEffect(() => {
    setHasError(false);
    setAspectRatio(null);
    setFullLoaded(false);
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
          {placeholderSrc && !fullLoaded && (
            <img
              className="image-preview-placeholder"
              src={placeholderSrc}
              alt=""
              aria-hidden="true"
              decoding="async"
              fetchPriority="high"
              onLoad={(e) => {
                // The small copy has the same aspect ratio, so it can size the
                // wrapper straight away and stop the stage jumping later.
                if (aspectRatio === null) {
                  const img = e.currentTarget;
                  setAspectRatio(img.naturalWidth / img.naturalHeight);
                }
              }}
            />
          )}
          <img
            src={src}
            alt={alt}
            decoding="async"
            className={placeholderSrc ? `image-preview-full${fullLoaded ? ' is-loaded' : ''}` : undefined}
            onError={(e) => {
              console.error('[ImagePreview] Image load error:', src, e);
              setHasError(true);
            }}
            onLoad={(e) => {
              const img = e.currentTarget;
              setAspectRatio(img.naturalWidth / img.naturalHeight);
              setFullLoaded(true);
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





