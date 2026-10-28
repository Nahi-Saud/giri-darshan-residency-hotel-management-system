# Giri Darshan Residency Hotel Management System

University ICT Project B hotel-management system for **Giri Darshan Residency**. The project extends the original hotel website prototype with a Node.js/Express REST API, MySQL persistence, authentication, role-based access and operational dashboards.

The existing visual identity and page structure are retained while customer, staff and administrator workflows use backend data.

## Project status

This repository is suitable for local development and university demonstration. It includes database-backed hotel operations, automated API regression tests and responsive embedded management pages.

Payment is intentionally a **demo record workflow**. It does not charge a real card or communicate with a payment gateway.

## Main technologies

- HTML, CSS and browser JavaScript/JSX
- React-style UI rendered in the browser
- Node.js 18+
- Express.js
- MySQL 8+ or compatible local MySQL/MariaDB
- `mysql2`, `dotenv`, `bcryptjs` and JSON Web Tokens
- Helmet, CORS and Express rate limiting

## Roles and access

| Role | Main access |
|---|---|
| Customer | Registration, login, customer dashboard, room browsing, booking, booking history, enquiries and demo payments |
| Staff | Staff portal, guest-document upload and verification, booking operations, check-in/check-out and enquiries |
| Admin | Full management dashboards, bookings, rooms, live rooms, parking, energy, users, staff, enquiries, payments and invoices |

Protected API routes enforce the same role boundaries. Customers cannot retrieve another customer's booking or document.

## Implemented functionality

### Public and customer functions

- Home, Rooms and Contact pages
- Customer registration and role-based sign-in
- Room types, room photographs, pricing and availability
- Customer dashboard and booking history
- Booking creation with date, guest-count and room-availability validation
- Booking confirmation feedback and cancellation rules
- Customer enquiry submission
- Demo payment records and invoices

### Staff operations

- Staff login and dashboard
- Reception-side document scanning/upload
- Authenticated document download
- Guest document verification or rejection
- Editable arriving guest count and persistent staff notes
- Check-in and check-out workflow
- Booking Management with contact information and editing controls
- Enquiry review and replies

### Administrator operations

- Live database dashboard summaries
- Booking creation, editing, status actions and cancellation
- Room number, floor, operational status and notes management
- Live Room Management and occupancy monitoring
- Parking allocation, concurrency checks and release workflow
- Staff creation and profile management
- User profile and activation management
- Enquiry replies and status tracking
- Payment status controls and invoice preview/download

### Energy Usage Overview

- Thirty rooms across three floors
- Floor navigation and room filtering
- Current power draw and appliance-level readings
- Room/floor comparisons and historical trends
- Estimated AUD energy cost and savings planner
- Room stay context and room-level usage details
- Equipment-fault reporting and maintenance status updates
- CSV/readings download and automatic refresh

The local project has no physical electricity-meter feed. The included utility creates explicitly simulated readings for occupied rooms for demonstration and testing.

## Repository structure

```text
.
├── index.html                         Main hotel website and role portals
├── assets/                            Images and browser assets
├── css/                               Shared frontend styles
├── js/                                Frontend scripts
├── live-room-management/              Live room and parking views
├── energy-usage-overview/              Embedded energy dashboard
├── backend/
│   ├── server.js                      Express application entry point
│   ├── src/db.js                      MySQL connection pool
│   ├── src/middleware/                Authentication and role middleware
│   ├── src/routes/                    REST API route modules
│   ├── sql/01_schema.sql              Complete MySQL schema
│   ├── scripts/                       Seed, migration and test utilities
│   ├── .env.example                   Safe configuration template
│   └── package.json
├── giri_darshan_mysql_schema_v1.sql   Additional root schema copy
└── TRANSFER_SETUP.md                  Condensed transfer instructions
```

## Prerequisites

Install the following:

- Node.js 18 or newer
- npm
- MySQL Server 8 or a compatible local MySQL/MariaDB server
- MySQL Workbench or another MySQL client
- Python 3, VS Code Live Server, or another static HTTP server for the frontend

## Local setup

### 1. Clone the repository

```powershell
git clone https://github.com/Nahi-Saud/giri-darshan-residency-hotel-management-system.git
cd giri-darshan-residency-hotel-management-system
```

### 2. Create the MySQL database

1. Start the local MySQL server.
2. Open MySQL Workbench.
3. Open `backend/sql/01_schema.sql`.
4. Execute the complete file.
5. Confirm that the `giri_darshan_db` schema exists.

The root `giri_darshan_mysql_schema_v1.sql` contains the same core schema for convenience.

### 3. Configure the backend

```powershell
cd backend
Copy-Item .env.example .env
```

Edit `backend/.env`:

```env
PORT=5000
NODE_ENV=development
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_local_mysql_password
DB_NAME=giri_darshan_db
JWT_SECRET=use_a_unique_random_secret_at_least_32_characters
JWT_EXPIRES_IN=1h
CORS_ORIGIN=http://127.0.0.1:5501,http://localhost:5501,http://127.0.0.1:5500,http://localhost:5500
```

Never commit `.env`. It is ignored by Git.

### 4. Install backend packages

```powershell
npm install
```

### 5. Apply migrations and seed development data

```powershell
npm run migrate
npm run seed
npm run sync:rooms
```

`sync:rooms` creates/synchronises the official three-floor, thirty-room inventory.

Development accounts created by the seed script:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@giridarshan.com` | `Password123!` |
| Staff | `staff@giridarshan.com` | `Password123!` |
| Customer | `customer@giridarshan.com` | `Password123!` |

These credentials are only for local demonstration. Change them before any hosted deployment.

### 6. Optional energy demonstration data

Create six hourly batches for currently occupied rooms:

```powershell
npm run record:energy -- --backfill 6
```

Create one current batch later:

```powershell
npm run record:energy
```

Preview without inserting data:

```powershell
npm run record:energy -- --dry-run
```

### 7. Start the backend

From `backend`:

```powershell
npm start
```

For automatic development restarts:

```powershell
npm run dev
```

Verify the API:

```text
http://127.0.0.1:5000/api/health
```

The response should report `"status":"ok"` and `"database":"connected"`.

### 8. Start the frontend

Open another terminal in the repository root:

```powershell
python -m http.server 5501
```

Then open:

```text
http://127.0.0.1:5501/
```

VS Code Live Server can also be used. If it selects another port, add that origin to `CORS_ORIGIN` and restart the backend.

Do not open `index.html` through a `file://` URL; browser security rules can prevent API and iframe communication.

## Backend commands

Run these from `backend`:

| Command | Purpose |
|---|---|
| `npm start` | Start the Express API |
| `npm run dev` | Start with Node watch mode |
| `npm run migrate` | Apply safe feature/schema upgrades |
| `npm run seed` | Add local demonstration accounts and starter data |
| `npm run sync:rooms` | Synchronise the three-floor room inventory |
| `npm run record:energy` | Record a simulated energy batch for occupied rooms |
| `npm run check` | Syntax/JSX compilation checks |
| `npm run test:features` | Feature workflow regression suite |
| `npm run test:comprehensive` | Authentication, authorization and API regression suite |

Additional focused tests:

```powershell
node scripts/test-booking-regression.js
node scripts/test-parking.js
```

The feature tests create QA records in the local database.

## REST API groups

| Area | Base path |
|---|---|
| Authentication | `/api/auth` |
| Rooms and room types | `/api/rooms` |
| Bookings and check-in/out | `/api/bookings` |
| Payments and invoices | `/api/payments` |
| Guest verification/documents | `/api/verifications` |
| Staff management | `/api/staff` |
| User management | `/api/users` |
| Enquiries and replies | `/api/enquiries` |
| Parking | `/api/parking` |
| Energy and equipment faults | `/api/energy` |
| Role dashboards | `/api/dashboard` |

## Security measures

- Passwords are hashed with bcrypt.
- JWTs use expiry and HS256 verification.
- Logout revokes the current token.
- Authentication verifies the user is still active.
- Role middleware protects staff/admin APIs.
- Customer-owned booking and document access is checked server-side.
- Authentication endpoints are rate limited.
- Helmet security headers are enabled.
- Production CORS uses configured origins.
- JSON request size is limited.
- Uploaded documents are stored outside the public frontend and require authentication to retrieve.
- Production errors omit stack traces and database details.
- Startup rejects a missing, default or short `JWT_SECRET`.

## Uploaded documents and privacy

Runtime uploads are saved under `backend/private-documents`. That directory, local `.env` files and transfer archives are ignored by Git. Do not publish real guest identity documents or database exports containing personal information.

## Current limitations and future work

- Payment is a demo database workflow; a real gateway must be added separately.
- Energy readings are simulated until physical sensors or a telemetry service are connected.
- Local MySQL is the current source of truth.
- HTTPS, hosted secrets, backups and production monitoring are deployment responsibilities.
- A later migration to Supabase or another hosted database can preserve the frontend while replacing the data layer/API configuration.

## Testing status

The current local build has passed:

- Syntax and inline JSX compilation checks
- Authentication and three-role authorization checks
- Booking creation/editing/cancellation and overlap rules
- Verification, document upload/download and check-in/check-out transitions
- Payments and invoice retrieval
- Enquiry reply storage
- Room, staff and user management
- Parking allocation concurrency/release
- Energy authorization and live dashboard loading
- Malformed JSON, expired/revoked token and missing-route handling

## Academic project note

This repository was developed for ICT Project B as an educational hotel-management implementation. Review all security, privacy, legal and payment requirements before using it in a real hotel environment.

