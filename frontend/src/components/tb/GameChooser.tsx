import { CreationResponse } from '../../api/client';
import { GAMES, playUrl } from '../../config/play';
import { Icon, IconName } from './Icon';
import { Sheet } from './parts';
import './GameChooser.css';

const ART: Record<string, IconName> = { stunt: 'star', dance: 'music' };

/**
 * Play opens this: one big card per game, a picture and a name, side by side.
 * Each card is a plain link to the game page, so it opens like any page does.
 */
export function GameChooser({ creation, onClose }: {
  creation: Pick<CreationResponse, 'id' | 'user_id' | 'character_name' | 'name'>;
  onClose: () => void;
}) {
  return (
    <Sheet title="Pick a game" onClose={onClose} className="tb-games-sheet">
      <div className="tb-games">
        {GAMES.map((g) => (
          <a key={g.id} className={`tb-game-card tb-game-card--${g.id}`} data-game={g.id} href={playUrl(creation, g.id)}>
            <span className="tb-game-art">
              <Icon name={ART[g.id]} size={56} stroke={2.2} />
              {g.camera && <span className="tb-game-badge" title="Uses the camera"><Icon name="camera" size={18} /></span>}
            </span>
            <span className="tb-game-name">{g.name}</span>
          </a>
        ))}
      </div>
    </Sheet>
  );
}
