import { track } from '../../analytics';
import { Sheet } from './parts';
import './AskSheet.css';

/**
 * The grown-up check (design canvas: GrownUp, approved by Raz). Before the
 * sign-in sheet opens the first time in a browser: "Is a grown-up with you?"
 * Not yet closes it, back where they were. Yes goes on to sign in, and is
 * not asked again in this browser; its time is kept with the account once it
 * signs in (keepAdultConfirmation).
 */
const KEY = 'hm_adult_confirmed_at';

const read = (): string | null => {
  try { return window.localStorage.getItem(KEY); } catch { return null; }
};

/** When a grown-up said Yes in this browser (ISO time), or null. */
export const adultConfirmedAt = (): string | null => read();

/** Whether to ask before the sign-in sheet opens. */
export const needsGrownUpCheck = (): boolean => !read();

export function GrownUpSheet({ onYes, onNotYet }: { onYes: () => void; onNotYet: () => void }) {
  const notYet = () => { track('adult_confirmed', { answer: 'not_yet' }); onNotYet(); };
  const yes = () => {
    try { window.localStorage.setItem(KEY, new Date().toISOString()); } catch { /* asked again next time */ }
    track('adult_confirmed', { answer: 'yes' });
    onYes();
  };
  return (
    <Sheet label="Is a grown-up with you?" onClose={notYet} className="tb-ask tb-grownup">
      <h2 className="tb-ask-title">Is a grown-up with you?</h2>
      <p className="tb-ask-line">A grown-up signs in and pays.</p>
      <div className="tb-ask-btns">
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full tb-grownup-later" onClick={notYet}>Not yet</button>
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-grownup-yes" onClick={yes}>Yes</button>
      </div>
    </Sheet>
  );
}
