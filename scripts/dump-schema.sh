#!/usr/bin/env bash
# Writes supabase/schema.sql: the whole app schema, so a new local stack can be built without production.
# Dump from the LOCAL stack only after it matches production (all migrations applied).
set -euo pipefail
cd "$(dirname "$0")/.."
db=supabase_db_localdb
out=supabase/schema.sql
latest=$(ls supabase/migrations | sort | tail -1)
# Empty search_path makes the trigger and policy text name functions as public.x(), matching the dump
q() { docker exec -e PGOPTIONS='-c search_path=' "$db" psql -U postgres -At -c "$1"; }

{
  echo "-- App schema snapshot, made by scripts/dump-schema.sh. Do not edit by hand."
  echo "-- Includes every migration up to and including: $latest"
  echo "-- Rebuild: load this into a new Supabase stack, then apply only migrations newer than that file."
  echo "-- Not included: the pg_cron job (see *_supabase_cron_cleanup.sql; it needs Vault secrets set by hand)."
  echo
  # The booking overlap constraints need btree_gist before the tables are created
  echo 'create schema if not exists public;'
  echo 'create extension if not exists btree_gist with schema public;'
  # Fixed restrict key keeps the file stable between dumps. A new stack already has the public schema and
  # supabase_admin's default grants (postgres may not set those), so both are skipped.
  docker exec "$db" pg_dump -U postgres --schema-only --no-owner --schema=public --restrict-key=schemasnapshot \
    | sed -e 's/^CREATE SCHEMA public;/CREATE SCHEMA IF NOT EXISTS public;/' -e '/FOR ROLE supabase_admin/d'
  echo
  echo "-- Outside the public schema: new-user trigger, storage buckets and their access rules"
  q "select pg_get_triggerdef(oid) || ';' from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal"
  q "select format('insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (%L, %L, %L, %s, %L) on conflict (id) do nothing;', id, name, public, coalesce(file_size_limit::text, 'null'), allowed_mime_types) from storage.buckets order by id"
  q "select format('create policy %I on storage.objects as %s for %s to %s%s%s;', policyname, permissive, cmd, array_to_string(roles, ', '), coalesce(' using (' || qual || ')', ''), coalesce(' with check (' || with_check || ')', '')) from pg_policies where schemaname = 'storage' order by policyname"
} | tr -d '\r' > "$out"
echo "wrote $out (through $latest)"
