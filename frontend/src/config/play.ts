import { CreationResponse } from '../api/client';

/**
 * The games a hero can be played in. Both are pages of one game build
 * (games/hero-moves), built into this image under /play/, and both load the
 * hero they are given with ?vrm= and label it with ?name=.
 *
 * The VRM path is deliberately RELATIVE, never API_BASE_URL: the games only
 * accept a same-origin URL, and nginx proxies /api/ to the backend in every
 * environment, so this works whether or not the SPA itself calls the backend
 * directly.
 */
export type GameId = 'stunt' | 'dance';

export interface Game {
  id: GameId;
  /** One to three words: the card says the rest with a picture. */
  name: string;
  page: string;
  /** Needs the webcam, so the card says so with a camera badge. */
  camera: boolean;
}

export const GAMES: Game[] = [
  { id: 'stunt', name: 'Stunt show', page: 'reel.html', camera: false },
  { id: 'dance', name: 'Dance party', page: 'index.html', camera: true },
];

export function playUrl(
  creation: Pick<CreationResponse, 'id' | 'user_id' | 'character_name' | 'name'>,
  game: GameId = 'stunt',
): string {
  const vrm = `/api/files/${creation.user_id}/${creation.id}/avatar.vrm`;
  const name = creation.character_name || creation.name || 'Your hero';
  const page = GAMES.find((g) => g.id === game)?.page ?? GAMES[0].page;
  return `/play/${page}?vrm=${encodeURIComponent(vrm)}&name=${encodeURIComponent(name)}`;
}

export function canPlay(creation: Pick<CreationResponse, 'steps'>): boolean {
  return creation.steps.some((s) => s.step_name === 'convert_vrm' && s.status === 'completed');
}
