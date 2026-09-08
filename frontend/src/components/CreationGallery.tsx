import { useState, useEffect } from 'react';
import { api, CreationResponse, getAuthToken } from '../api/client';
import { calculateOverallProgress } from './PipelineProgress';
import './CreationGallery.css';

interface CreationGalleryProps {
  onSelectCreation: (creation: CreationResponse) => void;
}

interface User {
  id: string;
  username: string;
  is_admin?: boolean;
}

/*
 * The two dropdowns show only their current value ("All", "Newest") so they can
 * be sized to their own content and leave the rest of the line to the search
 * box. `label` is what the native option list says, `short` is what the closed
 * chip shows.
 */
const STATUS_OPTIONS = [
  { value: 'all', label: 'All', short: 'All' },
  { value: 'completed', label: 'Done', short: 'Done' },
  { value: 'failed', label: 'Failed', short: 'Failed' },
] as const;

const SORT_OPTIONS = [
  { value: 'updated-newest', label: 'Last modified: newest first', short: 'Newest' },
  { value: 'updated-oldest', label: 'Last modified: oldest first', short: 'Oldest' },
  { value: 'created-newest', label: 'Created: newest first', short: 'Newest made' },
  { value: 'created-oldest', label: 'Created: oldest first', short: 'Oldest made' },
] as const;

