const assert = require('node:assert/strict');
const express = require('express');
require('dotenv').config();
const { pool, query } = require('../src/db');
const { signToken } = require('../src/middleware/auth');

async function main() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use('/bookings', require('../src/routes/bookings'));
  app.use('/payments', require('../src/routes/payments'));
  app.use('/verifications', require('../src/routes/verifications'));
  app.use('/enquiries', require('../src/routes/enquiries'));
  app.use('/staff', require('../src/routes/staff'));
  app.use('/users', require('../src/routes/users'));
  app.use('/rooms', require('../src/routes/rooms'));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const [admin] = await query("SELECT * FROM users WHERE role='admin' AND status='active' LIMIT 1");
    const [staff] = await query("SELECT * FROM users WHERE role='staff' AND status='active' LIMIT 1");
    const [customer] = await query("SELECT * FROM users WHERE role='customer' AND status='active' LIMIT 1");
    const [roomType] = await query(`SELECT rt.* FROM room_types rt
      WHERE rt.is_active=TRUE AND rt.max_capacity>=2 AND EXISTS (
        SELECT 1 FROM rooms r WHERE r.room_type_id=rt.id AND r.status IN ('available','booked')
      ) ORDER BY rt.id LIMIT 1`);
    assert.ok(admin && staff && customer && roomType, 'Seed admin, staff, customer and room type are required.');
    const tokens = { admin: signToken(admin), staff: signToken(staff), customer: signToken(customer) };
    async function call(path, method = 'GET', body, actor = 'admin') {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${tokens[actor]}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json();
      return { response, data };
    }

    const [latestBooking] = await query('SELECT MAX(check_out_date) AS latest FROM bookings WHERE room_type_id=?', [roomType.id]);
    const dateFrom = (value, days) => { const date = value ? new Date(value) : new Date('2042-02-08T00:00:00Z'); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
    const checkInDate = dateFrom(latestBooking?.latest, 2);
    const checkOutDate = dateFrom(latestBooking?.latest, 4);
    const editedCheckInDate = dateFrom(latestBooking?.latest, 3);
    const editedCheckOutDate = dateFrom(latestBooking?.latest, 5);
    const create = await call('/bookings', 'POST', { customerId: customer.id, roomTypeId: roomType.id, checkInDate, checkOutDate, adults: 2, children: 0, seniors: 0 }, 'staff');
    assert.equal(create.response.status, 201, JSON.stringify(create.data));
    const bookingId = create.data.id;
    const edit = await call(`/bookings/${bookingId}`, 'PATCH', { checkInDate: editedCheckInDate, checkOutDate: editedCheckOutDate, adults: 1, children: 0, seniors: 1, customerPhone: 'QA-0400-000-001', staffNotes: 'QA booking management note.' }, 'staff');
    assert.equal(edit.response.status, 200, JSON.stringify(edit.data));
    const list = await call('/bookings', 'GET', undefined, 'staff');
    assert.equal(list.response.status, 200, JSON.stringify(list.data));
    assert.ok(Array.isArray(list.data), JSON.stringify(list.data));
    const listed = list.data.find(row => Number(row.booking_id) === Number(bookingId));
    assert.equal(listed.customer_phone, 'QA-0400-000-001');
    assert.equal(listed.staff_notes, 'QA booking management note.');
    assert.equal(Number(listed.seniors), 1);
    const [guestCounts] = await query('SELECT COUNT(*) AS total, SUM(guest_type = \'adult\') AS adults, SUM(guest_type = \'senior\') AS seniors FROM booking_guests WHERE booking_id=?', [bookingId]);
    assert.deepEqual(guestCounts, { total: 2, adults: 1, seniors: 1 });
    console.log('PASS admin/staff booking creation, editing, contact and staff-note data');

    const userEdit = await call(`/users/${customer.id}`, 'PATCH', { firstName: customer.first_name, lastName: customer.last_name, email: customer.email, phone: 'QA-0400-000-EDIT' }, 'admin');
    assert.equal(userEdit.response.status, 200, JSON.stringify(userEdit.data));
    const users = await call('/users', 'GET', undefined, 'admin');
    assert.equal(users.data.find(user => Number(user.id) === Number(customer.id))?.phone, 'QA-0400-000-EDIT');
    console.log('PASS user profile editing');

    const payment = await call(`/payments/${bookingId}`, 'POST', { paymentMethod: 'demo', paymentStatus: 'paid' }, 'admin');
    assert.equal(payment.response.status, 201, JSON.stringify(payment.data));
    const invoice = await call(`/payments/invoices/${bookingId}`, 'GET', undefined, 'admin');
    assert.equal(invoice.response.status, 200, JSON.stringify(invoice.data));
    assert.ok(invoice.data.invoice_number && Number(invoice.data.total_inr) >= 0);
    console.log('PASS payment creates retrievable invoice');

    const pendingBeforeUpload = await call('/verifications/pending', 'GET', undefined, 'staff');
    const receptionTask = pendingBeforeUpload.data.find(row => Number(row.booking_id) === Number(bookingId));
    assert.ok(receptionTask, 'Paid booking must create a reception verification task.');
    assert.equal(receptionTask.document_id, null);
    console.log('PASS payment creates reception verification task before document upload');

    const fileData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=';
    const upload = await call(`/verifications/${bookingId}/upload`, 'POST', { documentType: 'other', fileData }, 'staff');
    assert.equal(upload.response.status, 201, JSON.stringify(upload.data));
    const listAfterUpload = await call('/bookings', 'GET', undefined, 'staff');
    assert.ok(listAfterUpload.data.find(row => Number(row.booking_id) === Number(bookingId))?.document_id);
    console.log('PASS booking-management document upload and document status data');

    const pendingVerifications = await call('/verifications/pending', 'GET', undefined, 'staff');
    assert.equal(pendingVerifications.response.status, 200, JSON.stringify(pendingVerifications.data));
    const pendingVerification = pendingVerifications.data.find(row => Number(row.booking_id) === Number(bookingId));
    assert.ok(pendingVerification, 'Uploaded booking must appear in staff verification.');
    assert.equal(Number(pendingVerification.max_capacity), Number(roomType.max_capacity));
    assert.equal(Number(pendingVerification.total_guests), 2);
    assert.equal(pendingVerification.payment_status, 'paid');
    const verified = await call(`/verifications/${pendingVerification.verification_id}/action`, 'PATCH', { action: 'verified', notes: 'QA identity checks passed.' }, 'staff');
    assert.equal(verified.response.status, 200, JSON.stringify(verified.data));
    const invalidArrival = await call(`/verifications/${pendingVerification.verification_id}/action`, 'PATCH', { action: 'confirmed_check_in', arrivingGuests: 0 }, 'staff');
    assert.equal(invalidArrival.response.status, 400, JSON.stringify(invalidArrival.data));
    const confirmedArrival = await call(`/verifications/${pendingVerification.verification_id}/action`, 'PATCH', { action: 'confirmed_check_in', arrivingGuests: Number(roomType.max_capacity) + 1, notes: 'QA arrival count above room capacity accepted and confirmed.' }, 'staff');
    assert.equal(confirmedArrival.response.status, 200, JSON.stringify(confirmedArrival.data));
    const [arrivalRecord] = await query('SELECT check_in_notes FROM check_in_out WHERE booking_id = ?', [bookingId]);
    assert.equal(arrivalRecord.check_in_notes, 'QA arrival count above room capacity accepted and confirmed.');
    const [arrivalAudit] = await query("SELECT notes FROM staff_verification_actions WHERE verification_id = ? AND action_type = 'confirmed_check_in' ORDER BY id DESC LIMIT 1", [pendingVerification.verification_id]);
    assert.match(arrivalAudit.notes, new RegExp(`^Arriving guests: ${Number(roomType.max_capacity) + 1}`));
    const checkout = await call(`/bookings/${bookingId}/status`, 'PATCH', { status: 'checked_out' }, 'staff');
    assert.equal(checkout.response.status, 200, JSON.stringify(checkout.data));
    console.log('PASS staff verification summary, editable arriving guest count without a capacity ceiling, notes and check-in');

    const enquiryResponse = await fetch(base + '/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'QA Enquiry', email: `qa-${Date.now()}@example.com`, subject: 'Feature test', message: 'Please confirm the reply workflow.' }) });
    const enquiry = await enquiryResponse.json();
    assert.equal(enquiryResponse.status, 201, JSON.stringify(enquiry));
    const reply = await call(`/enquiries/${enquiry.id}/replies`, 'POST', { reply: 'The enquiry reply workflow is working.' }, 'staff');
    assert.equal(reply.response.status, 201, JSON.stringify(reply.data));
    const enquiries = await call('/enquiries', 'GET', undefined, 'staff');
    assert.equal(enquiries.data.find(item => item.id === enquiry.id)?.latest_reply, 'The enquiry reply workflow is working.');
    console.log('PASS enquiry reply stored and returned');

    const stamp = Date.now();
    const newStaff = await call('/staff', 'POST', { firstName: 'QA', lastName: 'Staff', email: `qa-staff-${stamp}@example.com`, password: 'Password123!', employeeCode: `QA-STF-${stamp}`, department: 'Front Office', jobTitle: 'QA Tester', hourlyRateInr: 30, hireDate: '2026-10-15' }, 'admin');
    assert.equal(newStaff.response.status, 201, JSON.stringify(newStaff.data));
    const staffEdit = await call(`/staff/${newStaff.data.staffProfileId}`, 'PATCH', { department: 'Operations', employmentStatus: 'on_leave', hourlyRateInr: 32 }, 'admin');
    assert.equal(staffEdit.response.status, 200, JSON.stringify(staffEdit.data));
    console.log('PASS staff creation and profile editing');

    const room = await call('/rooms', 'POST', { roomNumber: `QA-${stamp}`, roomTypeId: roomType.id, floorNumber: 8, status: 'available' }, 'admin');
    assert.equal(room.response.status, 201, JSON.stringify(room.data));
    const roomEdit = await call(`/rooms/${room.data.id}`, 'PATCH', { roomNumber: `QA-${stamp}-E`, floorNumber: 9, status: 'maintenance' }, 'admin');
    assert.equal(roomEdit.response.status, 200, JSON.stringify(roomEdit.data));
    const [savedRoom] = await query('SELECT room_number, floor_number, status FROM rooms WHERE id=?', [room.data.id]);
    assert.deepEqual(savedRoom, { room_number: `QA-${stamp}-E`, floor_number: 9, status: 'maintenance' });
    console.log('PASS room number, floor and status editing');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
