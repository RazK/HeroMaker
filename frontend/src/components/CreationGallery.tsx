import { useState, useEffect } from 'react';
import { api, CreationResponse } from '../api/client';
import { calculateOverallProgress } from './PipelineProgress';
import './CreationGallery.css';

interface CreationGalleryProps {
  onSelectCreation: (creation: CreationResponse) => void;
}

export function CreationGallery({ onSelectCreation }: CreationGalleryProps) {
  const [creations, setCreations] = useState<CreationResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    loadCreations();
  }, []);

  // Update every second for time remaining
  useEffect(() => {
    const hasProcessing = creations.some(c => c.status === 'processing');
    if (hasProcessing) {
      const interval = setInterval(() => {
        setTick(t => t + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [creations]);

  const loadCreations = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Load all creations - start with a large limit
      let allCreations: CreationResponse[] = [];
      let offset = 0;
      const limit = 100;
      let hasMore = true;
      
      while (hasMore) {
        const result = await api.listCreations(limit, offset);
        allCreations = [...allCreations, ...result.creations];
        
        console.log(`[CreationGallery] Loaded batch: offset=${offset}, count=${result.creations.length}, total so far=${allCreations.length}`);
        
        // If we got fewer than the limit, we've reached the end
        if (result.creations.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
        }
      }
      
      console.log(`[CreationGallery] Total creations loaded: ${allCreations.length}`);
      console.log('[CreationGallery] Creation IDs:', allCreations.map(c => c.id));
      console.log('[CreationGallery] Creation statuses:', allCreations.map(c => ({ id: c.id, status: c.status })));
      
      // Show all creations that have an original image
      const filteredCreations = allCreations.filter(creation => {
        // Only show if it has an original image (either in temp or permanent)
        const isTemp = creation.status !== 'completed';
        try {
          const originalUrl = api.getFileUrl(creation.id, 'original.jpg', isTemp);
          return !!originalUrl;
        } catch {
          return false;
        }
      });
      
      console.log(`[CreationGallery] Creations with original image: ${filteredCreations.length}`);
      
      setCreations(filteredCreations);
    } catch (err) {
      console.error('[CreationGallery] Failed to load creations:', err);
      setError('Failed to load creations');
    } finally {
      setIsLoading(false);
    }
  };

  const getImageUrl = (creation: CreationResponse, filename: 'original.jpg' | 'rendered.png'): string | null => {
    // Try to get image - check if creation is completed (permanent) or in progress (temp)
    const isTemp = creation.status !== 'completed';
    try {
      return api.getFileUrl(creation.id, filename, isTemp);
    } catch {
      return null;
    }
  };

  const getTimeRemaining = (creation: CreationResponse): string | null => {
    if (creation.status !== 'processing' || !creation.steps || creation.steps.length === 0) {
      return null;
    }
    
    // Find the current processing step
    const processingStep = creation.steps.find(step => step.status === 'processing');
    if (!processingStep || !processingStep.estimated_completion_time || !processingStep.started_at) {
      return null;
    }

    const now = new Date().getTime();
    const estimatedAt = processingStep.estimated_completion_time.endsWith('Z') || processingStep.estimated_completion_time.match(/[+-]\d{2}:\d{2}$/)
      ? processingStep.estimated_completion_time
      : processingStep.estimated_completion_time + 'Z';
    
    const estimated = new Date(estimatedAt).getTime();
    const remaining = estimated - now;

    if (remaining <= 0) {
      return 'Anytime now...';
    }

    const seconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes > 0) {
      return `~${minutes}m ${seconds % 60}s`;
    } else {
      return `~${seconds}s`;
    }
  };

  const getCurrentStepName = (creation: CreationResponse): string | null => {
    if (creation.status !== 'processing' || !creation.steps) {
      return null;
    }
    
    const processingStep = creation.steps.find(step => step.status === 'processing');
    if (!processingStep) {
      return null;
    }

    const stepNames: Record<string, string> = {
      image_processing: 'Processing Image',
      chatgpt_render: 'AI Rendering',
      meshy_3d: '3D Modeling',
      meshy_rig: 'Rigging',
      convert_vrm: 'VRM Conversion',
    };

    return stepNames[processingStep.step_name] || processingStep.step_name;
  };

  if (isLoading) {
    return (
      <div className="creation-gallery-loading">
        <div className="spinner"></div>
        <p>Loading creations...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="creation-gallery-error">
        <p>{error}</p>
        <button onClick={loadCreations}>Retry</button>
      </div>
    );
  }

  if (creations.length === 0) {
    return (
      <div className="creation-gallery-empty">
        <p>No creations found. Upload an image to get started!</p>
      </div>
    );
  }

  return (
    <div className="creation-gallery">
      <div className="creation-gallery-grid">
        {creations.map((creation) => {
          const originalUrl = getImageUrl(creation, 'original.jpg');
          const renderedUrl = getImageUrl(creation, 'rendered.png');
          const isCompleted = creation.status === 'completed';
          const hasBothImages = (originalUrl && renderedUrl) || false;
          const timeRemaining = getTimeRemaining(creation);
          const currentStep = getCurrentStepName(creation);
          const progress = !isCompleted ? calculateOverallProgress(creation) : null;
          
          return (
            <div
              key={creation.id}
              className="creation-gallery-item"
              onClick={() => onSelectCreation(creation)}
            >
              {originalUrl ? (
                <div className="creation-gallery-image-container">
                  {hasBothImages ? (
                    <>
                      <img
                        src={originalUrl}
                        alt={creation.character_name || 'Creation'}
                        className="creation-gallery-image creation-gallery-image-original"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <img
                        src={renderedUrl!}
                        alt={creation.character_name || 'Creation'}
                        className="creation-gallery-image creation-gallery-image-rendered"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </>
                  ) : (
                    <img
                      src={originalUrl}
                      alt={creation.character_name || 'Creation'}
                      className="creation-gallery-image"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <div className="creation-gallery-overlay">
                    <div className={`creation-gallery-overlay-bottom ${!isCompleted && progress !== null ? 'has-progress' : ''}`}>
                      <div className="creation-gallery-overlay-column creation-gallery-overlay-names">
                        {isCompleted && hasBothImages ? (
                          <div className="creation-gallery-name-container">
                            {(creation.name || creation.age) && (
                              <div className="creation-gallery-name creation-gallery-name-original">
                                {creation.name || ''}{creation.name && creation.age ? ', ' : ''}{creation.age ? String(creation.age) : ''}
                              </div>
                            )}
                            {creation.character_name && (
                              <div className="creation-gallery-name creation-gallery-name-rendered">
                                {creation.character_name}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="creation-gallery-name-single">
                            {creation.name && (
                              <div className="creation-gallery-name-line">
                                {creation.name}{creation.age ? `, ${creation.age}` : ''}
                              </div>
                            )}
                            {creation.character_name && (
                              <div className="creation-gallery-name-line">
                                {creation.character_name}
                              </div>
                            )}
                            {!creation.name && !creation.character_name && creation.age && (
                              <div className="creation-gallery-name-line">
                                {String(creation.age)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      
                      {!isCompleted && progress !== null && (
                        <div className="creation-gallery-overlay-column creation-gallery-overlay-progress">
                          <div className="creation-gallery-progress-bar">
                            <div 
                              className="creation-gallery-progress-fill"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      
                      <div className="creation-gallery-overlay-column creation-gallery-overlay-status">
                        {!isCompleted && (currentStep || timeRemaining) && (
                          <div className="creation-gallery-status-info">
                            {currentStep && (
                              <div className="creation-gallery-step-name">{currentStep}</div>
                            )}
                            {timeRemaining && (
                              <div className="creation-gallery-time">{timeRemaining}</div>
                            )}
                          </div>
                        )}
                        <div className={`creation-gallery-status creation-gallery-status-${creation.status}`}>
                          {creation.status === 'completed' && '✓'}
                          {creation.status === 'processing' && '⟳'}
                          {creation.status === 'failed' && '✗'}
                          {creation.status === 'pending' && '○'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="creation-gallery-placeholder">
                  <div className="creation-gallery-placeholder-icon">📷</div>
                  <div className={`creation-gallery-status creation-gallery-status-${creation.status}`}>
                    {creation.status === 'completed' && '✓'}
                    {creation.status === 'processing' && '⟳'}
                    {creation.status === 'failed' && '✗'}
                    {creation.status === 'pending' && '○'}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

