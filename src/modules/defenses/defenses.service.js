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
  // mysql2 returns DATETIME columns as JS Date objects — handle them directly.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    const dbValue = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
    return { dbValue, dateValue: value };
  }
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

// Compute how many minutes of the candidate [candidateStart, candidateEnd] are
// consumed by a single conflicting interval.
function computeOverlapMinutes(conflictStart, conflictEnd, candidateStartMs, candidateEndMs) {
  const overlapStart = Math.max(conflictStart, candidateStartMs);
  const overlapEnd = Math.min(conflictEnd, candidateEndMs);
  return Math.max(0, Math.round((overlapEnd - overlapStart) / 60000));
}

// Returns how many minutes remain in the *blocking* meeting at the point the
// candidate would start (i.e. how long the user would need to wait).
function computeRemainingMinutes(conflictEndMs, candidateStartMs) {
  return Math.max(0, Math.round((conflictEndMs - candidateStartMs) / 60000));
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

  const candidateStartMs = startDate.getTime();
  const candidateEndMs = endDate.getTime();

  // Collect all conflict details across every domain.
  const allConflicts = [];

  const checks = [
    { label: 'project', result: buildOccupancyDp(projectSchedules, startDate, endDate) },
    { label: 'room', result: buildOccupancyDp(roomSchedules, startDate, endDate) },
    { label: 'teacher', result: buildOccupancyDp(teacherSchedules, startDate, endDate) },
    { label: 'student', result: buildOccupancyDp(studentSchedules, startDate, endDate) },
  ];

  for (const { label, result } of checks) {
    if (result.hasConflict) {
      for (const interval of result.conflictingIntervals) {
        const remaining = computeRemainingMinutes(interval.endMs, candidateStartMs);
        const overlap = computeOverlapMinutes(interval.startMs, interval.endMs, candidateStartMs, candidateEndMs);
        allConflicts.push({
          domain: label,
          defense_id: interval.id,
          project_id: interval.project_id,
          remaining_minutes: remaining,
          overlap_minutes: overlap,
        });
      }
    }
  }

  if (!allConflicts.length) {
    return { ok: true, conflicts: [] };
  }

  return { ok: false, conflicts: allConflicts };
}
 
