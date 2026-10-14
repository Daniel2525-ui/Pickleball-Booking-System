# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Players / Customers**: Pickleball players of all skill levels in Butuan City looking to check live court availability, reserve time slots, pay, and track upcoming or past bookings.
- **Venue Admins & Staff**: Managers operating Crosshair Dinkers who oversee court schedules, manage bookings, review payments and revenue metrics, and view customer records.

## Product Purpose

Crosshair Dinkers is a dedicated court reservation and facility management platform for the Crosshair Dinkers pickleball venue in Butuan City, Agusan Del Norte. It eliminates manual scheduling bottlenecks and phone-call reservations by providing real-time court availability, instant online booking, and a streamlined administrative dashboard. Success is measured by seamless court occupancy, zero double-bookings, rapid customer self-service, and clear operational visibility for staff.

## Positioning

The official digital home and exclusive booking portal for the Crosshair Dinkers facility in Butuan City—combining a community-focused player experience with real-time court scheduling and venue operations.

## Operating Context

- **Customer Journey**: Responsive mobile and desktop web interface. Players browse live court availability on an interactive grid, select slots, sign in, confirm bookings, and manage reservations via `/my-bookings`.
- **Venue Administration**: Admin dashboard accessed via `/admin` covering real-time daily schedules, court status management, booking records with status updates/cancellations, customer directory, and payment tracking.
- **Timezone**: Asia/Manila (UTC+8) venue operational time.

## Capabilities and Constraints

- **Tech Stack**: Next.js 16 (App Router), React 19, Tailwind CSS v4, Lucide React, Motion.
- **Backend & Auth**: Supabase PostgreSQL and Supabase Auth with server-side rendering (`@supabase/ssr`).
- **Payments**: Stripe integration for handling online payments.
- **Scheduling Rules**: Time slot booking per court, status lifecycles (`pending`, `confirmed`, `completed`, `cancelled`), conflict prevention, and customer cancellation rules tied to venue local time.

## Brand Commitments

- **Name**: Crosshair Dinkers
- **Tagline**: "Dink with precision. Play your game."
- **Tone & Identity**: Energetic, athletic, welcoming, and modern; community-centric pickleball brand with a crosshair motif symbolizing precision dinking.
- **Location**: Butuan City, Agusan Del Norte, Philippines.

## Evidence on Hand

- Public landing page with hero, venue features, about section, and interactive booking grid (`src/app/page.tsx`).
- Customer portal with booking flow (`/book`) and booking history (`/my-bookings`).
- Complete administrative suite (`/admin/dashboard`, `/admin/bookings`, `/admin/courts`, `/admin/customers`, `/admin/payments`, `/admin/schedules`).
- Database schema and services in `src/lib/services/`.

## Product Principles

1. **Precision & Real-Time Accuracy**: Court availability must reflect true slot status with zero double-booking tolerance.
2. **Frictionless Self-Service**: Players should be able to check availability and book a court in under a minute on mobile or desktop.
3. **Operational Clarity for Admins**: Staff need clear, instant visibility into daily court activity, player check-ins, and schedule conflicts.
4. **Community Grounding**: Keep the digital experience welcoming to both beginners and competitive tournament players in Butuan City.
