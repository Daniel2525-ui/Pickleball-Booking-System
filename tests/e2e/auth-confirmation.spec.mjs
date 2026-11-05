// Unconfirmed sign-ups stay out of the app's tables, and abandoned ones are cleaned up. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { requireLocalDb, sql } from "./local-db.mjs";

const stamp = Date.now();
const email = (tag) => `e2e-confirm-${tag}-${stamp}@example.com`;

// An auth user as Supabase stores a sign-up; `confirmed` and `age` stand in for the link click and time passing
function signUp(tag, { confirmed = false, age = "0 days" } = {}) {
  return sql(`INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
    VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '${email(tag)}', '',
            '{"full_name":"Confirm ${tag}","phone":"09170000123"}', '{"provider":"email","providers":["email"]}',
            now() - interval '${age}', now(), ${confirmed ? "now()" : "NULL"})
    RETURNING id`).split(/\s+/)[0];
}
const profile = (id) => sql(`SELECT coalesce(full_name || '|' || phone || '|' || role, 'none') FROM public.profiles WHERE id = '${id}' UNION ALL SELECT 'none' LIMIT 1`);
const exists = (id) => sql(`SELECT count(*) FROM auth.users WHERE id = '${id}'`);

test.beforeEach(() => requireLocalDb());
test.afterAll(() => sql(`DELETE FROM public.profiles WHERE email LIKE 'e2e-confirm-%-${stamp}@example.com'; DELETE FROM auth.users WHERE email LIKE 'e2e-confirm-%-${stamp}@example.com'`));

test("a profile is created when the email is confirmed, not at sign-up", () => {
  const id = signUp("new");
  expect(profile(id)).toBe("none");
  sql(`UPDATE auth.users SET email_confirmed_at = now() WHERE id = '${id}'`);
  expect(profile(id)).toBe("Confirm new|09170000123|customer");

  // Auto-confirmed (or admin-created) accounts get theirs straight away
  expect(profile(signUp("auto", { confirmed: true }))).toBe("Confirm auto|09170000123|customer");
});

test("sign-ups left unconfirmed for 7 days are deleted, and nothing with data ever is", () => {
  const stale = signUp("stale", { age: "8 days" });
  const fresh = signUp("fresh", { age: "2 days" });
  // An old unconfirmed account that somehow has a profile (it could hold bookings) must survive
  const withData = signUp("data", { age: "30 days" });
  sql(`INSERT INTO public.profiles (id, email, full_name, phone, role) VALUES ('${withData}', '${email("data")}', 'Confirm data', '09170000123', 'customer')`);

  sql("SELECT public.delete_stale_unconfirmed_users()");
  expect([exists(stale), exists(fresh), exists(withData)]).toEqual(["0", "1", "1"]);
  // Signed-in players can't run the cleanup themselves
  expect(sql("SELECT has_function_privilege('authenticated', 'public.delete_stale_unconfirmed_users()', 'EXECUTE')")).toBe("f");
  expect(sql("SELECT schedule FROM cron.job WHERE jobname = 'delete-stale-unconfirmed-users'")).toBe("30 19 * * *");
});
