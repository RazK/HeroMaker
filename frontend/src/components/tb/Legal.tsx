import type { ReactNode } from 'react';
import { Header, NavButton } from './parts';
import './Legal.css';

/** Where to write to us: refunds, questions, anything on a legal page. */
export const CONTACT_EMAIL = 'raz@yosigal.com';

/** The legal pages, each on its own URL so a reviewer can open it directly. */
export const LEGAL_PATHS = {
  privacy: '/privacy',
  terms: '/terms',
  refunds: '/refunds',
} as const;
export type LegalPage = keyof typeof LEGAL_PATHS;

/** The legal page this URL is, or null. */
export const legalPageAt = (pathname: string): LegalPage | null =>
  (Object.keys(LEGAL_PATHS) as LegalPage[]).find((p) => LEGAL_PATHS[p] === pathname) ?? null;

/** Anywhere (e.g. the Buy credits sheet) can open a legal page; App listens. */
export const LEGAL_OPEN_EVENT = 'legal:open';
export const openLegal = (page: LegalPage) =>
  window.dispatchEvent(new CustomEvent<LegalPage>(LEGAL_OPEN_EVENT, { detail: page }));

/**
 * The shell of a legal page (Privacy, Terms, Refunds): the one header with
 * Back, and an article of running text. Legal pages are the one place the
 * brand book allows paragraphs; everything else is the usual screen.
 */
export function LegalScreen({ title, heading, onBack, children }: {
  title: string;
  heading: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="tb-screen tb-legal-screen">
      <Header left={<NavButton icon="back" label="Back" onClick={onBack} className="tb-back" />} title={title} />
      <article className="tb-screen-body tb-legal">
        <h1 className="tb-h1">{heading}</h1>
        {children}
      </article>
    </div>
  );
}
