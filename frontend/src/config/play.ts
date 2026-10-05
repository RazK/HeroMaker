import { CreationResponse } from '../api/client';

type HeroRef = Pick<CreationResponse, 'id' | 'user_id' | 'character_name' | 'name'>;

/**
 * The hero's VRM as every 3D view loads it: the web-optimized copy the backend
 * serves as opt_avatar.vrm (~1.5 MB instead of ~9 MB, visually identical).
 *
 * RELATIVE, never API_BASE_URL: the game pages only accept a same-origin URL,
 * and nginx proxies /api/ to the backend in every environment. The hero page
 * and the Dance party page both use exactly this URL, so the second one finds
 * the file in the browser cache.
 */
export function heroVrmUrl(creation: Pick<CreationResponse, 'id' | 'user_id'>): string {
  return `/api/files/${creation.user_id}/${creation.id}/opt_avatar.vrm`;
}

/**
 * The camera game, Dance party: a page of the game build (games/hero-moves)
 * served under /play/. It loads the hero it is given with ?vrm= and labels it
 * with ?name=. The moves a hero can do without a camera live on its own page.
 */
export function playUrl(creation: HeroRef): string {
  const name = creation.character_name || creation.name || 'Your hero';
  return `/play/index.html?vrm=${encodeURIComponent(heroVrmUrl(creation))}&name=${encodeURIComponent(name)}`;
}

export function canPlay(creation: Pick<CreationResponse, 'steps'>): boolean {
  return creation.steps.some((s) => s.step_name === 'convert_vrm' && s.status === 'completed');
}
