import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { emailConfigured, sendEmail, type SendEmail } from "../../email.ts";
import { fetchVenueContact, type VenueContact } from "../../venue.ts";
import { formatManilaDate, getBookingStart, lateNightOf } from "../../utils/bookingTime.ts";
import { formatShortDate, formatTime12h } from "../../utils/formatTime.ts";
import { bookingRef } from "../openPlay/bookingTitle.ts";
import { SITE_URL } from "../../brand.ts";

/**
 * Booking confirmation and 24-hour reminder emails.
 * Run by the cleanup cron (every 15 minutes) and after each PayMongo webhook. Every booking is claimed
 * (confirmation_sent_at / reminder_sent_at NULL -> now) before sending, so concurrent runs never double-send.
 */
export type EmailKind = "confirmation" | "reminder";

export interface EmailBooking {
  id: string;
  basket_id: string | null;
  booking_date: string;
  /** The day the booking belongs to; the day before booking_date for hours after midnight */
  business_date?: string | null;
  start_time: string;
  end_time: string;
  customer_name: string;
  open_play_spots: number | null;
  confirmation_sent_at: string | null;
  profiles: { email: string | null; full_name: string | null } | null;
  customers: { email: string | null; full_name: string | null } | null;
  courts: { name: string } | null;
}

export interface EmailGroup {
  to: string;
  name: string;
  rows: EmailBooking[];
}

const DAY_MS = 24 * 60 * 60_000;
const COLUMN = { confirmation: "confirmation_sent_at", reminder: "reminder_sent_at" } as const;
// shortcut: 20 bookings per kind per run (~80/hour from the cron), raise if a venue ever confirms more
const BATCH = 20;
const SELECT =
  "id, basket_id, booking_date, business_date, start_time, end_time, customer_name, open_play_spots, confirmation_sent_at, profiles(email, full_name), customers(email, full_name), courts(name)";

/**
 * Which fetched bookings to claim, and which of those to actually email.
 * Claimed but not emailed: already started, or (reminder) the confirmation itself went out within 24 hours of play.
 * Reminders not yet within 24 hours are left alone for a later run.
 */
export const planEmails = (kind: EmailKind, rows: EmailBooking[], now: number) => {
  const startOf = (b: EmailBooking) => getBookingStart(b).getTime();
  const claim = kind === "reminder" ? rows.filter((b) => startOf(b) - now <= DAY_MS) : rows;
  const send = claim.filter(
    (b) =>
      startOf(b) > now &&
      !(kind === "reminder" && b.confirmation_sent_at && startOf(b) - Date.parse(b.confirmation_sent_at) <= DAY_MS),
  );
  return { claim, send };
};

