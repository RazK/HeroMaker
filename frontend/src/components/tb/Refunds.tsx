import { CONTACT_EMAIL, LegalScreen } from './Legal';

/**
 * The refund policy: a plain-language draft for Raz to approve (2026-10-20).
 * It must match what the code does: failed steps refund themselves
 * (credits.refund_last_step_charge), a refunded order is handled by an admin.
 * Change the words only with his approval, and update the date when you do.
 */
export function Refunds({ onBack }: { onBack: () => void }) {
  return (
    <LegalScreen title="Refunds" heading="HeroMaker Refund Policy" onBack={onBack}>
      <h2>The short version</h2>
      <p>Changed your mind? Unused credits can be refunded within 14 days of purchase.<br />If a hero fails to finish, its credits come back on their own.</p>

      <h2>Credits</h2>
      <ul>
        <li>Unused credits: refundable within 14 days of purchase, on request.</li>
        <li>Used part of a pack? We refund the part you haven't used.</li>
        <li>Credits spent on a hero that finished: not refundable.</li>
      </ul>

      <h2>When a hero doesn't finish</h2>
      <p>A hero is made in steps, and each step's credits are taken as it starts.<br />If a step fails or runs out of time, its credits go straight back to your balance.<br />You don't need to ask.</p>

      <h2>Class seats</h2>
      <ul>
        <li>Unused seats: refundable within 14 days of purchase, on request.</li>
        <li>Seats a child has used to make a hero: not refundable.</li>
        <li>If a class hero fails to finish, its credits go back to the class.</li>
      </ul>

      <h2>How to ask for a refund</h2>
      <p>Email {CONTACT_EMAIL} from the address on your account.<br />Tell us the order number from your Lemon Squeezy receipt.</p>
      <p>The money goes back to the card or account you paid with, through Lemon Squeezy.<br />How soon it shows depends on your bank.<br />The refunded credits or seats are then taken off your balance.</p>

      <h2>Who handles payments</h2>
      <p>Lemon Squeezy is the merchant of record for every order.<br />It takes the payment, handles sales tax and VAT, and sends your receipt and invoice.<br />We never see your card details.</p>

      <h2>Your rights</h2>
      <p>If the consumer law where you live gives you more, that comes first.</p>

      <h2>Contact</h2>
      <p>Raz Karl &amp; Elad Shikley<br />{CONTACT_EMAIL}<br /><span className="tb-muted">Last updated 20 October 2026</span></p>
    </LegalScreen>
  );
}
