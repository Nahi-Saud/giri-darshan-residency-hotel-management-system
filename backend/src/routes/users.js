const express = require('express');
const { query, transaction } = require('../db');
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));
router.post('/', async (req, res, next) => {
  try {
    const { firstName, lastName, email, phone, password, role } = req.body;
    if (![firstName, lastName, email, password].every(v => typeof v === 'string' && v.trim()) || !['customer', 'staff', 'admin'].includes(role)) return res.status(400).json({ message: 'Complete the required fields and select a valid role.' });
    if (firstName.length > 80 || lastName.length > 80 || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || Buffer.byteLength(password) > 72) return res.status(400).json({ message: 'Use a valid email and a password of at least 8 characters (maximum 72 bytes).' });
    const hash = await bcrypt.hash(password, 12);
    const id = await transaction(async conn => {
      const [result] = await conn.execute('INSERT INTO users (first_name,last_name,email,phone,password_hash,role) VALUES (?,?,?,?,?,?)', [firstName.trim(),lastName.trim(),email.trim().toLowerCase(),phone || null,hash,role]);
      if (role === 'customer') await conn.execute('INSERT INTO customer_profiles (user_id) VALUES (?)', [result.insertId]);
      if (role === 'staff') await conn.execute('INSERT INTO staff_profiles (user_id,employee_code) VALUES (?,?)', [result.insertId, 'GDR-STF-' + result.insertId]);
      return result.insertId;
    });
    res.status(201).json({ id, message: 'User created.' });
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email is already registered.' }); next(error); }
});

router.get('/', async (req, res, next) => {
  try {
    const rows = await query('SELECT id, first_name, last_name, email, phone, role, status, created_at FROM users ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) { next(error); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: 'Invalid user ID.' });
    const [existing] = await query('SELECT id, first_name, last_name, email, phone FROM users WHERE id = :id', { id });
    if (!existing) return res.status(404).json({ message: 'User not found.' });
    const firstName = String(req.body.firstName ?? existing.first_name).trim();
    const lastName = String(req.body.lastName ?? existing.last_name).trim();
    const email = String(req.body.email ?? existing.email).trim().toLowerCase();
    const phone = String(req.body.phone ?? existing.phone ?? '').trim();
    if (!firstName || !lastName || firstName.length > 80 || lastName.length > 80) return res.status(400).json({ message: 'First and last name are required and must be 80 characters or fewer.' });
    if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    if (phone.length > 30) return res.status(400).json({ message: 'Phone number must be 30 characters or fewer.' });
    await query('UPDATE users SET first_name=:firstName, last_name=:lastName, email=:email, phone=:phone WHERE id=:id', { firstName, lastName, email, phone: phone || null, id });
    res.json({ message: 'User updated.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email is already registered.' });
    next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive', 'blocked'].includes(status)) return res.status(400).json({ message: 'Invalid account status.' });
    if (Number(req.params.id) === req.user.id && status !== 'active') return res.status(409).json({ message: 'You cannot disable your own account.' });
    const result = await query('UPDATE users SET status = :status WHERE id = :id', { status, id: req.params.id });
    if (!result.affectedRows) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'User status updated.' });
  } catch (error) { next(error); }
});

module.exports = router;
