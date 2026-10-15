import { useEffect, useState } from 'react';
import { api, RenderStyle } from '../../api/client';
import './StylePicker.css';

/**
 * The painting styles, as the server lists them. Shown at once from this copy
 * (same keys, same order as GET /api/styles), then replaced by the server's
 * answer, so the row never waits on the network.
 */
export const DEFAULT_STYLES: RenderStyle[] = [
  { key: 'pixar', label: 'Pixar' },
  { key: 'lego', label: 'Lego' },
  { key: 'minecraft', label: 'Minecraft' },
  { key: 'anime', label: 'Anime' },
  { key: 'original', label: 'Original' },
];
export const DEFAULT_STYLE = DEFAULT_STYLES[0].key;

/** The example painting of each style: Crayon Kid, the robot's drawing,
 * painted in it (backend/scripts/make_style_samples.py). */
const sampleUrl = (key: string) => `/styles/${key}.webp`;
/** Until a style has its sample, its card shows that same drawing. */
const FALLBACK_URL = '/styles/drawing.webp';

export function useRenderStyles(): RenderStyle[] {
  const [styles, setStyles] = useState<RenderStyle[]>(DEFAULT_STYLES);
  useEffect(() => {
    let live = true;
    api.getStyles()
      .then((list) => { if (live && list.length) setStyles(list); })
      .catch(() => { /* keep the built-in list */ });
    return () => { live = false; };
  }, []);
  return styles;
}

function StyleCard({ style, plate, selected, disabled, onPick }: {
  style: RenderStyle; plate: number; selected: boolean; disabled?: boolean; onPick: () => void;
}) {
  // A sample that is missing (404, or the app shell served in its place) fails
  // to decode: the card then shows the drawing, tinted by the plate, instead.
  const [missing, setMissing] = useState(false);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`tb-style${selected ? ' tb-style--on' : ''}`}
      data-style={style.key}
      disabled={disabled}
      onClick={onPick}
    >
      <span className={`tb-style-img tb-plate-${plate}${missing ? ' tb-style-img--drawing' : ''}`}>
        <img
          src={missing ? FALLBACK_URL : sampleUrl(style.key)}
          alt=""
          draggable={false}
          onError={() => setMissing(true)}
        />
      </span>
      <span className="tb-style-label">{style.label}</span>
    </button>
  );
}

/** One row of square style cards; the picked one wears a grape ring. */
export function StylePicker({ styles, value, onChange, disabled }: {
  styles: RenderStyle[]; value: string; onChange: (key: string) => void; disabled?: boolean;
}) {
  return (
    <div className="tb-styles" role="radiogroup" aria-label="Style">
      {styles.map((s, i) => (
        <StyleCard
          key={s.key}
          style={s}
          plate={(i % 6) + 1}
          selected={s.key === value}
          disabled={disabled}
          onPick={() => onChange(s.key)}
        />
      ))}
    </div>
  );
}
