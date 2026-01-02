import { useState, useEffect } from 'react';
import { CreationStepResponse } from '../api/client';
import { ImagePreview } from './ImagePreview';
import { ModelPreview } from './ModelPreview';
import { api } from '../api/client';
import { RetryModal } from './RetryModal';
import './StepCard.css';

interface StepCardProps {
  step: CreationStepResponse;
  creationId: string;
  userId: string;
  stepIndex: number;
  onStepRetry?: (stepName: string) => void;
}

const STEP_DISPLAY_NAMES: Record<string, string> = {
  image_processing: 'Image Processing',
  openai_render: 'AI Rendering',
  meshy_3d: '3D Modeling',
  meshy_rig: 'Rigging & Animating',
  convert_vrm: 'VRM Conversion',
  complete: 'Finalization',
};

const STEP_OUTPUT_FILES: Record<string, string> = {
  image_processing: 'processed.jpg',
  openai_render: 'rendered.png',
  meshy_3d: 'model.glb',
  meshy_rig: 'rigged.glb',
  convert_vrm: 'avatar.vrm',
};

/**
 * Parse a date string, handling timezone issues.
 * If the date string doesn't have timezone info (no Z or +/- offset),
 * we assume it's UTC and append 'Z' to force UTC interpretation.
 */
function parseDate(dateStr: string): number {
  // If the string doesn't end with Z or +/- timezone, it's naive and we should treat it as UTC
  if (typeof dateStr === 'string' && !dateStr.endsWith('Z') && !dateStr.match(/[+-]\d{2}:\d{2}$/)) {
    // Naive datetime - append Z to force UTC interpretation
    return new Date(dateStr + 'Z').getTime();
  }
  return new Date(dateStr).getTime();
}

function getStepProgress(step: CreationStepResponse): number | null {
  if (step.status === 'completed') {
    console.log(`[StepCard] ${step.step_name}: completed, progress = 100%`);
    return 100;
  }
  if (step.status !== 'processing') {
    console.log(`[StepCard] ${step.step_name}: status = ${step.status}, progress = 0%`);
    return 0;
  }

  if (step.estimated_completion_time && step.started_at) {
    // Log raw strings to debug timezone issues
    console.log(`[StepCard] ${step.step_name}: raw date strings`, {
      started_at_raw: step.started_at,
      estimated_completion_time_raw: step.estimated_completion_time,
      started_at_type: typeof step.started_at,
      estimated_completion_time_type: typeof step.estimated_completion_time,
    });

    const now = new Date().getTime();
    const started = parseDate(step.started_at);
    const estimated = parseDate(step.estimated_completion_time);
    const total = estimated - started;
    const elapsed = now - started;
    const remaining = estimated - now;

    // Log parsed dates to check timezone handling
    console.log(`[StepCard] ${step.step_name}: parsed dates`, {
      now_iso: new Date(now).toISOString(),
      now_local: new Date(now).toString(),
      started_iso: new Date(started).toISOString(),
      started_local: new Date(started).toString(),
      estimated_iso: new Date(estimated).toISOString(),
      estimated_local: new Date(estimated).toString(),
      timezone_offset: new Date().getTimezoneOffset(),
    });

    // Check if estimate is stale (more than 2x the original estimate has passed)
    const isStale = remaining < 0 && elapsed > total * 2;

    if (isStale) {
      console.log(`[StepCard] ${step.step_name}: estimate is stale`, {
        started: new Date(started).toISOString(),
        estimated: new Date(estimated).toISOString(),
        now: new Date(now).toISOString(),
        elapsed: `${(elapsed / 1000).toFixed(1)}s`,
        originalEstimate: `${(total / 1000).toFixed(1)}s`,
        overBy: `${((elapsed - total) / 1000).toFixed(1)}s`,
      });
      return null; // Indeterminate - estimate is stale
    }

    if (total > 0 && elapsed >= 0) {
      const progress = (elapsed / total) * 100;
      const cappedProgress = Math.min(Math.max(progress, 0), 99);
      console.log(`[StepCard] ${step.step_name}: progress calc`, {
        started: new Date(started).toISOString(),
        estimated: new Date(estimated).toISOString(),
        now: new Date(now).toISOString(),
        elapsed: `${(elapsed / 1000).toFixed(1)}s`,
        total: `${(total / 1000).toFixed(1)}s`,
        progress: `${progress.toFixed(1)}%`,
        capped: `${cappedProgress.toFixed(1)}%`,
      });
      return cappedProgress;
    } else {
      console.warn(`[StepCard] ${step.step_name}: invalid time values`, { total, elapsed });
    }
  } else {
    console.log(`[StepCard] ${step.step_name}: missing time estimates`, {
      hasEstimated: !!step.estimated_completion_time,
      hasStarted: !!step.started_at,
    });
  }

  return null; // Indeterminate
}

