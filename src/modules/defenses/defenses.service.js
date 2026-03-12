const db = require('../../../config/db');

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Dynamic Programming Algorithm:
// Uses a difference array + prefix-sum state transition over discretized time points
// to compute active occupancy per segment and detect overlap conflicts efficiently.
function buildOccupancyDp(intervals, candidateStart, candidateEnd) {
  if (!intervals.length) {
    return { hasConflict: false, conflictingIntervals: [] };
  }

  const candidateStartMs = candidateStart.getTime();
  const candidateEndMs = candidateEnd.getTime();

  const pointsSet = new Set([candidateStartMs, candidateEndMs]);
  const normalized = intervals
    .map((interval) => {
      const start = toDate(interval.start_time);
      const end = toDate(interval.end_time);
      if (!start || !end) return null;
      return {
        ...interval,
        startMs: start.getTime(),
        endMs: end.getTime(),
      };
    })
    .filter((interval) => interval && interval.startMs < interval.endMs);

  for (const interval of normalized) {
    pointsSet.add(interval.startMs);
    pointsSet.add(interval.endMs);
  }

  const points = Array.from(pointsSet).sort((a, b) => a - b);
  const indexByPoint = new Map(points.map((point, index) => [point, index]));
  const diff = Array(points.length).fill(0);

  for (const interval of normalized) {
    const startIndex = indexByPoint.get(interval.startMs);
    const endIndex = indexByPoint.get(interval.endMs);
    diff[startIndex] += 1;
    diff[endIndex] -= 1;
  }

  // Prefix accumulation over segments gives active meeting count per timeslice.
  let active = 0;
  let hasConflict = false;
  for (let i = 0; i < points.length - 1; i += 1) {
    active += diff[i];
    const segmentStart = points[i];
    const segmentEnd = points[i + 1];
    const intersectsCandidate = segmentEnd > candidateStartMs && segmentStart < candidateEndMs;
    if (intersectsCandidate && active > 0) {
      hasConflict = true;
      break;
    }
  }

  if (!hasConflict) {
    return { hasConflict: false, conflictingIntervals: [] };
  }

  const conflictingIntervals = normalized.filter((interval) => (
    interval.startMs < candidateEndMs && interval.endMs > candidateStartMs
  ));

  return { hasConflict: true, conflictingIntervals };
}

async function getProjectMemberGroups(projectId, fallbackUserId) {
  const { rows } = await db.query(
    `SELECT user_id, role
     FROM project_members
     WHERE project_id = ? AND status = 'accepted'`,
    [projectId]
  );

  const teacherIds = new Set();
  const studentIds = new Set();

  for (const row of rows) {
    if (row.role === 'adviser') {
      teacherIds.add(row.user_id);
    } else {
      studentIds.add(row.user_id);
    }
  }

  if (!teacherIds.size && fallbackUserId) {
    teacherIds.add(fallbackUserId);
  }

  return {
    teacherIds: Array.from(teacherIds),
    studentIds: Array.from(studentIds),
  };
}

function buildInClausePlaceholders(items) {
  return items.map(() => '?').join(', ');
}

async function getParticipantSchedules(userIds, candidateStart, candidateEnd) {
  if (!userIds.length) {
    return [];
  }

  const placeholders = buildInClausePlaceholders(userIds);
  const { rows } = await db.query(
    `SELECT DISTINCT d.id, d.project_id, d.start_time, d.end_time, d.location, pm.user_id AS participant_id
     FROM defenses d
     JOIN project_members pm
       ON pm.project_id = d.project_id
      AND pm.status = 'accepted'
     WHERE pm.user_id IN (${placeholders})
       AND d.status = 'scheduled'
       AND d.start_time < ?
       AND d.end_time > ?`,
    [...userIds, candidateEnd, candidateStart]
  );

  return rows;
}

async function getRoomSchedules(location, candidateStart, candidateEnd) {
  if (!location || location.toLowerCase() === 'online') {
    return [];
  }

  const { rows } = await db.query(
    `SELECT id, project_id, start_time, end_time, location
     FROM defenses
     WHERE status = 'scheduled'
       AND location = ?
       AND start_time < ?
       AND end_time > ?`,
    [location, candidateEnd, candidateStart]
  );

  return rows;
}

async function getProjectSchedules(projectId, candidateStart, candidateEnd) {
  const { rows } = await db.query(
    `SELECT id, project_id, start_time, end_time, location
     FROM defenses
     WHERE project_id = ?
       AND status = 'scheduled'
       AND start_time < ?
       AND end_time > ?`,
    [projectId, candidateEnd, candidateStart]
  );
  return rows;
}

