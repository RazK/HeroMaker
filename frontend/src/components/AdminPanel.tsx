import { useState, useEffect } from 'react';
import { api, AdminUserResponse, AdminCouponResponse, ApiError } from '../api/client';
import { CreateCouponModal } from './CreateCouponModal';
import './AdminPanel.css';

interface AdminPanelProps {
  onClose: () => void;
  currentUserId: string;
}

type Tab = 'users' | 'coupons';

export function AdminPanel({ onClose, currentUserId }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [users, setUsers] = useState<AdminUserResponse[]>([]);
  const [coupons, setCoupons] = useState<AdminCouponResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCredits, setEditingCredits] = useState<string | null>(null);
  const [creditsValue, setCreditsValue] = useState<string>('');
  const [showCreateCoupon, setShowCreateCoupon] = useState(false);

  // Load data when tab changes
  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (activeTab === 'users') {
        const data = await api.admin.listUsers();
        setUsers(data);
      } else {
        const data = await api.admin.listCoupons();
        setCoupons(data);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load data';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  // User actions
  const handleToggleAdmin = async (userId: string, currentIsAdmin: boolean) => {
    if (userId === currentUserId) {
      alert("You can't change your own admin status");
      return;
    }
    try {
      await api.admin.updateUser(userId, { is_admin: !currentIsAdmin });
      loadData();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update user';
      alert(message);
    }
  };

  const handleCreditsEdit = (userId: string, currentCredits: number) => {
    setEditingCredits(userId);
    setCreditsValue(String(currentCredits));
  };

  const handleCreditsSave = async (userId: string) => {
    const credits = parseInt(creditsValue, 10);
    if (isNaN(credits) || credits < 0) {
      alert('Invalid credits value');
      return;
    }
    try {
      await api.admin.updateUser(userId, { credits });
      setEditingCredits(null);
      loadData();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update credits';
      alert(message);
    }
  };

  const handleDeleteUser = async (userId: string, username: string) => {
    if (userId === currentUserId) {
      alert("You can't delete yourself");
      return;
    }
    if (!confirm(`Delete user "${username}"? This will also delete all their creations.`)) {
      return;
    }
    try {
      await api.admin.deleteUser(userId);
      loadData();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete user';
      alert(message);
    }
  };

  // Coupon actions
  const handleToggleCouponActive = async (couponId: string, currentIsActive: boolean) => {
    try {
      await api.admin.updateCoupon(couponId, { is_active: !currentIsActive });
      loadData();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update coupon';
      alert(message);
    }
  };

  const handleDeleteCoupon = async (couponId: string, code: string) => {
    if (!confirm(`Delete coupon "${code}"?`)) {
      return;
    }
    try {
      await api.admin.deleteCoupon(couponId);
      loadData();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete coupon';
      alert(message);
    }
  };

  const handleCouponCreated = () => {
    setShowCreateCoupon(false);
    loadData();
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className="admin-panel">
      <div className="admin-panel-tabs">
        <div className="admin-panel-tabs-left">
          <button
            className={`admin-panel-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            Users
          </button>
          <button
            className={`admin-panel-tab ${activeTab === 'coupons' ? 'active' : ''}`}
            onClick={() => setActiveTab('coupons')}
          >
            Coupons
          </button>
          {activeTab === 'coupons' && (
            <button
              className="admin-create-button"
              onClick={() => setShowCreateCoupon(true)}
            >
              🎟️ Create Coupon
            </button>
          )}
        </div>
        <div className="admin-panel-tabs-right">
          <button className="admin-panel-back" onClick={onClose}>
            ← Back
          </button>
        </div>
      </div>

      {error && <div className="admin-panel-error">{error}</div>}

      {isLoading ? (
        <div className="admin-panel-loading">Loading...</div>
      ) : activeTab === 'users' ? (
        <div className="admin-panel-content">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Creations</th>
                <th>Credits</th>
                <th>Admin</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className={user.id === currentUserId ? 'current-user' : ''}>
                  <td className="admin-table-username">{user.username}</td>
                  <td className="admin-table-email">{user.email}</td>
                  <td className="admin-table-creations">
                    <span className="creation-stat stat-completed" title="Completed">
                      {user.creation_stats.completed}
                    </span>
                    <span className="creation-stat stat-failed" title="Failed">
                      {user.creation_stats.failed}
                    </span>
                    <span className="creation-stat stat-in-progress" title="In Progress">
                      {user.creation_stats.in_progress}
                    </span>
                  </td>
                  <td className="admin-table-credits">
                    {editingCredits === user.id ? (
                      <div className="credits-edit">
                        <input
                          type="number"
                          value={creditsValue}
                          onChange={(e) => setCreditsValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCreditsSave(user.id);
                            if (e.key === 'Escape') setEditingCredits(null);
                          }}
                          autoFocus
                        />
                        <button onClick={() => handleCreditsSave(user.id)}>✓</button>
                        <button onClick={() => setEditingCredits(null)}>✗</button>
                      </div>
                    ) : (
                      <span
                        className="credits-value"
                        onClick={() => handleCreditsEdit(user.id, user.credits)}
                        title="Click to edit"
                      >
                        🪙 {user.credits}
                      </span>
                    )}
                  </td>
                  <td className="admin-table-admin">
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={user.is_admin}
                        onChange={() => handleToggleAdmin(user.id, user.is_admin)}
                        disabled={user.id === currentUserId}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </td>
                  <td className="admin-table-date">{formatDate(user.created_at)}</td>
                  <td className="admin-table-actions">
                    <button
                      className="admin-action-delete"
                      onClick={() => handleDeleteUser(user.id, user.username)}
                      disabled={user.id === currentUserId}
                      title={user.id === currentUserId ? "Can't delete yourself" : 'Delete user'}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-panel-content">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Credits</th>
                <th>Uses</th>
                <th>Expires</th>
                <th>Active</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((coupon) => (
                <tr key={coupon.id}>
                  <td className="admin-table-code">{coupon.code}</td>
                  <td className="admin-table-credits">🪙 {coupon.credit_amount}</td>
                  <td className="admin-table-uses">
                    {coupon.current_uses} / {coupon.max_uses}
                  </td>
                  <td className="admin-table-expires">
                    {coupon.expires_at ? formatDate(coupon.expires_at) : 'Never'}
                  </td>
                  <td className="admin-table-active">
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={coupon.is_active}
                        onChange={() => handleToggleCouponActive(coupon.id, coupon.is_active)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </td>
                  <td className="admin-table-date">{formatDate(coupon.created_at)}</td>
                  <td className="admin-table-actions">
                    <button
                      className="admin-action-delete"
                      onClick={() => handleDeleteCoupon(coupon.id, coupon.code)}
                      title="Delete coupon"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateCoupon && (
        <CreateCouponModal
          onClose={() => setShowCreateCoupon(false)}
          onCreated={handleCouponCreated}
        />
      )}
    </div>
  );
}