function getTimeRemaining(step: CreationStepResponse): string | null {
  if (step.status !== 'processing' || !step.estimated_completion_time || !step.started_at) {
    return null;
  }

  const now = new Date().getTime();
  const started = parseDate(step.started_at);
  const estimated = parseDate(step.estimated_completion_time);
  const total = estimated - started;
  const elapsed = now - started;
  const remaining = estimated - now;

  // Check if estimate is stale (more than 2x the original estimate has passed)
  const isStale = remaining < 0 && elapsed > total * 2;

  if (isStale) {
    console.log(`[StepCard] ${step.step_name}: estimate is stale, showing "Taking longer than expected..."`, {
      elapsed: `${(elapsed / 1000).toFixed(1)}s`,
      originalEstimate: `${(total / 1000).toFixed(1)}s`,
      overBy: `${((elapsed - total) / 1000).toFixed(1)}s`,
    });
    return 'Taking longer than expected...';
  }

  // If time has passed but step not completed (and not stale), show "anytime now"
  if (remaining <= 0) {
    console.log(`[StepCard] ${step.step_name}: time remaining <= 0, showing "Anytime now..."`, {
      remaining: `${(remaining / 1000).toFixed(1)}s`,
    });
    return 'Anytime now...';
  }

  if (remaining < 1000) {
    console.log(`[StepCard] ${step.step_name}: time remaining < 1s, showing "Almost done..."`);
    return 'Almost done...';
  }

  const seconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  let timeStr: string;
  if (hours > 0) {
    timeStr = `~${hours}h ${minutes % 60}m remaining`;
  } else if (minutes > 0) {
    timeStr = `~${minutes}m ${seconds % 60}s remaining`;
  } else {
    timeStr = `~${seconds}s remaining`;
  }

  // Log every 10 seconds to avoid spam
  if (seconds % 10 === 0) {
    console.log(`[StepCard] ${step.step_name}: time remaining = ${timeStr}`, {
      remaining: `${(remaining / 1000).toFixed(1)}s`,
    });
  }

  return timeStr;
}

/**
 * Generate a KalidoFace3D shareable link for a VRM file
 */
function getKalidoFace3DShareLink(vrmFileUrl: string): string {
  // KalidoFace3D supports loading VRM files via URL parameter
  // Format: https://3d.kalidoface.com/?vrm=<URL_TO_VRM_FILE>
  const encodedVrmUrl = encodeURIComponent(vrmFileUrl);
  return `https://3d.kalidoface.com/?vrm=${encodedVrmUrl}`;
}

