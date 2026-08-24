import { useState, useEffect } from 'react';
import { CreationStepResponse } from '../api/client';
import { ImagePreview } from './ImagePreview';
import { LazyModelPreview as ModelPreview } from './LazyModelPreview';
import { api } from '../api/client';
import './StepCard.css';

interface StepCardProps {
  step: CreationStepResponse;
  creationId: string;
  userId: string;
  stepIndex: number;
  isReady: boolean;  // Calculated by parent: first non-completed step
  displayName: string;  // From step config
  outputFile?: string;  // From step config
  stepCost: number;  // From step config
  creditBalance?: number;
  isLoggedIn: boolean;  // Whether user is logged in
  canDownload: boolean;  // Whether user can download (owns creation or is admin)
  onStepRun?: (stepName: string) => void;
  onCreationRefresh?: () => Promise<void>;  // Called to refresh creation state after step starts
  onPreviewClick?: () => void;  // Called when 3D model is clicked to open modal
}

function parseDate(dateStr: string): number {
  if (typeof dateStr === 'string' && !dateStr.endsWith('Z') && !dateStr.match(/[+-]\d{2}:\d{2}$/)) {
    return new Date(dateStr + 'Z').getTime();
  }
  return new Date(dateStr).getTime();
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

  const isStale = remaining < 0 && elapsed > total * 2;

  if (isStale) {
    return 'Taking longer than expected...';
  }

  if (remaining <= 0) {
    return 'Anytime now...';
  }

  if (remaining < 1000) {
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

  return timeStr;
}

function getKalidoFace3DShareLink(vrmFileUrl: string): string {
  const encodedVrmUrl = encodeURIComponent(vrmFileUrl);
  return `https://3d.kalidoface.com/?vrm=${encodedVrmUrl}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
}

/** "Tap" reads wrong with a mouse and "Click" reads wrong on a phone. */
const POINTER_VERB =
  typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches ? 'Tap' : 'Click';

export function StepCard({ 
  step, 
  creationId, 
  userId, 
  stepIndex, 
  isReady,
  displayName,
  outputFile,
  stepCost,
  creditBalance,
  isLoggedIn: _isLoggedIn,
  canDownload,
  onStepRun,
  onCreationRefresh,
  onPreviewClick,
}: StepCardProps) {
  const [, setTick] = useState(0);
  const [shareCopied, setShareCopied] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Force re-render every second for live time updates
  useEffect(() => {
    if (step.status === 'processing') {
      const interval = setInterval(() => {
        setTick(t => t + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [step.status, step.step_name]);

  const timeRemaining = getTimeRemaining(step);
  const isImageStep = outputFile && (outputFile.endsWith('.jpg') || outputFile.endsWith('.png'));
  const isModelStep = outputFile && outputFile.endsWith('.glb');
  const isVrmStep = outputFile && outputFile.endsWith('.vrm');
  const showPreview = step.status === 'completed' && outputFile;
  
  const walkingGlbFilename = (step.step_name === 'meshy_rig' && step.metadata_json?.walking_glb_url) 
    ? step.metadata_json.walking_glb_url 
    : null;
  
  const modelFile = (step.step_name === 'meshy_rig' && walkingGlbFilename) 
    ? walkingGlbFilename 
    : outputFile;
  
  const fileUrl = showPreview && modelFile
    ? api.getFileUrl(creationId, modelFile, userId)
    : null;
  
  const walkingUrl = (step.step_name === 'meshy_rig' && showPreview && walkingGlbFilename)
    ? api.getFileUrl(creationId, walkingGlbFilename, userId)
    : null;
  
  const riggedUrl = (step.step_name === 'meshy_rig' && showPreview && outputFile)
    ? api.getFileUrl(creationId, outputFile, userId)
    : null;

  const handleDownload = async () => {
    if (!outputFile) return;
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
      window.open(shareLink, '_blank');
    }
  };

  const handleCancel = async () => {
    if (step.status === 'failed' && step.error_message === 'Step cancelled by user') {
      return;
    }
    
    if (isCancelling) return;
    
    if (!window.confirm(`Are you sure you want to cancel ${displayName}?`)) return;
    
    setIsCancelling(true);
    try {
      await api.cancelStep(creationId, step.step_name);
      window.dispatchEvent(new CustomEvent('auth:credits-updated'));
      window.dispatchEvent(new CustomEvent('creation:refresh-now', { detail: { creationId } }));
      if (onStepRun) {
        onStepRun(step.step_name);
      }
    } catch (error) {
      alert(`Failed to cancel step: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleRunStep = async () => {
    setIsRunning(true);
    
    try {
      await api.runStep(creationId, step.step_name);
      window.dispatchEvent(new CustomEvent('auth:credits-updated'));
      
      // Directly refresh creation state (handles case when polling was stopped)
      if (onCreationRefresh) {
        await onCreationRefresh();
      }
      // Also dispatch event for any other listeners
      window.dispatchEvent(new CustomEvent('creation:refresh-now', { detail: { creationId } }));
      
      if (onStepRun) {
        onStepRun(step.step_name);
      }
    } catch (error) {
      alert(`Failed to run step: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleRetryAndContinue = async () => {
    setIsRunning(true);
    
    try {
      // Run pipeline starting from this step (retry and continue all following)
      await api.runPipeline(creationId, step.step_name);
      window.dispatchEvent(new CustomEvent('auth:credits-updated'));
      
      if (onCreationRefresh) {
        await onCreationRefresh();
      }
      window.dispatchEvent(new CustomEvent('creation:refresh-now', { detail: { creationId } }));
      
      if (onStepRun) {
        onStepRun(step.step_name);
      }
    } catch (error) {
      alert(`Failed to retry pipeline: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRunning(false);
    }
  };

  // Render action button based on status
  const renderActionButton = () => {
    const isCancelled = step.status === 'failed' && step.error_message === 'Step cancelled by user';
    
    // Processing: show Cancel button
    if (step.status === 'processing') {
      return (
        <button
          className="step-card-action-button step-card-action-cancel"
          onClick={handleCancel}
          disabled={isCancelling || isCancelled}
          title={isCancelling ? "Cancelling..." : "Cancel this step"}
        >
          {isCancelling ? 'Cancelling...' : 'Cancel'}
        </button>
      );
    }

    // Completed: show Download and Re-run buttons (only for owners/admins)
    if (step.status === 'completed') {
      if (!canDownload) {
        return null; // Only owners or admins can download/redo
      }
      const hasCredits = creditBalance === undefined || stepCost <= creditBalance;
      return (
        <div className="step-card-completed-buttons">
        <button
          className="step-card-action-button step-card-action-download"
          onClick={handleDownload}
          title={`Download ${outputFile}`}
        >
          Download
        </button>
          <button
            className="step-card-action-button step-card-action-run"
            onClick={() => {
              if (window.confirm(`Re-run ${displayName}? This will overwrite the current output.`)) {
                handleRunStep();
              }
            }}
            disabled={isRunning || !hasCredits}
            title={
              isRunning
                ? 'Running...'
                : !hasCredits
                  ? `Insufficient credits. Need ${stepCost}, have ${creditBalance}`
                  : `Re-run this step (overwrites current output)`
            }
          >
            {isRunning ? 'Running...' : (
              <>
                Redo
                <span className="step-card-action-cost">🪙 {stepCost}</span>
              </>
            )}
          </button>
        </div>
      );
    }

    // Failed: show Retry buttons
    if (step.status === 'failed') {
      const hasCredits = creditBalance === undefined || stepCost <= creditBalance;
      return (
        <div className="step-card-retry-buttons">
          <button
            className="step-card-action-button step-card-action-run"
            onClick={handleRunStep}
            disabled={isRunning || !hasCredits}
            title={
              isRunning
                ? `${displayName} is running...`
                : !hasCredits
                  ? `Insufficient credits. Need ${stepCost}, have ${creditBalance}`
                  : `Retry only this step`
            }
          >
            {isRunning ? 'Running...' : (
              <>
                Retry
                <span className="step-card-action-cost">🪙 {stepCost}</span>
              </>
            )}
          </button>
          <button
            className="step-card-action-button step-card-action-continue"
            onClick={handleRetryAndContinue}
            disabled={isRunning || !hasCredits}
            title={
              isRunning
                ? 'Pipeline is running...'
                : !hasCredits
                  ? `Insufficient credits`
                  : `Retry this step and continue pipeline`
            }
          >
            {isRunning ? '...' : 'Continue'}
          </button>
        </div>
      );
    }

    // Pending + Ready: show Run button
    if (step.status === 'pending' && isReady) {
      const hasCredits = creditBalance === undefined || stepCost <= creditBalance;
      return (
        <button
          className="step-card-action-button step-card-action-run"
          onClick={handleRunStep}
          disabled={isRunning || !hasCredits}
          title={
            isRunning
              ? `${displayName} is running...`
              : !hasCredits
                ? `Insufficient credits. Need ${stepCost}, have ${creditBalance}`
                : `Run ${displayName}`
          }
        >
          {isRunning ? 'Running...' : (
            <>
              Run
              <span className="step-card-action-cost">🪙 {stepCost}</span>
            </>
          )}
        </button>
      );
    }

    // Pending but not ready: no button
    return null;
  };

  return (
    <div className={`step-card step-card-${step.status}${isReady && step.status === 'pending' ? ' step-card-ready' : ''}`}>
      {/* Header */}
      <div className="step-card-header">
        <div className="step-card-number">{stepIndex + 1}</div>
        <div className="step-card-name-cost">
          <h3 className="step-card-name">{displayName}</h3>
        </div>
        {renderActionButton()}
      </div>

      {/* Body */}
      <div className="step-card-body">
        {step.status === 'processing' && timeRemaining && (() => {
          const timeMatch = timeRemaining.match(/^(~?)(.+?)\s+(remaining)$/);
          const timeValue = timeMatch ? timeMatch[1] + timeMatch[2] : timeRemaining;
          const remainingText = timeMatch ? timeMatch[3] : '';
          
          return (
            <div className="step-card-countdown">
              <div className="step-card-countdown-container">
                <div className="step-card-countdown-large">{timeValue}</div>
                {remainingText && <div className="step-card-countdown-label">{remainingText}</div>}
              </div>
            </div>
          );
        })()}

        {step.status === 'failed' && step.error_message && (
          <div className="step-card-error">
            <strong>Error:</strong> {step.error_message}
          </div>
        )}

        {step.status === 'completed' && showPreview && fileUrl && (
          <div className="step-card-preview">
            {isImageStep && <ImagePreview src={fileUrl} alt={displayName} />}
            {isModelStep && (
              <div 
                className="step-card-model-clickable"
                onClick={onPreviewClick}
                title={`${POINTER_VERB} to interact with 3D model`}
              >
                <ModelPreview 
                  url={fileUrl} 
                  isRigged={step.step_name === 'meshy_rig'} 
                  walkingUrl={walkingUrl}
                  riggedUrl={riggedUrl}
                  interactive={false}
                />
                <div className="step-card-model-hint">{POINTER_VERB} to interact</div>
              </div>
            )}
          </div>
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
    </div>
  );
}
