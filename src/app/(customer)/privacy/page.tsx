import { Metadata } from "next";
import { LegalPage } from "@/components/customers/legal-page";
import { fetchVenueContact } from "@/lib/venue";
import { getPublicClient } from "@/lib/supabase/public";
import { VENUE_NAME, VENUE_CITY } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${VENUE_NAME} collects and uses your personal information.`,
};

// Contact details are edited in Settings; refresh at most every 5 minutes
export const revalidate = 300;

export default async function PrivacyPage() {
  const venue = await fetchVenueContact(getPublicClient());
  return (
    <LegalPage title="Privacy Policy">
      <p>
        {VENUE_NAME} (&quot;we&quot;) runs this court booking website for our pickleball venue in {VENUE_CITY}. This
        policy explains what personal information we collect, why, and your rights under the Philippine Data Privacy
        Act of 2012 (Republic Act No. 10173).
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your full name, mobile number, email address and password when you register. Passwords are stored by our authentication provider in hashed form; we never see them.</li>
        <li><strong>Reservations:</strong> the court, date, time, status and amount of each booking you make, and walk-in bookings staff record for you.</li>
        <li><strong>Payments:</strong> card payments are processed by Stripe. We receive the payment status, amount and a Stripe reference, but never your full card number. Counter payments (cash or GCash) are recorded with the reference staff enter.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To create and secure your account and let you manage your reservations.</li>
        <li>To prevent double-bookings, confirm payments, and process refunds.</li>
        <li>To identify you at check-in and contact you about a reservation.</li>
      </ul>
      <p>We do not sell your information or use it for advertising.</p>

      <h2>Who we share it with</h2>
      <ul>
        <li><strong>Supabase</strong>, which hosts our database and accounts.</li>
        <li><strong>Stripe</strong>, which processes card payments and refunds.</li>
        <li><strong>Vercel</strong>, which hosts this website.</li>
      </ul>
      <p>These providers process data only to run the service for us. Venue staff with admin access can see bookings and customer contact details.</p>

      <h2>Your rights</h2>
      <p>
        You may ask to access, correct or delete your personal information, or object to its processing, by contacting
        us below. Some booking and payment records may need to be kept for accounting purposes.
      </p>

      <h2>Contact</h2>
      <p>
        {venue.address} · <a className="text-primary hover:underline" href={`mailto:${venue.email}`}>{venue.email}</a> ·{" "}
        <a className="text-primary hover:underline" href={venue.phoneHref}>{venue.phone}</a>
      </p>
    </LegalPage>
  );
}
