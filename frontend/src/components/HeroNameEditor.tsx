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
  /** Re-read the creation once a field has been saved. */
  onUpdated?: () => Promise<void>;
}

/**
 * The hero's identity, on the picture.
 *
 * This used to be a three-field form band sitting above the stage: it stole a
 * strip of height from the only thing anybody came to look at, and it made the
 * Studio look nothing like the Gallery card for the same creation. Now it is
 * the same treatment the Gallery uses - hero name bold, "creator · age"
 * underneath, on a scrim at the bottom of the picture - and editing happens in
 * place behind a pencil.
 */
export function HeroNameEditor({
  creationId,
  characterName,
  name,
  age,
  isAdmin = false,
  isLoggedIn = false,
  onUpdated,
}: HeroNameEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [characterNameValue, setCharacterNameValue] = useState(characterName || '');
  const [nameValue, setNameValue] = useState(name || '');
  const [ageValue, setAgeValue] = useState(age?.toString() || '');
  const [isSaving, setIsSaving] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Sync with props whenever the panel is closed. While it is open the inputs
  // are the source of truth, so a poll landing mid-edit cannot wipe a keystroke.
  useEffect(() => {
    if (isEditing) return;
    setCharacterNameValue(characterName || '');
    setNameValue(name || '');
    setAgeValue(age?.toString() || '');
  }, [characterName, name, age, isEditing]);

  useEffect(() => {
    if (isEditing) firstFieldRef.current?.focus();
  }, [isEditing]);

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

  const save = async <T,>(
    changed: boolean,
    call: () => Promise<T>,
    revert: () => void
  ): Promise<void> => {
    if (!isLoggedIn || !changed) return;
    setIsSaving(true);
    try {
      await call();
      if (onUpdated) await onUpdated();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update';
      console.error('[HeroNameEditor] Save error:', message);
      revert();
    } finally {
      setIsSaving(false);
    }
  };

  const saveCharacterName = () =>
    save(
      characterNameValue.trim() !== (characterName || ''),
      () => api.updateCharacterName(creationId, characterNameValue.trim()),
      () => setCharacterNameValue(characterName || '')
    );

  const saveName = () =>
    save(
      nameValue.trim() !== (name || ''),
      () => api.updateName(creationId, nameValue.trim()),
      () => setNameValue(name || '')
    );

  const saveAge = () => {
    const raw = ageValue.trim();
    const parsed = raw === '' ? null : parseInt(raw, 10);
    if (raw !== '' && (parsed === null || isNaN(parsed) || parsed < 0)) {
      setAgeValue(age?.toString() || '');
      return Promise.resolve();
    }
    return save(
      parsed !== age,
      () => api.updateAge(creationId, parsed),
      () => setAgeValue(age?.toString() || '')
    );
  };

  const commitAll = async () => {
    await saveCharacterName();
    await saveName();
    await saveAge();
    setIsEditing(false);
  };

  const heroLine = (characterName || '').trim();
  const creatorLine = [(name || '').trim(), age !== null && age !== undefined ? String(age) : '']
    .filter(Boolean)
    .join(' · ');

  // Clicks here are on top of the 3D stage, which opens a modal when clicked.
  const swallow = (e: React.MouseEvent) => e.stopPropagation();

  if (!isEditing) {
    return (
      <div className="hero-identity" onClick={swallow}>
        <div className="hero-identity-text">
          <div className="hero-identity-hero">{heroLine || 'Unnamed hero'}</div>
          {creatorLine && <div className="hero-identity-creator">{creatorLine}</div>}
        </div>
        {isLoggedIn && (
          <button
            type="button"
            className="hero-identity-edit"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            title="Edit hero name, creator and age"
            aria-label="Edit hero name, creator and age"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="hero-identity is-editing" onClick={swallow}>
      <div className="hero-identity-fields">
        <input
          ref={firstFieldRef}
          type="text"
          value={characterNameValue}
          onChange={(e) => setCharacterNameValue(e.target.value)}
          onBlur={saveCharacterName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitAll(); }
            if (e.key === 'Escape') { setIsEditing(false); }
          }}
          placeholder="Superhero name"
          className="hero-identity-input hero-identity-input-hero"
          disabled={isSaving}
        />
        <div className="hero-identity-fields-row">
          <input
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitAll(); }
              if (e.key === 'Escape') { setIsEditing(false); }
            }}
            placeholder="Creator"
            className="hero-identity-input"
            disabled={isSaving}
          />
          <input
            type="number"
            value={ageValue}
            onChange={(e) => setAgeValue(e.target.value)}
            onBlur={saveAge}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitAll(); }
              if (e.key === 'Escape') { setIsEditing(false); }
            }}
            placeholder="Age"
            className="hero-identity-input hero-identity-input-age"
            disabled={isSaving}
            min="0"
          />
          <button
            type="button"
            className="hero-identity-done"
            onClick={commitAll}
            disabled={isSaving}
            title="Done"
          >
            {isSaving ? '…' : 'Done'}
          </button>
        </div>
      </div>

      {isAdmin && (
        <button
          type="button"
          className="hero-identity-id"
          onClick={handleCopyId}
          title="Copy creation ID"
        >
          <span className="hero-identity-id-text">{creationId}</span>
          {copySuccess ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
