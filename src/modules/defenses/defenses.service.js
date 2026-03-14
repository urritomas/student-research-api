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

function toLocalDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value !== 'string') return null;
  return toDate(value.replace(' ', 'T'));
}

function computeOverlapMinutes(candidateStart, candidateEnd, existingStart, existingEnd) {
  const startMs = Math.max(candidateStart.getTime(), existingStart.getTime());
  const endMs = Math.min(candidateEnd.getTime(), existingEnd.getTime());
  if (endMs <= startMs) return 0;
  return Math.round((endMs - startMs) / 60000);
}

function addMinutesLocal(date, minutes) {
  return new Date(date.getTime() + (minutes * 60000));
}

function formatDbDateLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function getAdviserOverlapConflicts(conn, { projectId, userId, location, startDb, endDb }) {
  const scheduleStatuses = ['scheduled', 'approved', 'moved', 'rescheduled'];

  const startDate = toLocalDate(startDb);
  const endDate = toLocalDate(endDb);
  if (!startDate || !endDate) {
    return {
      conflicts: [],
      maxOverlapMinutes: 0,
      candidateTotalMinutes: 0,
      effectiveMinutes: 0,
      effectiveStartTime: startDb,
    };
  }

  const candidateTotalMinutes = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));

  const [memberRows] = await conn.execute(
    `SELECT user_id
     FROM project_members
     WHERE project_id = ?
       AND status = 'accepted'`,
    [projectId]
  );

  const memberIds = Array.from(new Set([userId, ...memberRows.map((row) => row.user_id)]));
  const statusPlaceholders = scheduleStatuses.map(() => '?').join(', ');

  const [projectRows] = await conn.execute(
    `SELECT id, project_id, start_time, end_time
     FROM defenses
     WHERE project_id = ?
       AND status IN (${statusPlaceholders})
       AND start_time < ?
       AND COALESCE(end_time, start_time) > ?`,
    [projectId, ...scheduleStatuses, endDb, startDb]
  );

  const roomRows = (!location || location.toLowerCase() === 'online')
    ? []
    : await (async () => {
      const [rows] = await conn.execute(
        `SELECT id, project_id, start_time, end_time
         FROM defenses
         WHERE location = ?
           AND status IN (${statusPlaceholders})
           AND start_time < ?
           AND COALESCE(end_time, start_time) > ?`,
        [location, ...scheduleStatuses, endDb, startDb]
      );
      return rows;
    })();

  const participantRows = memberIds.length
    ? await (async () => {
      const memberPlaceholders = memberIds.map(() => '?').join(', ');
      const [rows] = await conn.execute(
        `SELECT DISTINCT d.id, d.project_id, d.start_time, d.end_time, pm.user_id AS participant_id
         FROM defenses d
         JOIN project_members pm
           ON pm.project_id = d.project_id
          AND pm.status = 'accepted'
         WHERE pm.user_id IN (${memberPlaceholders})
           AND d.status IN (${statusPlaceholders})
           AND d.start_time < ?
           AND COALESCE(d.end_time, d.start_time) > ?`,
        [...memberIds, ...scheduleStatuses, endDb, startDb]
      );
      return rows;
    })()
    : [];

  const toConflict = (domain, row) => {
    const rowStart = toLocalDate(row.start_time);
    const rowEnd = toLocalDate(row.end_time) || rowStart;
    const overlapMinutes = (rowStart && rowEnd)
      ? computeOverlapMinutes(startDate, endDate, rowStart, rowEnd)
      : 0;
    return {
      domain,
      defense_id: row.id,
      project_id: row.project_id,
      overlap_minutes: overlapMinutes,
      remaining_minutes: Math.max(0, candidateTotalMinutes - overlapMinutes),
      participant_id: row.participant_id,
    };
  };

  const conflicts = [
    ...projectRows.map((row) => toConflict('project', row)),
    ...roomRows.map((row) => toConflict('room', row)),
    ...participantRows.map((row) => toConflict('participant', row)),
  ].filter((item) => item.overlap_minutes > 0);

  const maxOverlapMinutes = conflicts.reduce((max, item) => Math.max(max, item.overlap_minutes), 0);
  const effectiveMinutes = Math.max(0, candidateTotalMinutes - maxOverlapMinutes);
  const effectiveStartTime = formatDbDateLocal(addMinutesLocal(startDate, maxOverlapMinutes));

  return {
    conflicts,
    maxOverlapMinutes,
    candidateTotalMinutes,
    effectiveMinutes,
    effectiveStartTime,
  };
}

