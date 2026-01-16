import { useState } from 'react';
import './RetryModal.css';

interface RetryModalProps {
  stepName: string;
  isOpen: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onRetry: (retryAllFollowing: boolean, mockCreationId?: string) => void;
}

export function RetryModal({ stepName, isOpen, isAdmin, onClose, onRetry }: RetryModalProps) {
  const [retryAllFollowing, setRetryAllFollowing] = useState(true);
  const [mockCreationId, setMockCreationId] = useState('');

  if (!isOpen) return null;

  const handleRetry = () => {
    onRetry(retryAllFollowing);
    setMockCreationId('');
    onClose();
  };

  const handleMockRetry = () => {
    if (mockCreationId.trim()) {
      onRetry(retryAllFollowing, mockCreationId.trim());
      setMockCreationId('');
      onClose();
    }
  };

  const handleCancel = () => {
    setRetryAllFollowing(true); // Reset to default
    setMockCreationId('');
    onClose();
  };

  const canMock = mockCreationId.trim();

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
          <button className="retry-modal-button retry-modal-button-confirm" onClick={handleRetry}>
            Retry
          </button>
          {isAdmin && (
            <button 
              className="retry-modal-button retry-modal-button-mock" 
              onClick={handleMockRetry}
              disabled={!canMock}
            >
              <span>Mock</span>
              <input
                type="text"
                className="retry-modal-mock-input"
                placeholder="creation id to mock"
                value={mockCreationId}
                onChange={(e) => setMockCreationId(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleMockRetry();
                  }
                }}
              />
            </button>
          )}
          <button className="retry-modal-button retry-modal-button-cancel" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

