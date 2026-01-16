import { useState, useEffect, useRef } from 'react';
import { api, ApiError } from '../api/client';
import './HeroNameEditor.css';

interface HeroNameEditorProps {
  creationId: string;
  characterName: string | null;
  name: string | null;
  age: number | null;
  isAdmin?: boolean;
  isLoggedIn?: boolean;
  onCharacterNameUpdated: (newName: string) => void;
  onNameUpdated: (newName: string) => void;
  onAgeUpdated: (newAge: number | null) => void;
}

export function HeroNameEditor({ creationId, characterName, name, age, isAdmin = false, isLoggedIn = false, onCharacterNameUpdated, onNameUpdated, onAgeUpdated }: HeroNameEditorProps) {
  const [characterNameValue, setCharacterNameValue] = useState(characterName || '');
  const [nameValue, setNameValue] = useState(name || '');
  const [ageValue, setAgeValue] = useState(age?.toString() || '');
  const [isSaving, setIsSaving] = useState(false);
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
    if (!isLoggedIn) return;
    const trimmed = characterNameValue.trim();
    const currentValue = characterName || '';
    if (trimmed === currentValue) return; // No change
    
    setIsSaving(true);
    try {
      const updated = await api.updateCharacterName(creationId, trimmed);
      onCharacterNameUpdated(updated.character_name || '');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update';
      console.error('[HeroNameEditor] Save error:', message);
      setCharacterNameValue(characterName || ''); // Revert on error
    } finally {
      setIsSaving(false);
    }
  };

  const saveName = async () => {
    if (!isLoggedIn) return;
    const trimmedName = nameValue.trim();
    const currentName = name || '';
    
    if (trimmedName === currentName) return; // No change

    setIsSaving(true);
    try {
      const updated = await api.updateName(creationId, trimmedName);
      onNameUpdated(updated.name || '');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update';
      console.error('[HeroNameEditor] Save error:', message);
      setNameValue(name || ''); // Revert on error
    } finally {
      setIsSaving(false);
    }
  };

  const saveAge = async () => {
    if (!isLoggedIn) return;
    const ageNum = ageValue.trim() === '' ? null : parseInt(ageValue.trim(), 10);
    
    // Validate age
    if (ageValue.trim() !== '' && (isNaN(ageNum!) || ageNum! < 0)) {
      setAgeValue(age?.toString() || '');
      return;
    }

    const currentAge = age;
    
    if (ageNum === currentAge) return; // No change

    setIsSaving(true);
    try {
      const updated = await api.updateAge(creationId, ageNum);
      onAgeUpdated(updated.age);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update';
      console.error('[HeroNameEditor] Save error:', message);
      setAgeValue(age?.toString() || ''); // Revert on error
    } finally {
      setIsSaving(false);
    }
  };

  const clearCharacterName = async () => {
    if (!isLoggedIn) return;
    setCharacterNameValue('');
    setIsSaving(true);
    try {
      const updated = await api.updateCharacterName(creationId, '');
      onCharacterNameUpdated(updated.character_name || '');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update';
      console.error('[HeroNameEditor] Clear error:', message);
      setCharacterNameValue(characterName || '');
    } finally {
      setIsSaving(false);
    }
  };

  const clearName = async () => {
    if (!isLoggedIn) return;
    const previousNameValue = nameValue;
    isClearingRef.current = 'name';
    setNameValue('');
    setIsSaving(true);
    try {
      const updated = await api.updateName(creationId, '');
      if (updated.name === '' || updated.name === null) {
        onNameUpdated('');
      } else {
        onNameUpdated(updated.name || '');
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update';
      console.error('[HeroNameEditor] Clear error:', message);
      setNameValue(previousNameValue);
    } finally {
      setIsSaving(false);
      setTimeout(() => {
        isClearingRef.current = null;
      }, 100);
    }
  };

  const clearAge = async () => {
    if (!isLoggedIn) return;
    const previousAgeValue = ageValue;
    isClearingRef.current = 'age';
    setAgeValue('');
    setIsSaving(true);
    try {
      const updated = await api.updateAge(creationId, null);
      if (updated.age === null || updated.age === undefined) {
        onAgeUpdated(null);
      } else {
        onAgeUpdated(updated.age);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update';
      console.error('[HeroNameEditor] Clear error:', message);
      setAgeValue(previousAgeValue);
    } finally {
      setIsSaving(false);
      setTimeout(() => {
        isClearingRef.current = null;
      }, 100);
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
              disabled={isSaving || !isLoggedIn}
              readOnly={!isLoggedIn}
            />
            {nameValue && isLoggedIn && (
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
              disabled={isSaving || !isLoggedIn}
              readOnly={!isLoggedIn}
              min="0"
            />
            {ageValue && isLoggedIn && (
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
            disabled={isSaving || !isLoggedIn}
            readOnly={!isLoggedIn}
          />
          {characterNameValue && isLoggedIn && (
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
      </div>
    </div>
  );
}
