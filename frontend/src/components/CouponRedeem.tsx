import { useState } from 'react';
import { api, ApiError } from '../api/client';
import './CouponRedeem.css';

interface CouponRedeemProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newBalance: number) => void;
}

export function CouponRedeem({ isOpen, onClose, onSuccess }: CouponRedeemProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ message: string; creditsAdded: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [couponCredits, setCouponCredits] = useState<number | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'valid' | 'invalid' | null>(null);

  const validateCoupon = async () => {
    if (!code.trim()) {
      setCouponCredits(null);
      setError(null);
      setValidationStatus(null);
      return;
    }

    setIsValidating(true);
    setError(null);
    try {
      const result = await api.validateCoupon(code.trim());
      if (result.valid) {
        setCouponCredits(result.credits);
        setError(null);
        setValidationStatus('valid');
      } else {
        setCouponCredits(null);
        setError(result.message);
        setValidationStatus('invalid');
      }
    } catch (err) {
      setCouponCredits(null);
      setValidationStatus('invalid');
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to validate coupon code');
      }
    } finally {
      setIsValidating(false);
    }
  };

  const handleClearCode = () => {
    setCode('');
    setError(null);
    setCouponCredits(null);
    setValidationStatus(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      validateCoupon();
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsLoading(true);

    try {
      const result = await api.redeemCoupon(code);
      setSuccess({
        message: result.message,
        creditsAdded: result.credits_added,
      });
      onSuccess(result.new_balance);
      // Clear the code input after success
      setCode('');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setCode('');
    setError(null);
    setSuccess(null);
    setCouponCredits(null);
    setValidationStatus(null);
    onClose();
  };

  return (
    <div className="coupon-modal-overlay" onClick={handleClose}>
      <div className="coupon-modal" onClick={(e) => e.stopPropagation()}>
        <button className="coupon-modal-close" onClick={handleClose}>×</button>

        <h2 className="coupon-modal-title">Redeem Coupon 🎟️</h2>
        <p className="coupon-modal-subtitle">Enter your coupon code to add credits to your account</p>

        <form className="coupon-modal-form" onSubmit={handleSubmit}>
          {error && (
            <div className="coupon-modal-error">
              {error}
            </div>
          )}

          {success && (
            <div className="coupon-modal-success">
              {success.message}
            </div>
          )}

          <div className="coupon-modal-field">
            <div className="coupon-modal-input-wrapper">
              <input
                id="coupon-code"
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setCouponCredits(null);
                  setError(null);
                  setValidationStatus(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder="e.g., HERO-ABC123"
                required
                disabled={isLoading}
                autoComplete="off"
                autoFocus
                className="coupon-modal-input"
              />
              {code && (
                <button
                  type="button"
                  className="coupon-modal-icon coupon-modal-clear"
                  onClick={handleClearCode}
                  title="Clear"
                  tabIndex={-1}
                >
                  ×
                </button>
              )}
              {isValidating ? (
                <span className="coupon-modal-icon coupon-modal-status-loading">⏳</span>
              ) : validationStatus === 'valid' ? (
                <span className="coupon-modal-icon coupon-modal-status-valid">✓</span>
              ) : validationStatus === 'invalid' ? (
                <span className="coupon-modal-icon coupon-modal-status-invalid">✗</span>
              ) : (
                <button
                  type="button"
                  className="coupon-modal-icon coupon-modal-enter"
                  onClick={validateCoupon}
                  disabled={isLoading || !code.trim()}
                  title="Validate (Enter)"
                  tabIndex={-1}
                >
                  ↵
                </button>
              )}
            </div>
          </div>

          {couponCredits && (
            <button
              type="submit"
              className="coupon-modal-submit"
              disabled={isLoading}
            >
              {isLoading ? 'Redeeming...' : `Claim ${couponCredits} credits 🪙`}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
