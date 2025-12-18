import { CreationResponse } from '../api/client';
import { StepCard } from './StepCard';
import './PipelineProgress.css';

interface PipelineProgressProps {
  creation: CreationResponse;
}

export function calculateOverallProgress(creation: CreationResponse): number {
  // Exclude the "complete" and "convert_vrm" steps from progress calculation
  const visibleSteps = creation.steps.filter((s) => s.step_name !== 'complete' && s.step_name !== 'convert_vrm');
  if (visibleSteps.length === 0) return 0;
  const completed = visibleSteps.filter((s) => s.status === 'completed').length;
  return Math.round((completed / visibleSteps.length) * 100);
}

export function PipelineProgress({ creation }: PipelineProgressProps) {
  // Filter out the "complete" and "convert_vrm" steps - they don't need their own cards
  const visibleSteps = creation.steps.filter((step) => step.step_name !== 'complete' && step.step_name !== 'convert_vrm');
  
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
            creationStatus={creation.status}
          />
        ))}
      </div>
    </div>
  );
}

