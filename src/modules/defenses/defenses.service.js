const db = require('../../../config/db');
 
async function createDefense(userId, payload) {
  try {
    const { project_id, defense_type, start_time, location, modality } = payload;
 
    if (!project_id) return { error: 'project_id is required' };
    if (!defense_type || !['proposal', 'midterm', 'final'].includes(defense_type)) {
      return { error: 'defense_type must be one of: proposal, midterm, final' };
    }
    if (!start_time) return { error: 'start_time is required' };
    if (!location) return { error: 'location is required' };

    // Verify adviser belongs to an institution
    const { rows: roleRows } = await db.query(
      `SELECT institution_id FROM user_roles
       WHERE user_id = ? AND role = 'adviser' AND institution_id IS NOT NULL
       LIMIT 1`,
      [userId]
    );
    if (!roleRows[0]) {
      return { error: 'You are not part of an institution. Ask your coordinator to add you first.' };
    }
    const institutionId = roleRows[0].institution_id;

    // Ensure the project has institution_id set so coordinators can see it
    await db.query(
      `UPDATE projects SET institution_id = ? WHERE id = ? AND institution_id IS NULL`,
      [institutionId, project_id]
    );

    await db.query(
      `INSERT INTO defenses (id, project_id, defense_type, scheduled_at, location, modality, status, created_by)
       VALUES (UUID(), ?, ?, ?, ?, ?, 'pending', ?)`,
      [project_id, defense_type, start_time, location, modality || 'Online', userId]
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
     ORDER BY d.scheduled_at DESC`,
    [userId]
  );
  return rows;
}

/**
 * Get all defenses for projects where the user is a member.
 * This lets students see defenses scheduled by their adviser.
 */
async function getDefensesForMember(userId) {
  const { rows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.project_code,
            u.full_name AS created_by_name
     FROM defenses d
     JOIN projects p ON d.project_id = p.id
     JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     LEFT JOIN users u ON d.created_by = u.id
     ORDER BY d.scheduled_at DESC`,
    [userId]
  );
  return rows;
}
 
module.exports = { createDefense, getDefensesByUser, getDefensesForMember };