async function createDefense(userId, payload) {
  let conn;
  try {
    const { project_id, section, defense_type, start_time, end_time, location, partial_time, force_partial, force_pending } = payload;
 
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

    let status = 'scheduled';
    let blockedBy = null;
    let hasOverlap = false;

    if (!scheduleCheck.ok) {
      hasOverlap = true;
      const conflicts = scheduleCheck.conflicts;
      const maxRemaining = Math.max(...conflicts.map(c => c.remaining_minutes));
      const maxOverlap = Math.max(...conflicts.map(c => c.overlap_minutes));
      const candidateTotalMinutes = Math.round(
        (normalizedEnd.dateValue.getTime() - normalizedStart.dateValue.getTime()) / 60000
      );
      const effectiveMinutes = candidateTotalMinutes - maxOverlap;

      // Compute the effective start time (after the overlap ends)
      const latestConflictEndMs = Math.max(
        ...conflicts.map(c => {
          const end = new Date(c.remaining_minutes * 60000 + normalizedStart.dateValue.getTime());
          return end.getTime();
        })
      );
      const effectiveStartDb = formatDateToDbUtc(new Date(latestConflictEndMs));

      // Only allow overlap if the remaining time after deduction is above 10 mins
      if (effectiveMinutes <= 10) {
        await conn.rollback();
        return {
          error: `Schedule conflict: after deducting the overlap, only ${effectiveMinutes} minutes would remain (must be above 10 minutes). Please choose a different time.`,
          status: 409,
        };
      }

      // User confirmed the overlap — proceed as scheduled with partial_time
      if (force_partial) {
        status = 'scheduled';
      }
      // User opted to wait (pending) — will auto-promote when blocking meeting ends/cancels
      else if (force_pending) {
        status = 'pending';
        blockedBy = conflicts[0].defense_id;
      }
      // Conflict exists but user hasn't confirmed yet — return conflict details
      else {
        await conn.rollback();
        return {
          conflict: true,
          conflicts,
          max_overlap_minutes: maxOverlap,
          max_remaining_minutes: maxRemaining,
          candidate_total_minutes: candidateTotalMinutes,
          effective_minutes: effectiveMinutes,
          effective_start_time: effectiveStartDb,
          message: 'Schedule conflict detected. Please confirm how to proceed.',
          status: 409,
        };
      }
    }

    const [idRows] = await conn.execute('SELECT UUID() AS id');
    const defenseId = idRows[0].id;
 
    await conn.execute(
      `INSERT INTO defenses (id, project_id, section, defense_type, start_time, end_time, location, partial_time, status, blocked_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [defenseId, project_id, section, defense_type, normalizedStart.dbValue, normalizedEnd.dbValue, location, hasOverlap ? 1 : 0, status, blockedBy, userId]
    );

    const [rows] = await conn.execute(
      'SELECT * FROM defenses WHERE id = ? LIMIT 1',
      [defenseId]
    );

    await conn.commit();

    // After booking, scan all pending defenses for potential promotion
    await processAllPendingDefenses();
 
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
              WHEN d.status = 'scheduled' THEN 'Scheduled'
              WHEN d.status = 'pending' THEN 'Pending'
              WHEN d.status = 'cancelled' THEN 'Cancelled'
              WHEN d.status = 'rescheduled' THEN 'Rescheduled'
              WHEN d.status = 'completed' THEN 'Completed'
              ELSE d.status
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
    `UPDATE defenses SET status = 'cancelled' WHERE id = ?`,
    [defenseId]
  );

  // Auto-promote: find any pending defenses that were blocked by this one
  await promotePendingDefenses(defenseId);

  // Then scan all pending defenses globally
  await processAllPendingDefenses();

  const { rows: updatedRows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.project_code,
            CASE
              WHEN d.status = 'scheduled' THEN 'Scheduled'
              WHEN d.status = 'pending' THEN 'Pending'
              WHEN d.status = 'cancelled' THEN 'Cancelled'
              WHEN d.status = 'rescheduled' THEN 'Rescheduled'
              WHEN d.status = 'completed' THEN 'Completed'
              ELSE d.status
            END AS status_label
     FROM defenses d
     LEFT JOIN projects p ON d.project_id = p.id
     WHERE d.id = ?
     LIMIT 1`,
    [defenseId]
  );

  return { data: updatedRows[0] || null };
}

// When a defense is cancelled, auto-promote any pending defenses that were
// waiting on it, provided they no longer have conflicts.
async function promotePendingDefenses(cancelledDefenseId) {
  const { rows: pendingRows } = await db.query(
    `SELECT * FROM defenses WHERE blocked_by = ? AND status = 'pending'`,
    [cancelledDefenseId]
  );

  for (const pending of pendingRows) {
    const normalizedStart = normalizeDateTimeInput(pending.start_time);
    const normalizedEnd = normalizeDateTimeInput(pending.end_time);
    if (!normalizedStart || !normalizedEnd) continue;

    const recheck = await validateScheduleConstraints({
      projectId: pending.project_id,
      startTime: normalizedStart.dbValue,
      endTime: normalizedEnd.dbValue,
      startDate: normalizedStart.dateValue,
      endDate: normalizedEnd.dateValue,
      location: pending.location,
      fallbackTeacherId: pending.created_by,
    });

    if (recheck.ok) {
      await db.query(
        `UPDATE defenses SET status = 'scheduled', blocked_by = NULL WHERE id = ?`,
        [pending.id]
      );
    }
  }
}

// After any booking / cancellation / reschedule, scan ALL pending defenses
// ordered by created_at and try to promote them one-by-one inside a
// SERIALIZABLE transaction so that competing defenses for the same slot
// are resolved first-come-first-served.
async function processAllPendingDefenses() {
  let conn;
  try {
    conn = await db.pool.getConnection();
    await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await conn.beginTransaction();

    const [pendingRows] = await conn.execute(
      `SELECT * FROM defenses WHERE status = 'pending' ORDER BY created_at ASC`
    );

    for (const pending of pendingRows) {
      const normalizedStart = normalizeDateTimeInput(pending.start_time);
      const normalizedEnd = normalizeDateTimeInput(pending.end_time);
      if (!normalizedStart || !normalizedEnd) continue;

      const recheck = await validateScheduleConstraints({
        projectId: pending.project_id,
        startTime: normalizedStart.dbValue,
        endTime: normalizedEnd.dbValue,
        startDate: normalizedStart.dateValue,
        endDate: normalizedEnd.dateValue,
        location: pending.location,
        fallbackTeacherId: pending.created_by,
        queryRunner: conn,
      });

      if (recheck.ok) {
        await conn.execute(
          `UPDATE defenses SET status = 'scheduled', blocked_by = NULL WHERE id = ?`,
          [pending.id]
        );
      }
    }

    await conn.commit();
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (e) { console.error('processAllPending rollback error:', e); }
    }
    console.error('processAllPendingDefenses error:', err);
  } finally {
    if (conn) conn.release();
  }
}