/**
 * Copy text to clipboard and show a brief notification
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
}

export function StepCard({ step, creationId, userId, stepIndex, onStepRetry }: StepCardProps) {
  // Force re-render every second for live time updates
  const [, setTick] = useState(0);
  const [shareCopied, setShareCopied] = useState(false);
  const [showRetryModal, setShowRetryModal] = useState(false);
  const [isHoveringStatus, setIsHoveringStatus] = useState(false);
  const [isHoveringNumber, setIsHoveringNumber] = useState(false);

  useEffect(() => {
    if (step.status === 'processing') {
      console.log(`[StepCard] ${step.step_name}: starting live update interval`);
      // Update every second for smooth countdown
      const interval = setInterval(() => {
        setTick(t => t + 1);
      }, 1000);
      return () => {
        console.log(`[StepCard] ${step.step_name}: stopping live update interval`);
        clearInterval(interval);
      };
    }
  }, [step.status, step.step_name]);

  const progress = getStepProgress(step);
  const timeRemaining = getTimeRemaining(step);
  const displayName = STEP_DISPLAY_NAMES[step.step_name] || step.step_name;
  const outputFile = STEP_OUTPUT_FILES[step.step_name];
  const isImageStep = outputFile && (outputFile.endsWith('.jpg') || outputFile.endsWith('.png'));
  const isModelStep = outputFile && outputFile.endsWith('.glb');
  const isVrmStep = outputFile && outputFile.endsWith('.vrm');
  // Only show preview for completed steps (file exists)
  const showPreview = step.status === 'completed' && outputFile;
  
  // For rigging step, check if walking.glb exists in metadata
  const walkingGlbFilename = (step.step_name === 'meshy_rig' && step.metadata_json?.walking_glb_url) 
    ? step.metadata_json.walking_glb_url 
    : null;
  
  // Use walking.glb if available, otherwise use outputFile (rigged.glb)
  const modelFile = (step.step_name === 'meshy_rig' && walkingGlbFilename) 
    ? walkingGlbFilename 
    : outputFile;
  
  const fileUrl = showPreview
    ? api.getFileUrl(creationId, modelFile, userId)
    : null;
  
  // For rigging step, provide both URLs for toggle
  const walkingUrl = (step.step_name === 'meshy_rig' && showPreview && walkingGlbFilename)
    ? api.getFileUrl(creationId, walkingGlbFilename, userId)
    : null;
  
  const riggedUrl = (step.step_name === 'meshy_rig' && showPreview && outputFile)
    ? api.getFileUrl(creationId, outputFile, userId)
    : null;

  const handleDownload = async () => {
    if (!outputFile) return;
    
    // For rigged step, download avatar.vrm instead of rigged.glb
    const fileToDownload = step.step_name === 'meshy_rig' ? 'avatar.vrm' : outputFile;
    
    try {
      await api.downloadFile(creationId, fileToDownload, userId);
    } catch (error) {
      console.error('Failed to download file:', error);
      alert(`Failed to download ${fileToDownload}`);
    }
  };

  const handleShareVrm = async () => {
    if (!fileUrl) return;
    
    const shareLink = getKalidoFace3DShareLink(fileUrl);
    const success = await copyToClipboard(shareLink);
    
    if (success) {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } else {
      // Fallback: open in new window if clipboard fails
      window.open(shareLink, '_blank');
    }
  };

  const handleRetry = async (retryAllFollowing: boolean) => {
    try {
      // Use pipeline endpoint with step name and retry flag
      await api.runPipeline(creationId, step.step_name, retryAllFollowing);
      
      // Immediately update UI to show processing state
      if (onStepRetry) {
        onStepRetry(step.step_name);
      }
      
      // Close modal after successful retry
      setShowRetryModal(false);
    } catch (error) {
      console.error('Failed to retry step:', error);
      alert(`Failed to retry step: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleStatusClick = () => {
    if (step.status !== 'processing') {
      // Show retry modal for non-processing steps
      setShowRetryModal(true);
    }
  };

  return (
    <div className={`step-card step-card-${step.status}`}>
      <div className="step-card-header">
        <div
          className="step-card-number-wrapper"
          onMouseEnter={() => setIsHoveringNumber(true)}
          onMouseLeave={() => setIsHoveringNumber(false)}
        >
          {isHoveringNumber && step.status !== 'processing' ? (
            <button
              className="step-card-number step-card-number-retry"
              onClick={handleStatusClick}
              title="Retry this step"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            </button>
          ) : (
            <div className="step-card-number">{stepIndex + 1}</div>
          )}
        </div>
        <div className="step-card-info">
          <h3 className="step-card-name">{displayName}</h3>
        </div>
        {step.status === 'completed' && outputFile ? (
          <button
            className={`step-card-status step-card-status-${step.status} step-card-status-download`}
            onClick={handleDownload}
            title={`Download ${outputFile}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        ) : (
          <div
            className="step-card-status-wrapper"
            onMouseEnter={() => setIsHoveringStatus(true)}
            onMouseLeave={() => setIsHoveringStatus(false)}
          >
            {isHoveringStatus && step.status === 'failed' ? (
              <button
                className={`step-card-status step-card-status-${step.status} step-card-status-retry`}
                onClick={handleStatusClick}
                title="Retry this step"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M3 21v-5h5" />
                </svg>
              </button>
            ) : (
              <div className={`step-card-status step-card-status-${step.status}`}>
                {step.status === 'processing' && '⟳'}
                {step.status === 'failed' && '✗'}
                {step.status === 'pending' && '○'}
                {step.status === 'completed' && '✓'}
              </div>
            )}
          </div>
        )}
      </div>

      {step.status === 'processing' && (
        <div className="step-card-progress">
          <div className="step-card-progress-bar">
            {progress !== null ? (
              <div
                className="step-card-progress-fill"
                style={{ width: `${progress}%` }}
              />
            ) : (
              <div className="step-card-progress-fill step-card-progress-indeterminate" />
            )}
          </div>
          {progress !== null && progress > 0 && (
            <div className="step-card-progress-text">{Math.round(progress)}%</div>
          )}
        </div>
      )}

      {step.status === 'failed' && step.error_message && (
        <div className="step-card-error">
          <strong>Error</strong> {step.error_message}
        </div>
      )}

      <RetryModal
        stepName={displayName}
        isOpen={showRetryModal}
        onClose={() => setShowRetryModal(false)}
        onRetry={handleRetry}
      />

      {showPreview && fileUrl ? (
        <div className="step-card-preview">
          {isImageStep && <ImagePreview src={fileUrl} alt={displayName} />}
          {isModelStep && (
            <ModelPreview 
              url={fileUrl} 
              isRigged={step.step_name === 'meshy_rig'} 
              walkingUrl={walkingUrl}
              riggedUrl={riggedUrl}
            />
          )}
        </div>
      ) : (
        timeRemaining && (() => {
          // Split time string to separate the time from "remaining"
          const timeMatch = timeRemaining.match(/^(~?)(.+?)\s+(remaining)$/);
          const timeValue = timeMatch ? timeMatch[1] + timeMatch[2] : timeRemaining;
          const remainingText = timeMatch ? timeMatch[3] : '';
          
          return (
            <div className="step-card-preview step-card-time-placeholder">
              <div className="step-card-time-container">
                <div className="step-card-time-large">{timeValue}</div>
                {remainingText && <div className="step-card-time-label">{remainingText}</div>}
              </div>
            </div>
          );
        })()
      )}

      {isVrmStep && step.status === 'completed' && fileUrl && (
        <div className="step-card-share">
          <button
            className="step-card-share-button"
            onClick={handleShareVrm}
            title="Share VRM file in KalidoFace3D viewer"
          >
            {shareCopied ? (
              <>
                <span className="step-card-share-icon">✓</span>
                <span>Link Copied!</span>
              </>
            ) : (
              <>
                <span className="step-card-share-icon">🔗</span>
                <span>Share in KalidoFace3D</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}






