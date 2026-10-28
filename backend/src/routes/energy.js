const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('staff', 'admin'));

router.get('/overview', async (req, res, next) => {
  try {
    const rooms = await query('SELECT * FROM vw_live_room_monitor ORDER BY floor_number, room_number');
    const summary = await query(`
      SELECT
        COUNT(*) AS total_readings,
        COALESCE(SUM(kwh_usage), 0) AS total_kwh,
        AVG(kwh_usage) AS average_kwh,
        COUNT(DISTINCT CASE WHEN usage_level IN ('high', 'critical') THEN room_id END) AS high_usage_rooms
      FROM room_power_readings
      WHERE reading_time >= DATE_SUB(NOW(), INTERVAL 1 DAY)
    `);
    const [sensors] = await query("SELECT COUNT(*) AS total_sensors, COALESCE(SUM(sensor_status = 'active'),0) AS active_sensors FROM room_sensors");
    const [faults] = await query("SELECT COUNT(*) AS open_faults FROM equipment_faults WHERE fault_status IN ('reported','in_progress')");
    res.json({ summary: { ...summary[0], ...sensors, ...faults }, rooms });
  } catch (error) { next(error); }
});

// Rich energy dashboard data, adapted to the project's existing MySQL schema.
// Appliance watt columns are optional for older readings; in that case the
// recorded kWh value is converted to an approximate total draw for display.
router.get('/hotel-readings', async (req, res, next) => {
  try {
    const rooms = await query(`
      SELECT r.id, r.room_number, r.floor_number, r.status,
             rt.type_name AS room_type, rt.room_size_sqm, rt.max_capacity,
             p.id AS reading_id, p.tv_watts, p.ac_watts, p.microwave_watts,
             p.kwh_usage, p.reading_time
      FROM rooms r
      LEFT JOIN room_types rt ON rt.id = r.room_type_id
      LEFT JOIN (
        SELECT room_id, MAX(id) AS id
        FROM room_power_readings
        GROUP BY room_id
      ) latest ON latest.room_id = r.id
      LEFT JOIN room_power_readings p ON p.id = latest.id
      WHERE r.status <> 'inactive'
      ORDER BY r.floor_number, CAST(r.room_number AS UNSIGNED), r.room_number
    `);
    const [summary = {}] = await query(`
      SELECT COUNT(*) AS total_readings,
             COUNT(DISTINCT reading_time) AS reading_times,
             MIN(reading_time) AS first_reading_at,
             MAX(reading_time) AS last_reading_at
      FROM room_power_readings
    `);
    const history = await query(`
      SELECT reading_time,
             COUNT(*) AS rooms,
             SUM(COALESCE(tv_watts, 0) + COALESCE(ac_watts, 0) + COALESCE(microwave_watts, 0)
                 + CASE WHEN tv_watts IS NULL AND ac_watts IS NULL AND microwave_watts IS NULL
                        THEN kwh_usage * 1000 ELSE 0 END) AS total_watts
      FROM room_power_readings
      WHERE reading_time >= COALESCE(
        (SELECT MAX(reading_time) FROM room_power_readings) - INTERVAL 7 DAY,
        DATE_SUB(NOW(), INTERVAL 7 DAY)
      )
      GROUP BY reading_time
      ORDER BY reading_time DESC
      LIMIT 7
    `);
    const bookings = await query(`
      SELECT b.room_id, b.booking_ref, b.booking_status, b.check_in_date,
             b.check_out_date, b.total_guests
      FROM bookings b
      JOIN (
        SELECT room_id, MAX(id) AS id
        FROM bookings
        WHERE room_id IS NOT NULL AND booking_status <> 'cancelled'
        GROUP BY room_id
      ) latest ON latest.id = b.id
    `);
    const issues = await query(`
      SELECT id, room_id, equipment_name, fault_description, fault_status, reported_at
      FROM equipment_faults
      WHERE fault_status IN ('reported', 'in_progress')
      ORDER BY reported_at DESC
    `);
    const recent = await query(`
      SELECT room_id, reading_time, tv_watts, ac_watts, microwave_watts, kwh_usage
      FROM (
        SELECT p.*,
               ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY reading_time DESC, id DESC) AS row_number
        FROM room_power_readings p
      ) ranked
      WHERE row_number <= 6
      ORDER BY room_id, reading_time
    `);

    const bookingByRoom = new Map(bookings.map(booking => [Number(booking.room_id), booking]));
    const watts = reading => {
      const appliances = ['tv_watts', 'ac_watts', 'microwave_watts'];
      const hasApplianceReading = appliances.some(column => reading[column] !== null);
      return hasApplianceReading
        ? appliances.reduce((total, column) => total + (Number(reading[column]) || 0), 0)
        : (Number(reading.kwh_usage) || 0) * 1000;
    };

    res.json({
      source: process.env.DB_NAME || 'giri_darshan_db',
      generatedAt: new Date().toISOString(),
      readings: {
        total: Number(summary.total_readings) || 0,
        readingTimes: Number(summary.reading_times) || 0,
        firstReadingAt: summary.first_reading_at || null,
        lastReadingAt: summary.last_reading_at || null
      },
      history: history.reverse().map(reading => ({
        recordedAt: reading.reading_time,
        rooms: Number(reading.rooms) || 0,
        totalWatts: Number(reading.total_watts) || 0
      })),
      rooms: rooms.map(room => {
        const booking = bookingByRoom.get(Number(room.id));
        const roomRecent = recent.filter(reading => Number(reading.room_id) === Number(room.id));
        return {
          id: room.id,
          roomNumber: room.room_number,
          floor: Number(room.floor_number) || 0,
          status: room.status,
          roomType: room.room_type,
          sizeSqm: room.room_size_sqm === null ? null : Number(room.room_size_sqm),
          capacity: room.max_capacity === null ? null : Number(room.max_capacity),
          reading: room.reading_id ? {
            id: room.reading_id,
            tvWatts: Number(room.tv_watts) || 0,
            acWatts: Number(room.ac_watts) || 0,
            microwaveWatts: Number(room.microwave_watts) || 0,
            totalWatts: watts(room),
            recordedAt: room.reading_time
          } : null,
          booking: booking ? {
            ref: booking.booking_ref,
            status: String(booking.booking_status || '').replaceAll('_', ''),
            checkIn: booking.check_in_date,
            checkOut: booking.check_out_date,
            guests: Number(booking.total_guests) || 1
          } : null,
          issues: issues
            .filter(issue => Number(issue.room_id) === Number(room.id))
            .map(issue => ({
              id: issue.id,
              issue: issue.equipment_name,
              description: issue.fault_description,
              status: issue.fault_status === 'reported' ? 'open' : issue.fault_status,
              reportedAt: issue.reported_at
            })),
          recent: roomRecent.map(reading => ({
            recordedAt: reading.reading_time,
            microwaveWatts: Number(reading.microwave_watts) || 0,
            totalWatts: watts(reading)
          }))
        };
      })
    });
  } catch (error) { next(error); }
});

