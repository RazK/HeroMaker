import { CreationResponse, CreationStepResponse } from '../../api/client';
import { getStepCost } from '../../config/steps';
import { IconName } from './Icon';

/** What each pipeline step is called on screen, in plain words. */
export const STEP_UI: Record<string, { label: string; icon: IconName }> = {
  image_processing: { label: 'Reading the drawing', icon: 'scan' },
  openai_render: { label: 'Painting it', icon: 'brush' },
  meshy_3d: { label: 'Sculpting in 3D', icon: 'cube' },
  meshy_rig: { label: 'Teaching it to move', icon: 'run' },
  convert_vrm: { label: 'Packing the hero', icon: 'box' },
};

export type HeroState = 'ready' | 'making' | 'failed' | 'idle';

export function heroState(c: CreationResponse): HeroState {
  if (c.steps.some((s) => s.status === 'processing')) return 'making';
  if (c.steps.length && c.steps.every((s) => s.status === 'completed')) return 'ready';
  if (c.steps.some((s) => s.status === 'failed')) return 'failed';
  if (c.steps.some((s) => s.status === 'completed')) return 'making';
  return 'idle';
}

/** The step on screen now: the one running, else the one that failed, else the next to run. */
export function currentStep(c: CreationResponse): CreationStepResponse | undefined {
  return c.steps.find((s) => s.status === 'processing')
    ?? c.steps.find((s) => s.status === 'failed')
    ?? c.steps.find((s) => s.status !== 'completed');
}

export function stepViews(c: CreationResponse) {
  return c.steps.map((s) => ({
    icon: STEP_UI[s.step_name]?.icon ?? 'box',
    state: s.status === 'completed' ? 'done' as const
      : s.status === 'processing' ? 'now' as const
      : s.status === 'failed' ? 'failed' as const
      : 'next' as const,
  }));
}

/** Credits it takes to run every step that is not done yet. */
export function remainingCost(c: CreationResponse): number {
  return c.steps.filter((s) => s.status === 'pending' || s.status === 'failed').reduce((n, s) => n + getStepCost(s.step_name), 0);
}

function asUtc(t: string): number {
  return new Date(t.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(t) ? t : `${t}Z`).getTime();
}

/** "About 4 min", from the running step's own estimate. */
export function etaText(step: CreationStepResponse | undefined, now = Date.now()): string {
  if (!step || step.status !== 'processing' || !step.estimated_completion_time) return '';
  const left = asUtc(step.estimated_completion_time) - now;
  if (left <= 30_000) return 'Almost done';
  const min = Math.ceil(left / 60_000);
  return `About ${min} min`;
}

export function heroName(c: CreationResponse): string {
  return c.character_name || 'Your hero';
}
