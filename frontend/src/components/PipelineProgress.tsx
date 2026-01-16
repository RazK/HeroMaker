import { useState } from 'react';
import { CreationResponse, CreationStepResponse } from '../api/client';
import { StepCard } from './StepCard';
import { ControlBar } from './ControlBar';
import { PreviewModal } from './PreviewModal';
import { getStepByName } from '../config/steps';
import { api } from '../api/client';
import './PipelineProgress.css';

interface PipelineProgressProps {
  creation: CreationResponse;
  creditBalance?: number;
  isLoggedIn: boolean;
  onStepRun?: (stepName: string) => void;
  onCreationRefresh?: () => Promise<void>;
  onDelete?: () => void;
}

/**
 * Calculate which step is "ready" (first non-completed step)
 * Returns the step name that should be enabled, or null if all completed
 */
function getReadyStepName(steps: CreationStepResponse[]): string | null {
  for (const step of steps) {
    // Skip if processing - that step is already running
    if (step.status === 'processing') {
      return null; // No step is "ready" when one is processing
    }
    // First non-completed step is ready
    if (step.status !== 'completed') {
      return step.step_name;
    }
  }
  return null; // All completed
}

export function calculateOverallProgress(creation: CreationResponse): number {
  if (creation.steps.length === 0) return 0;
  const completed = creation.steps.filter((s) => s.status === 'completed').length;
  return Math.round((completed / creation.steps.length) * 100);
}

export function PipelineProgress({ creation, creditBalance, isLoggedIn, onStepRun, onCreationRefresh, onDelete }: PipelineProgressProps) {
  const [previewStep, setPreviewStep] = useState<CreationStepResponse | null>(null);

  // Filter out convert_vrm step - it's represented in the ControlBar
  const visibleSteps = creation.steps.filter((step) => step.step_name !== 'convert_vrm');
  
  // Calculate which step is ready
  const readyStepName = getReadyStepName(creation.steps);

  // Get file URLs for preview modal
  const getPreviewData = (step: CreationStepResponse) => {
    const config = getStepByName(step.step_name);
    const outputFile = config?.output_file;
    
    if (!outputFile) return null;

    const walkingGlbFilename = (step.step_name === 'meshy_rig' && step.metadata_json?.walking_glb_url) 
      ? step.metadata_json.walking_glb_url 
      : null;
    
    const modelFile = (step.step_name === 'meshy_rig' && walkingGlbFilename) 
      ? walkingGlbFilename 
      : outputFile;
    
    const fileUrl = api.getFileUrl(creation.id, modelFile, creation.user_id);
    const walkingUrl = walkingGlbFilename 
      ? api.getFileUrl(creation.id, walkingGlbFilename, creation.user_id) 
      : null;
    const riggedUrl = step.step_name === 'meshy_rig' 
      ? api.getFileUrl(creation.id, outputFile, creation.user_id) 
      : null;

    return {
      fileUrl,
      outputFile,
      walkingUrl,
      riggedUrl,
      displayName: config?.display_name || step.step_name,
    };
  };

  const handlePreviewClick = (step: CreationStepResponse) => {
    if (step.status === 'completed') {
      setPreviewStep(step);
    }
  };

  const handleClosePreview = () => {
    setPreviewStep(null);
  };

  const previewData = previewStep ? getPreviewData(previewStep) : null;

  return (
    <div className="pipeline-progress">
      <div className="pipeline-steps">
        {visibleSteps.map((step, index) => {
          const config = getStepByName(step.step_name);
          return (
            <StepCard 
              key={step.step_name} 
              step={step} 
              creationId={creation.id}
              userId={creation.user_id}
              stepIndex={index}
              isReady={step.step_name === readyStepName}
              displayName={config?.display_name || step.step_name}
              outputFile={config?.output_file}
              stepCost={config?.credit_cost || 0}
              creditBalance={creditBalance}
              onStepRun={onStepRun}
              onCreationRefresh={onCreationRefresh}
              onPreviewClick={() => handlePreviewClick(step)}
            />
          );
        })}
      </div>
      
      <ControlBar 
        creation={creation}
        isLoggedIn={isLoggedIn}
        onDelete={onDelete}
        onCreationRefresh={onCreationRefresh}
      />

      {/* Preview Modal for 3D interaction */}
      {previewStep && previewData && (
        <PreviewModal
          isOpen={true}
          onClose={handleClosePreview}
          creationId={creation.id}
          userId={creation.user_id}
          stepName={previewStep.step_name}
          displayName={previewData.displayName}
          fileUrl={previewData.fileUrl}
          outputFile={previewData.outputFile}
          walkingUrl={previewData.walkingUrl}
          riggedUrl={previewData.riggedUrl}
        />
      )}
    </div>
  );
}
