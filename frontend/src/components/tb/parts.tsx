import { ReactNode, useEffect } from 'react';
import { Icon, IconName } from './Icon';
import '../../styles/toybox.css';

/** A bottom sheet over a dimmed screen. Tapping the dim area closes it. */
export function Sheet({ title, onClose, children, className = '' }: { title?: string; onClose: () => void; children: ReactNode; className?: string }) {
  useEscape(onClose);
  return (
    <div className="tb-scrim" onClick={onClose}>
      <div className={`tb-sheet ${className}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="tb-sheet-grip" />
        {title && <div className="tb-sheet-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** A centered dialog, for confirmations. */
export function Dialog({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEscape(onClose);
  return (
    <div className="tb-scrim tb-scrim--center" onClick={onClose}>
      <div className="tb-dialog" role="alertdialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export function SheetRow({ icon, label, trail, danger, onClick, href }: { icon: IconName; label: string; trail?: string; danger?: boolean; onClick?: () => void; href?: string }) {
  const cls = `tb-sheet-row${danger ? ' tb-sheet-row--danger' : ''}`;
  const body = (<><Icon name={icon} /><span>{label}</span>{trail && <span className="tb-sheet-row-trail">{trail}</span>}</>);
  return href
    ? <a className={cls} href={href}>{body}</a>
    : <button type="button" className={cls} onClick={onClick}>{body}</button>;
}

/** The round button used on both edges of every header. */
export function NavButton({ icon, label, onClick, className = '' }: { icon: IconName; label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={`tb-nav ${className}`} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

export function Header({ left, title, right }: { left?: ReactNode; title?: string; right?: ReactNode }) {
  return (
    <header className="tb-header">
      <div className="tb-header-side">{left}</div>
      {title && <div className="tb-header-title">{title}</div>}
      <div className="tb-header-side tb-header-side--end">{right}</div>
    </header>
  );
}

export interface StepView { icon: IconName; state: 'done' | 'now' | 'failed' | 'next' }

/** Five connected icons: the whole pipeline at a glance. */
export function Stepper({ steps }: { steps: StepView[] }) {
  return (
    <div className="tb-stepper tb-step-now" role="list" aria-label="Progress">
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'contents' }}>
          <div role="listitem" aria-label={s.state} className={`tb-step-dot tb-step-dot--${s.state}`}>
            <Icon name={s.state === 'done' ? 'check' : s.state === 'failed' ? 'close' : s.icon} size={s.state === 'now' || s.state === 'failed' ? 24 : 18} />
          </div>
          {i < steps.length - 1 && <div className={`tb-step-line${s.state === 'done' ? ' tb-step-line--done' : ''}`} />}
        </div>
      ))}
    </div>
  );
}
