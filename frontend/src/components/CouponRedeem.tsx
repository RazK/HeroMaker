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
  const [success, setSuccess] = useState<{ message: string; tokensAdded: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
        tokensAdded: result.tokens_added,
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
    onClose();
  };

  return (
    <div className="coupon-modal-overlay" onClick={handleClose}>
      <div className="coupon-modal" onClick={(e) => e.stopPropagation()}>
        <button className="coupon-modal-close" onClick={handleClose}>×</button>

        <h2 className="coupon-modal-title">Redeem Coupon</h2>
        <p className="coupon-modal-subtitle">Enter your coupon code to add tokens to your account</p>

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
            <label htmlFor="coupon-code">Coupon Code</label>
            <input
              id="coupon-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g., HERO-ABC123"
              required
              disabled={isLoading}
              autoComplete="off"
              autoFocus
            />
          </div>

          <button
            type="submit"
            className="coupon-modal-submit"
            disabled={isLoading || !code.trim()}
          >
            {isLoading ? 'Redeeming...' : 'Redeem Coupon'}
          </button>
        </form>
      </div>
    </div>
  );
}
