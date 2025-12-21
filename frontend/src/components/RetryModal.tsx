import { useState } from 'react';
import './RetryModal.css';

interface RetryModalProps {
  stepName: string;
  isOpen: boolean;
  onClose: () => void;
  onRetry: (retryAllFollowing: boolean) => void;
}

export function RetryModal({ stepName, isOpen, onClose, onRetry }: RetryModalProps) {
  const [retryAllFollowing, setRetryAllFollowing] = useState(true);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onRetry(retryAllFollowing);
    onClose();
  };

  const handleCancel = () => {
    setRetryAllFollowing(true); // Reset to default
    onClose();
  };

  return (
    <div className="retry-modal-overlay" onClick={handleCancel}>
      <div className="retry-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="retry-modal-title">Retry Step</h3>
        <p className="retry-modal-message">
          How would you like to retry <strong>{stepName}</strong>?
        </p>
        <div className="retry-modal-options">
          <label className="retry-modal-option">
            <input
              type="radio"
              name="retry-option"
              checked={retryAllFollowing}
              onChange={() => setRetryAllFollowing(true)}
            />
            <span>Retry this step and all following steps (recommended)</span>
          </label>
          <label className="retry-modal-option">
            <input
              type="radio"
              name="retry-option"
              checked={!retryAllFollowing}
              onChange={() => setRetryAllFollowing(false)}
            />
            <span>Retry only this step</span>
          </label>
        </div>
        <div className="retry-modal-actions">
          <button className="retry-modal-button retry-modal-button-cancel" onClick={handleCancel}>
            Cancel
          </button>
          <button className="retry-modal-button retry-modal-button-confirm" onClick={handleConfirm}>
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}

