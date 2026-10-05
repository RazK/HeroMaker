/**
 * The Toy Box icon set: 24px stroke glyphs that take the text color.
 * One set for the whole app, so no emoji stand in for icons.
 */
const PATHS: Record<string, JSX.Element> = {
  play: <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />,
  share: <><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7" /><path d="M16 7l-4-4-4 4" /><path d="M12 3v12" /></>,
  download: <><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
  more: <><circle cx="5" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="19" cy="12" r="1.6" fill="currentColor" /></>,
  back: <path d="M15 18l-6-6 6-6" />,
  close: <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  coin: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9" /><path d="M9.5 9.5h4a1.8 1.8 0 010 3.6h-3a1.8 1.8 0 000 3.6h4" /></>,
  user: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /><path d="M3 17.5l9 5 9-5" opacity="0" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4.5h6V7" /><path d="M6.5 7l1 13h9l1-13" /></>,
  redo: <><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v5h5" /></>,
  pencil: <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z" />,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 018 0v2.5" /></>,
  scan: <><path d="M4 8V5a1 1 0 011-1h3" /><path d="M16 4h3a1 1 0 011 1v3" /><path d="M20 16v3a1 1 0 01-1 1h-3" /><path d="M8 20H5a1 1 0 01-1-1v-3" /><path d="M4 12h16" /></>,
  brush: <><path d="M14.5 4.5l5 5-7 7-5-5z" /><path d="M7.5 11.5c-3 0-3.5 3-3.5 5 0 1.5-1 2.5-1 2.5 3.5.5 7 0 8-3.5" /></>,
  cube: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5" /><path d="M12 12v9" /><path d="M12 12L4 7.5" /></>,
  run: <><circle cx="14" cy="4.5" r="1.8" /><path d="M8 21l3-6 3 2v4" /><path d="M6 11l3-3 4 1 2 4 3 1" /></>,
  box: <><path d="M3.5 8L12 4l8.5 4v8L12 20l-8.5-4z" /><path d="M3.5 8L12 12l8.5-4" /><path d="M12 12v8" /></>,
  ticket: <><path d="M4 7h16v3a2 2 0 000 4v3H4v-3a2 2 0 000-4z" /><path d="M14 7v10" /></>,
  logout: <><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4" /><path d="M6 12h10" /></>,
  star: <path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />,
  music: <><path d="M9 18V5.5l11-2V16" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  // The eight moves a hero can do on its page.
  dance: <><circle cx="13" cy="4.5" r="1.8" /><path d="M12.5 8l-1 6" /><path d="M12.3 9.5L17 6" /><path d="M12.3 9.5L7 11" /><path d="M11.5 14L8 20" /><path d="M11.5 14l4 2.5-.5 4" /></>,
  bodyroll: <><circle cx="12" cy="4.5" r="1.8" /><path d="M12 7.5c-2.5 2 2.5 4.5 0 7" /><path d="M12 14.5L9 20.5" /><path d="M12 14.5l3 6" /><path d="M6.5 7c-1.3 2-1.3 4 0 6" /><path d="M17.5 7c1.3 2 1.3 4 0 6" /></>,
  backflip: <><circle cx="12" cy="12" r="2" /><path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M17.5 3.5v3.8h-3.8" /></>,
  punch: <><rect x="9" y="7" width="11" height="10" rx="3.5" /><path d="M13 7v4" /><path d="M16.5 7v4" /><path d="M9 11.5h6" /><path d="M3 9h3" /><path d="M2 12h4" /><path d="M3 15h3" /></>,
  jump: <><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M5 20.5h14" /></>,
  land: <><path d="M12 3v11" /><path d="M7.5 10l4.5 4.5 4.5-4.5" /><path d="M4 20h16" /><path d="M5.5 16.5L3.5 15" /><path d="M18.5 16.5l2-1.5" /></>,
  fly: <><circle cx="18.5" cy="6" r="1.8" /><path d="M16 8.5L7 12.5" /><path d="M15 9l6 1.5" /><path d="M7 12.5l-4 .5" /><path d="M7 12.5L4 10" /><path d="M13.5 10.5c-1 3.5-4.5 5.5-9 5.5" /></>,
  victory: <><path d="M8 4h8v5a4 4 0 01-8 0z" /><path d="M8 5.5H5.5a2.5 2.5 0 002.7 4" /><path d="M16 5.5h2.5a2.5 2.5 0 01-2.7 4" /><path d="M12 13v4" /><path d="M8.5 20.5h7" /><path d="M10 17h4v3.5h-4z" /></>,
  gear:<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, stroke = 2.4 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
