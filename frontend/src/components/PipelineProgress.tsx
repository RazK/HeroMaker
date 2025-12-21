import { CreationResponse } from '../api/client';
import { StepCard } from './StepCard';
import './PipelineProgress.css';

interface PipelineProgressProps {
  creation: CreationResponse;
  onStepRetry?: (stepName: string) => void;
}

export function calculateOverallProgress(creation: CreationResponse): number {
  // Exclude the "complete" and "convert_vrm" steps from progress calculation
  const visibleSteps = creation.steps.filter((s) => s.step_name !== 'complete' && s.step_name !== 'convert_vrm');
  if (visibleSteps.length === 0) return 0;
  const completed = visibleSteps.filter((s) => s.status === 'completed').length;
  return Math.round((completed / visibleSteps.length) * 100);
}

export function PipelineProgress({ creation, onStepRetry }: PipelineProgressProps) {
  // Filter out the "complete" step - it doesn't need its own card
  // Show "convert_vrm" step if it failed (so user can see the error)
  const visibleSteps = creation.steps.filter((step) => {
    if (step.step_name === 'complete') {
      return false;
    }
    // Show convert_vrm if it failed, otherwise hide it
    if (step.step_name === 'convert_vrm') {
      return step.status === 'failed';
    }
    return true;
  });
  
  // Recalculate step indices for visible steps only
  const visibleStepsWithIndex = visibleSteps.map((step, index) => ({
    step,
    index,
  }));

  return (
    <div className="pipeline-progress">
      <div className="pipeline-steps">
        {visibleStepsWithIndex.map(({ step, index }) => (
          <StepCard 
            key={step.step_name} 
            step={step} 
            creationId={creation.id} 
            stepIndex={index}
            onStepRetry={onStepRetry}
          />
        ))}
      </div>
    </div>
  );
}






