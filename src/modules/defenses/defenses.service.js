const db = require('../../../config/db');

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateToDbUtc(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function normalizeDateTimeInput(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Keep local wall-clock input unchanged for DATETIME storage to avoid timezone shifts.
  const localNoZone = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/;
  const localMatch = trimmed.match(localNoZone);
  if (localMatch) {
    const datePart = localMatch[1];
    const timePart = localMatch[2];
    const secondsPart = localMatch[3] || ':00';
    const isoLocal = `${datePart}T${timePart}${secondsPart}`;
    const parsedLocal = toDate(isoLocal);
    if (!parsedLocal) return null;
    return {
      dbValue: `${datePart} ${timePart}${secondsPart}`,
      dateValue: parsedLocal,
    };
  }

  const parsed = toDate(trimmed);
  if (!parsed) return null;
  return {
    dbValue: formatDateToDbUtc(parsed),
    dateValue: parsed,
  };
}

async function queryRows(queryRunner, sql, params) {
  if (queryRunner && typeof queryRunner.execute === 'function') {
    const [rows] = await queryRunner.execute(sql, params);
    return rows;
  }
  const result = await db.query(sql, params);
  return result.rows;
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

async function getProjectMemberGroups(projectId, fallbackUserId, queryRunner = db) {
  const rows = await queryRows(
    queryRunner,
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

async function getParticipantSchedules(userIds, candidateStart, candidateEnd, queryRunner = db) {
  if (!userIds.length) {
    return [];
  }

  const placeholders = buildInClausePlaceholders(userIds);
  const rows = await queryRows(
    queryRunner,
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

async function getRoomSchedules(location, candidateStart, candidateEnd, queryRunner = db) {
  if (!location || location.toLowerCase() === 'online') {
    return [];
  }

  const rows = await queryRows(
    queryRunner,
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

async function getProjectSchedules(projectId, candidateStart, candidateEnd, queryRunner = db) {
  const rows = await queryRows(
    queryRunner,
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

async function validateScheduleConstraints({ projectId, startTime, endTime, startDate, endDate, location, fallbackTeacherId, queryRunner = db }) {
  const [projectSchedules, roomSchedules, memberGroups] = await Promise.all([
    getProjectSchedules(projectId, startTime, endTime, queryRunner),
    getRoomSchedules(location, startTime, endTime, queryRunner),
    getProjectMemberGroups(projectId, fallbackTeacherId, queryRunner),
  ]);

  const [teacherSchedules, studentSchedules] = await Promise.all([
    getParticipantSchedules(memberGroups.teacherIds, startTime, endTime, queryRunner),
    getParticipantSchedules(memberGroups.studentIds, startTime, endTime, queryRunner),
  ]);

  // Dynamic Programming checks are applied per constraint domain.
  const overlapResult = buildOccupancyDp(projectSchedules, startDate, endDate);
  if (overlapResult.hasConflict) {
    return {
      error: 'Overlapping schedules: this project already has a meeting in the selected time range',
      status: 409,
    };
  }

  const roomResult = buildOccupancyDp(roomSchedules, startDate, endDate);
  if (roomResult.hasConflict) {
    return {
      error: 'Room availability conflict: selected room is not available in the selected time range',
      status: 409,
    };
  }

  const teacherResult = buildOccupancyDp(teacherSchedules, startDate, endDate);
  if (teacherResult.hasConflict) {
    return {
      error: 'Teacher availability conflict: one or more teachers already have a meeting in the selected time range',
      status: 409,
    };
  }

  const studentResult = buildOccupancyDp(studentSchedules, startDate, endDate);
  if (studentResult.hasConflict) {
    return {
      error: 'Student availability conflict: one or more students already have a meeting in the selected time range',
      status: 409,
    };
  }

  return { ok: true };
}
 
async function createDefense(userId, payload) {
  let conn;
  try {
    const { project_id, section, defense_type, start_time, end_time, location, partial_time } = payload;
 
    if (!project_id) return { error: 'project_id is required' };
    if (!defense_type || !['proposal', 'midterm', 'final'].includes(defense_type)) {
      return { error: 'defense_type must be one of: proposal, midterm, final' };
    }
    if (!start_time) return { error: 'start_time is required' };
    if (!end_time) return { error: 'end_time is required' };
    if (!location) return { error: 'location is required' };

    const normalizedStart = normalizeDateTimeInput(start_time);
    const normalizedEnd = normalizeDateTimeInput(end_time);
    if (!normalizedStart) return { error: 'start_time must be a valid datetime value' };
    if (!normalizedEnd) return { error: 'end_time must be a valid datetime value' };
    if (normalizedStart.dateValue.getTime() >= normalizedEnd.dateValue.getTime()) {
      return { error: 'end_time must be after start_time' };
    }

    conn = await db.pool.getConnection();
    await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await conn.beginTransaction();

    const scheduleCheck = await validateScheduleConstraints({
      projectId: project_id,
      startTime: normalizedStart.dbValue,
      endTime: normalizedEnd.dbValue,
      startDate: normalizedStart.dateValue,
      endDate: normalizedEnd.dateValue,
      location,
      fallbackTeacherId: userId,
      queryRunner: conn,
    });
    if (scheduleCheck.error) {
      await conn.rollback();
      return scheduleCheck;
    }

    const [idRows] = await conn.execute('SELECT UUID() AS id');
    const defenseId = idRows[0].id;
 
    await conn.execute(
      `INSERT INTO defenses (id, project_id, section, defense_type, start_time, end_time, location, partial_time, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
      [defenseId, project_id, section, defense_type, normalizedStart.dbValue, normalizedEnd.dbValue, location, partial_time ? 1 : 0, userId]
    );

    const [rows] = await conn.execute(
      'SELECT * FROM defenses WHERE id = ? LIMIT 1',
      [defenseId]
    );

    await conn.commit();
 
    return { data: rows[0] };
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        console.error('createDefense rollback error:', rollbackErr);
      }
    }
    console.error('createDefense error:', err);
    throw err;
  } finally {
    if (conn) conn.release();
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
