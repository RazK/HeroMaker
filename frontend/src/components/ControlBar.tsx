import { useState } from 'react';
import { CreationResponse, CreationStepResponse, api, ApiError } from '../api/client';
import type { RailStage } from './PipelineProgress';
import { getStepByName } from '../config/steps';
import './ControlBar.css';

interface ControlBarProps {
  creation: CreationResponse;
  /** The phase currently on the stage - what Redo and Download act on. */
  stage?: RailStage;
  creditBalance?: number;
  isLoggedIn: boolean;
  canDownload: boolean;  // Whether user can download (owns creation or is admin)
  onDelete?: () => void;
  onStepRun?: (stepName: string) => void;
  onCreationRefresh?: () => Promise<void>;
}

interface DownloadTarget {
  file: string;
  label: string;
  icon: string;
}

/**
 * What "Download" means depends on which phase is on the stage.
 *
 * One button, three meanings - the drawing, the render, or the finished VRM -
 * because a Studio that shows you one picture and offers you a different file
 * is a Studio you cannot trust. The label carries the real format of the file
 * on disk: the drawing is a JPEG, so it says JPEG.
 */
function downloadTarget(creation: CreationResponse, stage?: RailStage): DownloadTarget | null {
  if (!stage) return null;
  const done = (name: string) =>
    creation.steps.some((s) => s.step_name === name && s.status === 'completed');

  if (stage.key === 'drawing') {
    return done('image_processing') ? { file: 'processed.jpg', label: 'Download JPEG', icon: '✏️' } : null;
  }
  if (stage.key === 'render') {
    return done('openai_render') ? { file: 'rendered.png', label: 'Download PNG', icon: '🖼' } : null;
  }
  // The 3D phase hands over the VRM - the thing the whole pipeline exists to
  // produce. Before the conversion step has run there is still a model worth
  // having, so offer that rather than a dead button.
  if (done('convert_vrm')) return { file: 'avatar.vrm', label: 'Download VRM', icon: '🧊' };
  if (done('meshy_rig')) return { file: 'rigged.glb', label: 'Download GLB', icon: '🧊' };
  if (done('meshy_3d')) return { file: 'model.glb', label: 'Download GLB', icon: '🧊' };
  return null;
}

/**
 * The step the staged phase's primary button acts on.
 *
 * A phase can group two backend steps, and the one you want is whichever is in
 * the way: the failure, or the thing that has not run. When everything in the
 * phase is done, it is the last one - that is what Redo re-runs.
 */
function primaryStep(stage?: RailStage): CreationStepResponse | undefined {
  if (!stage) return undefined;
  return (
    stage.steps.find((s) => s.status === 'processing') ??
    stage.steps.find((s) => s.status === 'failed') ??
    stage.steps.find((s) => s.status === 'pending') ??
    stage.step
  );
}

