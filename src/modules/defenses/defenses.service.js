const db = require('../../../config/db');

async function createDefense(userId, payload) {
  try {
    const { section, scheduled_at, location, partial_time, defense_type } = payload;

    if (!section) return { error: 'section is required' };
    if (!scheduled_at) return { error: 'scheduled_at is required' };
    if (!location) return { error: 'location is required' };
    if (!defense_type || !['proposal', 'midterm', 'final'].includes(defense_type)) {
      return { error: 'defense_type must be one of: proposal, midterm, final' };
    }

    await db.query(
      `INSERT INTO defenses (id, project_id, section, defense_type, scheduled_at, location, partial_time, status, created_by)
       VALUES (UUID(), UUID(), ?, ?, ?, ?, ?, 'scheduled', ?)`,
      [section, defense_type, scheduled_at, location, partial_time ? 1 : 0, userId]
    );

    const { rows } = await db.query(
      'SELECT * FROM defenses WHERE created_by = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    return { data: rows[0] };
  } catch (err) {
    console.error('createDefense error:', err);
    throw err;
  }
}

async function getDefensesByUser(userId) {
  const { rows } = await db.query(
    'SELECT * FROM defenses WHERE created_by = ? ORDER BY scheduled_at DESC',
    [userId]
  );
  return rows;
}

module.exports = { createDefense, getDefensesByUser };