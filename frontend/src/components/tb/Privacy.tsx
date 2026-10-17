import { Header, NavButton } from './parts';
import './Privacy.css';

export const PRIVACY_PATH = '/privacy';

/**
 * The privacy policy, as approved by Raz on 2026-10-17. Legal pages are the
 * one place the brand book allows running text. Change the words only with
 * his approval, and update the date when you do.
 */
export function Privacy({ onBack }: { onBack: () => void }) {
  return (
    <div className="tb-screen tb-privacy">
      <Header left={<NavButton icon="back" label="Back" onClick={onBack} className="tb-back" />} title="Privacy" />
      <article className="tb-screen-body tb-legal">
        <h1 className="tb-h1">HeroMaker Privacy Policy</h1>
        <p className="tb-muted">Operated by Raz Karl. Contact: raz@yosigal.com. Last updated 17 October 2026.</p>

        <h2>Who it's for</h2>
        <p>Accounts are for adults (18+). Children use HeroMaker together with a parent, through the parent's account.</p>

        <h2>What we collect</h2>
        <ul>
          <li>Your account: username, email, name, date of birth and password (stored encrypted). If you sign in with Google: your name, email and Google account ID.</li>
          <li>What you make: the photo of the drawing, the child's name and age if you enter them, and the pictures and 3D files we create from it.</li>
          <li>Purchases: a record of each order. Card details go only to our payment provider; we never see them.</li>
        </ul>

        <h2>What we share, and why</h2>
        <ul>
          <li>OpenAI: the drawing, to paint it and to suggest a name.</li>
          <li>Meshy: the painted picture, to build the 3D model.</li>
          <li>Railway: hosts our servers, database and files.</li>
          <li>Lemon Squeezy: processes payments.</li>
          <li>Google: only if you choose to sign in with Google.</li>
        </ul>
        <p>We don't sell your data, and we don't use analytics, ads or tracking.</p>

        <h2>Public gallery</h2>
        <p>Heroes appear in the public gallery, with the creator's name. Anyone visiting HeroMaker can see them.</p>

        <h2>Camera</h2>
        <p>The Dance party game uses your camera only on your device. Video never leaves your phone or computer.</p>

        <h2>Deleting your data</h2>
        <p>You can delete any hero, or your whole account, from the app at any time. It's removed immediately; backup copies are erased within 30 days, except purchase records, which we keep as required by law.</p>

        <h2>Changes</h2>
        <p>We may update this policy from time to time. The latest version is always on this page, with its date. If a change is significant, we'll let you know in the app or by email before it takes effect. If you don't agree, you can delete your account at any time.</p>

        <h2>Contact</h2>
        <p>raz@yosigal.com</p>
      </article>
    </div>
  );
}
