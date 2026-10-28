// Records simulated appliance-level readings for occupied rooms. The project has
// no physical meter feed, so this is an explicit demo-data utility for local use.
//
// Usage:
//   node scripts/record-energy-readings.js
//   node scripts/record-energy-readings.js --dry-run
//   node scripts/record-energy-readings.js --backfill 6
//   node scripts/record-energy-readings.js --every 15
require('dotenv').config();
const { query, pool } = require('../src/db');

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index === -1 ? null : Number(args[index + 1]);
};
const dryRun = args.includes('--dry-run');
const backfill = option('--backfill');
const every = option('--every');
const intervalMinutes = option('--interval') || 60;
const between = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);

function acFactor(date) {
  const hour = date.getHours() + date.getMinutes() / 60;
  return 0.55 + 0.6 * Math.max(0, Math.sin((Math.PI * (hour - 7)) / 15));
}

function simulate(base, previous, at) {
  const tvOn = Math.random() < (previous && previous.tv >= 40 ? 0.8 : 0.35);
  const microwaveOn = Math.random() < (previous && previous.microwave >= 600 ? 0.35 : 0.08);
  return {
    ac: Math.round(Math.min(2400, base.ac * acFactor(at) * between(0.85, 1.15))),
    tv: tvOn ? Math.round(Math.min(180, Math.max(40, base.tv) * between(0.8, 1.2))) : Math.round(between(1, 4)),
    microwave: microwaveOn ? Math.round(between(750, 1200)) : Math.round(between(1, 4))
  };
}

async function recordBatch(at) {
  const rooms = await query(`
    SELECT r.id, r.room_number, base.ac_watts, base.tv_watts,
           previous.tv_watts AS previous_tv, previous.microwave_watts AS previous_microwave,
           sensor.id AS sensor_id
    FROM rooms r
    LEFT JOIN (
      SELECT reading.room_id, reading.ac_watts, reading.tv_watts
      FROM room_power_readings reading
      JOIN (SELECT room_id, MIN(id) AS id FROM room_power_readings GROUP BY room_id) first_reading
        ON first_reading.id = reading.id
    ) base ON base.room_id = r.id
    LEFT JOIN (
      SELECT reading.room_id, reading.tv_watts, reading.microwave_watts
      FROM room_power_readings reading
      JOIN (SELECT room_id, MAX(id) AS id FROM room_power_readings GROUP BY room_id) latest_reading
        ON latest_reading.id = reading.id
    ) previous ON previous.room_id = r.id
    LEFT JOIN (
      SELECT room_id, MIN(id) AS id FROM room_sensors
      WHERE sensor_type = 'power_meter' AND sensor_status = 'active'
      GROUP BY room_id
    ) sensor ON sensor.room_id = r.id
    WHERE r.status = 'occupied'
    ORDER BY CAST(r.room_number AS UNSIGNED), r.room_number
  `);

  const rows = rooms.map(room => ({
    roomId: room.id,
    roomNumber: room.room_number,
    sensorId: room.sensor_id || null,
    ...simulate(
      { ac: Number(room.ac_watts) || 700, tv: Number(room.tv_watts) || 80 },
      room.previous_tv === null
        ? null
        : { tv: Number(room.previous_tv), microwave: Number(room.previous_microwave) },
      at
    )
  }));

  if (!dryRun) {
    for (const row of rows) {
      const totalWatts = row.ac + row.tv + row.microwave;
      const usageLevel = totalWatts >= 1800 ? 'high' : totalWatts >= 1000 ? 'medium' : 'normal';
      await query(
        `INSERT INTO room_power_readings
           (room_id, sensor_id, kwh_usage, tv_watts, ac_watts, microwave_watts, usage_level, reading_time)
         VALUES
           (:roomId, :sensorId, :kwhUsage, :tv, :ac, :microwave, :usageLevel, :at)`,
        { ...row, kwhUsage: totalWatts / 1000, usageLevel, at }
      );
    }
  }

  const total = rows.reduce((sum, row) => sum + row.ac + row.tv + row.microwave, 0);
  console.log(`${dryRun ? '[dry run] ' : ''}${at.toLocaleString('en-AU')} · ${rows.length} occupied rooms · ${total.toLocaleString('en-AU')} W total`);
  if (dryRun) console.table(rows);
}

async function main() {
  const now = new Date();
  now.setSeconds(0, 0);
  if (backfill) {
    for (let index = backfill - 1; index >= 0; index -= 1) {
      await recordBatch(new Date(now - index * intervalMinutes * 60000));
    }
  } else {
    await recordBatch(now);
  }
  if (!every) return pool.end();
  console.log(`Recording every ${every} minutes. Press Ctrl+C to stop.`);
  setInterval(() => recordBatch(new Date()).catch(error => console.error('Recording failed:', error.message)), every * 60000);
}

main().catch(async error => {
  console.error('Recording failed:', error.message);
  await pool.end();
  process.exit(1);
});
