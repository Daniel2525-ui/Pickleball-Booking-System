-- tests/integration/fixture.sql
-- Local Integration Test Schema Fixture for Hold Court Booking
-- Strictly for local disposable testing. Never apply to production.

-- 1. PostgreSQL Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Mock Supabase Roles (NOLOGIN roles for security & grant compatibility)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END $$;

-- 3. Mock Supabase auth Schema and JWT Claim Session Resolvers
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  );
$$;

-- 4. Core Domain Tables
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  role text DEFAULT 'customer'
);

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text,
  email text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.courts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  status text DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS public.operating_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week text UNIQUE NOT NULL,
  is_open boolean NOT NULL DEFAULT true,
  open_time time,
  close_time time
);

CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id),
  customer_id uuid REFERENCES public.customers(id),
  customer_name text,
  court_id uuid NOT NULL REFERENCES public.courts(id),
  booking_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  status text NOT NULL,
  total_amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'php',
  status text NOT NULL,
  payment_method text,
  payment_reference text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Baseline Operating Schedule (Sunday-Saturday; Monday closed)
INSERT INTO public.operating_hours (day_of_week, is_open, open_time, close_time) VALUES
  ('Sunday', true, '07:00:00', '22:00:00'),
  ('Monday', false, NULL, NULL),
  ('Tuesday', true, '07:00:00', '22:00:00'),
  ('Wednesday', true, '07:00:00', '22:00:00'),
  ('Thursday', true, '07:00:00', '22:00:00'),
  ('Friday', true, '07:00:00', '22:00:00'),
  ('Saturday', true, '07:00:00', '22:00:00')
ON CONFLICT (day_of_week) DO UPDATE 
SET is_open = EXCLUDED.is_open, open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time;

-- 6. Deterministic Test Entities
-- Admin Profile
INSERT INTO public.profiles (id, full_name, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Staff Admin', 'admin')
ON CONFLICT (id) DO NOTHING;

-- Customer Profile 1 (Alice)
INSERT INTO public.profiles (id, full_name, role) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Alice Player', 'customer')
ON CONFLICT (id) DO NOTHING;

-- Customer Profile 2 (Bob)
INSERT INTO public.profiles (id, full_name, role) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Bob Player', 'customer')
ON CONFLICT (id) DO NOTHING;

-- Guest Walk-in Customer
INSERT INTO public.customers (id, full_name, phone, email) VALUES
  ('44444444-4444-4444-4444-444444444444', 'Charlie Guest', '09123456789', 'charlie@example.com')
ON CONFLICT (id) DO NOTHING;

-- Court 1 (Active)
INSERT INTO public.courts (id, name, status) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Court 1 - Active', 'active')
ON CONFLICT (id) DO NOTHING;

-- Court 2 (Maintenance)
INSERT INTO public.courts (id, name, status) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Court 2 - Maintenance', 'maintenance')
ON CONFLICT (id) DO NOTHING;
