import { useState } from 'react';
import { CreationResponse, api, ApiError } from '../api/client';
import './ControlBar.css';

interface ControlBarProps {
  creation: CreationResponse;
  isLoggedIn: boolean;
  canDownload: boolean;  // Whether user can download (owns creation or is admin)
  onDelete?: () => void;
  onCreationRefresh?: () => Promise<void>;
}

export function ControlBar({ creation, isLoggedIn, canDownload, onDelete, onCreationRefresh }: ControlBarProps) {
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // Check if VRM is ready
  const vrmStep = creation.steps.find(s => s.step_name === 'convert_vrm');
  const isVrmReady = vrmStep?.status === 'completed';

  // Check if any step is currently processing
  const hasProcessingStep = creation.steps.some(s => s.status === 'processing');

  // Get steps that need to run (pending or failed)
  const stepsToRun = creation.steps.filter(s => 
    s.status === 'pending' || s.status === 'failed'
  );
  const hasStepsToRun = stepsToRun.length > 0;

  // Hide entire control bar if not logged in (all actions require auth)
  if (!isLoggedIn) {
    return null;
  }

  const handleDownloadVrm = async () => {
    try {
      await api.downloadFile(creation.id, 'avatar.vrm', creation.user_id);
    } catch (err) {
      console.error('Failed to download VRM:', err);
      setError('Failed to download VRM file');
    }
  };

  const handleContinue = async () => {
    if (!isLoggedIn || isRunning || hasProcessingStep) return;
    
    setIsRunning(true);
    setError(null);
    
    try {
      // Run only pending/failed steps
      for (const step of stepsToRun) {
        await api.runStep(creation.id, step.step_name);
        window.dispatchEvent(new CustomEvent('creation:refresh-now', { detail: { creationId: creation.id } }));
      }
      if (onCreationRefresh) {
        await onCreationRefresh();
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to continue pipeline';
      setError(message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleRestart = async () => {
    if (!isLoggedIn || isRunning) return;
    
    setIsRunning(true);
    setError(null);
    
    try {
      // Run full pipeline from the start
      await api.runPipeline(creation.id);
      window.dispatchEvent(new CustomEvent('creation:refresh-now', { detail: { creationId: creation.id } }));
      setShowRestartConfirm(false);
      if (onCreationRefresh) {
        await onCreationRefresh();
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to restart pipeline';
      setError(message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleDelete = async () => {
    if (!isLoggedIn || isDeleting) return;
    
    setIsDeleting(true);
    setError(null);
    
    try {
      await api.deleteCreation(creation.id);
      setShowDeleteConfirm(false);
      if (onDelete) {
        onDelete();
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete creation';
      setError(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const dismissError = () => setError(null);

  return (
    <div className="control-bar">
      <div className="control-bar-content">
        {/* Error message */}
        {error && (
          <div className="control-bar-error">
            <span>{error}</span>
            <button className="control-bar-error-dismiss" onClick={dismissError}>×</button>
          </div>
        )}

        {/* Success message when VRM ready */}
        {isVrmReady && !error && (
          <div className="control-bar-success">
            <span className="control-bar-success-icon">🎉</span>
            <span>Your hero is ready!</span>
          </div>
        )}

        {/* Action buttons - only show when logged in */}
        {isLoggedIn && (
          <div className="control-bar-actions">
            {/* Continue button - only show if there are steps to run and nothing processing */}
            {hasStepsToRun && !hasProcessingStep && (
              <button
                className="control-bar-button control-bar-continue"
                onClick={handleContinue}
                disabled={isRunning || isDeleting}
                title="Run remaining steps"
              >
                <span className="control-bar-button-icon">▶</span>
                <span>Continue</span>
              </button>
            )}

            {/* Restart button */}
            <button
              className="control-bar-button control-bar-restart"
              onClick={() => setShowRestartConfirm(true)}
              disabled={isRunning || isDeleting || hasProcessingStep}
              title="Restart pipeline from beginning"
            >
              <span className="control-bar-button-icon">↻</span>
              <span>Restart</span>
            </button>

            {/* Delete button */}
            <button
              className="control-bar-button control-bar-delete"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isRunning || isDeleting}
              title="Delete creation"
            >
              <span className="control-bar-button-icon">🗑</span>
              <span>Delete</span>
            </button>
          </div>
        )}

        {/* Download VRM button - show when ready and user owns creation (or is admin) */}
        {isVrmReady && canDownload && (
          <button
            className="control-bar-button control-bar-download"
            onClick={handleDownloadVrm}
            title="Download VRM avatar"
          >
            <span className="control-bar-button-icon">⬇</span>
            <span>Download VRM</span>
          </button>
        )}
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="control-bar-modal-overlay">
          <div className="control-bar-modal">
            <h3>Delete Creation?</h3>
            <p>This will permanently delete this creation and all its files. This action cannot be undone.</p>
            <div className="control-bar-modal-buttons">
              <button
                className="control-bar-modal-cancel"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                className="control-bar-modal-confirm control-bar-modal-delete"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restart confirmation modal */}
      {showRestartConfirm && (
        <div className="control-bar-modal-overlay">
          <div className="control-bar-modal">
            <h3>Restart Pipeline?</h3>
            <p>This will re-run all steps from the beginning. Previously completed steps will be overwritten.</p>
            <div className="control-bar-modal-buttons">
              <button
                className="control-bar-modal-cancel"
                onClick={() => setShowRestartConfirm(false)}
                disabled={isRunning}
              >
                Cancel
              </button>
              <button
                className="control-bar-modal-confirm control-bar-modal-restart"
                onClick={handleRestart}
                disabled={isRunning}
              >
                {isRunning ? 'Restarting...' : 'Restart'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