/** One email per recipient and checkout basket; bookings with no email on file are dropped. */
export const groupBookingEmails = (rows: EmailBooking[]): EmailGroup[] => {
  const groups = new Map<string, EmailGroup>();
  for (const b of rows) {
    const to = (b.profiles?.email || b.customers?.email || "").trim();
    if (!to) continue;
    const key = `${to.toLowerCase()}|${b.basket_id ?? b.id}`;
    const group = groups.get(key) ?? { to, name: b.profiles?.full_name || b.customers?.full_name || b.customer_name, rows: [] };
    group.rows.push(b);
    groups.set(key, group);
  }
  return [...groups.values()];
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const lineOf = (b: EmailBooking) =>
  `${b.open_play_spots ? `Open play (${b.open_play_spots} ${b.open_play_spots === 1 ? "spot" : "spots"})` : (b.courts?.name ?? "Court")} · ` +
  `${formatShortDate(b.booking_date)} · ${formatTime12h(b.start_time)} – ${formatTime12h(b.end_time)}` +
  (lateNightOf(b) ? ` (${lateNightOf(b)})` : "");

export const renderBookingEmail = (kind: EmailKind, group: EmailGroup, contact: VenueContact, siteUrl = SITE_URL) => {
  const rows = [...group.rows].sort((a, b) => getBookingStart(a).getTime() - getBookingStart(b).getTime());
  const first = rows[0];
  const subject =
    kind === "confirmation"
      ? `Booking confirmed: ${formatShortDate(first.booking_date)}`
      : `Reminder: you play ${formatShortDate(first.booking_date)} at ${formatTime12h(first.start_time)}`;
  const intro = kind === "confirmation" ? "Your booking is confirmed." : "A reminder that you're booked to play soon.";
  // One email per checkout, so every row shares the ref; a guest who lost their session gives it at the desk
  const ref = `Booking reference: ${bookingRef(first)} (show this at the front desk)`;
  const pass = siteUrl ? `${siteUrl.replace(/\/$/, "")}/my-bookings` : null;
  const lines = rows.map(lineOf);
  const footer = `${contact.address} · ${contact.phone} · ${contact.email}`;
  const text = [
    `Hi ${group.name},`, "", intro, "", ref, "", ...lines.map((l) => `- ${l}`), "",
    ...(pass ? [`View your booking: ${pass}`, ""] : []),
    `Questions? Contact us: ${footer}`,
  ].join("\n");
  const html =
    `<p>Hi ${escapeHtml(group.name)},</p><p>${intro}</p><p><strong>${escapeHtml(ref)}</strong></p>` +
    `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` +
    (pass ? `<p><a href="${escapeHtml(pass)}">View your booking</a></p>` : "") +
    `<p style="color:#666;font-size:13px">Questions? Contact us: ${escapeHtml(footer)}</p>`;
  return { subject, html, text };
};

const runKind = async (supabase: SupabaseClient, kind: EmailKind, now: number, send: SendEmail, contact: () => Promise<VenueContact>) => {
  const column = COLUMN[kind];
  let query = supabase
    .from("bookings")
    .select(SELECT)
    .eq("status", "confirmed")
    .is(column, null)
    .gte("booking_date", formatManilaDate(new Date(now)))
    .order("booking_date")
    .order("start_time")
    .limit(BATCH);
  if (kind === "reminder") {
    query = query.not("confirmation_sent_at", "is", null).lte("booking_date", formatManilaDate(new Date(now + DAY_MS)));
  }
  const { data, error } = await query;
  if (error) {
    console.error(`Booking ${kind} emails: fetch failed:`, error);
    return 0;
  }
  const { claim, send: due } = planEmails(kind, (data ?? []) as unknown as EmailBooking[], now);
  if (claim.length === 0) return 0;

  const stamp = new Date(now).toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("bookings")
    .update({ [column]: stamp })
    .in("id", claim.map((b) => b.id))
    .is(column, null) // another run may have claimed some since the fetch
    .select("id");
  if (claimError) {
    console.error(`Booking ${kind} emails: claim failed:`, claimError);
    return 0;
  }
  const mine = new Set((claimed ?? []).map((r) => r.id));
  const groups = groupBookingEmails(due.filter((b) => mine.has(b.id)));
  if (groups.length === 0) return 0;

  const venue = await contact();
  let sent = 0;
  for (const group of groups) {
    const ids = group.rows.map((b) => b.id).sort();
    const result = await send({
      to: group.to,
      ...renderBookingEmail(kind, group, venue),
      idempotencyKey: `${kind}-${createHash("sha256").update(ids.join(",")).digest("hex")}`,
    });
    if (result === "sent") sent++;
    if (result !== "retry") continue;
    // Temporary failure: release the claim so the next run tries again
    const { error: releaseError } = await supabase.from("bookings").update({ [column]: null }).in("id", ids).eq(column, stamp);
    if (releaseError) console.error(`Booking ${kind} emails: release failed:`, releaseError);
  }
  return sent;
};

/** Sends due confirmation and reminder emails. Never throws; does nothing until RESEND_API_KEY and EMAIL_FROM are set. */
export const sendBookingEmails = async (
  supabase: SupabaseClient,
  { now = Date.now(), send = sendEmail }: { now?: number; send?: SendEmail } = {},
) => {
  if (send === sendEmail && !emailConfigured()) return { confirmations: 0, reminders: 0 };
  let venue: Promise<VenueContact> | null = null;
  const contact = () => (venue ??= fetchVenueContact(supabase));
  try {
    // Confirmations first, so a booking made under 24 hours ahead gets its confirmation and no separate reminder
    const confirmations = await runKind(supabase, "confirmation", now, send, contact);
    const reminders = await runKind(supabase, "reminder", now, send, contact);
    return { confirmations, reminders };
  } catch (err) {
    console.error("Booking emails failed:", err);
    return { confirmations: 0, reminders: 0 };
  }
};
