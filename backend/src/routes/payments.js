const express = require('express');
const { query, transaction } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { makeInvoiceNumber } = require('../utils/refs');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    let sql = `
      SELECT p.*, b.booking_ref, b.customer_id, b.check_in_date, b.check_out_date,
        rt.type_name AS room_type, r.room_number, u.email AS customer_email, u.phone AS customer_phone,
        CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
        i.id AS invoice_id, i.invoice_number, i.subtotal_inr, i.tax_inr, i.total_inr, i.invoice_status, i.issued_at
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      JOIN users u ON u.id = b.customer_id
      JOIN room_types rt ON rt.id = b.room_type_id
      LEFT JOIN rooms r ON r.id = b.room_id
      LEFT JOIN invoices i ON i.payment_id = p.id
    `;
    const params = {};
    if (req.user.role === 'customer') {
      sql += ' WHERE b.customer_id = :customerId';
      params.customerId = req.user.id;
    } else if (req.user.role === 'staff') {
      sql += ' WHERE p.payment_status IN (\'paid\', \'pending\')';
    }
    sql += ' ORDER BY p.created_at DESC';
    const rows = await query(sql, params);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/invoices/:bookingId', requireAuth, async (req, res, next) => {
  try {
    const bookingId = Number(req.params.bookingId);
    if (!Number.isSafeInteger(bookingId) || bookingId < 1) return res.status(400).json({ message: 'Invalid booking ID.' });
    const rows = await query(`SELECT i.*, b.booking_ref, b.customer_id, b.check_in_date, b.check_out_date,
      CONCAT(u.first_name, ' ', u.last_name) AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
      rt.type_name AS room_type, r.room_number, p.payment_method, p.payment_status, p.transaction_ref
      FROM invoices i JOIN bookings b ON b.id = i.booking_id JOIN users u ON u.id = b.customer_id
      JOIN room_types rt ON rt.id = b.room_type_id LEFT JOIN rooms r ON r.id = b.room_id
      LEFT JOIN payments p ON p.id = i.payment_id WHERE i.booking_id = :bookingId
      ORDER BY i.created_at DESC, i.id DESC LIMIT 1`, { bookingId });
    const invoice = rows[0];
    if (!invoice) return res.status(404).json({ message: 'Invoice not found.' });
    if (req.user.role === 'customer' && invoice.customer_id !== req.user.id) return res.status(403).json({ message: 'You can only access your own invoice.' });
    res.set('Cache-Control', 'no-store');
    res.json(invoice);
  } catch (error) { next(error); }
});

router.post('/:bookingId', requireAuth, async (req, res, next) => {
  try {
    const { paymentMethod = 'demo', paymentStatus = 'paid', transactionRef } = req.body;
    if (!['card', 'gpay', 'upi', 'paytm', 'cash', 'bank_transfer', 'demo'].includes(paymentMethod) || !['pending', 'paid', 'failed', 'cancelled'].includes(paymentStatus)) return res.status(400).json({ message: 'Invalid payment method or status.' });
    const bookingId = Number(req.params.bookingId);

    const result = await transaction(async (conn) => {
      const [[booking]] = await conn.execute('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [bookingId]);
      if (!booking) {
        const err = new Error('Booking not found.');
        err.status = 404;
        throw err;
      }
      if (req.user.role === 'customer' && booking.customer_id !== req.user.id) {
        const err = new Error('You can only pay for your own booking.');
        err.status = 403;
        throw err;
      }
      const [[existing]] = await conn.execute("SELECT id FROM payments WHERE booking_id = ? AND payment_status IN ('paid', 'pending') LIMIT 1", [bookingId]);
      if (existing) { const err = new Error('A payment has already been recorded for this booking.'); err.status = 409; throw err; }
      const amount = booking.total_amount_inr || 0;
      const [payResult] = await conn.execute(
        `INSERT INTO payments (booking_id, payment_method, payment_status, amount_inr, transaction_ref, paid_at)
         VALUES (?, ?, ?, ?, ?, IF(? = 'paid', CURRENT_TIMESTAMP, NULL))`,
        [bookingId, paymentMethod, paymentStatus, amount, transactionRef || null, paymentStatus]
      );
      await conn.execute(
        `INSERT INTO invoices (invoice_number, booking_id, payment_id, subtotal_inr, tax_inr, total_inr, invoice_status, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [makeInvoiceNumber(), bookingId, payResult.insertId, amount, 0, amount, paymentStatus === 'paid' ? 'paid' : 'issued']
      );
      await conn.execute('UPDATE bookings SET booking_status = ? WHERE id = ?', ['awaiting_verification', bookingId]);
      await conn.execute(
        `INSERT INTO guest_verifications (booking_id, verification_status)
         VALUES (?, 'pending')
         ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
        [bookingId]
      );
      return { paymentId: payResult.insertId };
    });

    res.status(201).json({ message: 'Payment recorded.', ...result });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/status', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { paymentStatus } = req.body;
    if (!['pending', 'paid', 'failed', 'refunded', 'cancelled'].includes(paymentStatus)) return res.status(400).json({ message: 'Invalid payment status.' });
    const result = await query('UPDATE payments SET payment_status = :paymentStatus, paid_at = IF(:paymentStatus = \'paid\', CURRENT_TIMESTAMP, paid_at) WHERE id = :id', { paymentStatus, id: req.params.id });
    if (!result.affectedRows) return res.status(404).json({ message: 'Payment not found.' });
    await query("UPDATE invoices SET invoice_status = CASE WHEN :paymentStatus = 'paid' THEN 'paid' WHEN :paymentStatus = 'cancelled' THEN 'void' ELSE 'issued' END WHERE payment_id = :id", { paymentStatus, id: req.params.id });
    res.json({ message: 'Payment status updated.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
