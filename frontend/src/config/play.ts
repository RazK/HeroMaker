import { CreationResponse } from '../api/client';

/**
 * The game page for one hero. The game (games/hero-moves, reel.html) is built
 * into this image under /play/ and loads the hero it is given with ?vrm=.
 *
 * The VRM path is deliberately RELATIVE, never API_BASE_URL: the game only
 * accepts a same-origin URL, and nginx proxies /api/ to the backend in every
 * environment, so this works whether or not the SPA itself calls the backend
 * directly.
 */
export function playUrl(creation: Pick<CreationResponse, 'id' | 'user_id' | 'character_name' | 'name'>): string {
  const vrm = `/api/files/${creation.user_id}/${creation.id}/avatar.vrm`;
  const name = creation.character_name || creation.name || 'Your hero';
  return `/play/reel.html?vrm=${encodeURIComponent(vrm)}&name=${encodeURIComponent(name)}`;
}

export function canPlay(creation: Pick<CreationResponse, 'steps'>): boolean {
  return creation.steps.some((s) => s.step_name === 'convert_vrm' && s.status === 'completed');
}