async function validateScheduleConstraints({ projectId, startTime, endTime, location, fallbackTeacherId }) {
  const [projectSchedules, roomSchedules, memberGroups] = await Promise.all([
    getProjectSchedules(projectId, startTime, endTime),
    getRoomSchedules(location, startTime, endTime),
    getProjectMemberGroups(projectId, fallbackTeacherId),
  ]);

  const [teacherSchedules, studentSchedules] = await Promise.all([
    getParticipantSchedules(memberGroups.teacherIds, startTime, endTime),
    getParticipantSchedules(memberGroups.studentIds, startTime, endTime),
  ]);

  // Dynamic Programming checks are applied per constraint domain.
  const overlapResult = buildOccupancyDp(projectSchedules, startTime, endTime);
  if (overlapResult.hasConflict) {
    return {
      error: 'Overlapping schedules: this project already has a meeting in the selected time range',
      status: 409,
    };
  }

  const roomResult = buildOccupancyDp(roomSchedules, startTime, endTime);
  if (roomResult.hasConflict) {
    return {
      error: 'Room availability conflict: selected room is not available in the selected time range',
      status: 409,
    };
  }

  const teacherResult = buildOccupancyDp(teacherSchedules, startTime, endTime);
  if (teacherResult.hasConflict) {
    return {
      error: 'Teacher availability conflict: one or more teachers already have a meeting in the selected time range',
      status: 409,
    };
  }

  const studentResult = buildOccupancyDp(studentSchedules, startTime, endTime);
  if (studentResult.hasConflict) {
    return {
      error: 'Student availability conflict: one or more students already have a meeting in the selected time range',
      status: 409,
    };
  }

  return { ok: true };
}
 
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

    const parsedStart = toDate(start_time);
    const parsedEnd = toDate(end_time);
    if (!parsedStart) return { error: 'start_time must be a valid datetime value' };
    if (!parsedEnd) return { error: 'end_time must be a valid datetime value' };
    if (parsedStart.getTime() >= parsedEnd.getTime()) {
      return { error: 'end_time must be after start_time' };
    }

    const scheduleCheck = await validateScheduleConstraints({
      projectId: project_id,
      startTime: parsedStart,
      endTime: parsedEnd,
      location,
      fallbackTeacherId: userId,
    });
    if (scheduleCheck.error) {
      return scheduleCheck;
    }
 
    await db.query(
      `INSERT INTO defenses (id, project_id, section, defense_type, start_time, end_time, location, partial_time, status, created_by)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
      [project_id, section, defense_type, parsedStart, parsedEnd, location, partial_time ? 1 : 0, userId]
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
    `SELECT d.*, p.title AS project_title, p.project_code,
            CASE
              WHEN d.status = 'cancelled' THEN 'Cancelled'
              WHEN d.status = 'completed' THEN 'Approved'
              ELSE 'Pending'
            END AS status_label
     FROM defenses d
     LEFT JOIN projects p ON d.project_id = p.id
     WHERE d.created_by = ?
     ORDER BY d.start_time DESC`,
    [userId]
  );
  return rows;
}

async function cancelDefense(userId, defenseId) {
  if (!defenseId) {
    return { error: 'defenseId is required', status: 400 };
  }

  const { rows } = await db.query(
    'SELECT * FROM defenses WHERE id = ? LIMIT 1',
    [defenseId]
  );

  if (!rows.length) {
    return { error: 'Meeting not found', status: 404 };
  }

  const defense = rows[0];
  if (defense.created_by !== userId) {
    return { error: 'You are not allowed to cancel this meeting', status: 403 };
  }

  if (defense.status === 'cancelled') {
    return { error: 'Meeting is already cancelled', status: 409 };
  }

  await db.query(
    `UPDATE defenses
     SET status = 'cancelled'
     WHERE id = ?`,
    [defenseId]
  );

  const { rows: updatedRows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.project_code,
            CASE
              WHEN d.status = 'cancelled' THEN 'Cancelled'
              WHEN d.status = 'completed' THEN 'Approved'
              ELSE 'Pending'
            END AS status_label
     FROM defenses d
     LEFT JOIN projects p ON d.project_id = p.id
     WHERE d.id = ?
     LIMIT 1`,
    [defenseId]
  );

  return { data: updatedRows[0] || null };
}
 
module.exports = { createDefense, getDefensesByUser, cancelDefense };
