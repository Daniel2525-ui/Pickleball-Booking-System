from pathlib import Path

content = """# Pickleball Booking System — System Requirements

## 1. System Overview

The Pickleball Booking System is a web-based reservation and payment platform for a pickleball venue. It allows customers/players to view available courts, choose a desired date and time, make a booking, and pay online.

The system also provides an administrative side where authorized administrators can manage courts, bookings, customers, schedules, and payments.

The initial system is intended to support **one venue containing multiple pickleball courts**, while the database design may remain flexible enough to support additional venues in the future.

---

## 2. Technology Stack

| Area | Technology | Purpose |
|---|---|---|
| Frontend | Next.js | Customer and admin web application |
| Styling | Tailwind CSS | User interface styling and responsive design |
| Authentication | Supabase Auth | User registration, login, sessions, and authentication |
| Database | Supabase PostgreSQL | Store users, venues, courts, bookings, payments, and related data |
| Backend | Supabase + Next.js Server Actions/Route Handlers | Server-side business logic and database operations |
| Payment Processing | Stripe | Online payment processing |
| Deployment | Vercel | Hosting and deployment of the Next.js application |

---

# 3. User Roles

## 3.1 Customer / Player

Customers can:

- Create an account.
- Log in and log out.
- View the pickleball venue.
- View available courts.
- Select a desired booking date.
- Select a desired time.
- Select an available court.
- Review booking details before payment.
- Pay for a booking online.
- View their booking status.
- View their booking history.
- View booking details.
- Cancel a booking if the cancellation policy allows it.
- View payment status.
- Manage their profile information.

## 3.2 Administrator

Administrators can:

- Log in securely.
- Access the admin dashboard.
- View booking statistics.
- View all bookings.
- View bookings by date.
- View bookings by court.
- View customer information.
- Manage courts.
- Temporarily disable a court.
- View payment information.
- Manage booking statuses when necessary.
- Create or modify bookings manually when authorized.
- Cancel bookings when necessary.
- Manage venue operating hours.
- Configure booking rules.
- Configure pricing where applicable.

---

# 4. Core System Features

## 4.1 Authentication

The system shall use Supabase Authentication.

### Customer authentication

Customers should be able to:

- Register an account.
- Log in.
- Log out.
- Maintain an authenticated session.
- Reset their password.
- Access protected customer pages.

### Administrator authentication

Administrators should have access to protected admin pages.

Admin privileges must be enforced on the server/database level and should not rely only on frontend checks.

---

# 5. Venue and Court Management

The system will initially support one pickleball venue containing multiple courts.

Example:

```text
Pickleball Venue
├── Court 1
├── Court 2
├── Court 3
├── Court 4
└── Court 5