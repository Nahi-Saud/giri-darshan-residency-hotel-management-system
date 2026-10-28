# Giri Darshan Residency Backend API Setup

This backend is the next step after the MySQL schema. It uses **Node.js + Express + MySQL** and is designed for the current HTML/CSS/JS website. The frontend should not connect directly to MySQL. The correct structure is:

```text
Frontend website -> Backend API -> MySQL database
```

## 1. Create the database in MySQL Workbench

1. Open MySQL Workbench.
2. Connect to your local MySQL server.
3. Open `backend/sql/01_schema.sql`.
4. Run the full script.
5. Refresh schemas and confirm `giri_darshan_db` exists.

## 2. Configure backend connection

Open the `backend` folder in VS Code or terminal.

```bash
cd backend
copy .env.example .env
```

Edit `.env` and set your MySQL password:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=giri_darshan_db
JWT_SECRET=change_this_to_a_long_random_secret
```

## 3. Install packages

```bash
npm install
```

## 4. Optional: add demo login accounts and starter rooms

Apply the feature migration when upgrading an existing local database:

```bash
npm run migrate
```

This is for development/testing only. It creates login accounts, room prices/capacity, rooms, parking spots and power sensors.

```bash
npm run seed
```

The Energy Usage page reads the project's MySQL room, booking, sensor, reading and
equipment-fault tables. Because local development has no physical power meters,
you can create clearly simulated readings for currently occupied rooms:

```bash
npm run record:energy -- --backfill 6
```

Run `npm run record:energy` later to add one fresh batch. This demo utility never
runs automatically and does not replace a real meter integration.

Test login details after seed:

```text
Admin:    admin@giridarshan.com / Password123!
Staff:    staff@giridarshan.com / Password123!
Customer: customer@giridarshan.com / Password123!
```

## 5. Start the backend

```bash
npm run dev
```

Test this in the browser:

```text
http://localhost:5000/api/health
```

Expected result:

```json
{
  "status": "ok",
  "database": "connected"
}
```

## 6. API route groups

| Area | API path | Purpose |
|---|---|---|
| Auth/Login | `/api/auth` | register, login, current user, logout |
| Rooms | `/api/rooms` | room types, rooms, live room monitor |
| Bookings | `/api/bookings` | customer bookings and admin/staff booking status |
| Payments | `/api/payments` | demo payment records and invoice creation |
| Verification | `/api/verifications` | guest document submission and staff verification |
| Staff | `/api/staff` | admin staff management |
| Users | `/api/users` | admin user management |
| Enquiries | `/api/enquiries` | contact/enquiry submission and staff/admin review |
| Parking | `/api/parking` | parking spots and allocations |
| Energy | `/api/energy` | energy overview, appliance readings, trends and equipment faults |
| Dashboard | `/api/dashboard` | customer, staff and admin summaries |

## 7. Frontend connection

The main website is connected to these API routes. Authentication tokens are kept in runtime memory and are cleared by logout or a browser refresh.

Example:

```js
const API_BASE = 'http://localhost:5000/api';

async function login(email, password, role) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role })
  });
  const data = await res.json();
  return data;
}
```

## Important note

This backend is ready for local MySQL development first. Later, when you move to Supabase or another deployment platform, the API layer can be updated without redesigning the website pages.
