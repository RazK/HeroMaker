import { useState, useEffect } from 'react';
import { FileUpload } from './components/FileUpload';
import { HeaderUploadButtons } from './components/HeaderUploadButtons';
import { HeaderAuth } from './components/HeaderAuth';
import { PipelineProgress } from './components/PipelineProgress';
import { CreationGallery } from './components/CreationGallery';
import { HeroNameEditor } from './components/HeroNameEditor';
import { AdminPanel } from './components/AdminPanel';
import { useCreationPolling } from './hooks/useCreationPolling';
import { api, CreationResponse, ApiError, getAuthToken } from './api/client';
import { loadStepConfig, getTotalCost } from './config/steps';
import './App.css';

function App() {
  const [creation, setCreation] = useState<CreationResponse | null>(null);
  const [uploadedFilePreview, setUploadedFilePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWebcamModal, setShowWebcamModal] = useState(false);
  const [showPostUploadActions, setShowPostUploadActions] = useState(false);
  const [pipelineCost, setPipelineCost] = useState<number>(0);
  const [creditBalance, setCreditBalance] = useState<number | undefined>(undefined);
  const [userInfo, setUserInfo] = useState<{ id: string; is_admin: boolean } | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  // Load step config on mount
  useEffect(() => {
    loadStepConfig()
      .then(() => {
        setPipelineCost(getTotalCost());
      })
      .catch(console.error);
  }, []);

  // Fetch credit balance and user info when auth state changes
  const refreshCreditBalance = async () => {
    const token = getAuthToken();
    if (!token) {
      setCreditBalance(undefined);
      setUserInfo(null);
      return;
    }
    try {
      const user = await api.getMe();
      setCreditBalance(user.credits);
      setUserInfo({ id: user.id, is_admin: user.is_admin });
      // Dispatch event to notify HeaderAuth to refresh
      window.dispatchEvent(new CustomEvent('auth:credits-updated', { detail: { credits: user.credits } }));
    } catch {
      setCreditBalance(undefined);
      setUserInfo(null);
    }
  };

  useEffect(() => {
    refreshCreditBalance();

    // Listen for auth events
    const handleAuthChange = () => refreshCreditBalance();
    const handleUnauthorized = () => setCreditBalance(undefined);

    window.addEventListener('auth:login', handleAuthChange);
    window.addEventListener('auth:logout', handleAuthChange);
    window.addEventListener('auth:unauthorized', handleUnauthorized);

    return () => {
      window.removeEventListener('auth:login', handleAuthChange);
      window.removeEventListener('auth:logout', handleAuthChange);
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  // Apply bright mode class to document root for admin users
  useEffect(() => {
    if (userInfo?.is_admin) {
      document.documentElement.classList.add('bright-mode');
    } else {
      document.documentElement.classList.remove('bright-mode');
    }
  }, [userInfo?.is_admin]);

  const handleUpload = async (file: File, characterName?: string) => {
    console.log('[App] handleUpload:', { filename: file.name, characterName });
    setIsUploading(true);
    setError(null);

    try {
      // Create preview for the modal
      const reader = new FileReader();
      reader.onload = (e) => {
        setUploadedFilePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);

      // Create creation and upload image
      const newCreation = await api.createCreation(file, characterName);
      console.log('[App] Creation successful:', {
        creationId: newCreation.id,
        status: newCreation.status,
      });
      
      setCreation(newCreation);
      setShowPostUploadActions(true);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to upload image';
      console.error('[App] Upload failed:', err);
      setError(message);
      setUploadedFilePreview(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartPipeline = async () => {
    if (!creation) return;

    setIsStarting(true);
    setError(null);

    try {
      // Run full pipeline (all steps automatically)
      await api.startPipeline(creation.id);
      window.dispatchEvent(new CustomEvent('creation:refresh-now', { detail: { creationId: creation.id } }));
      
      await refreshCreditBalance();
      setShowPostUploadActions(false);
      setUploadedFilePreview(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to start pipeline';
      console.error('[App] Pipeline start failed:', err);
      setError(message);
      await refreshCreditBalance();
    } finally {
      setIsStarting(false);
    }
  };

  const handleSelectCreation = async (selectedCreation: CreationResponse) => {
    console.log('[App] Creation selected:', {
      creationId: selectedCreation.id,
      status: selectedCreation.status,
      stepsCount: selectedCreation.steps.length,
    });
    setError(null);

    // Gallery items have no steps — fetch full creation details
    if (selectedCreation.steps.length === 0) {
      try {
        const full = await api.getCreation(selectedCreation.id);
        setCreation(full);
      } catch (err) {
        console.error('[App] Failed to fetch creation details:', err);
        // Fall back to the gallery item (will show without steps)
        setCreation(selectedCreation);
      }
    } else {
      setCreation(selectedCreation);
    }
  };

  // Note: Auto-start removed - modal now handles pipeline start

  // Poll for updates when there's a processing step
  const hasProcessingStep = creation?.steps.some(s => s.status === 'processing');
  const shouldPoll = creation && (hasProcessingStep || creation.status === 'pending');
  useCreationPolling(shouldPoll ? creation.id : null, (updatedCreation) => {
    setCreation(updatedCreation);
  });

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-left">
          <HeaderUploadButtons
            onUpload={handleUpload}
            onStartWebcam={() => setShowWebcamModal(true)}
            disabled={isUploading}
            isLoggedIn={creditBalance !== undefined}
          />
        </div>
        <div
          className="app-header-center"
          onClick={() => {
            setCreation(null);
            setError(null);
            setShowAdminPanel(false);
            // Scroll to top smoothly
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          style={{ cursor: 'pointer' }}
        >
          <img src="/logo-head-transparent.png" alt="HeroMaker Logo" className="app-logo" />
          <h1>HeroMaker</h1>
        </div>
        <div className="app-header-right">
          <HeaderAuth onOpenAdmin={() => setShowAdminPanel(true)} />
        </div>
      </header>
      
      {showWebcamModal && (
        <FileUpload
          onUpload={(file, characterName) => {
            handleUpload(file, characterName);
            setShowWebcamModal(false);
          }}
          disabled={isUploading}
          showWebcamOnMount={true}
          onClose={() => setShowWebcamModal(false)}
          creditBalance={creditBalance}
          creationCost={pipelineCost}
        />
      )}

      {showPostUploadActions && creation && (
        <div className="post-upload-actions-overlay">
          <div className="post-upload-actions-modal">
            <button
              className="post-upload-actions-close"
              onClick={() => {
                setShowPostUploadActions(false);
                setCreation(null);
                setUploadedFilePreview(null);
              }}
              disabled={isStarting}
            >
              ×
            </button>
            <h3>Make My Hero!</h3>
            {uploadedFilePreview && (
              <div className="post-upload-actions-preview">
                <img src={uploadedFilePreview} alt="Uploaded" />
              </div>
            )}
            <div className="post-upload-actions-buttons">
              <button
                className="post-upload-action-button post-upload-action-primary"
                onClick={handleStartPipeline}
                disabled={isStarting || (creditBalance !== undefined && pipelineCost > creditBalance)}
              >
                <span>{isStarting ? 'Creating...' : 'Go'}</span>
                {pipelineCost > 0 && <span className="post-upload-action-cost">🪙 {pipelineCost}</span>}
              </button>
              <button
                className="post-upload-action-button post-upload-action-secondary"
                onClick={() => {
                  setShowPostUploadActions(false);
                  setCreation(null);
                  setUploadedFilePreview(null);
                }}
                disabled={isStarting}
              >
                Cancel
              </button>
            </div>
            {creditBalance !== undefined && pipelineCost > creditBalance && (
              <div className="post-upload-actions-error">
                Insufficient credits. You have {creditBalance} but need {pipelineCost}.
              </div>
            )}
          </div>
        </div>
      )}

      <main className="app-main">
        {error && (
          <div className="app-error">
            <strong>Error:</strong> {error}
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {showAdminPanel && userInfo ? (
          <AdminPanel
            onClose={() => setShowAdminPanel(false)}
            currentUserId={userInfo.id}
          />
        ) : !creation ? (
          <div className="app-gallery-section">
            <CreationGallery 
              onSelectCreation={handleSelectCreation}
            />
          </div>
        ) : (
          <div className="app-pipeline-section">
            <HeroNameEditor
              creationId={creation.id}
              characterName={creation.character_name}
              name={creation.name}
              age={creation.age}
              isAdmin={userInfo?.is_admin ?? false}
              isLoggedIn={creditBalance !== undefined}
              onCharacterNameUpdated={(newName) => {
                setCreation({ ...creation, character_name: newName });
              }}
              onNameUpdated={(newName) => {
                setCreation({ ...creation, name: newName });
              }}
              onAgeUpdated={(newAge) => {
                setCreation({ ...creation, age: newAge });
              }}
            />

            <PipelineProgress
              creation={creation}
              creditBalance={creditBalance}
              isLoggedIn={creditBalance !== undefined}
              currentUserId={userInfo?.id}
              isAdmin={userInfo?.is_admin ?? false}
              onStepRun={() => {
                // Refresh credit balance after step starts
                refreshCreditBalance();
              }}
              onCreationRefresh={async () => {
                // Directly fetch and update creation state
                // This ensures UI updates even when polling was stopped
                try {
                  const updated = await api.getCreation(creation.id);
                  setCreation(updated);
                } catch (err) {
                  console.error('[App] Failed to refresh creation:', err);
                }
              }}
              onDelete={() => {
                setCreation(null);
                setError(null);
              }}
            />
          </div>
        )}
      </main>
      
      {!creation && (
        <footer className="app-footer">
          <div className="app-footer-content">
            <span className="app-footer-name">Raz Karl</span>
            <span className="app-footer-normal">&</span>
            <span className="app-footer-name">Elad Shikley</span>
            <span className="app-footer-normal">Hanukkah 2025 ©</span>
          </div>
        </footer>
      )}
    </div>
  );
}

export default App;

