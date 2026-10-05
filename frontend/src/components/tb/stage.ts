/**
 * The live 3D hero, borrowed from the game build at run time.
 *
 * games/hero-moves builds `herostage.js` beside its pages, and
 * devops/scripts/bundle-game.sh copies that build into public/play/ before
 * every image build, so it is served at /play/herostage.js. Importing it from
 * there (rather than bundling the game's source into this app) is what the
 * Docker build allows — Railway's build context is frontend/ alone — and it
 * gives the hero page and the Dance party page ONE copy of three.js, of each
 * animation clip and of the hero's VRM, all from the same URLs, so the second
 * page finds them in the browser cache. None of it is in this app's bundle;
 * it is fetched when a hero page first opens.
 *
 * The types below are the module's contract (games/hero-moves/src/herostage.ts).
 */

export interface HeroStageInstance {
  showSculpt(url: string): Promise<void>;
  showHero(url: string): Promise<void>;
  movesReady(url: string): Promise<void>;
  /** Play a move now, cutting off the current one. False if it cannot. */
  play(id: string): boolean;
  /** Keep the top `px` of the stage clear (the intro's stepper sits there). */
  setInsetTop(px: number): void;
  clear(): void;
  dispose(): void;
}

export interface StageModule {
  MOVES: string[];
  /** Start downloading (once per page) and report progress 0..1. Returns an unsubscribe. */
  prefetch(url: string, onProgress?: (fraction: number) => void): () => void;
  prepareHero(url: string): Promise<void>;
  prepareSculpt(url: string): Promise<void>;
  HeroStage: new (container: HTMLElement, events?: { onPlaying?: (id: string | null) => void }) => HeroStageInstance;
}

export const STAGE_MODULE_URL = '/play/herostage.js';

let pending: Promise<StageModule> | null = null;

/** The stage module, fetched once. A failure is forgotten so the next hero retries. */
export function loadStage(): Promise<StageModule> {
  if (!pending) {
    pending = import(/* @vite-ignore */ STAGE_MODULE_URL) as Promise<StageModule>;
    pending.catch(() => { pending = null; });
  }
  return pending;
}
