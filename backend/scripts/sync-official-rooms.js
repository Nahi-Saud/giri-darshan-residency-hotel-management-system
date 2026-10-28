require('dotenv').config();
const { query, pool } = require('../src/db');

const catalog = [
  {
    name: 'Non-A/C Room', price: 1800, capacity: 2, bed: 'Queen-size bed', image: 'assets/images/rooms/non-ac-1.jpg',
    description: 'A spacious, well-furnished non-A/C room with an attached bathroom, ceiling fan, 43-inch television, WiFi, dressing table, chairs and 24-hour hot water.',
    amenities: ['Ceiling fan', '43-inch television', 'WiFi available', 'Dressing table', 'Attached bathroom', 'Hot water 24/7', 'Car parking available on cost', 'Lift available']
  },
  {
    name: 'A/C Room', price: 2200, capacity: 2, bed: 'Queen-size bed', image: 'assets/images/rooms/ac-1.jpg',
    description: 'A richly appointed, air-conditioned double room with a queen-size bed, desk, ceiling fan, 43-inch television, WiFi, dressing table, writing table, chairs and 24-hour hot water.',
    amenities: ['Air conditioning', 'Ceiling fan', '43-inch television', 'WiFi available', 'Dressing table', 'Writing table and chairs', 'Attached bathroom', 'Hot water 24/7', 'Car parking available on cost', 'Lift available']
  },
  {
    name: 'Deluxe A/C Room', price: 2500, capacity: 2, bed: 'King-size bed', image: 'assets/images/rooms/deluxe-ac-1.jpg',
    description: 'A deluxe air-conditioned room with a king-size bed, balcony or terrace, en-suite bathroom, ceiling fan, television, WiFi, dressing table, writing table, chairs and 24-hour hot water.',
    amenities: ['Air conditioning', 'Ceiling fan', 'King-size bed', 'Television', 'WiFi available', 'Dressing table', 'Writing table and chairs', 'Balcony or terrace', 'En-suite bathroom', 'Hot water 24/7', 'Car parking available on cost', 'Lift available']
  },
  {
    name: 'Suite Room', price: 4000, capacity: 5, bed: 'King-size bed + double bed', image: 'assets/images/rooms/suite-ac-1.jpg',
    description: 'An air-conditioned suite for up to five guests with a spacious living area, king-size bed, double bed, chairs and table, 43-inch television, in-room safe, wardrobe, mirror, high-speed WiFi, room service and hot water.',
    amenities: ['Air conditioning', 'Living area', '43-inch television', 'High-speed WiFi', 'In-room safe', 'Wardrobe with mirror', 'Room service', 'Hot water 24/7', 'Car parking available on cost', 'Lift available']
  },
  {
    name: 'Suite Room non-A/C', price: 3000, capacity: 5, bed: 'King-size bed + double bed + single bed', image: 'assets/images/rooms/suite-non-ac-1.jpg',
    description: 'A spacious non-A/C suite for up to five guests with a king-size bed, double bed, single bed, living area, chairs and table, 43-inch television, in-room safe, high-speed WiFi, room service and hot water.',
    amenities: ['Living area', '43-inch television', 'High-speed WiFi', 'In-room safe', 'Room service', 'Hot water 24/7', 'Car parking available on cost', 'Lift available']
  }
];

// Preserve every room number already used by the project and add the missing
// inventory. The result is ten rooms on each of three floors and six rooms of
// each official category.
const rooms = [
  ['101', 'Non-A/C Room', 1], ['102', 'A/C Room', 1], ['103', 'Deluxe A/C Room', 1], ['104', 'Suite Room', 1], ['105', 'Suite Room non-A/C', 1],
  ['106', 'Non-A/C Room', 1], ['107', 'Deluxe A/C Room', 1], ['108', 'Suite Room', 1], ['109', 'Suite Room non-A/C', 1], ['110', 'Suite Room non-A/C', 1],
  ['201', 'Non-A/C Room', 2], ['202', 'A/C Room', 2], ['203', 'Deluxe A/C Room', 2], ['204', 'Suite Room', 2], ['205', 'A/C Room', 2],
  ['206', 'Non-A/C Room', 2], ['207', 'Deluxe A/C Room', 2], ['208', 'Suite Room', 2], ['209', 'Suite Room non-A/C', 2], ['210', 'Suite Room non-A/C', 2],
  ['301', 'Non-A/C Room', 3], ['302', 'A/C Room', 3], ['303', 'Deluxe A/C Room', 3], ['304', 'Suite Room', 3], ['305', 'A/C Room', 3],
  ['306', 'Non-A/C Room', 3], ['307', 'A/C Room', 3], ['308', 'Deluxe A/C Room', 3], ['309', 'Suite Room', 3], ['310', 'Suite Room non-A/C', 3]
];

async function main() {
  for (const type of catalog) {
    await query(`INSERT INTO room_types (type_name, description, base_price_inr, max_capacity, bed_details, image_path, is_active)
      VALUES (:name, :description, :price, :capacity, :bed, :image, TRUE)
      ON DUPLICATE KEY UPDATE description=VALUES(description), base_price_inr=VALUES(base_price_inr),
        max_capacity=VALUES(max_capacity), bed_details=VALUES(bed_details), image_path=VALUES(image_path), is_active=TRUE`, type);
    for (const amenity of type.amenities) {
      await query('INSERT IGNORE INTO amenities (amenity_name) VALUES (:amenity)', { amenity });
      await query(`INSERT IGNORE INTO room_type_amenities (room_type_id, amenity_id)
        SELECT rt.id, a.id FROM room_types rt JOIN amenities a ON a.amenity_name=:amenity WHERE rt.type_name=:name`,
        { amenity, name: type.name });
    }
  }

  const types = await query('SELECT id, type_name FROM room_types WHERE is_active=TRUE');
  const typeId = Object.fromEntries(types.map(type => [type.type_name, type.id]));
  for (const [roomNumber, typeName, floorNumber] of rooms) {
    await query(`INSERT INTO rooms (room_number, room_type_id, floor_number, status, housekeeping_status)
      VALUES (:roomNumber, :roomTypeId, :floorNumber, 'available', 'clean')
      ON DUPLICATE KEY UPDATE room_type_id=VALUES(room_type_id), floor_number=VALUES(floor_number)`,
      { roomNumber, roomTypeId: typeId[typeName], floorNumber });
  }

  const officialNumbers = rooms.map(([number]) => number);
  const placeholders = officialNumbers.map(() => '?').join(',');
  await pool.execute(`UPDATE rooms SET status='inactive' WHERE room_number NOT IN (${placeholders}) AND room_number LIKE 'QA-%'`, officialNumbers);

  const roomRows = await query(`SELECT id, room_number FROM rooms WHERE room_number IN (${placeholders})`, officialNumbers);
  for (const room of roomRows) {
    await query(`INSERT INTO room_sensors (room_id, sensor_code, sensor_type, sensor_status, installed_at)
      VALUES (:roomId, :sensorCode, 'power_meter', 'active', CURDATE())
      ON DUPLICATE KEY UPDATE sensor_status='active'`, { roomId: room.id, sensorCode: `PWR-${room.room_number}` });
  }

  const totals = await query(`SELECT floor_number, COUNT(*) AS rooms FROM rooms
    WHERE room_number IN (${placeholders}) GROUP BY floor_number ORDER BY floor_number`, officialNumbers);
  console.log('Official room catalog synchronized:', totals);
  await pool.end();
}

main().catch(async error => {
  console.error('Room catalog synchronization failed:', error.message);
  await pool.end();
  process.exit(1);
});
