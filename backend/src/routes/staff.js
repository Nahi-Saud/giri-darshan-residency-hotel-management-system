const express = require('express');
const bcrypt = require('bcryptjs');
const { query, transaction } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/', async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT sp.*, u.first_name, u.last_name, u.email, u.phone, u.status AS user_status,
        COALESCE((SELECT ROUND(SUM(GREATEST(TIMESTAMPDIFF(MINUTE, ss.clock_in, ss.clock_out) - ss.break_minutes, 0)) / 60, 2)
          FROM staff_shifts ss WHERE ss.staff_profile_id = sp.id AND ss.shift_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND ss.clock_in IS NOT NULL AND ss.clock_out IS NOT NULL), 0) AS weekly_hours,
        (SELECT TIME_FORMAT(ss.clock_in, '%H:%i') FROM staff_shifts ss WHERE ss.staff_profile_id = sp.id ORDER BY ss.shift_date DESC, ss.id DESC LIMIT 1) AS latest_clock_in,
        (SELECT TIME_FORMAT(ss.clock_out, '%H:%i') FROM staff_shifts ss WHERE ss.staff_profile_id = sp.id ORDER BY ss.shift_date DESC, ss.id DESC LIMIT 1) AS latest_clock_out
      FROM staff_profiles sp
      JOIN users u ON u.id = sp.user_id
      ORDER BY sp.employee_code
    `);
    res.json(rows);
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const { firstName, lastName, email, phone, password, employeeCode, department, jobTitle, hourlyRateInr, hireDate } = req.body;
    if (![firstName, lastName, email, password, employeeCode].every(value => typeof value === 'string' && value.trim())) {
      return res.status(400).json({ message: 'firstName, lastName, email, password and employeeCode are required.' });
    }
    if (firstName.trim().length > 80 || lastName.trim().length > 80 || employeeCode.trim().length > 40 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 160 || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ message: 'Enter valid staff details and a password of 8 to 72 bytes.' });
    }
    if (hourlyRateInr !== undefined && hourlyRateInr !== '' && (!Number.isFinite(Number(hourlyRateInr)) || Number(hourlyRateInr) < 0)) return res.status(400).json({ message: 'Hourly rate must be zero or greater.' });
    const result = await transaction(async (conn) => {
      const passwordHash = await bcrypt.hash(password, 12);
      const [userResult] = await conn.execute(
        `INSERT INTO users (first_name, last_name, email, phone, password_hash, role)
         VALUES (?, ?, ?, ?, ?, 'staff')`,
        [firstName.trim(), lastName.trim(), email.trim().toLowerCase(), typeof phone === 'string' ? phone.trim() || null : null, passwordHash]
      );
      const [profileResult] = await conn.execute(
        `INSERT INTO staff_profiles (user_id, employee_code, department, job_title, hourly_rate_inr, hire_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userResult.insertId, employeeCode.trim(), department || null, jobTitle || null, hourlyRateInr === '' ? null : hourlyRateInr || null, hireDate || null]
      );
      return { userId: userResult.insertId, staffProfileId: profileResult.insertId };
    });
    res.status(201).json({ message: 'Staff member created.', ...result });
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email or employee code is already in use.' }); next(error); }
});

router.patch('/:staffProfileId', async (req, res, next) => {
  try {
    const { department, jobTitle, hourlyRateInr, hireDate, employmentStatus } = req.body;
    if (hourlyRateInr !== undefined && hourlyRateInr !== '' && (!Number.isFinite(Number(hourlyRateInr)) || Number(hourlyRateInr) < 0)) return res.status(400).json({ message: 'Hourly rate must be zero or greater.' });
    if (employmentStatus !== undefined && !['active','inactive','terminated','on_leave'].includes(employmentStatus)) return res.status(400).json({ message: 'Invalid employment status.' });
    const result = await query(
      `UPDATE staff_profiles SET
         department = COALESCE(:department, department),
         job_title = COALESCE(:jobTitle, job_title),
         hourly_rate_inr = COALESCE(:hourlyRateInr, hourly_rate_inr),
         hire_date = COALESCE(:hireDate, hire_date),
         employment_status = COALESCE(:employmentStatus, employment_status)
       WHERE id = :staffProfileId`,
      { staffProfileId: req.params.staffProfileId, department: department || null, jobTitle: jobTitle || null, hourlyRateInr: hourlyRateInr ?? null, hireDate: hireDate || null, employmentStatus: employmentStatus || null }
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Staff profile not found.' });
    res.json({ message: 'Staff profile updated.' });
  } catch (error) { next(error); }
});

router.post('/:staffProfileId/shifts', async (req, res, next) => {
  try {
    const { shiftDate, clockIn, clockOut, breakMinutes = 0, shiftStatus = 'scheduled' } = req.body;
    const result = await query(
      `INSERT INTO staff_shifts (staff_profile_id, shift_date, clock_in, clock_out, break_minutes, shift_status)
       VALUES (:staffProfileId, :shiftDate, :clockIn, :clockOut, :breakMinutes, :shiftStatus)`,
      { staffProfileId: req.params.staffProfileId, shiftDate, clockIn: clockIn || null, clockOut: clockOut || null, breakMinutes, shiftStatus }
    );
    res.status(201).json({ id: result.insertId, message: 'Shift saved.' });
  } catch (error) { next(error); }
});

module.exports = router;
