// Helpers for the specs that create bookings. They only ever talk to the local Supabase
// container, so they are skipped unless E2E_LOCAL_DB=1 and the app under test is on localhost.
import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";

const CONTAINER = process.env.E2E_DB_CONTAINER || "supabase_db_localdb";

export const writesAllowed =
  process.env.E2E_LOCAL_DB === "1" && /^http:\/\/(localhost|127\.0\.0\.1)/.test(process.env.E2E_BASE_URL || "");

export function requireLocalDb() {
  test.skip(!writesAllowed, "write tests need E2E_LOCAL_DB=1 and a localhost E2E_BASE_URL backed by the local Supabase stack");
}

export function sql(query) {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: query,
    encoding: "utf8",
  }).trim();
}

export function account(role) {
  const email = process.env[`E2E_${role}_EMAIL`];
  const password = process.env[`E2E_${role}_PASSWORD`];
  if (!email || !password) throw new Error(`E2E_${role}_EMAIL / E2E_${role}_PASSWORD are not set`);
  return { email, password };
}

export async function login(page, { email, password }) {
  await page.goto("/login");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In to Account" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

// Tomorrow in Asia/Manila as YYYY-MM-DD, the date every write test books on
export function tomorrowManila() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() + 86_400_000));
}

export function resetBookings() {
  sql(`
    DELETE FROM public.refund_requests;
    DELETE FROM public.payments;
    DELETE FROM public.bookings;
    DELETE FROM public.customers;
    UPDATE public.operating_hours SET is_open = true, open_time = '06:00', close_time = '22:00';
    UPDATE public.courts SET status = 'active';
  `);
}

export function firstCourt() {
  const [id, name] = sql("SELECT id || '|' || name FROM public.courts ORDER BY name LIMIT 1").split("|");
  return { id, name };
}

// The local stack's API URL and public anon key, for tests that call Supabase directly
export function localSupabase() {
  const url = process.env.E2E_SUPABASE_URL;
  const anonKey = process.env.E2E_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY are not set");
  if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) throw new Error("E2E_SUPABASE_URL must point at the local stack");
  return { url, anonKey };
}
