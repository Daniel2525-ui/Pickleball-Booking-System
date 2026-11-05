# Running the e2e tests

The browser tests create and cancel real bookings, so they run only against a **local** Supabase stack, never
production (`.env.local` points at production). The helpers in `local-db.mjs` skip every write test unless
`E2E_LOCAL_DB=1` and the app is on localhost.

## Once

1. Start Docker Desktop. The local stack runs in containers named `supabase_*_localdb`; the database
   container is `supabase_db_localdb`.
2. Copy `tests/e2e/e2e.env.example` to `tests/e2e/.env.e2e` (git-ignored) and fill in the local keys and the
   three test accounts. The admin account needs `role = 'admin'` and `is_owner = true`.
3. If the local database was loaded from an old schema dump, bring its permissions in line with production:
   `docker exec -i supabase_db_localdb psql -U postgres < tests/e2e/local-match-production-grants.sql`

## Each time

```bash
scripts/e2e-app.sh            # terminal 1: the app on :3200 against the local stack
scripts/e2e-test.sh           # terminal 2: every spec (about 11 minutes)
scripts/e2e-test.sh tests/e2e/admin-staff.spec.mjs --project=desktop   # one spec
npm test                      # unit tests, no stack needed
```

`e2e-app.sh` refuses to start if the Supabase URL is not local or the Stripe keys in `.env.local` are not test
keys. Apply new migrations to the local stack before running specs that need them:
`docker exec -i supabase_db_localdb psql -U postgres < supabase/migrations/<file>.sql`

## If the dev server acts strangely

After many hot reloads `next dev` can serve stale code (for example a constant that reads as undefined).
Stop `e2e-app.sh` and start it again before chasing the failure.

## If the local stack is lost

The migrations in `supabase/migrations` do not create the base tables (they were made in the Supabase
dashboard), so build a new stack from the snapshot instead:

1. Start a new Supabase stack and name its database container `supabase_db_localdb`.
2. `docker exec -i supabase_db_localdb psql -U postgres -v ON_ERROR_STOP=1 < supabase/schema.sql`
3. Apply any migration newer than the one named at the top of `supabase/schema.sql`.
4. Create the three test accounts by signing up in the app, then make the admin one `role = 'admin'`, `is_owner = true`.

After a new migration reaches production and the local stack, refresh the snapshot with
`scripts/dump-schema.sh` and commit it.
