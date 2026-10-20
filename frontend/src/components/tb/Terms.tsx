import { CONTACT_EMAIL, LegalScreen, openLegal } from './Legal';

/**
 * The terms of service, plain language. Raz (2026-10-20): "Don't be so
 * giving, you are here to protect me": as protective of HeroMaker as the law
 * allows, with no promise beyond what the code does. Kept consistent with
 * Privacy and Refunds and with the code (the gallery lists Editors' choice
 * only; an admin can remove a hero; failed steps refund as credits). Change
 * the words only with his approval, and update the date when you do.
 */
export function Terms({ onBack }: { onBack: () => void }) {
  return (
    <LegalScreen title="Terms" heading="HeroMaker Terms of Service" onBack={onBack}>
      <p>HeroMaker is made by Raz Karl &amp; Elad Shikley.<br />These terms are the deal between you and us. By using HeroMaker, or buying anything in it, you agree to them.</p>

      <h2>What HeroMaker does</h2>
      <p>It turns a child's drawing, or a photo, into a 3D hero you can play with.<br />AI does the making: OpenAI paints the drawing, Meshy builds the 3D model.</p>

      <h2>Who can use it</h2>
      <ul>
        <li>Accounts are for adults (18+).</li>
        <li>Children use HeroMaker with a parent, on the parent's account, or in a class a teacher runs.</li>
        <li>In a class, a child gives only a first name and, if they like, an age. No account, no email.</li>
        <li>A teacher running a class is responsible for having their school's and the children's parents' permission.</li>
        <li>You are responsible for your account and everything done with it.</li>
      </ul>

      <h2>What you buy</h2>
      <ul>
        <li>Credits, in one-time packs. No subscription.</li>
        <li>Starter: $5 for 30 credits. Maker: $15 for 100. Studio: $40 for 300.</li>
        <li>One hero costs 10 credits.</li>
        <li>Teachers can buy class seats at a teacher price: $1.25 a seat, plus $0.50 an order. One seat is one hero for one child, used in that class only.</li>
        <li>Prices are in US dollars and shown before you pay.</li>
        <li>We may change prices, packs and how many credits a hero costs. A change never touches an order already paid.</li>
      </ul>
      <p>Lemon Squeezy is the merchant of record: it takes the payment, handles tax and sends the invoice. Its buyer terms apply to the purchase too.</p>

      <h2>Credits</h2>
      <p>Credits are for making heroes in HeroMaker, and nothing else.<br />They are a licence to use the service, not money: they have no cash value, can't be transferred, sold or swapped for money, and are refunded only as the Refund policy says.<br />Credits expire 24 months after the purchase they came from.<br />Credits are lost when you delete your account, or when we close it for breaking these terms.</p>
      <button type="button" className="tb-chip tb-legal-chip" onClick={() => openLegal('refunds')}>Refund policy</button>

      <h2>Your drawings and heroes</h2>
      <ul>
        <li>Your drawing, and the hero made from it, are yours.</li>
        <li>You give us a worldwide, free, non-exclusive permission to store, copy, process (including with our AI providers), adapt and show them in HeroMaker, and to show heroes picked for Editors' choice in HeroMaker's own promotion.</li>
        <li>Upload only drawings and photos you have the right to use. A photo of a person needs their permission, or their parent's.</li>
        <li>You are responsible for what you upload. If it breaks the law or someone else's rights, you cover the cost of any claim against us because of it.</li>
        <li>Delete a hero, or your account, and that permission ends, except for backups (erased within 30 days), promotion already published, and what the law makes us keep.</li>
      </ul>

      <h2>What is public</h2>
      <ul>
        <li>The public gallery shows Editors' choice: finished heroes we pick, with the creator's name.</li>
        <li>Every other hero is listed only to you, under My heroes.</li>
        <li>A hero's own page opens for anyone you share its link with.</li>
        <li>A hero made in a class stays private until a parent keeps it.</li>
        <li>Want a hero out of Editors' choice? Email us and we'll take it out.</li>
      </ul>

      <h2>Fair use</h2>
      <ul>
        <li>Nothing violent, sexual, hateful or meant to hurt anyone.</li>
        <li>No one else's personal details, and nothing you don't have the right to use.</li>
        <li>Don't try to break, overload or get around HeroMaker, its payments or its limits.</li>
      </ul>
      <p>We may remove any hero, and suspend or close any account, that we believe breaks these rules, without refund.</p>

      <h2>AI makes every hero</h2>
      <p>Results vary. The same drawing can make a different hero each time, and a hero may not look like its drawing, or like the person in a photo.<br />A finished hero you don't like is not a fault, and its credits are not refunded.</p>

      <h2>The service</h2>
      <p>HeroMaker is provided "as is" and "as available", without warranties of any kind, as far as the law allows.<br />We don't promise it will always be available, fast or free of mistakes. It relies on outside providers (AI, hosting, payments) that we don't control.<br />If a step fails, its credits come back to your balance: that is the remedy for a failed step.<br />We may change, suspend or stop HeroMaker, or any part of it, at any time.</p>

      <h2>Our responsibility</h2>
      <p>As far as the law allows:</p>
      <ul>
        <li>We aren't responsible for indirect or consequential losses, lost data, or losses caused by outside providers.</li>
        <li>Our total responsibility to you, for everything, is limited to what you paid us in the 3 months before the claim.</li>
      </ul>
      <p>Nothing here takes away rights the law gives you that can't be waived.</p>

      <h2>Changes</h2>
      <p>We may update these terms; the latest version is always here, with its date.<br />Using HeroMaker after a change means you accept it. If you don't, stop using HeroMaker and delete your account.</p>

      <h2>Law</h2>
      <p>These terms are governed by the laws of Israel. The courts of Tel Aviv-Yafo alone handle any dispute.</p>

      <h2>Contact</h2>
      <p>Raz Karl &amp; Elad Shikley<br />{CONTACT_EMAIL}<br /><span className="tb-muted">Last updated 20 October 2026</span></p>
    </LegalScreen>
  );
}
