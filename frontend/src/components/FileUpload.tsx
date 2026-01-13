import { useState, useRef, DragEvent, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './FileUpload.css';

interface FileUploadProps {
  onUpload: (file: File, characterName?: string) => void;
  disabled?: boolean;
  showWebcamOnMount?: boolean;
  onClose?: () => void;
  tokenBalance?: number;  // User's current token balance (undefined if not logged in)
  creationCost?: number;  // Cost to create a hero
}

export function FileUpload({ onUpload, disabled = false, showWebcamOnMount = false, onClose, tokenBalance, creationCost }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [characterName, setCharacterName] = useState('');
  const [showWebcam, setShowWebcam] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cropArea, setCropArea] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const currentFileRef = useRef<File | null>(null);
  const hasAppliedCropRef = useRef<boolean>(false);

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
      // Reset state when opening modal
      setCapturedImage(null);
      setCropArea(null);
      setIsDraggingCrop(false);
      setCropStart(null);
      hasAppliedCropRef.current = false; // Reset crop flag
      
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
    
    // Clean up image URL
    if (capturedImage) {
      URL.revokeObjectURL(capturedImage);
    }
    
    // Reset all state
    setShowWebcam(false);
    setCapturedImage(null);
    setCropArea(null);
    setIsDraggingCrop(false);
    setCropStart(null);
    setResizeHandle(null);
    hasAppliedCropRef.current = false; // Reset crop flag
    
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
            // Stop the video stream
            if (streamRef.current) {
              streamRef.current.getTracks().forEach(track => track.stop());
              streamRef.current = null;
            }
            if (videoRef.current) {
              videoRef.current.srcObject = null;
            }
            
            // Show captured image and enable cropping
            const imageUrl = URL.createObjectURL(blob);
            setCapturedImage(imageUrl);
          }
        }, 'image/jpeg', 0.95);
      }
    }
  };

  const handleCropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cropContainerRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    
    const rect = cropContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (!cropArea) {
      // Creating new crop area
      setIsDraggingCrop(true);
      setCropStart({ x, y });
      setCropArea({ x, y, width: 0, height: 0 });
      return;
    }
    
    const { x: cropX, y: cropY, width, height } = cropArea;
    const handleSize = 15;
    
    // Check if clicking on a resize handle (corners)
    if (Math.abs(x - cropX) < handleSize && Math.abs(y - cropY) < handleSize) {
      setResizeHandle('nw');
      setIsDraggingCrop(true);
      setCropStart({ x: cropX, y: cropY });
    } else if (Math.abs(x - (cropX + width)) < handleSize && Math.abs(y - cropY) < handleSize) {
      setResizeHandle('ne');
      setIsDraggingCrop(true);
      setCropStart({ x: cropX + width, y: cropY });
    } else if (Math.abs(x - cropX) < handleSize && Math.abs(y - (cropY + height)) < handleSize) {
      setResizeHandle('sw');
      setIsDraggingCrop(true);
      setCropStart({ x: cropX, y: cropY + height });
    } else if (Math.abs(x - (cropX + width)) < handleSize && Math.abs(y - (cropY + height)) < handleSize) {
      setResizeHandle('se');
      setIsDraggingCrop(true);
      setCropStart({ x: cropX + width, y: cropY + height });
    } else if (x >= cropX && x <= cropX + width && y >= cropY && y <= cropY + height) {
      // Clicking inside crop area - move it
      setIsDraggingCrop(true);
      setCropStart({ x: x - cropX, y: y - cropY });
      setResizeHandle(null);
    } else {
      // Clicking outside - create new crop area
      setIsDraggingCrop(true);
      setCropStart({ x, y });
      setCropArea({ x, y, width: 0, height: 0 });
      setResizeHandle(null);
    }
  };


  const applyCrop = () => {
    if (!cropArea || !cropImageRef.current || !canvasRef.current || !capturedImage) return;
    if (cropArea.width < 10 || cropArea.height < 10) return;
    
    const img = cropImageRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const imgRect = img.getBoundingClientRect();
    const containerRect = cropContainerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    
    // Calculate scale - image uses object-fit: cover
    const scaleX = img.naturalWidth / imgRect.width;
    const scaleY = img.naturalHeight / imgRect.height;
    
    // Map crop area to image coordinates
    const cropX = Math.max(0, cropArea.x * scaleX);
    const cropY = Math.max(0, cropArea.y * scaleY);
    const cropWidth = Math.min(img.naturalWidth - cropX, cropArea.width * scaleX);
    const cropHeight = Math.min(img.naturalHeight - cropY, cropArea.height * scaleY);
    
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    
    ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'webcam-capture.jpg', { type: 'image/jpeg' });
        currentFileRef.current = file;
        
        if (capturedImage) {
          URL.revokeObjectURL(capturedImage);
        }
        const imageUrl = URL.createObjectURL(blob);
        hasAppliedCropRef.current = true; // Mark that we've applied a crop
        setCapturedImage(imageUrl);
        setCropArea(null);
      }
    }, 'image/jpeg', 0.95);
  };

  const skipCrop = () => {
    if (capturedImage && canvasRef.current && cropImageRef.current) {
      const img = cropImageRef.current;
      const canvas = canvasRef.current;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], 'webcam-capture.jpg', { type: 'image/jpeg' });
            currentFileRef.current = file;
            setCropArea(null);
          }
        }, 'image/jpeg', 0.95);
      }
    }
  };

  const handleStartPipelineFromModal = () => {
    if (currentFileRef.current) {
      // Set preview before closing
      if (capturedImage) {
        setPreview(capturedImage);
      }
      onUpload(currentFileRef.current, characterName || undefined);
      stopWebcam();
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
      if (capturedImage) {
        URL.revokeObjectURL(capturedImage);
      }
    };
  }, []);

  // Handle crop dragging and resizing
  useEffect(() => {
    if (!isDraggingCrop || !cropStart || !cropContainerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = cropContainerRef.current!.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
      
      if (!cropArea) {
        // Creating new selection
        const startX = Math.min(cropStart.x, x);
        const startY = Math.min(cropStart.y, y);
        const width = Math.abs(x - cropStart.x);
        const height = Math.abs(y - cropStart.y);
        setCropArea({ 
          x: startX, 
          y: startY, 
          width: Math.min(width, rect.width - startX), 
          height: Math.min(height, rect.height - startY) 
        });
      } else if (resizeHandle) {
        // Resizing crop area
        let newCrop = { ...cropArea };
        
        if (resizeHandle === 'nw') {
          const newWidth = cropArea.width + (cropArea.x - x);
          const newHeight = cropArea.height + (cropArea.y - y);
          if (newWidth > 20 && newHeight > 20) {
            newCrop.x = x;
            newCrop.y = y;
            newCrop.width = newWidth;
            newCrop.height = newHeight;
          }
        } else if (resizeHandle === 'ne') {
          const newWidth = x - cropArea.x;
          const newHeight = cropArea.height + (cropArea.y - y);
          if (newWidth > 20 && newHeight > 20) {
            newCrop.y = y;
            newCrop.width = newWidth;
            newCrop.height = newHeight;
          }
        } else if (resizeHandle === 'sw') {
          const newWidth = cropArea.width + (cropArea.x - x);
          const newHeight = y - cropArea.y;
          if (newWidth > 20 && newHeight > 20) {
            newCrop.x = x;
            newCrop.width = newWidth;
            newCrop.height = newHeight;
          }
        } else if (resizeHandle === 'se') {
          const newWidth = x - cropArea.x;
          const newHeight = y - cropArea.y;
          if (newWidth > 20 && newHeight > 20) {
            newCrop.width = newWidth;
            newCrop.height = newHeight;
          }
        }
        
        // Constrain to container bounds
        if (newCrop.x < 0) {
          newCrop.width += newCrop.x;
          newCrop.x = 0;
        }
        if (newCrop.y < 0) {
          newCrop.height += newCrop.y;
          newCrop.y = 0;
        }
        if (newCrop.x + newCrop.width > rect.width) {
          newCrop.width = rect.width - newCrop.x;
        }
        if (newCrop.y + newCrop.height > rect.height) {
          newCrop.height = rect.height - newCrop.y;
        }
        
        setCropArea(newCrop);
      } else {
        // Moving existing crop area
        const newX = Math.max(0, Math.min(x - cropStart.x, rect.width - cropArea.width));
        const newY = Math.max(0, Math.min(y - cropStart.y, rect.height - cropArea.height));
        setCropArea({ ...cropArea, x: newX, y: newY });
      }
    };

    const handleMouseUp = () => {
      setIsDraggingCrop(false);
      setCropStart(null);
      setResizeHandle(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingCrop, cropStart, cropArea, resizeHandle]);

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
                <span className="file-upload-cost">Cost: {creationCost} tokens</span>
              )}
              {tokenBalance !== undefined && creationCost !== undefined && tokenBalance < creationCost && (
                <span className="file-upload-insufficient">
                  Insufficient tokens (have {tokenBalance})
                </span>
              )}
              <button
                onClick={handleStartPipeline}
                disabled={disabled || (tokenBalance !== undefined && creationCost !== undefined && tokenBalance < creationCost)}
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
            <div 
              className="file-upload-modal-content"
              ref={cropContainerRef}
              onMouseDown={capturedImage && cropArea ? handleCropMouseDown : undefined}
            >
              {capturedImage ? (
                <>
                  <img 
                    ref={cropImageRef}
                    src={capturedImage} 
                    alt="Captured" 
                    className="file-upload-modal-image"
                    onLoad={() => {
                      // Only initialize crop area if we haven't applied a crop yet
                      if (cropImageRef.current && cropContainerRef.current && !cropArea && !hasAppliedCropRef.current) {
                        const containerRect = cropContainerRef.current.getBoundingClientRect();
                        const padding = 40;
                        setCropArea({
                          x: padding,
                          y: padding,
                          width: containerRect.width - padding * 2,
                          height: containerRect.height - padding * 2
                        });
                      }
                    }}
                  />
                  {cropArea && cropArea.width > 0 && cropArea.height > 0 && (
                    <>
                      <div 
                        className="file-upload-crop-overlay"
                        style={{
                          clipPath: `polygon(
                            0% 0%, 
                            0% 100%, 
                            ${cropArea.x}px 100%, 
                            ${cropArea.x}px ${cropArea.y}px, 
                            ${cropArea.x + cropArea.width}px ${cropArea.y}px, 
                            ${cropArea.x + cropArea.width}px ${cropArea.y + cropArea.height}px, 
                            ${cropArea.x}px ${cropArea.y + cropArea.height}px, 
                            ${cropArea.x}px 100%, 
                            100% 100%, 
                            100% 0%
                          )`
                        }}
                      />
                      <div 
                        className="file-upload-crop-area"
                        style={{
                          left: `${cropArea.x}px`,
                          top: `${cropArea.y}px`,
                          width: `${cropArea.width}px`,
                          height: `${cropArea.height}px`,
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleCropMouseDown(e);
                        }}
                      >
                        <div 
                          className="file-upload-crop-handle file-upload-crop-handle-nw"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            if (cropArea) {
                              setResizeHandle('nw');
                              setIsDraggingCrop(true);
                              setCropStart({ x: cropArea.x, y: cropArea.y });
                            }
                          }}
                        />
                        <div 
                          className="file-upload-crop-handle file-upload-crop-handle-ne"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            if (cropArea) {
                              setResizeHandle('ne');
                              setIsDraggingCrop(true);
                              setCropStart({ x: cropArea.x + cropArea.width, y: cropArea.y });
                            }
                          }}
                        />
                        <div 
                          className="file-upload-crop-handle file-upload-crop-handle-sw"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            if (cropArea) {
                              setResizeHandle('sw');
                              setIsDraggingCrop(true);
                              setCropStart({ x: cropArea.x, y: cropArea.y + cropArea.height });
                            }
                          }}
                        />
                        <div 
                          className="file-upload-crop-handle file-upload-crop-handle-se"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            if (cropArea) {
                              setResizeHandle('se');
                              setIsDraggingCrop(true);
                              setCropStart({ x: cropArea.x + cropArea.width, y: cropArea.y + cropArea.height });
                            }
                          }}
                        />
                      </div>
                    </>
                  )}
                </>
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="file-upload-modal-video"
                />
              )}
            </div>
            <div className="file-upload-modal-controls">
              {capturedImage && cropArea ? (
                <>
                  <button
                    className="file-upload-modal-crop-apply"
                    onClick={applyCrop}
                    disabled={!cropArea || cropArea.width < 10 || cropArea.height < 10}
                  >
                    Apply Crop
                  </button>
                  <button
                    className="file-upload-modal-crop-skip"
                    onClick={skipCrop}
                  >
                    Skip
                  </button>
                  <button
                    className="file-upload-modal-cancel"
                    onClick={stopWebcam}
                  >
                    Cancel
                  </button>
                </>
              ) : capturedImage ? (
                <>
                  <input
                    type="text"
                    placeholder="Superhero name (optional)"
                    value={characterName}
                    onChange={(e) => setCharacterName(e.target.value)}
                    className="file-upload-modal-name-input"
                    disabled={disabled}
                  />
                  <div className="file-upload-modal-start-section">
                    {creationCost !== undefined && (
                      <span className="file-upload-modal-cost">Cost: {creationCost} tokens</span>
                    )}
                    {tokenBalance !== undefined && creationCost !== undefined && tokenBalance < creationCost && (
                      <span className="file-upload-modal-insufficient">
                        Insufficient tokens (have {tokenBalance})
                      </span>
                    )}
                    <button
                      className="file-upload-modal-start"
                      onClick={handleStartPipelineFromModal}
                      disabled={disabled || (tokenBalance !== undefined && creationCost !== undefined && tokenBalance < creationCost)}
                    >
                      Start Pipeline
                    </button>
                  </div>
                  <button
                    className="file-upload-modal-cancel"
                    onClick={stopWebcam}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}