router.patch('/hotel-maintenance/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const requestedStatus = req.body.status;
    const statuses = { open: 'reported', in_progress: 'in_progress', resolved: 'resolved' };
    if (!Number.isSafeInteger(id) || id < 1 || !Object.hasOwn(statuses, requestedStatus)) {
      return res.status(400).json({ message: 'Choose a valid issue and status.' });
    }
    const status = statuses[requestedStatus];
    const result = await query(
      `UPDATE equipment_faults
       SET fault_status = :status,
           resolved_at = IF(:status = 'resolved', CURRENT_TIMESTAMP, NULL)
       WHERE id = :id`,
      { id, status }
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Issue not found.' });
    res.json({ message: status === 'resolved' ? 'Issue marked as resolved.' : 'Issue status updated.' });
  } catch (error) { next(error); }
});

router.post('/hotel-maintenance', async (req, res, next) => {
  try {
    const roomId = Number(req.body.roomId);
    const issue = typeof req.body.issue === 'string' ? req.body.issue.trim() : '';
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    if (!Number.isSafeInteger(roomId) || roomId < 1 || !issue || issue.length > 120 || description.length > 2000) {
      return res.status(400).json({ message: 'Choose a room and describe the issue.' });
    }
    const [room] = await query('SELECT id FROM rooms WHERE id = :roomId AND status <> \'inactive\'', { roomId });
    if (!room) return res.status(404).json({ message: 'Room not found.' });
    const result = await query(
      `INSERT INTO equipment_faults (room_id, equipment_name, fault_description, priority)
       VALUES (:roomId, :issue, :description, 'medium')`,
      { roomId, issue, description: description || null }
    );
    res.status(201).json({ id: result.insertId, message: 'Issue reported to maintenance.' });
  } catch (error) { next(error); }
});

router.post('/readings', requireRole('admin'), async (req, res, next) => {
  try {
    const { roomId, sensorId, kwhUsage, usageLevel = 'normal' } = req.body;
    const result = await query(
      'INSERT INTO room_power_readings (room_id, sensor_id, kwh_usage, usage_level) VALUES (:roomId, :sensorId, :kwhUsage, :usageLevel)',
      { roomId, sensorId: sensorId || null, kwhUsage, usageLevel }
    );
    res.status(201).json({ id: result.insertId, message: 'Energy reading saved.' });
  } catch (error) { next(error); }
});

router.get('/faults', async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT ef.*, r.room_number
      FROM equipment_faults ef
      JOIN rooms r ON r.id = ef.room_id
      ORDER BY ef.reported_at DESC
    `);
    res.json(rows);
  } catch (error) { next(error); }
});

router.post('/faults', requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const { roomId, sensorId, equipmentName, faultDescription, priority = 'medium' } = req.body;
    if (!Number.isSafeInteger(Number(roomId)) || Number(roomId) < 1 || typeof equipmentName !== 'string' || !equipmentName.trim() || equipmentName.length > 100 || !['low','medium','high','critical'].includes(priority)) return res.status(400).json({message:'Select a room, equipment name and valid priority.'});
    const result = await query(
      `INSERT INTO equipment_faults (room_id, sensor_id, equipment_name, fault_description, priority)
       VALUES (:roomId, :sensorId, :equipmentName, :faultDescription, :priority)`,
      { roomId, sensorId: sensorId || null, equipmentName, faultDescription: faultDescription || null, priority }
    );
    res.status(201).json({ id: result.insertId, message: 'Equipment fault reported.' });
  } catch (error) { next(error); }
});

router.patch('/faults/:id', requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['reported','in_progress','resolved','closed'].includes(status)) return res.status(400).json({message:'Invalid fault status.'});
    const result = await query('UPDATE equipment_faults SET fault_status = :status, resolved_at = IF(:status IN (\'resolved\', \'closed\'), CURRENT_TIMESTAMP, NULL) WHERE id = :id', { status, id: req.params.id });
    if (!result.affectedRows) return res.status(404).json({message:'Fault not found.'});
    res.json({ message: 'Fault status updated.' });
  } catch (error) { next(error); }
});

module.exports = router;