export function CreationGallery({ onSelectCreation }: CreationGalleryProps) {
  const [creations, setCreations] = useState<CreationResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'failed'>('completed');
  const [ownershipFilter, setOwnershipFilter] = useState<'everyone' | 'my'>('everyone');
  const [user, setUser] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'created' | 'updated'>('updated');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [hoveredCreationId, setHoveredCreationId] = useState<string | null>(null);
  const [copiedCreationId, setCopiedCreationId] = useState<string | null>(null);

  // Check auth status on mount and listen for auth changes
  useEffect(() => {
    const checkAuth = async () => {
      const token = getAuthToken();
      if (!token) {
        setUser(null);
        setOwnershipFilter('everyone');
        return;
      }
      try {
        const userData = await api.getMe();
        setUser(userData);
      } catch {
        setUser(null);
        setOwnershipFilter('everyone');
      }
    };
    
    checkAuth();
    
    // Listen for auth events
    const handleAuthChange = () => checkAuth();
    window.addEventListener('auth:login', handleAuthChange);
    window.addEventListener('auth:logout', handleAuthChange);
    window.addEventListener('auth:unauthorized', handleAuthChange);
    
    return () => {
      window.removeEventListener('auth:login', handleAuthChange);
      window.removeEventListener('auth:logout', handleAuthChange);
      window.removeEventListener('auth:unauthorized', handleAuthChange);
    };
  }, []);

  // Load creations on mount and when ownership filter changes
  useEffect(() => {
    loadCreations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownershipFilter]);

  // Update every second for time remaining
  useEffect(() => {
    const hasProcessing = creations.some(c => c.status === 'processing');
    if (hasProcessing) {
      const interval = setInterval(() => {
        setTick(t => t + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [creations]);

  const loadCreations = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Determine if we should filter to only user's creations
      const mineOnly = ownershipFilter === 'my' && !!user;
      
      // Load all creations in a single call (backend returns all)
      const result = await api.listCreations(0, 0, mineOnly);
      const allCreations = result.creations;

      console.log(`[CreationGallery] Loaded ${allCreations.length} creations, filter=${ownershipFilter}`);
      
      console.log(`[CreationGallery] Total creations loaded: ${allCreations.length}`);
      console.log('[CreationGallery] Creation IDs:', allCreations.map(c => c.id));
      console.log('[CreationGallery] Creation statuses:', allCreations.map(c => ({ id: c.id, status: c.status })));
      
      // Show all creations that have an original image
      const filteredCreations = allCreations.filter(creation => {
        // Only show if it has an original image
        try {
          const originalUrl = api.getFileUrl(creation.id, 'original.jpg', creation.user_id);
          return !!originalUrl;
        } catch {
          return false;
        }
      });
      
      console.log(`[CreationGallery] Creations with original image: ${filteredCreations.length}`);
      
      setCreations(filteredCreations);
    } catch (err) {
      console.error('[CreationGallery] Failed to load creations:', err);
      setError('Failed to load creations');
    } finally {
      setIsLoading(false);
    }
  };

  const getImageUrl = (creation: CreationResponse, filename: string): string | null => {
    try {
      return api.getFileUrl(creation.id, filename, creation.user_id);
    } catch {
      return null;
    }
  };

  const getTimeRemaining = (creation: CreationResponse): string | null => {
    if (creation.status !== 'processing' || !creation.steps || creation.steps.length === 0) {
      return null;
    }
    
    // Find the current processing step
    const processingStep = creation.steps.find(step => step.status === 'processing');
    if (!processingStep || !processingStep.estimated_completion_time || !processingStep.started_at) {
      return null;
    }

    const now = new Date().getTime();
    const estimatedAt = processingStep.estimated_completion_time.endsWith('Z') || processingStep.estimated_completion_time.match(/[+-]\d{2}:\d{2}$/)
      ? processingStep.estimated_completion_time
      : processingStep.estimated_completion_time + 'Z';
    
    const estimated = new Date(estimatedAt).getTime();
    const remaining = estimated - now;

    if (remaining <= 0) {
      return 'Anytime now...';
    }

    const seconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes > 0) {
      return `~${minutes}m ${seconds % 60}s`;
    } else {
      return `~${seconds}s`;
    }
  };

  const getCurrentStepName = (creation: CreationResponse): string | null => {
    if (creation.status !== 'processing' || !creation.steps) {
      return null;
    }
    
    const processingStep = creation.steps.find(step => step.status === 'processing');
    if (!processingStep) {
      return null;
    }

    const stepNames: Record<string, string> = {
      image_processing: 'Processing Image',
      openai_render: 'AI Rendering',
      meshy_3d: '3D Modeling',
      meshy_rig: 'Rigging',
      convert_vrm: 'VRM Conversion',
    };

    return stepNames[processingStep.step_name] || processingStep.step_name;
  };

  const handleCopyCreationId = async (e: React.MouseEvent, creationId: string) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(creationId);
      setCopiedCreationId(creationId);
      setTimeout(() => setCopiedCreationId(null), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  // Filter creations based on status and search query
  const filteredCreations = creations.filter(creation => {
    // Status filter
    if (statusFilter === 'completed' && creation.status !== 'completed') return false;
    if (statusFilter === 'failed' && creation.status !== 'failed') return false;
    
    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      const matchesName = creation.character_name?.toLowerCase().includes(query) ?? false;
      const matchesCreator = creation.name?.toLowerCase().includes(query) ?? false;
      const matchesAge = creation.age?.toString().includes(query) ?? false;
      if (!matchesName && !matchesCreator && !matchesAge) return false;
    }
    
    return true;
  });

  // Sort filtered creations
  const sortedCreations = [...filteredCreations].sort((a, b) => {
    const getDate = (creation: CreationResponse) => {
      if (sortBy === 'created') {
        return new Date(creation.created_at).getTime();
      } else {
        return new Date(creation.updated_at).getTime();
      }
    };
    
    const dateA = getDate(a);
    const dateB = getDate(b);
    
    if (sortOrder === 'newest') {
      return dateB - dateA; // Newest first
    } else {
      return dateA - dateB; // Oldest first
    }
  });

  const sortValue = `${sortBy}-${sortOrder}`;
  const statusLabel = STATUS_OPTIONS.find(o => o.value === statusFilter)?.short ?? 'All';
  const sortLabel = SORT_OPTIONS.find(o => o.value === sortValue)?.short ?? 'Newest';
  // "14 of 104" while filtered, just the total when nothing is filtered out.
  const countLabel = filteredCreations.length === creations.length
    ? `${creations.length}`
    : `${filteredCreations.length} of ${creations.length}`;

  if (isLoading) {
    return (
      <div className="creation-gallery-loading">
        <div className="spinner"></div>
        <p>Loading creations...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="creation-gallery-error">
        <p>{error}</p>
        <button onClick={loadCreations}>Retry</button>
      </div>
    );
  }

  if (creations.length === 0) {
    return (
      <div className="creation-gallery-empty">
        <p>No creations found. Upload an image to get started!</p>
      </div>
    );
  }

  return (
    <div className="creation-gallery">
      {user && (
        <div className="creation-gallery-header">
          <div className="creation-gallery-scope" role="group" aria-label="Whose creations to show">
            <button
              type="button"
              className={`creation-gallery-scope-button ${ownershipFilter === 'my' ? 'is-active' : ''}`}
              aria-pressed={ownershipFilter === 'my'}
              onClick={() => setOwnershipFilter('my')}
            >
              Mine
            </button>
            <button
              type="button"
              className={`creation-gallery-scope-button ${ownershipFilter === 'everyone' ? 'is-active' : ''}`}
              aria-pressed={ownershipFilter === 'everyone'}
              onClick={() => setOwnershipFilter('everyone')}
            >
              Everyone
            </button>
          </div>
        </div>
      )}
      {/*
       * One line: status, sort, search. The two chips are sized to the text of
       * their current value and the search box takes every pixel that is left,
       * which is what keeps this usable at 360px.
       */}
      <div className="creation-gallery-controls">
        <span className="creation-gallery-chip">
          <span className="creation-gallery-chip-value">{statusLabel}</span>
          <svg className="creation-gallery-chip-caret" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
            <path fill="currentColor" d="M6 8.5 1.5 4h9z" />
          </svg>
          <select
            className="creation-gallery-chip-select creation-gallery-status-select"
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'completed' | 'failed')}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </span>
        <span className="creation-gallery-chip">
          <span className="creation-gallery-chip-value">{sortLabel}</span>
          <svg className="creation-gallery-chip-caret" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
            <path fill="currentColor" d="M6 8.5 1.5 4h9z" />
          </svg>
          <select
            className="creation-gallery-chip-select creation-gallery-sort-select"
            aria-label="Sort creations"
            value={sortValue}
            onChange={(e) => {
              const [by, order] = e.target.value.split('-');
              setSortBy(by as 'created' | 'updated');
              setSortOrder(order as 'newest' | 'oldest');
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </span>
        <div className="creation-gallery-search">
          <svg className="creation-gallery-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="text"
            className="creation-gallery-search-input"
            placeholder="Search heroes"
            aria-label="Search creations by name, creator, or age"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {/* The count rides at the right end of the search field, not on a row of its own. */}
          <span className="creation-gallery-search-count">{countLabel}</span>
        </div>
      </div>
      {sortedCreations.length === 0 ? (
        <div className="creation-gallery-empty">
          <p>No creations match your filters. Try adjusting your search or filter.</p>
        </div>
      ) : (
        <div className="creation-gallery-grid">
          {sortedCreations.map((creation) => {
          const originalUrl = getImageUrl(creation, 'thumb_original.jpg');
          const renderedUrl = getImageUrl(creation, 'thumb_rendered.png');
          const isCompleted = creation.status === 'completed';
          const hasBothImages = (originalUrl && renderedUrl) || false;
          const timeRemaining = getTimeRemaining(creation);
          const currentStep = getCurrentStepName(creation);
          const progress = !isCompleted ? calculateOverallProgress(creation) : null;
          // "Maya · 7" - the child who drew it, and their age.
          const byline = [creation.name, creation.age ? String(creation.age) : null]
            .filter(Boolean)
            .join(' · ');

          return (
            <div
              key={creation.id}
              className="creation-gallery-item"
              onClick={() => onSelectCreation(creation)}
              onMouseEnter={() => setHoveredCreationId(creation.id)}
              onMouseLeave={() => setHoveredCreationId(null)}
            >
              {originalUrl ? (
                <div
                  className="creation-gallery-image-container"
                  /*
                   * The drawings and the renders are 3:4, the tile is square, so
                   * the leftover space is filled with a blown-up blur of the same
                   * picture rather than cropping the character's head and feet
                   * off. Passed as custom properties so the two fills can live on
                   * ::before / ::after and cost no extra elements.
                   */
                  style={{
                    ['--gallery-fill-original' as string]: `url("${originalUrl}")`,
                    ['--gallery-fill-rendered' as string]: renderedUrl ? `url("${renderedUrl}")` : 'none',
                  }}
                >
                  {hasBothImages ? (
                    <>
                      <img
                        src={originalUrl}
                        loading="lazy"
                        width={300}
                        height={300}
                        alt={creation.character_name || 'Creation'}
                        className="creation-gallery-image creation-gallery-image-original"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <img
                        src={renderedUrl!}
                        loading="lazy"
                        width={300}
                        height={300}
                        alt={creation.character_name || 'Creation'}
                        className="creation-gallery-image creation-gallery-image-rendered"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </>
                  ) : (
                    <img
                      src={originalUrl}
                      loading="lazy"
                      width={300}
                      height={300}
                      alt={creation.character_name || 'Creation'}
                      className="creation-gallery-image"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <div className="creation-gallery-overlay">
                    {hoveredCreationId === creation.id && (
                      <div className="creation-gallery-overlay-top">
                        <div className="creation-gallery-creation-id-hover">
                          <button
                            className="creation-gallery-copy-id-button"
                            onClick={(e) => handleCopyCreationId(e, creation.id)}
                            title="Copy creation ID"
                          >
                            {copiedCreationId === creation.id ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            )}
                          </button>
                          {/* Short form only - the full id is what the button copies,
                              and a whole UUID does not fit a tile. */}
                          <span className="creation-gallery-creation-id-text" title={creation.id}>
                            {creation.id.slice(0, 8)}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className={`creation-gallery-overlay-bottom ${!isCompleted && progress !== null ? 'has-progress' : ''}`}>
                      <div className="creation-gallery-overlay-column creation-gallery-overlay-names">
                        {/*
                         * Hero name in bold with "creator · age" underneath.
                         * Both lines stay put while the picture cross-fades -
                         * the names used to swap with the images, which made
                         * the caption unreadable while you scrolled.
                         */}
                        <div className="creation-gallery-caption">
                          {creation.character_name && (
                            <div className="creation-gallery-hero-name">{creation.character_name}</div>
                          )}
                          {byline && (
                            <div className="creation-gallery-byline">{byline}</div>
                          )}
                        </div>
                      </div>
                      
                      {!isCompleted && progress !== null && (
                        <div className="creation-gallery-overlay-column creation-gallery-overlay-progress">
                          <div className="creation-gallery-progress-bar">
                            <div 
                              className="creation-gallery-progress-fill"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      
                      <div className="creation-gallery-overlay-column creation-gallery-overlay-status">
                        {!isCompleted && (currentStep || timeRemaining) && (
                          <div className="creation-gallery-status-info">
                            {currentStep && (
                              <div className="creation-gallery-step-name">{currentStep}</div>
                            )}
                            {timeRemaining && (
                              <div className="creation-gallery-time">{timeRemaining}</div>
                            )}
                          </div>
                        )}
                        {/* A finished hero needs no badge - the picture is the
                            proof. Only the states that need attention show one. */}
                        {!isCompleted && (
                          <div className={`creation-gallery-status creation-gallery-status-${creation.status}`}>
                            {creation.status === 'processing' && '⟳'}
                            {creation.status === 'failed' && '✗'}
                            {creation.status === 'pending' && '○'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="creation-gallery-placeholder">
                  <div className="creation-gallery-placeholder-icon">📷</div>
                  <div className={`creation-gallery-status creation-gallery-status-${creation.status}`}>
                    {creation.status === 'completed' && '✓'}
                    {creation.status === 'processing' && '⟳'}
                    {creation.status === 'failed' && '✗'}
                    {creation.status === 'pending' && '○'}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
}






