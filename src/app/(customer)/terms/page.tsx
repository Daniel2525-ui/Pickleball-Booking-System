import { Metadata } from "next";
import { LegalPage } from "@/components/customers/legal-page";
import { VENUE_CONTACT } from "@/lib/venue";
import { CANCELLATION_CUTOFF_HOURS } from "@/lib/services/bookings/cancelBooking.service";
import { getPublicClient } from "@/lib/supabase/public";
import { fetchPricing } from "@/lib/services/pricing/fetchPricing.service";
import { formatTime12h } from "@/lib/utils/formatTime";

// Rates and booking length are edited in the admin; refresh at most every 5 minutes
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Terms & Booking Rules | Crosshair Dinkers",
  description: "Booking, payment and cancellation rules for Crosshair Dinkers courts.",
};

export default async function TermsPage() {
  const { data: pricing } = await fetchPricing(getPublicClient());
  const hoursText = pricing
    ? pricing.settings.min_hours === pricing.settings.max_hours
      ? `${pricing.settings.min_hours} consecutive hour${pricing.settings.min_hours === 1 ? "" : "s"}`
      : `${pricing.settings.min_hours} to ${pricing.settings.max_hours} consecutive hours`
    : "the number of consecutive hours shown on the booking calendar";

  return (
    <LegalPage title="Terms & Booking Rules">
      <p>By creating an account or booking a court at Crosshair Dinkers you agree to these rules.</p>

      <h2>Bookings</h2>
      <ul>
        <li>Courts are booked in whole hours, for {hoursText}, within the venue&apos;s operating hours shown on the booking calendar.</li>
        <li>
          {pricing ? <>The standard court rate is ₱{pricing.settings.base_hourly_rate.toLocaleString()} per hour.</> : <>Court rates are shown before you pay.</>}
          {pricing && pricing.peakRates.length > 0 && (
            <> Peak rates apply to each hour that falls in these windows:{" "}
              {pricing.peakRates.map((p) => `${p.label ? p.label + ": " : ""}${p.days.map((d) => d.slice(0, 3)).join(", ")} ${formatTime12h(p.start_time)}–${formatTime12h(p.end_time)} at ₱${p.hourly_rate.toLocaleString()}/hr`).join("; ")}.
            </>
          )}{" "}
          The total is shown before you pay.
        </li>
        <li>When you continue to checkout, your slot is held for about 35 minutes while you pay. If payment isn&apos;t completed, the hold ends and the slot is released.</li>
        <li>A reservation is confirmed only after payment succeeds; it then appears in My Bookings.</li>
        <li>Please check in at reception 10 minutes before your slot. Non-marking court shoes are required.</li>
      </ul>

      <h2 id="cancellation">Cancellations &amp; refunds</h2>
      <ul>
        <li>You can cancel a paid reservation in My Bookings up to {CANCELLATION_CUTOFF_HOURS} hours before its start time and receive a full refund. Card refunds go back to the original card; banks usually take 5–10 business days to show them. Counter payments are refunded by venue staff.</li>
        <li>Within {CANCELLATION_CUTOFF_HOURS} hours of the start time, online cancellation is closed. Please contact the venue.</li>
        <li>Unpaid holds can be cancelled at any time before the slot starts.</li>
        <li>If the venue has to cancel your reservation, you receive a full refund.</li>
        <li>Online rescheduling isn&apos;t available; cancel within the window above and book a new slot.</li>
      </ul>

      <h2>Accounts</h2>
      <ul>
        <li>Keep your login details private; you are responsible for bookings made with your account.</li>
        <li>Provide your real name and a working mobile number so staff can identify you at check-in.</li>
      </ul>

      <h2>Privacy</h2>
      <p>
        See our <a className="text-primary hover:underline" href="/privacy">Privacy Policy</a> for how we handle your information.
      </p>

      <h2>Contact</h2>
      <p>
        {VENUE_CONTACT.address} · <a className="text-primary hover:underline" href={`mailto:${VENUE_CONTACT.email}`}>{VENUE_CONTACT.email}</a> ·{" "}
        <a className="text-primary hover:underline" href={VENUE_CONTACT.phoneHref}>{VENUE_CONTACT.phone}</a>
      </p>
    </LegalPage>
  );
}
