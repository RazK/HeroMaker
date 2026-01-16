import { useState, useEffect, useRef } from 'react';
import { api, ApiError } from '../api/client';
import './HeroNameEditor.css';

interface HeroNameEditorProps {
  creationId: string;
  characterName: string | null;
  name: string | null;
  age: number | null;
  isAdmin?: boolean;
  onCharacterNameUpdated: (newName: string) => void;
  onNameUpdated: (newName: string) => void;
  onAgeUpdated: (newAge: number | null) => void;
  onDelete?: () => void;
  onRestart?: () => void;
}

export function HeroNameEditor({ creationId, characterName, name, age, isAdmin = false, onCharacterNameUpdated, onNameUpdated, onAgeUpdated, onDelete, onRestart }: HeroNameEditorProps) {
  const [characterNameValue, setCharacterNameValue] = useState(characterName || '');
  const [nameValue, setNameValue] = useState(name || '');
  const [ageValue, setAgeValue] = useState(age?.toString() || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const handleCopyId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(creationId);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  // Sync with props when they change, but only sync if we're not currently editing
  // Use refs to track if we're in the middle of clearing a field
  const isClearingRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (isClearingRef.current !== 'characterName') {
      setCharacterNameValue(characterName || '');
    }
  }, [characterName]);
  
  useEffect(() => {
    if (isClearingRef.current !== 'name') {
      setNameValue(name || '');
    }
  }, [name]);
  
  useEffect(() => {
    if (isClearingRef.current !== 'age') {
      setAgeValue(age?.toString() || '');
    }
  }, [age]);

  const saveCharacterName = async () => {
    const trimmed = characterNameValue.trim();
    const currentValue = characterName || '';
    if (trimmed === currentValue) return; // No change
    
    setIsSaving(true);
    setError(null);
    try {
      const updated = await api.updateCharacterName(creationId, trimmed);
      onCharacterNameUpdated(updated.character_name || '');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update';
      setError(message);
      setCharacterNameValue(characterName || ''); // Revert on error
    } finally {
      setIsSaving(false);
    }
  };

  const saveName = async () => {
    const trimmedName = nameValue.trim();
    const currentName = name || '';
    
    if (trimmedName === currentName) return; // No change

    setIsSaving(true);
    setError(null);
    try {
      console.log('[HeroNameEditor] Saving name:', { trimmedName, currentName });
      const updated = await api.updateName(creationId, trimmedName);
      console.log('[HeroNameEditor] Update response:', { name: updated.name });
      onNameUpdated(updated.name || '');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update';
      setError(message);
      setNameValue(name || ''); // Revert on error
    } finally {
      setIsSaving(false);
    }
  };

  const saveAge = async () => {
    const ageNum = ageValue.trim() === '' ? null : parseInt(ageValue.trim(), 10);
    
    // Validate age
    if (ageValue.trim() !== '' && (isNaN(ageNum!) || ageNum! < 0)) {
      setError('Age must be a positive number');
      setAgeValue(age?.toString() || '');
      return;
    }

    const currentAge = age;
    
    if (ageNum === currentAge) return; // No change

    setIsSaving(true);
    setError(null);
    try {
      console.log('[HeroNameEditor] Saving age:', { ageNum, currentAge });
      const updated = await api.updateAge(creationId, ageNum);
      console.log('[HeroNameEditor] Update response:', { age: updated.age });
      onAgeUpdated(updated.age);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update';
      setError(message);
      setAgeValue(age?.toString() || ''); // Revert on error
    } finally {
      setIsSaving(false);
    }
  };

  const clearCharacterName = async () => {
    setCharacterNameValue('');
    setIsSaving(true);
    setError(null);
    try {
      const updated = await api.updateCharacterName(creationId, '');
      onCharacterNameUpdated(updated.character_name || '');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update';
      setError(message);
      setCharacterNameValue(characterName || '');
    } finally {
      setIsSaving(false);
    }
  };

  const clearName = async () => {
    const previousNameValue = nameValue;
    isClearingRef.current = 'name';
    setNameValue('');
    setIsSaving(true);
    setError(null);
    try {
      const updated = await api.updateName(creationId, '');
      // Only update if the API response matches what we expect (empty name)
      if (updated.name === '' || updated.name === null) {
        onNameUpdated('');
      } else {
        onNameUpdated(updated.name || '');
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update';
      setError(message);
      setNameValue(previousNameValue);
    } finally {
      setIsSaving(false);
      // Clear the flag after a short delay to allow the update to complete
      setTimeout(() => {
        isClearingRef.current = null;
      }, 100);
    }
  };

  const clearAge = async () => {
    const previousAgeValue = ageValue;
    isClearingRef.current = 'age';
    setAgeValue('');
    setIsSaving(true);
    setError(null);
    try {
      const updated = await api.updateAge(creationId, null);
      // Only update if the API response matches what we expect (null age)
      if (updated.age === null || updated.age === undefined) {
        onAgeUpdated(null);
      } else {
        onAgeUpdated(updated.age);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update';
      setError(message);
      setAgeValue(previousAgeValue);
    } finally {
      setIsSaving(false);
      // Clear the flag after a short delay to allow the update to complete
      setTimeout(() => {
        isClearingRef.current = null;
      }, 100);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await api.deleteCreation(creationId);
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

  const handleRestart = async () => {
    setIsRestarting(true);
    setError(null);
    try {
      // Run all steps individually (new API design - independent step execution)
      const allSteps = ['image_processing', 'openai_render', 'meshy_3d', 'meshy_rig', 'convert_vrm', 'complete'];
      for (const stepName of allSteps) {
        await api.runStep(creationId, stepName);
        // Trigger immediate refresh after each step starts
        window.dispatchEvent(new CustomEvent('creation:refresh-now', { detail: { creationId } }));
      }
      setShowRestartConfirm(false);
      if (onRestart) {
        onRestart();
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to resume pipeline';
      setError(message);
    } finally {
      setIsRestarting(false);
    }
  };

  return (
    <div className="hero-name-editor">
      <div className="hero-name-editor-row">
        <div className="hero-name-editor-name-age-wrapper">
          <div className="hero-name-editor-field-wrapper">
            <input
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveName();
                }
              }}
              placeholder="Creator Name"
              className="hero-name-editor-input-compact"
              disabled={isSaving}
            />
            {nameValue && (
              <button
                type="button"
                className="hero-name-editor-clear"
                onClick={clearName}
                tabIndex={-1}
              >
                ×
              </button>
            )}
          </div>
          <div className="hero-name-editor-field-wrapper hero-name-editor-field-wrapper-age">
            <input
              type="number"
              value={ageValue}
              onChange={(e) => setAgeValue(e.target.value)}
              onBlur={saveAge}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveAge();
                }
              }}
              placeholder="Age"
              className="hero-name-editor-input-compact hero-name-editor-input-age"
              disabled={isSaving}
              min="0"
            />
            {ageValue && (
              <button
                type="button"
                className="hero-name-editor-clear"
                onClick={clearAge}
                tabIndex={-1}
              >
                ×
              </button>
            )}
          </div>
        </div>
        <div className="hero-name-editor-field-wrapper">
          <input
            type="text"
            value={characterNameValue}
            onChange={(e) => setCharacterNameValue(e.target.value)}
            onBlur={saveCharacterName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                saveCharacterName();
              }
            }}
            placeholder="Superhero Name"
            className="hero-name-editor-input-compact"
            disabled={isSaving}
          />
          {characterNameValue && (
            <button
              type="button"
              className="hero-name-editor-clear"
              onClick={clearCharacterName}
              tabIndex={-1}
            >
              ×
            </button>
          )}
        </div>
        {isAdmin && (
          <div className="hero-name-editor-field-wrapper">
            <span className="hero-name-editor-creation-id-label">Creation ID:</span>
            <input
              type="text"
              value={creationId || ''}
              readOnly
              className="hero-name-editor-input-compact hero-name-editor-creation-id-input"
            />
            <button
              type="button"
              className="hero-name-editor-copy-id"
              onClick={handleCopyId}
              title="Copy creation ID"
            >
              {copySuccess ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>
        )}
        <div className="hero-name-editor-actions">
          <button
            type="button"
            className="hero-name-editor-action-button hero-name-editor-restart-button"
            onClick={() => setShowRestartConfirm(true)}
            disabled={isSaving || isDeleting || isRestarting}
            title="Resume pipeline from last failed step"
          >
            ↻
          </button>
          <button
            type="button"
            className="hero-name-editor-action-button hero-name-editor-delete-button"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isSaving || isDeleting || isRestarting}
            title="Delete creation"
          >
            🗑
          </button>
        </div>
      </div>
      {error && (
        <div className="hero-name-editor-error">{error}</div>
      )}
      
      {showDeleteConfirm && (
        <div className="hero-name-editor-confirm-overlay">
          <div className="hero-name-editor-confirm-dialog">
            <h3>Delete Creation?</h3>
            <p>This will permanently delete this creation and all its files. This action cannot be undone.</p>
            <div className="hero-name-editor-confirm-buttons">
              <button
                type="button"
                className="hero-name-editor-confirm-cancel"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="hero-name-editor-confirm-delete"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {showRestartConfirm && (
        <div className="hero-name-editor-confirm-overlay">
          <div className="hero-name-editor-confirm-dialog">
            <h3>Restart Pipeline?</h3>
            <p>This will resume the pipeline from the last failed step. Completed steps will be preserved.</p>
            <div className="hero-name-editor-confirm-buttons">
              <button
                type="button"
                className="hero-name-editor-confirm-cancel"
                onClick={() => setShowRestartConfirm(false)}
                disabled={isRestarting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="hero-name-editor-confirm-restart"
                onClick={handleRestart}
                disabled={isRestarting}
              >
                {isRestarting ? 'Restarting...' : 'Restart'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


