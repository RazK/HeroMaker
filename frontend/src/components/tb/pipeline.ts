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

/** Where an estimate stops: it never claims a step is nearly done when nobody said so. */
const ESTIMATE_CEILING = 90;

/**
 * How far a step that reports no progress probably is, from how long it has
 * run against how long it usually takes. Eases toward 90%: ~78% at the
 * typical time, ~88% at twice it, never more.
 */
export function estimatedPct(elapsedMs: number, typicalMs: number): number {
  if (!(typicalMs > 0)) return 0;
  return ESTIMATE_CEILING * (1 - Math.exp((-2 * Math.max(0, elapsedMs)) / typicalMs));
}

export interface StepProgress {
  /** What the bar shows, 0-99: only a finished step is 100. */
  pct: number;
  /** The provider reported `pct` (Meshy). Otherwise it is estimated from elapsed time. */
  real: boolean;
  /** When the step should end, epoch ms; null when nothing is known. */
  endsAt: number | null;
}

/** The running step's progress, real when the provider reports it, else estimated. */
export function stepProgress(step: CreationStepResponse | undefined, now = Date.now()): StepProgress | null {
  if (!step || step.status !== 'processing') return null;
  const typicalMs = (step.estimated_duration ?? 0) * 1000;
  const startedAt = step.started_at ? Math.min(now, asUtc(step.started_at)) : now;
  const endsAt = step.estimated_completion_time
    ? asUtc(step.estimated_completion_time)
    : typicalMs ? startedAt + typicalMs : null;
  if (typeof step.progress === 'number') {
    return { pct: Math.max(0, Math.min(99, step.progress)), real: true, endsAt };
  }
  return { pct: estimatedPct(now - startedAt, typicalMs), real: false, endsAt };
}

/**
 * The bar never goes backwards and the time left never jumps up, within one
 * run of one step: a later poll can only move them toward done.
 */
export function holdSteady(prev: (StepProgress & { key: string }) | null, key: string, next: StepProgress): StepProgress & { key: string } {
  if (!prev || prev.key !== key) return { ...next, key };
  return {
    key,
    real: next.real,
    pct: Math.max(prev.pct, next.pct),
    endsAt: prev.endsAt === null ? next.endsAt : next.endsAt === null ? prev.endsAt : Math.min(prev.endsAt, next.endsAt),
  };
}

/** "About 3 min left", counting down through "Under a minute" to "Almost done…". */
export function etaText(endsAt: number | null, now = Date.now()): string {
  if (endsAt === null) return '';
  const left = endsAt - now;
  if (left < -60_000) return 'Taking a bit longer';
  if (left <= 15_000) return 'Almost done…';
  if (left < 60_000) return 'Under a minute';
  return `About ${Math.ceil(left / 60_000)} min left`;
}

export function heroName(c: CreationResponse): string {
  return c.character_name || 'Your hero';
}
