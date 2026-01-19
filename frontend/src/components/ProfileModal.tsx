import { useState, useEffect } from 'react';
import { api, ApiError } from '../api/client';
import './ProfileModal.css';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    id: string;
    username: string;
    email: string;
    name: string | null;
    credits: number;
    is_admin: boolean;
  };
  onProfileUpdated: () => void;
}

export function ProfileModal({ isOpen, onClose, user, onProfileUpdated }: ProfileModalProps) {
  const [name, setName] = useState(user.name || '');
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName(user.name || '');
      setUsername(user.username);
      setEmail(user.email);
      setDateOfBirth('');
      setShowPasswordChange(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
      setSuccess(null);
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    // Validate password change
    if (showPasswordChange) {
      if (!currentPassword) {
        setError('Current password is required');
        return;
      }
      if (!newPassword) {
        setError('New password is required');
        return;
      }
      if (newPassword.length < 6) {
        setError('New password must be at least 6 characters');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    setIsSaving(true);

    try {
      const updateData: any = {};
      
      if (name !== (user.name || '')) {
        updateData.name = name;
      }
      if (username !== user.username) {
        updateData.username = username;
      }
      if (email !== user.email) {
        updateData.email = email;
      }
      if (dateOfBirth) {
        updateData.date_of_birth = dateOfBirth;
      }
      if (showPasswordChange && newPassword) {
        updateData.current_password = currentPassword;
        updateData.new_password = newPassword;
      }

      if (Object.keys(updateData).length === 0) {
        setError('No changes to save');
        setIsSaving(false);
        return;
      }

      await api.updateProfile(updateData);
      setSuccess('Profile updated successfully');
      onProfileUpdated();
      
      // Close after a short delay
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update profile';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="profile-modal-backdrop" onClick={handleBackdropClick}>
      <div className="profile-modal">
        <div className="profile-modal-header">
          <h2>Edit Profile</h2>
          <button className="profile-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="profile-modal-content">
          {error && <div className="profile-modal-error">{error}</div>}
          {success && <div className="profile-modal-success">{success}</div>}

          <div className="profile-modal-field">
            <label>Display Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your display name"
            />
          </div>

          <div className="profile-modal-field">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
            />
          </div>

          <div className="profile-modal-field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
            />
          </div>

          <div className="profile-modal-field">
            <label>Date of Birth</label>
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
            />
          </div>

          <div className="profile-modal-password-section">
            <button
              type="button"
              className="profile-modal-password-toggle"
              onClick={() => setShowPasswordChange(!showPasswordChange)}
            >
              {showPasswordChange ? 'Cancel' : 'Change Password'}
            </button>

            {showPasswordChange && (
              <div className="profile-modal-password-fields">
                <div className="profile-modal-field">
                  <label>Current Password</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                  />
                </div>
                <div className="profile-modal-field">
                  <label>New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                  />
                </div>
                <div className="profile-modal-field">
                  <label>Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="profile-modal-footer">
          <button
            className="profile-modal-cancel"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            className="profile-modal-save"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
