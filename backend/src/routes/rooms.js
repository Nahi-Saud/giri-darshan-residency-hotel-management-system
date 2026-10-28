const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/types', async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT rt.*, GROUP_CONCAT(a.amenity_name ORDER BY a.amenity_name SEPARATOR ', ') AS amenities
      FROM room_types rt
      LEFT JOIN room_type_amenities rta ON rta.room_type_id = rt.id
      LEFT JOIN amenities a ON a.id = rta.amenity_id
      WHERE rt.is_active = TRUE
      GROUP BY rt.id
      ORDER BY rt.id
    `);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { status, floor } = req.query;
    const params = {};
    let where = 'WHERE 1=1';
    if (status) { where += ' AND r.status = :status'; params.status = status; }
    if (floor) { where += ' AND r.floor_number = :floor'; params.floor = Number(floor); }
    const rows = await query(`
      SELECT r.*, rt.type_name, rt.base_price_inr, rt.max_capacity
      FROM rooms r
      JOIN room_types rt ON rt.id = r.room_type_id
      ${where}
      ORDER BY r.floor_number, r.room_number
    `, params);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/live', requireAuth, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM vw_live_room_monitor ORDER BY floor_number, room_number');
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { roomNumber, roomTypeId, floorNumber, status, bedrooms, bathrooms, notes } = req.body;
    if (typeof roomNumber !== 'string' || !roomNumber.trim() || roomNumber.trim().length > 20 || !Number.isSafeInteger(Number(roomTypeId)) || Number(roomTypeId) < 1) return res.status(400).json({ message: 'Enter a valid room number and room type.' });
    if (floorNumber !== undefined && floorNumber !== null && floorNumber !== '' && (!Number.isSafeInteger(Number(floorNumber)) || Number(floorNumber) < 0 || Number(floorNumber) > 999)) return res.status(400).json({ message: 'Enter a valid floor number.' });
    if (status !== undefined && !['available','booked','occupied','maintenance','inactive'].includes(status)) return res.status(400).json({ message: 'Invalid room status.' });
    const result = await query(
      `INSERT INTO rooms (room_number, room_type_id, floor_number, status, bedrooms, bathrooms, notes)
       VALUES (:roomNumber, :roomTypeId, :floorNumber, :status, :bedrooms, :bathrooms, :notes)`,
      { roomNumber: roomNumber.trim(), roomTypeId: Number(roomTypeId), floorNumber: floorNumber === '' || floorNumber == null ? null : Number(floorNumber), status: status || 'available', bedrooms: bedrooms || null, bathrooms: bathrooms || null, notes: notes || null }
    );
    res.status(201).json({ id: result.insertId, message: 'Room created.' });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { roomNumber, roomTypeId, floorNumber, status, housekeepingStatus, bedrooms, bathrooms, notes } = req.body;
    if (roomNumber !== undefined && (typeof roomNumber !== 'string' || !roomNumber.trim() || roomNumber.trim().length > 20)) return res.status(400).json({ message: 'Enter a valid room number.' });
    if (roomTypeId !== undefined && (!Number.isSafeInteger(Number(roomTypeId)) || Number(roomTypeId) < 1)) return res.status(400).json({ message: 'Select a valid room type.' });
    if (floorNumber !== undefined && floorNumber !== null && floorNumber !== '' && (!Number.isSafeInteger(Number(floorNumber)) || Number(floorNumber) < 0 || Number(floorNumber) > 999)) return res.status(400).json({ message: 'Enter a valid floor number.' });
    if (status !== undefined && !['available','booked','occupied','maintenance','inactive'].includes(status)) return res.status(400).json({ message: 'Invalid room status.' });
    if (housekeepingStatus !== undefined && !['clean','dirty','in_progress','inspected'].includes(housekeepingStatus)) return res.status(400).json({ message: 'Invalid housekeeping status.' });
    const result = await query(
      `UPDATE rooms SET
         room_number = COALESCE(:roomNumber, room_number),
         room_type_id = COALESCE(:roomTypeId, room_type_id),
         floor_number = CASE WHEN :floorProvided = 1 THEN :floorNumber ELSE floor_number END,
         status = COALESCE(:status, status),
         housekeeping_status = COALESCE(:housekeepingStatus, housekeeping_status),
         bedrooms = COALESCE(:bedrooms, bedrooms),
         bathrooms = COALESCE(:bathrooms, bathrooms),
         notes = COALESCE(:notes, notes)
       WHERE id = :id`,
      { id: req.params.id, roomNumber: roomNumber === undefined ? null : roomNumber.trim(), roomTypeId: roomTypeId === undefined ? null : Number(roomTypeId), floorProvided: floorNumber === undefined ? 0 : 1, floorNumber: floorNumber === '' || floorNumber === null ? null : Number(floorNumber), status: status || null, housekeepingStatus: housekeepingStatus || null, bedrooms: bedrooms ?? null, bathrooms: bathrooms ?? null, notes: notes ?? null }
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Room not found.' });
    res.json({ message: 'Room updated.' });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await query('UPDATE rooms SET status = \'inactive\' WHERE id = :id', { id: req.params.id });
    if (!result.affectedRows) return res.status(404).json({ message: 'Room not found.' });
    res.json({ message: 'Room marked inactive.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
