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
  // mysql2 returns DATETIME columns as JS Date objects, handle them directly.
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

function buildExactTimeConflicts(intervals) {
  return {
    hasConflict: intervals.length > 0,
    conflictingIntervals: intervals,
  };
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

async function getParticipantSchedules(userIds, scheduledAt, queryRunner = db) {
  if (!userIds.length) {
    return [];
  }

  const placeholders = buildInClausePlaceholders(userIds);
  const rows = await queryRows(
    queryRunner,
    `SELECT DISTINCT d.id, d.project_id, d.scheduled_at, d.location, pm.user_id AS participant_id
     FROM defenses d
     JOIN project_members pm
       ON pm.project_id = d.project_id
      AND pm.status = 'accepted'
     WHERE pm.user_id IN (${placeholders})
       AND d.status = 'scheduled'
       AND d.scheduled_at = ?`,
    [...userIds, scheduledAt]
  );

  return rows;
}

async function getRoomSchedules(location, scheduledAt, queryRunner = db) {
  if (!location || location.toLowerCase() === 'online') {
    return [];
  }

  const rows = await queryRows(
    queryRunner,
    `SELECT id, project_id, scheduled_at, location
     FROM defenses
     WHERE status = 'scheduled'
       AND location = ?
       AND scheduled_at = ?`,
    [location, scheduledAt]
  );

  return rows;
}

async function getProjectSchedules(projectId, scheduledAt, queryRunner = db) {
  const rows = await queryRows(
    queryRunner,
    `SELECT id, project_id, scheduled_at, location
     FROM defenses
     WHERE project_id = ?
       AND status = 'scheduled'
       AND scheduled_at = ?`,
    [projectId, scheduledAt]
  );
  return rows;
}

async function validateScheduleConstraints({ projectId, scheduledAt, location, fallbackTeacherId, queryRunner = db }) {
  const [projectSchedules, roomSchedules, memberGroups] = await Promise.all([
    getProjectSchedules(projectId, scheduledAt, queryRunner),
    getRoomSchedules(location, scheduledAt, queryRunner),
    getProjectMemberGroups(projectId, fallbackTeacherId, queryRunner),
  ]);

  const [teacherSchedules, studentSchedules] = await Promise.all([
    getParticipantSchedules(memberGroups.teacherIds, scheduledAt, queryRunner),
    getParticipantSchedules(memberGroups.studentIds, scheduledAt, queryRunner),
  ]);

  const allConflicts = [];

  const checks = [
    { label: 'project', result: buildExactTimeConflicts(projectSchedules) },
    { label: 'room', result: buildExactTimeConflicts(roomSchedules) },
    { label: 'teacher', result: buildExactTimeConflicts(teacherSchedules) },
    { label: 'student', result: buildExactTimeConflicts(studentSchedules) },
  ];

  for (const { label, result } of checks) {
    if (result.hasConflict) {
      for (const interval of result.conflictingIntervals) {
        allConflicts.push({
          domain: label,
          defense_id: interval.id,
          project_id: interval.project_id,
          scheduled_at: interval.scheduled_at,
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
    const { project_id, defense_type, scheduled_at, location, modality, force_pending, submit_as_proposal } = payload;
    const scheduleInput = scheduled_at;

    if (!project_id) return { error: 'project_id is required' };
    if (!defense_type || !['proposal', 'midterm', 'final'].includes(defense_type)) {
      return { error: 'defense_type must be one of: proposal, midterm, final' };
    }
    if (!scheduleInput) return { error: 'scheduled_at is required' };
    if (!location) return { error: 'location is required' };

    const normalizedSchedule = normalizeDateTimeInput(scheduleInput);
    if (!normalizedSchedule) return { error: 'scheduled_at must be a valid datetime value' };

    conn = await db.pool.getConnection();
    await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await conn.beginTransaction();

    const [projectRows] = await conn.execute(
      'SELECT id, institution_id FROM projects WHERE id = ? LIMIT 1',
      [project_id]
    );

    const project = projectRows[0];
    if (!project) {
      await conn.rollback();
      return { error: 'Project not found', status: 404 };
    }

    const [institutionRows] = await conn.execute(
      `SELECT institution_id
       FROM user_roles
       WHERE user_id = ?
         AND role = 'adviser'
         AND institution_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    const adviserInstitutionId = institutionRows[0]?.institution_id || null;
    if (!adviserInstitutionId) {
      await conn.rollback();
      return {
        error: 'Adviser must be assigned to an institution before submitting a defense proposal.',
        status: 400,
      };
    }

    if (!project.institution_id) {
      await conn.execute(
        'UPDATE projects SET institution_id = ? WHERE id = ?',
        [adviserInstitutionId, project_id]
      );
    } else if (project.institution_id !== adviserInstitutionId) {
      await conn.rollback();
      return {
        error: 'Project institution does not match adviser institution.',
        status: 403,
      };
    }

    const scheduleCheck = await validateScheduleConstraints({
      projectId: project_id,
      scheduledAt: normalizedSchedule.dbValue,
      location,
      fallbackTeacherId: userId,
      queryRunner: conn,
    });

    let status = submit_as_proposal ? 'pending' : 'scheduled';
    let blockedBy = null;
    if (!scheduleCheck.ok) {
      const conflicts = scheduleCheck.conflicts;
      if (force_pending || submit_as_proposal) {
        status = 'pending';
        blockedBy = conflicts[0].defense_id;
      } else {
        await conn.rollback();
        return {
          conflict: true,
          conflicts,
          message: 'Schedule conflict detected for this datetime. Please choose another time or set force_pending.',
          status: 409,
        };
      }
    }

    const [idRows] = await conn.execute('SELECT UUID() AS id');
    const defenseId = idRows[0].id;

    await conn.execute(
      `INSERT INTO defenses (id, project_id, defense_type, scheduled_at, location, modality, status, blocked_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [defenseId, project_id, defense_type, normalizedSchedule.dbValue, location, modality || 'Online', status, blockedBy, userId]
    );

    const [rows] = await conn.execute(
      'SELECT * FROM defenses WHERE id = ? LIMIT 1',
      [defenseId]
    );

    await conn.commit();

    // Adviser proposals should stay pending for coordinator review.
    if (!submit_as_proposal) {
      await processAllPendingDefenses();
    }

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
     ORDER BY d.scheduled_at DESC`,
    [userId]
  );
  return rows;
}

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

  await promotePendingDefenses(defenseId);
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

async function promotePendingDefenses(cancelledDefenseId) {
  const { rows: pendingRows } = await db.query(
    `SELECT * FROM defenses WHERE blocked_by = ? AND status = 'pending'`,
    [cancelledDefenseId]
  );

  for (const pending of pendingRows) {
    const normalizedSchedule = normalizeDateTimeInput(pending.scheduled_at);
    if (!normalizedSchedule) continue;

    const recheck = await validateScheduleConstraints({
      projectId: pending.project_id,
      scheduledAt: normalizedSchedule.dbValue,
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
      const normalizedSchedule = normalizeDateTimeInput(pending.scheduled_at);
      if (!normalizedSchedule) continue;

      const recheck = await validateScheduleConstraints({
        projectId: pending.project_id,
        scheduledAt: normalizedSchedule.dbValue,
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
      try {
        await conn.rollback();
      } catch (e) {
        console.error('processAllPending rollback error:', e);
      }
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

  const scheduleInput = payload.scheduled_at;
  if (!scheduleInput) return { error: 'scheduled_at is required' };

  const normalizedSchedule = normalizeDateTimeInput(scheduleInput);
  if (!normalizedSchedule) return { error: 'scheduled_at must be a valid datetime value' };

  let conn;
  try {
    conn = await db.pool.getConnection();
    await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE defenses SET status = 'cancelled' WHERE id = ?`,
      [defenseId]
    );

    const scheduleCheck = await validateScheduleConstraints({
      projectId: defense.project_id,
      scheduledAt: normalizedSchedule.dbValue,
      location: defense.location,
      fallbackTeacherId: userId,
      queryRunner: conn,
    });

    if (!scheduleCheck.ok) {
      await conn.rollback();
      return {
        conflict: true,
        conflicts: scheduleCheck.conflicts,
        message: 'Rescheduled datetime has conflicts.',
        status: 409,
      };
    }

    await conn.execute(
      `UPDATE defenses SET scheduled_at = ?, status = 'rescheduled', blocked_by = NULL WHERE id = ?`,
      [normalizedSchedule.dbValue, defenseId]
    );

    const [updatedRows] = await conn.execute(
      'SELECT * FROM defenses WHERE id = ? LIMIT 1',
      [defenseId]
    );

    await conn.commit();
    await processAllPendingDefenses();

    return { data: updatedRows[0] };
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {
        console.error('reschedule rollback error:', e);
      }
    }
    console.error('rescheduleDefense error:', err);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { createDefense, getDefensesByUser, getDefensesForMember, cancelDefense, rescheduleDefense };
