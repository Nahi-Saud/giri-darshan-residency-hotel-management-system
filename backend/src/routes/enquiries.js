const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { customerId, name, email, phone, subject, message } = req.body;
    if (![name, email, message].every(value => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'name, email and message are required.' });
    if (name.trim().length > 160 || email.trim().length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || String(phone || '').length > 30 || String(subject || '').length > 180 || message.trim().length > 5000) return res.status(400).json({ message: 'Enter valid enquiry details within the allowed lengths.' });
    const result = await query(
      `INSERT INTO enquiries (customer_id, name, email, phone, subject, message)
       VALUES (:customerId, :name, :email, :phone, :subject, :message)`,
      { customerId: customerId || null, name: name.trim(), email: email.trim().toLowerCase(), phone: phone || null, subject: subject || null, message: message.trim() }
    );
    res.status(201).json({ id: result.insertId, message: 'Enquiry submitted.' });
  } catch (error) { next(error); }
});

router.get('/', requireAuth, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT e.*, CONCAT(u.first_name, ' ', u.last_name) AS assigned_staff,
        (SELECT er.reply_text FROM enquiry_replies er WHERE er.enquiry_id = e.id ORDER BY er.created_at DESC, er.id DESC LIMIT 1) AS latest_reply,
        (SELECT er.created_at FROM enquiry_replies er WHERE er.enquiry_id = e.id ORDER BY er.created_at DESC, er.id DESC LIMIT 1) AS latest_reply_at,
        (SELECT COUNT(*) FROM enquiry_replies er WHERE er.enquiry_id = e.id) AS reply_count
      FROM enquiries e
      LEFT JOIN users u ON u.id = e.assigned_to
      ORDER BY e.created_at DESC
    `);
    res.json(rows);
  } catch (error) { next(error); }
});

router.post('/:id/replies', requireAuth, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const reply = typeof req.body?.reply === 'string' ? req.body.reply.trim() : '';
    if (!reply || reply.length > 5000) return res.status(400).json({ message: 'Reply must contain between 1 and 5000 characters.' });
    const enquiryId = Number(req.params.id);
    if (!Number.isSafeInteger(enquiryId) || enquiryId < 1) return res.status(400).json({ message: 'Invalid enquiry ID.' });
    const enquiries = await query('SELECT id FROM enquiries WHERE id = :id LIMIT 1', { id: enquiryId });
    if (!enquiries.length) return res.status(404).json({ message: 'Enquiry not found.' });
    const result = await query('INSERT INTO enquiry_replies (enquiry_id, replied_by, reply_text) VALUES (:enquiryId, :repliedBy, :reply)', { enquiryId, repliedBy: req.user.id, reply });
    await query("UPDATE enquiries SET enquiry_status = 'responded', assigned_to = COALESCE(assigned_to, :staffId) WHERE id = :id", { staffId: req.user.id, id: enquiryId });
    res.status(201).json({ id: result.insertId, message: 'Reply saved.' });
  } catch (error) { next(error); }
});

router.patch('/:id', requireAuth, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const { status, assignedTo } = req.body;
    if (status !== undefined && !['new', 'open', 'in_progress', 'responded', 'closed'].includes(status)) return res.status(400).json({ message: 'Invalid enquiry status.' });
    const result = await query(
      'UPDATE enquiries SET enquiry_status = COALESCE(:status, enquiry_status), assigned_to = COALESCE(:assignedTo, assigned_to) WHERE id = :id',
      { id: req.params.id, status: status || null, assignedTo: assignedTo || null }
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Enquiry not found.' });
    res.json({ message: 'Enquiry updated.' });
  } catch (error) { next(error); }
});

module.exports = router;
