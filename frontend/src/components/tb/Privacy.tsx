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

        <h2>Who it's for</h2>
        <p>Accounts are for adults (18+).<br />Children use HeroMaker with a parent, on the parent's account.</p>

        <h2>What we collect</h2>
        <ul>
          <li>Your account: username, email, name, date of birth, password (encrypted).</li>
          <li>With Google sign-in: your name, email and Google ID.</li>
          <li>What you make: the drawing, the child's name and age if entered, and the pictures and 3D files we create.</li>
          <li>Purchases: a record of each order. We never see card details.</li>
        </ul>

        <h2>Who we share it with</h2>
        <ul>
          <li>OpenAI: the drawing, to paint it and name it.</li>
          <li>Meshy: the painting, to build the 3D model.</li>
          <li>Railway: hosting and storage.</li>
          <li>Lemon Squeezy: payments.</li>
          <li>Google: only if you sign in with Google.</li>
        </ul>
        <p>We don't sell your data.<br />No analytics, ads or tracking.</p>

        <h2>Public gallery</h2>
        <p>Heroes appear in the public gallery with the creator's name.</p>

        <h2>Camera</h2>
        <p>Dance party uses the camera on your device only.<br />Video is never uploaded.</p>

        <h2>Deleting your data</h2>
        <p>Delete any hero, or your whole account, from the app at any time.<br />It's removed immediately.<br />Backups are erased within 30 days.<br />Purchase records are kept, as the law requires.</p>

        <h2>Changes</h2>
        <p>We may update this policy; the latest version is always here.<br />We'll tell you before a significant change takes effect.<br />If you don't agree, you can delete your account.</p>

        <h2>Contact</h2>
        <p>Raz Karl<br />raz@yosigal.com<br /><span className="tb-muted">Last updated 17 October 2026</span></p>
      </article>
    </div>
  );
}