async function rescheduleDefense(userId, defenseId, payload) {
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
    return { error: 'You are not allowed to reschedule this meeting', status: 403 };
  }

  if (defense.status === 'cancelled') {
    return { error: 'Cannot reschedule a cancelled meeting', status: 409 };
  }

  const { start_time, end_time } = payload;
  if (!start_time) return { error: 'start_time is required' };
  if (!end_time) return { error: 'end_time is required' };

  const normalizedStart = normalizeDateTimeInput(start_time);
  const normalizedEnd = normalizeDateTimeInput(end_time);
  if (!normalizedStart) return { error: 'start_time must be a valid datetime value' };
  if (!normalizedEnd) return { error: 'end_time must be a valid datetime value' };
  if (normalizedStart.dateValue.getTime() >= normalizedEnd.dateValue.getTime()) {
    return { error: 'end_time must be after start_time' };
  }

  let conn;
  try {
    conn = await db.pool.getConnection();
    await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await conn.beginTransaction();

    // Temporarily mark the current defense as cancelled so it doesn't conflict with itself
    await conn.execute(
      `UPDATE defenses SET status = 'cancelled' WHERE id = ?`,
      [defenseId]
    );

    const scheduleCheck = await validateScheduleConstraints({
      projectId: defense.project_id,
      startTime: normalizedStart.dbValue,
      endTime: normalizedEnd.dbValue,
      startDate: normalizedStart.dateValue,
      endDate: normalizedEnd.dateValue,
      location: defense.location,
      fallbackTeacherId: userId,
      queryRunner: conn,
    });

    if (!scheduleCheck.ok) {
      await conn.rollback();
      const maxRemaining = Math.max(...scheduleCheck.conflicts.map(c => c.remaining_minutes));
      if (maxRemaining <= 10) {
        return {
          error: 'Schedule conflict: an existing meeting occupies this slot with 10 minutes or less remaining.',
          status: 409,
        };
      }
      return {
        conflict: true,
        conflicts: scheduleCheck.conflicts,
        max_overlap_minutes: Math.max(...scheduleCheck.conflicts.map(c => c.overlap_minutes)),
        max_remaining_minutes: maxRemaining,
        message: 'Rescheduled time has conflicts.',
        status: 409,
      };
    }

    await conn.execute(
      `UPDATE defenses SET start_time = ?, end_time = ?, status = 'rescheduled', blocked_by = NULL WHERE id = ?`,
      [normalizedStart.dbValue, normalizedEnd.dbValue, defenseId]
    );

    const [updatedRows] = await conn.execute(
      'SELECT * FROM defenses WHERE id = ? LIMIT 1',
      [defenseId]
    );

    await conn.commit();

    // After reschedule, scan all pending defenses for potential promotion
    await processAllPendingDefenses();

    return { data: updatedRows[0] };
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (e) { console.error('reschedule rollback error:', e); }
    }
    console.error('rescheduleDefense error:', err);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}
 
module.exports = { createDefense, getDefensesByUser, cancelDefense, rescheduleDefense };