export function ControlBar({ creation, stage, creditBalance, isLoggedIn, canDownload, onDelete, onStepRun, onCreationRefresh }: ControlBarProps) {
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Check if any step is currently processing
  const hasProcessingStep = creation.steps.some(s => s.status === 'processing');

  // Hide entire control bar if not logged in (all actions require auth)
  if (!isLoggedIn) {
    return null;
  }

  const target = downloadTarget(creation, stage);
  const step = primaryStep(stage);
  const stepCost = step ? getStepByName(step.step_name)?.credit_cost ?? 0 : 0;
  const hasCredits = creditBalance === undefined || stepCost <= creditBalance;

  const refresh = async () => {
    window.dispatchEvent(new CustomEvent('auth:credits-updated'));
    window.dispatchEvent(new CustomEvent('creation:refresh-now', { detail: { creationId: creation.id } }));
    if (onCreationRefresh) await onCreationRefresh();
    if (step && onStepRun) onStepRun(step.step_name);
  };

  const handleDownload = async () => {
    if (!target) return;
    try {
      await api.downloadFile(creation.id, target.file, creation.user_id);
    } catch (err) {
      console.error('Failed to download:', err);
      setError(`Failed to download ${target.file}`);
    }
  };

  /** Re-run one finished step, leaving everything after it alone. */
  const handleRedo = async () => {
    if (!step || isRunning) return;
    const name = getStepByName(step.step_name)?.display_name || step.step_name;
    if (!window.confirm(`Redo ${name}? This overwrites the current output.`)) return;
    setIsRunning(true);
    setError(null);
    try {
      await api.runStep(creation.id, step.step_name);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to re-run step');
    } finally {
      setIsRunning(false);
    }
  };

  /**
   * Run the staged phase and everything after it.
   *
   * This is both "retry the step that failed" and "carry on from where the
   * pipeline stopped" - they were two buttons that did almost the same thing,
   * and the second one was only ever reachable when the first one was.
   */
  const handleRunFrom = async () => {
    if (!step || isRunning) return;
    setIsRunning(true);
    setError(null);
    try {
      await api.runPipeline(creation.id, step.step_name);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to run pipeline');
    } finally {
      setIsRunning(false);
    }
  };

  const handleCancel = async () => {
    if (!step || isCancelling) return;
    const name = getStepByName(step.step_name)?.display_name || step.step_name;
    if (!window.confirm(`Cancel ${name}?`)) return;
    setIsCancelling(true);
    setError(null);
    try {
      await api.cancelStep(creation.id, step.step_name);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel step');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleRestart = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setError(null);
    try {
      await api.runPipeline(creation.id);
      window.dispatchEvent(new CustomEvent('creation:refresh-now', { detail: { creationId: creation.id } }));
      setShowRestartConfirm(false);
      if (onCreationRefresh) await onCreationRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to restart pipeline');
    } finally {
      setIsRunning(false);
    }
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    setError(null);
    try {
      await api.deleteCreation(creation.id);
      setShowDeleteConfirm(false);
      if (onDelete) onDelete();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete creation');
    } finally {
      setIsDeleting(false);
    }
  };

  /**
   * The first button always stands for "do something about the phase on the
   * stage", so its slot never moves even though its meaning does.
   */
  const renderPhaseButton = () => {
    if (!step) return <span className="control-bar-button is-empty" aria-hidden="true" />;

    if (step.status === 'processing') {
      return (
        <button
          className="control-bar-button control-bar-cancel"
          onClick={handleCancel}
          disabled={isCancelling}
          title={`Cancel ${stage?.label ?? 'this phase'}`}
        >
          <span className="control-bar-button-icon" aria-hidden="true">✕</span>
          <span className="control-bar-button-label">{isCancelling ? 'Cancelling…' : 'Cancel'}</span>
        </button>
      );
    }

    if (step.status === 'completed') {
      return (
        <button
          className="control-bar-button control-bar-redo"
          onClick={handleRedo}
          disabled={isRunning || isDeleting || hasProcessingStep || !hasCredits || !canDownload}
          title={
            !canDownload ? 'Only the owner can re-run a phase'
            : !hasCredits ? `Insufficient credits. Need ${stepCost}, have ${creditBalance}`
            : `Re-run ${stage?.label ?? 'this phase'} (overwrites the current output)`
          }
        >
          <span className="control-bar-button-icon" aria-hidden="true">↻</span>
          <span className="control-bar-button-label">{isRunning ? 'Running…' : 'Redo'}</span>
          {stepCost > 0 && <span className="control-bar-button-cost">🪙 {stepCost}</span>}
        </button>
      );
    }

    // Pending or failed: run this phase and everything after it.
    return (
      <button
        className="control-bar-button control-bar-run"
        onClick={handleRunFrom}
        disabled={isRunning || isDeleting || hasProcessingStep || !hasCredits || !canDownload}
        title={
          !canDownload ? 'Only the owner can run a phase'
          : !hasCredits ? `Insufficient credits. Need ${stepCost}, have ${creditBalance}`
          : `Run ${stage?.label ?? 'this phase'} and everything after it`
        }
      >
        <span className="control-bar-button-icon" aria-hidden="true">▶</span>
        <span className="control-bar-button-label">
          {isRunning ? 'Running…' : step.status === 'failed' ? 'Retry' : 'Run'}
        </span>
        {stepCost > 0 && <span className="control-bar-button-cost">🪙 {stepCost}</span>}
      </button>
    );
  };

  return (
    <div className="control-bar">
      <div className="control-bar-actions">
        {renderPhaseButton()}

        <button
          className="control-bar-button control-bar-restart"
          onClick={() => setShowRestartConfirm(true)}
          disabled={isRunning || isDeleting || hasProcessingStep || !canDownload}
          title="Restart the whole pipeline from the beginning"
        >
          <span className="control-bar-button-icon" aria-hidden="true">⟳</span>
          <span className="control-bar-button-label">Restart</span>
        </button>

        <button
          className="control-bar-button control-bar-delete"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={isRunning || isDeleting || !canDownload}
          title="Delete this creation"
        >
          <span className="control-bar-button-icon" aria-hidden="true">🗑</span>
          <span className="control-bar-button-label">Delete</span>
        </button>

        <button
          className="control-bar-button control-bar-download"
          onClick={handleDownload}
          disabled={!target || !canDownload}
          title={
            !canDownload ? 'Only the owner can download this creation'
            : target ? `Download ${target.file}`
            : `${stage?.label ?? 'This phase'} has not produced a file yet`
          }
        >
          <span className="control-bar-button-icon" aria-hidden="true">{target?.icon ?? '⬇'}</span>
          <span className="control-bar-button-label">{target?.label ?? 'Download'}</span>
        </button>
      </div>

      {/* Errors float over the panel: it is sized to the buttons, and a line
          that pushed them would push the squares off the screen. */}
      {error && (
        <div className="control-bar-error" role="alert">
          <span>{error}</span>
          <button className="control-bar-error-dismiss" onClick={() => setError(null)}>×</button>
        </div>
      )}

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