async function createDefense(userId, payload) {
  let conn;
  try {
    const { project_id, defense_type, start_time, end_time, location, modality, force_proceed } = payload;
    const scheduleInput = start_time;

    if (!project_id) return { error: 'project_id is required' };
    if (!defense_type || !['proposal', 'midterm', 'final'].includes(defense_type)) {
      return { error: 'defense_type must be one of: proposal, midterm, final' };
    }
    if (!scheduleInput) return { error: 'start_time is required' };
    if (!end_time) return { error: 'end_time is required' };
    if (!location) return { error: 'location is required' };

    const normalizedSchedule = normalizeDateTimeInput(scheduleInput);
    if (!normalizedSchedule) return { error: 'start_time must be a valid datetime value' };
    const normalizedEndTime = end_time ? normalizeDateTimeInput(end_time) : null;
    if (!normalizedEndTime) return { error: 'end_time must be a valid datetime value' };
    if (normalizedEndTime.dateValue <= normalizedSchedule.dateValue) {
      return { error: 'end_time must be later than start_time' };
    }

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

    const overlapCheck = await getAdviserOverlapConflicts(conn, {
      projectId: project_id,
      userId,
      location,
      startDb: normalizedSchedule.dbValue,
      endDb: normalizedEndTime.dbValue,
    });

    if (overlapCheck.conflicts.length && !force_proceed) {
      await conn.rollback();
      return {
        conflict: true,
        conflicts: overlapCheck.conflicts,
        max_overlap_minutes: overlapCheck.maxOverlapMinutes,
        candidate_total_minutes: overlapCheck.candidateTotalMinutes,
        effective_minutes: overlapCheck.effectiveMinutes,
        effective_start_time: overlapCheck.effectiveStartTime,
        message: 'This schedule overlaps with confirmed defenses. Confirm if you still want to proceed.',
        status: 409,
      };
    }

    const status = 'pending';

    const [idRows] = await conn.execute('SELECT UUID() AS id');
    const defenseId = idRows[0].id;

    await conn.execute(
      `INSERT INTO defenses (id, project_id, defense_type, start_time, end_time, location, modality, status, blocked_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [defenseId, project_id, defense_type, normalizedSchedule.dbValue, normalizedEndTime.dbValue, location, modality || 'Online', status, null, userId]
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

async function getDefensesForMember(userId) {
  const { rows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.project_code,
            u.full_name AS created_by_name
     FROM defenses d
     JOIN projects p ON d.project_id = p.id
     JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     LEFT JOIN users u ON d.created_by = u.id
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

  const scheduleInput = payload.start_time;
  if (!scheduleInput) return { error: 'start_time is required' };

  const normalizedSchedule = normalizeDateTimeInput(scheduleInput);
  if (!normalizedSchedule) return { error: 'start_time must be a valid datetime value' };
  const normalizedEndTime = payload.end_time ? normalizeDateTimeInput(payload.end_time) : null;

  await db.query(
    `UPDATE defenses
     SET start_time = ?,
         end_time = ?,
         status = 'pending',
         blocked_by = NULL,
         verified_by = NULL,
         verified_at = NULL,
         verified_schedule = NULL
     WHERE id = ?`,
    [normalizedSchedule.dbValue, normalizedEndTime?.dbValue || null, defenseId]
  );

  const { rows: updatedRows } = await db.query(
    'SELECT * FROM defenses WHERE id = ? LIMIT 1',
    [defenseId]
  );

  return { data: updatedRows[0] };
}

module.exports = { createDefense, getDefensesByUser, getDefensesForMember, cancelDefense, rescheduleDefense };
