const db = require('../../../config/db');

/**
 * Get a meeting by ID
 */
async function getMeetingById(meetingId) {
  const { rows } = await db.query(
    `SELECT 
       m.id, m.project_id, m.defense_type, m.scheduled_at, m.end_time, 
       m.location, m.rubric_id, m.status, m.adviser_id, m.created_by, 
       m.created_at, 
       p.title as project_title,
       u.full_name as adviser_name, u.email as adviser_email
     FROM meetings m
     LEFT JOIN projects p ON m.project_id = p.id
     LEFT JOIN users u ON m.adviser_id = u.id
     WHERE m.id = ?
     LIMIT 1`,
    [meetingId]
  );
  return rows[0] || null;
}

/**
 * Get all meetings for an adviser
 */
async function getMeetingsByAdviser(adviserId, filters = {}) {
  let query = `
    SELECT 
      m.id, m.project_id, m.defense_type, m.scheduled_at, m.end_time,
      m.location, m.rubric_id, m.status, m.adviser_id, m.created_by,
      m.created_at,
      p.title as project_title
    FROM meetings m
    LEFT JOIN projects p ON m.project_id = p.id
    WHERE m.adviser_id = ?
  `;
  const params = [adviserId];

  // Optional filters
  if (filters.status) {
    query += ' AND m.status = ?';
    params.push(filters.status);
  }

  if (filters.defense_type) {
    query += ' AND m.defense_type = ?';
    params.push(filters.defense_type);
  }

  if (filters.from_date) {
    query += ' AND m.scheduled_at >= ?';
    params.push(filters.from_date);
  }

  if (filters.to_date) {
    query += ' AND m.scheduled_at <= ?';
    params.push(filters.to_date);
  }

  query += ' ORDER BY m.scheduled_at DESC';

  const { rows } = await db.query(query, params);
  return rows;
}

/**
 * Get meetings for a project
 */
async function getMeetingsByProject(projectId) {
  const { rows } = await db.query(
    `SELECT 
       m.id, m.project_id, m.defense_type, m.scheduled_at, m.end_time,
       m.location, m.rubric_id, m.status, m.adviser_id, m.created_by,
       m.created_at,
       u.full_name as adviser_name
     FROM meetings m
     LEFT JOIN users u ON m.adviser_id = u.id
     WHERE m.project_id = ?
     ORDER BY m.scheduled_at DESC`,
    [projectId]
  );
  return rows;
}

/**
 * Get meetings for a user (either as adviser or participant)
 */
async function getMeetingsForUser(userId) {
  const { rows } = await db.query(
    `SELECT 
       m.id, m.project_id, m.defense_type, m.scheduled_at, m.end_time,
       m.location, m.rubric_id, m.status, m.adviser_id, m.created_by,
       m.created_at,
       p.title as project_title,
       u.full_name as adviser_name
     FROM meetings m
     LEFT JOIN projects p ON m.project_id = p.id
     LEFT JOIN users u ON m.adviser_id = u.id
     WHERE m.adviser_id = ? 
        OR m.created_by = ?
        OR m.project_id IN (
          SELECT project_id FROM project_members WHERE user_id = ?
        )
     ORDER BY m.scheduled_at DESC`,
    [userId, userId, userId]
  );
  return rows;
}

/**
 * Get meetings in a date range
 */
async function getMeetingsByDateRange(startDate, endDate, adviserId = null) {
  let query = `
    SELECT 
      m.id, m.project_id, m.defense_type, m.scheduled_at, m.end_time,
      m.location, m.rubric_id, m.status, m.adviser_id, m.created_by,
      m.created_at,
      p.title as project_title,
      u.full_name as adviser_name
    FROM meetings m
    LEFT JOIN projects p ON m.project_id = p.id
    LEFT JOIN users u ON m.adviser_id = u.id
    WHERE m.scheduled_at BETWEEN ? AND ?
  `;
  const params = [startDate, endDate];

  if (adviserId) {
    query += ' AND m.adviser_id = ?';
    params.push(adviserId);
  }

  query += ' ORDER BY m.scheduled_at ASC';

  const { rows } = await db.query(query, params);
  return rows;
}

/**
 * Create a new meeting
 */
async function createMeeting(meetingData) {
  const {
    project_id,
    defense_type,
    scheduled_at,
    end_time,
    location,
    rubric_id,
    adviser_id,
    created_by,
  } = meetingData;

  const id = require('crypto').randomUUID();

  await db.query(
    `INSERT INTO meetings 
     (id, project_id, defense_type, scheduled_at, end_time, location, rubric_id, adviser_id, created_by, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', NOW())`,
    [id, project_id, defense_type, scheduled_at, end_time, location, rubric_id, adviser_id, created_by]
  );

  return getMeetingById(id);
}

/**
 * Update a meeting
 */
async function updateMeeting(meetingId, updates) {
  const allowedFields = ['scheduled_at', 'end_time', 'location', 'status', 'rubric_id'];
  const updateClauses = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      updateClauses.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (updateClauses.length === 0) {
    return getMeetingById(meetingId);
  }

  params.push(meetingId);

  await db.query(
    `UPDATE meetings SET ${updateClauses.join(', ')} WHERE id = ?`,
    params
  );

  return getMeetingById(meetingId);
}

/**
 * Cancel a meeting
 */
async function cancelMeeting(meetingId) {
  return updateMeeting(meetingId, { status: 'cancelled' });
}

/**
 * Mark a meeting as completed
 */
async function completeMeeting(meetingId) {
  return updateMeeting(meetingId, { status: 'completed' });
}

/**
 * Reschedule a meeting
 */
async function rescheduleMeeting(meetingId, newScheduledAt, newEndTime = null) {
  const updates = { scheduled_at: newScheduledAt };
  if (newEndTime) {
    updates.end_time = newEndTime;
  }
  return updateMeeting(meetingId, updates);
}

module.exports = {
  getMeetingById,
  getMeetingsByAdviser,
  getMeetingsByProject,
  getMeetingsForUser,
  getMeetingsByDateRange,
  createMeeting,
  updateMeeting,
  cancelMeeting,
  completeMeeting,
  rescheduleMeeting,
};
