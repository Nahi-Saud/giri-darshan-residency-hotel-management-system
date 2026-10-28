const express = require('express');
const { query, transaction } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const documentRoot = path.resolve(__dirname, '../../private-documents');

const router = express.Router();

router.get('/pending', requireAuth, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const rows = await query(`SELECT gv.id AS verification_id, gv.verification_status, b.id AS booking_id, b.booking_ref,
      b.adults, b.children, b.seniors, b.total_guests, b.total_amount_inr,
      CONCAT(u.first_name, ' ', u.last_name) AS guest_name, rt.type_name AS room_type, rt.max_capacity, r.room_number,
      b.check_in_date, b.check_out_date, d.id AS document_id, d.document_type, d.file_path,
      COALESCE((SELECT p.payment_status FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1), 'pending') AS payment_status
      FROM guest_verifications gv JOIN bookings b ON b.id = gv.booking_id JOIN users u ON u.id = b.customer_id
      JOIN room_types rt ON rt.id = b.room_type_id LEFT JOIN rooms r ON r.id = b.room_id
      LEFT JOIN guest_identification_documents d ON d.id = gv.document_id
      WHERE gv.verification_status IN ('pending', 'under_review', 'verified') AND b.booking_status NOT IN ('checked_out', 'cancelled', 'rejected')
      ORDER BY gv.created_at DESC`);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/:bookingId/upload', requireAuth, requireRole('staff', 'admin'), async (req, res, next) => {
  let storedPath;
  try {
    const { documentType, documentNumber, fileData } = req.body;
    if (!['passport', 'aadhaar_card', 'drivers_license', 'national_id', 'other'].includes(documentType)) return res.status(400).json({ message: 'Select a valid document type.' });
    const match = typeof fileData === 'string' && fileData.match(/^data:(application\/pdf|image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return res.status(400).json({ message: 'Upload a PDF, PNG or JPEG document.' });
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return res.status(400).json({ message: 'Document must be between 1 byte and 5 MB.' });
    const signatures = { 'application/pdf': bytes.subarray(0, 5).toString() === '%PDF-', 'image/png': bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'image/jpeg': bytes.subarray(0, 3).toString('hex') === 'ffd8ff' };
    if (!signatures[match[1]]) return res.status(400).json({ message: 'Document content does not match its file type.' });
    const filePath = randomUUID() + ({ 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg' })[match[1]];
    const bookingId = Number(req.params.bookingId);

    const result = await transaction(async (conn) => {
      const [[booking]] = await conn.execute('SELECT * FROM bookings WHERE id = ?', [bookingId]);
      if (!booking) {
        const err = new Error('Booking not found.');
        err.status = 404;
        throw err;
      }
      await fs.mkdir(documentRoot, { recursive: true });
      storedPath = path.join(documentRoot, filePath);
      await fs.writeFile(storedPath, bytes, { flag: 'wx' });
      const [doc] = await conn.execute(
        `INSERT INTO guest_identification_documents
         (booking_id, uploaded_by, document_type, document_number, file_path, document_status)
         VALUES (?, ?, ?, ?, ?, 'submitted')`,
        [bookingId, req.user.id, documentType, documentNumber || null, filePath || null]
      );
      const [ver] = await conn.execute(
        `INSERT INTO guest_verifications (booking_id, document_id, verification_status)
         VALUES (?, ?, 'pending')
         ON DUPLICATE KEY UPDATE document_id = VALUES(document_id), verification_status = 'pending'`,
        [bookingId, doc.insertId]
      );
      const [[verification]] = await conn.execute('SELECT id FROM guest_verifications WHERE booking_id = ?', [bookingId]);
      await conn.execute('UPDATE bookings SET booking_status = ? WHERE id = ?', ['awaiting_verification', bookingId]);
      return { documentId: doc.insertId, verificationId: verification?.id || ver.insertId || null };
    });
    res.status(201).json({ message: 'Guest document submitted for staff verification.', ...result });
  } catch (error) {
    if (storedPath) await fs.unlink(storedPath).catch(() => {});
    next(error);
  }
});

router.get('/documents/:id', requireAuth, async (req, res, next) => {
  try {
    const [doc] = await query('SELECT d.file_path, b.customer_id FROM guest_identification_documents d JOIN bookings b ON b.id = d.booking_id WHERE d.id = ?', [req.params.id]);
    if (!doc) return res.status(404).json({ message: 'Document not found.' });
    if (req.user.role === 'customer' && doc.customer_id !== req.user.id) return res.status(403).json({ message: 'Access denied.' });
    if (!doc.file_path || path.basename(doc.file_path) !== doc.file_path) return res.status(404).json({ message: 'Document file unavailable.' });
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(path.join(documentRoot, doc.file_path), err => { if (err) next(err); });
  } catch (error) { next(error); }
});

router.patch('/:verificationId/action', requireAuth, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const { action, notes, arrivingGuests } = req.body;
    const allowed = ['verified', 'rejected', 'confirmed_check_in'];
    if (!allowed.includes(action)) return res.status(400).json({ message: 'action must be verified, rejected or confirmed_check_in.' });
    if (notes != null && (typeof notes !== 'string' || notes.trim().length > 1000)) return res.status(400).json({ message: 'Notes must be 1000 characters or fewer.' });
    if (action === 'rejected' && !String(notes || '').trim()) return res.status(400).json({ message: 'Add a brief reason before rejecting verification.' });

    await transaction(async (conn) => {
      const [[v]] = await conn.execute(`SELECT gv.*, b.total_guests, b.room_id, rt.max_capacity
        FROM guest_verifications gv JOIN bookings b ON b.id = gv.booking_id
        JOIN room_types rt ON rt.id = b.room_type_id
        WHERE gv.id = ? FOR UPDATE`, [req.params.verificationId]);
      if (!v) {
        const err = new Error('Verification record not found.');
        err.status = 404;
        throw err;
      }
      if (action === 'confirmed_check_in' && v.verification_status !== 'verified') {
        const err = new Error('Verify the document before check-in.'); err.status = 409; throw err;
      }
      if (action === 'verified' && !v.document_id) {
        const err = new Error('Upload the guest document before verification.'); err.status = 409; throw err;
      }
      if (action === 'confirmed_check_in') {
        const arriving = Number(arrivingGuests);
        if (!Number.isInteger(arriving) || arriving < 1) {
          const err = new Error('Arriving guest count must be a positive whole number.'); err.status = 400; throw err;
        }
      }
      if (v.verification_status === 'check_in_confirmed') { const err = new Error('This stay is already checked in.'); err.status = 409; throw err; }
      const actionNotes = action === 'confirmed_check_in'
        ? `Arriving guests: ${Number(arrivingGuests)}${String(notes || '').trim() ? `\n${String(notes).trim()}` : ''}`
        : String(notes || '').trim() || null;
      await conn.execute(
        'INSERT INTO staff_verification_actions (verification_id, staff_id, action_type, notes) VALUES (?, ?, ?, ?)',
        [req.params.verificationId, req.user.id, action, actionNotes]
      );

      if (action === 'verified') {
        await conn.execute('UPDATE guest_verifications SET verification_status = \'verified\', verified_by = ?, verified_at = CURRENT_TIMESTAMP WHERE id = ?', [req.user.id, req.params.verificationId]);
        await conn.execute('UPDATE guest_identification_documents SET document_status = \'verified\' WHERE id = ?', [v.document_id]);
        await conn.execute('UPDATE bookings SET booking_status = \'confirmed\' WHERE id = ?', [v.booking_id]);
      }
      if (action === 'rejected') {
        await conn.execute('UPDATE guest_verifications SET verification_status = \'rejected\', verified_by = ?, verified_at = CURRENT_TIMESTAMP, rejection_reason = ? WHERE id = ?', [req.user.id, notes || 'Rejected by staff.', req.params.verificationId]);
        await conn.execute('UPDATE guest_identification_documents SET document_status = \'rejected\' WHERE id = ?', [v.document_id]);
        await conn.execute('UPDATE bookings SET booking_status = \'rejected\' WHERE id = ?', [v.booking_id]);
      }
      if (action === 'confirmed_check_in') {
        await conn.execute('UPDATE guest_verifications SET verification_status = \'check_in_confirmed\', verified_by = ?, verified_at = CURRENT_TIMESTAMP WHERE id = ?', [req.user.id, req.params.verificationId]);
        await conn.execute('UPDATE bookings SET booking_status = \'checked_in\' WHERE id = ?', [v.booking_id]);
        await conn.execute('INSERT INTO check_in_out (booking_id, checked_in_by, check_in_time, check_in_notes) VALUES (?, ?, CURRENT_TIMESTAMP, ?) ON DUPLICATE KEY UPDATE checked_in_by = VALUES(checked_in_by), check_in_time = CURRENT_TIMESTAMP, check_in_notes = VALUES(check_in_notes)', [v.booking_id, req.user.id, String(notes || '').trim() || null]);
        await conn.execute('UPDATE rooms r JOIN bookings b ON b.room_id = r.id SET r.status = \'occupied\' WHERE b.id = ?', [v.booking_id]);
      }
    });
    res.json({ message: 'Verification action saved.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
