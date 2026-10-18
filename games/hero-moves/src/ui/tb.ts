import { el } from './dom'

/**
 * Toy Box parts for the games, as plain DOM.
 *
 * The HeroMaker app builds its screens from React parts in
 * frontend/src/components/tb/. The games are not React, so these builders make
 * the same markup with the same class names, and the classes themselves come
 * from the app's own stylesheet (ui/toybox.css imports
 * frontend/src/styles/toybox.css). Change a button there and every game's
 * button changes with it.
 *
 * Any game in games/ can import this module and ui/toybox.css.
 */

/**
 * Line icons, copied path for path from frontend/src/components/tb/Icon.tsx:
 * 24 viewBox, stroke 2.4, round caps and joins, currentColor. `pause` is the
 * one glyph the app does not have yet; it is drawn in the same style.
 */
const PATHS = {
  back: '<path d="M15 18l-6-6 6-6" />',
  close: '<path d="M6 6l12 12" /><path d="M18 6L6 18" />',
  gear: '<circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />',
  music: '<path d="M9 18V5.5l11-2V16" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" />',
  redo: '<path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v5h5" />',
  star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />',
  pause: '<path d="M8.5 5v14" /><path d="M15.5 5v14" />',
  // Robot Rumble's two buttons: the app's own punch and jump move glyphs.
  punch: '<rect x="9" y="7" width="11" height="10" rx="3.5" /><path d="M13 7v4" /><path d="M16.5 7v4" /><path d="M9 11.5h6" /><path d="M3 9h3" /><path d="M2 12h4" /><path d="M3 15h3" />',
  jump: '<path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M5 20.5h14" />',
} as const
export type IconName = keyof typeof PATHS

export function icon(name: IconName, size = 22): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
}

/** The app's big pill button (58px, Barriecito 19px, 6px depth). */
export function tbButton(label: string, opts: {
  kind?: 'primary' | 'secondary' | 'sun'
  icon?: IconName
  full?: boolean
  onClick?: () => void
} = {}): HTMLButtonElement {
  const { kind = 'primary', full = true } = opts
  const b = el('button', { class: `tb-btn tb-btn--${kind}${full ? ' tb-btn--full' : ''}` })
  b.type = 'button'
  if (opts.icon) b.insertAdjacentHTML('beforeend', icon(opts.icon))
  b.append(el('span', {}, label))
  if (opts.onClick) b.addEventListener('click', opts.onClick)
  return b
}

/** The app's round header button: 40px, 2px ink outline, 4px depth. Icon only, so always labelled. */
export function tbNav(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { class: 'tb-nav', title: label, onclick: onClick })
  b.type = 'button'
  b.setAttribute('aria-label', label)
  b.innerHTML = icon(name)
  return b
}

/** A row of the app's chips; the chosen one is ink. */
export function tbChips<T>(
  options: ReadonlyArray<{ value: T; label: string; title?: string }>,
  current: T,
  onPick: (v: T) => void,
): HTMLDivElement {
  const row = el('div', { class: 'tb-chips' })
  row.setAttribute('role', 'group')
  row.append(...options.map((o) => {
      const b = el('button', {
        class: `tb-chip${o.value === current ? ' tb-chip--on' : ''}`,
        title: o.title ?? '',
        onclick: () => onPick(o.value),
      }, o.label)
      b.type = 'button'
      b.setAttribute('aria-pressed', String(o.value === current))
      return b
    }))
  return row
}

/** A labelled setting, laid out like the app's form fields. */
export function tbField(label: string, control: HTMLElement): HTMLDivElement {
  return el('div', { class: 'tb-field' }, el('label', {}, label), control)
}

/** The grip a bottom sheet carries at its top edge. */
export function tbGrip(): HTMLDivElement {
  const g = el('div', { class: 'tb-sheet-grip' })
  g.setAttribute('aria-hidden', 'true')
  return g
}
