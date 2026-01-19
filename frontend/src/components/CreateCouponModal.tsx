import { useState } from 'react';
import { api, ApiError } from '../api/client';
import './CreateCouponModal.css';

interface CreateCouponModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function generateCouponCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing chars like 0/O, 1/I/L
  let code = 'HERO-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function CreateCouponModal({ onClose, onCreated }: CreateCouponModalProps) {
  const [code, setCode] = useState(generateCouponCode());
  const [creditAmount, setCreditAmount] = useState('10');
  const [maxUses, setMaxUses] = useState('1');
  const [expiresAt, setExpiresAt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateCode = () => {
    setCode(generateCouponCode());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const credits = parseInt(creditAmount, 10);
    const uses = parseInt(maxUses, 10);

    if (!code.trim()) {
      setError('Code is required');
      return;
    }
    if (isNaN(credits) || credits <= 0) {
      setError('Credit amount must be a positive number');
      return;
    }
    if (isNaN(uses) || uses <= 0) {
      setError('Max uses must be a positive number');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.admin.createCoupon({
        code: code.trim().toUpperCase(),
        credit_amount: credits,
        max_uses: uses,
        expires_at: expiresAt || undefined,
      });
      onCreated();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create coupon';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="create-coupon-modal-backdrop" onClick={handleBackdropClick}>
      <div className="create-coupon-modal">
        <div className="create-coupon-modal-header">
          <h2>Create Coupon</h2>
          <button className="create-coupon-modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="create-coupon-modal-form">
          {error && <div className="create-coupon-modal-error">{error}</div>}

          <div className="create-coupon-modal-field">
            <label htmlFor="coupon-code">Code</label>
            <div className="create-coupon-modal-code-input">
              <input
                id="coupon-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="HERO-XXXXXX"
              />
              <button
                type="button"
                className="create-coupon-modal-generate"
                onClick={handleGenerateCode}
                title="Generate random code"
              >
                🎲
              </button>
            </div>
          </div>

          <div className="create-coupon-modal-field">
            <label htmlFor="coupon-credits">Credit Amount</label>
            <input
              id="coupon-credits"
              type="number"
              min="1"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              placeholder="10"
            />
          </div>

          <div className="create-coupon-modal-field">
            <label htmlFor="coupon-max-uses">Max Uses</label>
            <input
              id="coupon-max-uses"
              type="number"
              min="1"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="1"
            />
          </div>

          <div className="create-coupon-modal-field">
            <label htmlFor="coupon-expires">Expires At (optional)</label>
            <input
              id="coupon-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>

          <div className="create-coupon-modal-actions">
            <button
              type="button"
              className="create-coupon-modal-cancel"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="create-coupon-modal-submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create Coupon'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
