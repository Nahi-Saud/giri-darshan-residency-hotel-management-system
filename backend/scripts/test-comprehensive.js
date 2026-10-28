const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const base = process.env.API_BASE || 'http://127.0.0.1:5000/api';

async function request(path, { method = 'GET', token, body, rawBody, origin } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { response, data };
}

async function login(email, password = 'Password123!', role) {
  const result = await request('/auth/login', { method: 'POST', body: { email, password, role } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.ok(result.data.token && result.data.user?.role === role);
  return result.data.token;
}

async function expectStatus(path, expected, options) {
  const result = await request(path, options);
  assert.equal(result.response.status, expected, `${options?.method || 'GET'} ${path}: ${JSON.stringify(result.data)}`);
  return result;
}

async function main() {
  const health = await expectStatus('/health', 200);
  assert.equal(health.data.database, 'connected');
  assert.ok(health.response.headers.get('x-content-type-options'));
  assert.ok(health.response.headers.get('content-security-policy'));
  console.log('PASS health, database connectivity and Helmet security headers');

  await expectStatus('/auth/login', 401, { method: 'POST', body: { email: 'admin@giridarshan.com', password: 'wrong-password', role: 'admin' } });
  const customer = await login('customer@giridarshan.com', 'Password123!', 'customer');
  const staff = await login('staff@giridarshan.com', 'Password123!', 'staff');
  const admin = await login('admin@giridarshan.com', 'Password123!', 'admin');
  await expectStatus('/auth/me', 401);
  await expectStatus('/auth/me', 200, { token: customer });
  await expectStatus('/auth/me', 200, { token: staff });
  await expectStatus('/auth/me', 200, { token: admin });
  console.log('PASS login failure, three role logins, authenticated identity and anonymous denial');

  await expectStatus('/dashboard/customer', 200, { token: customer });
  await expectStatus('/dashboard/staff', 200, { token: staff });
  const adminDashboard = await expectStatus('/dashboard/admin', 200, { token: admin });
  for (const key of ['recentBookings', 'bookingTrends', 'weeklyRevenue', 'roomStatus', 'occupancyRate']) assert.ok(Object.hasOwn(adminDashboard.data, key), `Missing dashboard field ${key}`);
  await expectStatus('/dashboard/admin', 403, { token: customer });
  await expectStatus('/dashboard/admin', 403, { token: staff });
  await expectStatus('/dashboard/customer', 403, { token: admin });
  console.log('PASS dashboard payloads and role boundaries');

  await expectStatus('/rooms/types', 200);
  await expectStatus('/rooms', 200, { token: customer });
  await expectStatus('/rooms/live', 200, { token: staff });
  await expectStatus('/rooms/live', 403, { token: customer });
  await expectStatus('/rooms', 403, { method: 'POST', token: staff, body: { roomNumber: 'DENIED', roomTypeId: 1, floorNumber: 1 } });
  console.log('PASS public room types, authenticated rooms, live rooms and room-management roles');

  await expectStatus('/bookings', 200, { token: customer });
  await expectStatus('/bookings/customers', 200, { token: staff });
  await expectStatus('/bookings/customers', 403, { token: customer });
  await expectStatus('/bookings/999999999', 403, { method: 'PATCH', token: customer, body: { staffNotes: 'denied' } });
  console.log('PASS booking list ownership surface and staff-only booking editing');

  await expectStatus('/payments', 200, { token: customer });
  await expectStatus('/verifications/pending', 200, { token: staff });
  await expectStatus('/verifications/pending', 403, { token: customer });
  await expectStatus('/verifications/999999999/upload', 403, { method: 'POST', token: customer, body: { documentType: 'other', fileData: 'invalid' } });
  console.log('PASS payments access and staff-only verification/document upload');

  await expectStatus('/users', 200, { token: admin });
  await expectStatus('/users', 403, { token: staff });
  await expectStatus('/users', 403, { token: customer });
  await expectStatus('/staff', 200, { token: admin });
  await expectStatus('/staff', 403, { token: staff });
  console.log('PASS admin-only user and staff management');

  await expectStatus('/enquiries', 200, { token: staff });
  await expectStatus('/enquiries', 403, { token: customer });
  await expectStatus('/parking/spots', 200, { token: staff });
  await expectStatus('/parking/spots', 403, { token: customer });
  await expectStatus('/energy/overview', 200, { token: staff });
  await expectStatus('/energy/overview', 403, { token: customer });
  await expectStatus('/energy/readings', 403, { method: 'POST', token: staff, body: { roomId: 1, kwhUsage: 1 } });
  console.log('PASS enquiry, parking and energy authorization');

  await expectStatus('/auth/login', 400, { method: 'POST', rawBody: '{bad json' });
  const expired = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: -1, algorithm: 'HS256' });
  await expectStatus('/auth/me', 401, { token: expired });
  const logoutToken = await login('customer@giridarshan.com', 'Password123!', 'customer');
  await expectStatus('/auth/logout', 200, { method: 'POST', token: logoutToken });
  await expectStatus('/auth/me', 401, { token: logoutToken });
  await expectStatus('/route-that-does-not-exist', 404);
  console.log('PASS malformed JSON, expired token, logout revocation and 404 handling');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
