import { useState, useEffect, useRef } from 'react';
import { FileUpload } from './components/FileUpload';
import { HeaderUploadButtons } from './components/HeaderUploadButtons';
import { HeaderAuth } from './components/HeaderAuth';
import { PipelineProgress } from './components/PipelineProgress';
import { CreationGallery } from './components/CreationGallery';
import { HeroNameEditor } from './components/HeroNameEditor';
import { useCreationPolling } from './hooks/useCreationPolling';
import { api, CreationResponse, ApiError } from './api/client';
import './App.css';

function App() {
  const [creation, setCreation] = useState<CreationResponse | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWebcamModal, setShowWebcamModal] = useState(false);
  const hasStartedRef = useRef<string | null>(null);

  const handleUpload = async (file: File, characterName?: string) => {
    console.log('[App] handleUpload:', { filename: file.name, characterName });
    setIsUploading(true);
    setError(null);

    try {
      const newCreation = await api.uploadImage(file, characterName);
      console.log('[App] Upload successful:', {
        creationId: newCreation.id,
        status: newCreation.status,
        stepsCount: newCreation.steps.length,
      });
      setCreation(newCreation);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to upload image';
      console.error('[App] Upload failed:', err);
      setError(message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartPipeline = async () => {
    if (!creation) {
      console.warn('[App] handleStartPipeline called but no creation');
      return;
    }

    console.log('[App] handleStartPipeline:', { creationId: creation.id });
    setIsStarting(true);
    setError(null);

    try {
      await api.runPipeline(creation.id);
      console.log('[App] Pipeline start successful');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to start pipeline';
      console.error('[App] Pipeline start failed:', err);
      setError(message);
    } finally {
      setIsStarting(false);
    }
  };

  const handleSelectCreation = (selectedCreation: CreationResponse) => {
    console.log('[App] Creation selected:', {
      creationId: selectedCreation.id,
      status: selectedCreation.status,
      stepsCount: selectedCreation.steps.length,
    });
    setCreation(selectedCreation);
    setError(null);
  };

  // Auto-start pipeline after upload
  useEffect(() => {
    if (creation && creation.status === 'pending' && hasStartedRef.current !== creation.id) {
      console.log('[App] Auto-starting pipeline:', { creationId: creation.id });
      hasStartedRef.current = creation.id;
      handleStartPipeline();
    }
  }, [creation?.id, creation?.status]);

  // Poll for updates - poll if status is pending, processing, or failed (user might retry)
  const shouldPoll = creation && (creation.status === 'pending' || creation.status === 'processing' || creation.status === 'failed');
  useCreationPolling(shouldPoll ? creation.id : null, (updatedCreation) => {
    console.log('[App] Creation updated:', {
      creationId: updatedCreation.id,
      status: updatedCreation.status,
      currentStep: updatedCreation.current_step,
      completedSteps: updatedCreation.steps.filter(s => s.status === 'completed').length,
    });
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
          />
        </div>
        <div 
          className="app-header-center"
          onClick={() => {
            setCreation(null);
            setError(null);
          }}
          style={{ cursor: 'pointer' }}
        >
          <img src="/logo-head-transparent.png" alt="HeroMaker Logo" className="app-logo" />
          <h1>HeroMaker</h1>
        </div>
        <div className="app-header-right">
          <HeaderAuth />
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
        />
      )}

      <main className="app-main">
        {error && (
          <div className="app-error">
            <strong>Error:</strong> {error}
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {!creation ? (
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
              onCharacterNameUpdated={(newName) => {
                setCreation({ ...creation, character_name: newName });
              }}
              onNameUpdated={(newName) => {
                setCreation({ ...creation, name: newName });
              }}
              onAgeUpdated={(newAge) => {
                setCreation({ ...creation, age: newAge });
              }}
              onDelete={() => {
                setCreation(null);
                setError(null);
              }}
              onRestart={async () => {
                // Refresh the creation after restart
                try {
                  const updated = await api.getCreation(creation.id);
                  setCreation(updated);
                } catch (err) {
                  console.error('[App] Failed to refresh creation after restart:', err);
                }
              }}
            />
            
            {creation.status === 'pending' && (
              <div className="app-pending-notice">
                <p>Pipeline is ready to start. Starting automatically...</p>
                {isStarting && (
                  <div className="app-loading">
                    <div className="spinner"></div>
                  </div>
                )}
              </div>
            )}

            <PipelineProgress 
              creation={creation}
              onStepRetry={(stepName) => {
                // Immediately mark step as processing with estimated time
                const stepDurations: Record<string, number> = {
                  image_processing: 1,
                  openai_render: 60,
                  meshy_3d: 180,
                  meshy_rig: 30,
                  convert_vrm: 3,
                };
                const duration = stepDurations[stepName] || 30;
                
                // Update creation to show step as processing
                if (creation) {
                  const updatedSteps = creation.steps.map(s => 
                    s.step_name === stepName 
                      ? { 
                          ...s, 
                          status: 'processing' as const,
                          error_message: null,
                          started_at: new Date().toISOString(),
                          estimated_completion_time: new Date(Date.now() + duration * 1000).toISOString()
                        }
                      : s
                  );
                  setCreation({ ...creation, steps: updatedSteps, status: 'processing' });
                }
              }}
            />
          </div>
        )}
      </main>
      
      <footer className="app-footer">
        <div className="app-footer-content">
          <span className="app-footer-name">Raz Karl</span>
          <span className="app-footer-normal">&</span>
          <span className="app-footer-name">Elad Shikley</span>
          <span className="app-footer-normal">Hanukkah 2025 ©</span>
        </div>
      </footer>
    </div>
  );
}

export default App;

