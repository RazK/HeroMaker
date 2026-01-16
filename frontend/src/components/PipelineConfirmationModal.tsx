import { useState, useEffect } from 'react';
import { api } from '../api/client';
import './PipelineConfirmationModal.css';

type PipelineMode = 'upload' | 'retry';

interface PipelineConfirmationModalProps {
  isOpen: boolean;
  mode: PipelineMode;
  // Upload mode props
  imageUrl?: string;
  // Retry mode props
  stepName?: string;  // Internal step name (e.g., "openai_render")
  stepDisplayName?: string;  // Display name (e.g., "AI Rendering")
  // Common props
  cost: number;
  creditBalance?: number;
  isAdmin: boolean;
  onClose: () => void;
  // Upload mode callback
  onConfirm?: (mockCreationId?: string) => void;
  // Retry mode callback
  onRetry?: (retryAllFollowing: boolean, mockCreationId?: string) => void;
}

export function PipelineConfirmationModal({ 
  isOpen, 
  mode,
  imageUrl,
  stepName,
  stepDisplayName,
  cost: initialCost, 
  creditBalance,
  isAdmin, 
  onClose, 
  onConfirm,
  onRetry
}: PipelineConfirmationModalProps) {
  const [mockCreationId, setMockCreationId] = useState('');
  const [retryAllFollowing, setRetryAllFollowing] = useState(true);
  const [cost, setCost] = useState(initialCost);
  const [costForAllFollowing, setCostForAllFollowing] = useState<number | null>(null);
  const [costForThisStep, setCostForThisStep] = useState<number | null>(null);
  const [isLoadingCost, setIsLoadingCost] = useState(false);

  // Fetch costs for both options when modal opens (retry mode only)
  useEffect(() => {
    if (mode === 'retry' && stepName && isOpen) {
      setIsLoadingCost(true);
      // Fetch costs for both options in parallel
      Promise.all([
        api.getCreationCost(stepName, true),   // All following
        api.getCreationCost(stepName, false)   // This step only
      ])
        .then(([allFollowingResult, thisStepResult]) => {
          setCostForAllFollowing(allFollowingResult.cost);
          setCostForThisStep(thisStepResult.cost);
          // Set current cost based on selected option
          setCost(retryAllFollowing ? allFollowingResult.cost : thisStepResult.cost);
          setIsLoadingCost(false);
        })
        .catch((error) => {
          console.error('Failed to calculate retry costs:', error);
          setIsLoadingCost(false);
        });
    } else {
      setCost(initialCost);
      setCostForAllFollowing(null);
      setCostForThisStep(null);
    }
  }, [mode, stepName, initialCost, isOpen]);

  // Update cost when retry option changes (retry mode only)
  useEffect(() => {
    if (mode === 'retry' && stepName) {
      if (retryAllFollowing && costForAllFollowing !== null) {
        setCost(costForAllFollowing);
      } else if (!retryAllFollowing && costForThisStep !== null) {
        setCost(costForThisStep);
      }
    }
  }, [mode, stepName, retryAllFollowing, costForAllFollowing, costForThisStep]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (mode === 'upload' && onConfirm) {
      onConfirm();
    } else if (mode === 'retry' && onRetry) {
      onRetry(retryAllFollowing);
    }
    // Reset state
    setMockCreationId('');
    onClose();
  };

  const handleMock = () => {
    if (mockCreationId.trim()) {
      if (mode === 'upload' && onConfirm) {
        onConfirm(mockCreationId.trim());
      } else if (mode === 'retry' && onRetry) {
        onRetry(retryAllFollowing, mockCreationId.trim());
      }
      // Reset state
      setMockCreationId('');
      onClose();
    }
  };

  const handleCancel = () => {
    setMockCreationId('');
    setRetryAllFollowing(true);
    onClose();
  };

  const canAfford = creditBalance === undefined || creditBalance >= cost;
  const canConfirm = canAfford && !isLoadingCost;
  const canMock = canAfford && mockCreationId.trim() && !isLoadingCost;

  return (
    <div className="pipeline-confirmation-modal-overlay" onClick={handleCancel}>
      <div className="pipeline-confirmation-modal" onClick={(e) => e.stopPropagation()}>
        {mode === 'upload' && imageUrl && (
          <div className="pipeline-confirmation-modal-image-container">
            <img 
              src={imageUrl} 
              alt="Uploaded image" 
              className="pipeline-confirmation-modal-image"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}
        {mode === 'retry' && stepDisplayName && (
          <div className="pipeline-confirmation-modal-content">
            <h3 className="pipeline-confirmation-modal-title">Retry Step</h3>
            <p className="pipeline-confirmation-modal-message">
              How would you like to retry <strong>{stepDisplayName}</strong>?
            </p>
            <div className="pipeline-confirmation-modal-retry-options">
              <label className="pipeline-confirmation-modal-retry-option">
                <input
                  type="radio"
                  name="retry-option"
                  checked={retryAllFollowing}
                  onChange={() => setRetryAllFollowing(true)}
                />
                <span className="pipeline-confirmation-modal-retry-option-text">
                  Retry this step and all following steps (recommended)
                </span>
                {costForAllFollowing !== null && (
                  <span className="pipeline-confirmation-modal-option-cost">
                    🪙 {costForAllFollowing}
                  </span>
                )}
              </label>
              <label className="pipeline-confirmation-modal-retry-option">
                <input
                  type="radio"
                  name="retry-option"
                  checked={!retryAllFollowing}
                  onChange={() => setRetryAllFollowing(false)}
                />
                <span className="pipeline-confirmation-modal-retry-option-text">
                  Retry only this step
                </span>
                {costForThisStep !== null && (
                  <span className="pipeline-confirmation-modal-option-cost">
                    🪙 {costForThisStep}
                  </span>
                )}
              </label>
            </div>
          </div>
        )}
        {(!canAfford && creditBalance !== undefined) && (
          <div className="pipeline-confirmation-modal-content">
            <div className="pipeline-confirmation-modal-insufficient-message">
              Insufficient credits. You have 🪙 {creditBalance}, but need 🪙 {cost}.
            </div>
          </div>
        )}
        <div className="pipeline-confirmation-modal-actions">
          <div className="pipeline-confirmation-modal-actions-left">
            <button 
              className="pipeline-confirmation-modal-button pipeline-confirmation-modal-button-confirm" 
              onClick={handleConfirm}
              disabled={!canConfirm}
            >
              {mode === 'upload' ? 'Start' : 'Run'}
              <span className="pipeline-confirmation-modal-button-cost">
                {isLoadingCost ? '...' : ` 🪙 ${cost}`}
              </span>
            </button>
            {isAdmin && (
              <button 
                className="pipeline-confirmation-modal-button pipeline-confirmation-modal-button-mock" 
                onClick={handleMock}
                disabled={!canMock}
              >
                <span>Mock</span>
                <input
                  type="text"
                  className="pipeline-confirmation-modal-mock-input"
                  placeholder="creation id to mock"
                  value={mockCreationId}
                  onChange={(e) => setMockCreationId(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleMock();
                    }
                  }}
                />
                <span className="pipeline-confirmation-modal-button-cost">
                  {isLoadingCost ? '...' : ` 🪙 ${cost}`}
                </span>
              </button>
            )}
          </div>
          <button 
            className="pipeline-confirmation-modal-button pipeline-confirmation-modal-button-cancel" 
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
