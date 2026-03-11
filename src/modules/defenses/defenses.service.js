const db = require('../../../config/db');
 
async function createDefense(userId, payload) {
  try {
    const { project_id, section, defense_type, start_time, end_time, location, partial_time } = payload;
 
    if (!project_id) return { error: 'project_id is required' };
    if (!defense_type || !['proposal', 'midterm', 'final'].includes(defense_type)) {
      return { error: 'defense_type must be one of: proposal, midterm, final' };
    }
    if (!start_time) return { error: 'start_time is required' };
    if (!end_time) return { error: 'end_time is required' };
    if (!location) return { error: 'location is required' };
 
    await db.query(
      `INSERT INTO defenses (id, project_id, section, defense_type, start_time, end_time, location, partial_time, status, created_by)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
      [project_id, section, defense_type, start_time, end_time, location, partial_time ? 1 : 0, userId]
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
    `SELECT d.*, p.title AS project_title, p.project_code
     FROM defenses d
     LEFT JOIN projects p ON d.project_id = p.id
     WHERE d.created_by = ?
     ORDER BY d.start_time DESC`,
    [userId]
  );
  return rows;
}
 
module.exports = { createDefense, getDefensesByUser };
