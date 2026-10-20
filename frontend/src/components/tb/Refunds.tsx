import { CONTACT_EMAIL, LegalScreen } from './Legal';

/**
 * The refund policy, plain language. Raz (2026-10-20): "Don't be so giving,
 * you are here to protect me": purchases are final except where this page or
 * the law says otherwise. It must match what the code does: failed steps
 * refund themselves as credits (credits.refund_last_step_charge), a failed
 * class hero gives its seat back (classes.release_failed_seats), a refunded
 * order is handled by an admin. Change the words only with his approval, and
 * update the date when you do.
 */
export function Refunds({ onBack }: { onBack: () => void }) {
  return (
    <LegalScreen title="Refunds" heading="HeroMaker Refund Policy" onBack={onBack}>
      <h2>The short version</h2>
      <p>Purchases are final.<br />If a hero fails to finish, its credits come back to your balance on their own.</p>

      <h2>Credits</h2>
      <ul>
        <li>Credits are delivered the moment you pay. By buying, you ask for them straight away, and you agree that this ends any right to cancel once they are delivered, as far as the law allows.</li>
        <li>A pack with none of its credits used may be refunded within 14 days of purchase, on request.</li>
        <li>Once any credit from a pack is used, that pack is not refundable.</li>
        <li>Credits that came free (welcome credits, coupons, credits from support) are never refundable.</li>
      </ul>

      <h2>When a hero doesn't finish</h2>
      <p>A hero is made in steps, and each step's credits are taken as it starts.<br />If a step fails or runs out of time, its credits go back to your balance. You don't need to ask.<br />Failed steps are refunded as credits, not money.<br />A hero that finished is not refunded because of how it looks.</p>

      <h2>Class seats</h2>
      <ul>
        <li>An order with none of its seats used may be refunded within 14 days of purchase, on request.</li>
        <li>Once any seat from an order is used, that order is not refundable.</li>
        <li>If a class hero fails to finish, its seat goes back to the class, for another child. Seats are not refunded as money.</li>
      </ul>

      <h2>How to ask for a refund</h2>
      <p>Email {CONTACT_EMAIL} from the address on your account, within 14 days of purchase.<br />Tell us the order number from your Lemon Squeezy receipt.</p>
      <p>The money goes back to the card or account you paid with, through Lemon Squeezy.<br />The refunded credits or seats are then taken off your balance.</p>
      <p>We may refuse a refund where we see abuse, such as repeated buying and refunding.<br />A chargeback opened without asking us first may close the account, and its credits with it.</p>

      <h2>Who handles payments</h2>
      <p>Lemon Squeezy is the merchant of record for every order.<br />It takes the payment, handles sales tax and VAT, and sends your receipt and invoice.<br />We never see your card details.</p>

      <h2>Your rights</h2>
      <p>Nothing here takes away rights the law gives you that can't be waived.</p>

      <h2>Contact</h2>
      <p>Raz Karl &amp; Elad Shikley<br />{CONTACT_EMAIL}<br /><span className="tb-muted">Last updated 20 October 2026</span></p>
    </LegalScreen>
  );
}
