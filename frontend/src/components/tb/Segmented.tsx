import { Icon, IconName } from './Icon';
import './Segmented.css';

export interface Segment<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
  /** A small live dot after the label; its text is what a screen reader hears. */
  dot?: string;
}

/**
 * The switch between a screen's top-level places: equal segments across the
 * full width, at least 44px tall, the chosen one filled in ink. It sits above
 * any chips, which choose within a place (brand book, "Switch and chips").
 */
export function Segmented<T extends string>({ value, segments, onChange, label, className = '' }: {
  value: T;
  segments: Segment<T>[];
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`tb-seg ${className}`.trim()} role="tablist" aria-label={label}>
      {segments.map((s) => {
        const on = s.id === value;
        return (
          <button key={s.id} type="button" role="tab" aria-selected={on}
            className={`tb-seg-btn tb-seg-${s.id}${on ? ' tb-seg-btn--on' : ''}`}
            onClick={() => onChange(s.id)}>
            {s.icon && <Icon name={s.icon} size={20} />}
            <span className="tb-seg-label">{s.label}</span>
            {s.dot && <span className="tb-seg-dot" role="img" aria-label={s.dot} />}
          </button>
        );
      })}
    </div>
  );
}
