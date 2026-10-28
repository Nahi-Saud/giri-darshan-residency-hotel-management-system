require('dotenv').config();
const { query, pool } = require('../src/db');

async function main() {
  const energyColumns = await query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'room_power_readings'
      AND COLUMN_NAME IN ('tv_watts', 'ac_watts', 'microwave_watts')
  `);
  const existingEnergyColumns = new Set(energyColumns.map(column => column.COLUMN_NAME));
  for (const column of ['tv_watts', 'ac_watts', 'microwave_watts']) {
    if (!existingEnergyColumns.has(column)) {
      await query(`ALTER TABLE room_power_readings ADD COLUMN ${column} DECIMAL(10,2) NULL AFTER kwh_usage`);
    }
  }
  await query(`CREATE TABLE IF NOT EXISTS enquiry_replies (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enquiry_id BIGINT NOT NULL,
    replied_by BIGINT NULL,
    reply_text TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (enquiry_id) REFERENCES enquiries(id) ON DELETE CASCADE,
    FOREIGN KEY (replied_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
  await query(`INSERT INTO guest_verifications (booking_id, verification_status)
    SELECT b.id, 'pending'
    FROM bookings b
    LEFT JOIN guest_verifications gv ON gv.booking_id = b.id
    WHERE b.booking_status = 'awaiting_verification' AND gv.id IS NULL`);
  console.log('Feature migration complete.');
  await pool.end();
}

main().catch(async error => {
  console.error('Feature migration failed:', error.message);
  await pool.end();
  process.exit(1);
});
