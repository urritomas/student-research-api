const db = require('../../../config/db');
const { createNotification } = require('../notifications/notifications.service');

// ─── Institution Management ─────────────────────────────────────────────────

async function getInstitutionByCoordinator(userId) {
  const { rows } = await db.query(
    `SELECT i.*
     FROM institutions i
     INNER JOIN user_roles ur ON ur.institution_id = i.id
     WHERE ur.user_id = ? AND ur.role = 'coordinator'
     ORDER BY ur.created_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function getInstitutionById(institutionId) {
  const { rows } = await db.query(
    'SELECT * FROM institutions WHERE id = ? LIMIT 1',
    [institutionId]
  );
  return rows[0] || null;
}

async function getAdvisersInInstitution(institutionId) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.full_name, u.avatar_url, ur.role, ur.created_at AS role_assigned_at
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     WHERE ur.institution_id = ? AND ur.role = 'adviser'
     ORDER BY u.full_name ASC`,
    [institutionId]
  );
  return rows;
}

async function addAdviserToInstitution(institutionId, adviserId, coordinatorId) {
  // Verify the adviser exists and has adviser role
  const { rows: roleRows } = await db.query(
    `SELECT ur.id, ur.institution_id
     FROM user_roles ur
     WHERE ur.user_id = ? AND ur.role = 'adviser'
     ORDER BY ur.created_at DESC LIMIT 1`,
    [adviserId]
  );

  if (!roleRows[0]) {
    return { error: 'User is not an adviser' };
  }

  if (roleRows[0].institution_id === institutionId) {
    return { error: 'Adviser is already in this institution' };
  }

  await db.query(
    'UPDATE user_roles SET institution_id = ? WHERE id = ?',
    [institutionId, roleRows[0].id]
  );

  return { data: { success: true } };
}

async function removeAdviserFromInstitution(institutionId, adviserId) {
  const { rows } = await db.query(
    `UPDATE user_roles SET institution_id = NULL
     WHERE user_id = ? AND role = 'adviser' AND institution_id = ?`,
    [adviserId, institutionId]
  );
  return rows;
}

// ─── Course Management ──────────────────────────────────────────────────────

async function getCoursesByInstitution(institutionId) {
  const { rows } = await db.query(
    `SELECT * FROM courses
     WHERE institution_id = ?
     ORDER BY course_name ASC`,
    [institutionId]
  );
  return rows;
}

async function getCourseById(courseId) {
  const { rows } = await db.query(
    'SELECT * FROM courses WHERE id = ? LIMIT 1',
    [courseId]
  );
  return rows[0] || null;
}

async function createCourse(institutionId, { courseName, code, description }) {
  // Check for duplicate code within institution
  const { rows: existing } = await db.query(
    'SELECT id FROM courses WHERE institution_id = ? AND code = ? LIMIT 1',
    [institutionId, code]
  );
  if (existing[0]) {
    return { error: 'A course with this code already exists in your institution' };
  }

  await db.query(
    `INSERT INTO courses (id, institution_id, course_name, code, description)
     VALUES (UUID(), ?, ?, ?, ?)`,
    [institutionId, courseName, code, description || null]
  );

  const { rows } = await db.query(
    `SELECT * FROM courses WHERE institution_id = ? AND code = ? LIMIT 1`,
    [institutionId, code]
  );

  return { data: rows[0] };
}

async function updateCourse(courseId, institutionId, { courseName, code, description }) {
  const course = await getCourseById(courseId);
  if (!course || course.institution_id !== institutionId) {
    return { error: 'Course not found in your institution' };
  }

  if (code && code !== course.code) {
    const { rows: dup } = await db.query(
      'SELECT id FROM courses WHERE institution_id = ? AND code = ? AND id != ? LIMIT 1',
      [institutionId, code, courseId]
    );
    if (dup[0]) {
      return { error: 'A course with this code already exists in your institution' };
    }
  }

  await db.query(
    `UPDATE courses SET course_name = ?, code = ?, description = ? WHERE id = ?`,
    [courseName || course.course_name, code || course.code, description !== undefined ? description : course.description, courseId]
  );

  const updated = await getCourseById(courseId);
  return { data: updated };
}

async function deleteCourse(courseId, institutionId) {
  const course = await getCourseById(courseId);
  if (!course || course.institution_id !== institutionId) {
    return { error: 'Course not found in your institution' };
  }

  await db.query('DELETE FROM courses WHERE id = ?', [courseId]);
  return { data: { success: true } };
}

// ─── Defense Verification ───────────────────────────────────────────────────

async function getPendingDefenses(institutionId) {
  const { rows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.project_code,
            u.full_name AS created_by_name
     FROM defenses d
     INNER JOIN projects p ON d.project_id = p.id
     LEFT JOIN users u ON d.created_by = u.id
     WHERE p.institution_id = ?
       AND d.verified_by IS NULL
       AND d.status IN ('pending', 'scheduled')
     ORDER BY d.scheduled_at ASC`,
    [institutionId]
  );
  return rows;
}

async function getAllDefensesForInstitution(institutionId) {
  const { rows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.project_code,
            u.full_name AS created_by_name,
            vu.full_name AS verified_by_name
     FROM defenses d
     INNER JOIN projects p ON d.project_id = p.id
     LEFT JOIN users u ON d.created_by = u.id
     LEFT JOIN users vu ON d.verified_by = vu.id
     WHERE p.institution_id = ?
     ORDER BY d.scheduled_at DESC`,
    [institutionId]
  );
  return rows;
}

async function verifyDefense(defenseId, coordinatorId, { venue, verifiedSchedule, notes }) {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    // Get current defense with project info
    const [defenseRows] = await conn.execute(
      `SELECT d.*, p.title AS project_title
       FROM defenses d
       LEFT JOIN projects p ON d.project_id = p.id
       WHERE d.id = ? LIMIT 1`,
      [defenseId]
    );
    const defense = defenseRows[0];
    if (!defense) {
      await conn.rollback();
      return { error: 'Defense not found' };
    }

    // Determine status: 'moved' if schedule was changed, otherwise 'approved'
    const scheduleMoved = verifiedSchedule && verifiedSchedule !== defense.scheduled_at?.toISOString?.();
    const newStatus = scheduleMoved ? 'moved' : 'approved';
    const notifType = scheduleMoved ? 'defense_moved' : 'defense_approved';

    // Update defense with verification
    await conn.execute(
      `UPDATE defenses
       SET verified_by = ?, verified_at = NOW(),
           venue = COALESCE(?, venue),
           verified_schedule = ?,
           status = ?
       WHERE id = ?`,
      [coordinatorId, venue || null, verifiedSchedule || defense.scheduled_at, newStatus, defenseId]
    );

    // Create verification audit record
    await conn.execute(
      `INSERT INTO defense_verifications (id, defense_id, verified_by, previous_schedule, new_schedule, previous_venue, new_venue, notes)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`,
      [
        defenseId,
        coordinatorId,
        defense.scheduled_at,
        verifiedSchedule || defense.scheduled_at,
        defense.venue || defense.location,
        venue || defense.venue || defense.location,
        notes || null,
      ]
    );

    // Notify all project members
    const [members] = await conn.execute(
      'SELECT user_id FROM project_members WHERE project_id = ?',
      [defense.project_id]
    );

    const finalSchedule = verifiedSchedule || defense.scheduled_at;
    const dateStr = new Date(finalSchedule).toLocaleDateString();
    const timeStr = new Date(finalSchedule).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const modality = defense.modality || 'Online';

    const notifTitle = scheduleMoved
      ? `Defense Schedule Modified & Approved`
      : `Defense Approved`;
    const notifMessage = scheduleMoved
      ? `The ${defense.defense_type} defense for "${defense.project_title}" has been approved with a new schedule: ${dateStr} at ${timeStr} (${modality}).`
      : `The ${defense.defense_type} defense for "${defense.project_title}" has been approved for ${dateStr} at ${timeStr} (${modality}).`;

    for (const member of members) {
      await createNotification({
        userId: member.user_id,
        type: notifType,
        title: notifTitle,
        message: notifMessage,
        metadata: { defenseId, projectId: defense.project_id, schedule: finalSchedule, modality },
        conn,
      });
    }

    await conn.commit();

    // Return updated defense
    const { rows } = await db.query('SELECT * FROM defenses WHERE id = ? LIMIT 1', [defenseId]);
    return { data: rows[0] };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function rejectDefense(defenseId, coordinatorId, { notes }) {
  const { rows: defenseRows } = await db.query(
    `SELECT d.*, p.title AS project_title
     FROM defenses d
     LEFT JOIN projects p ON d.project_id = p.id
     WHERE d.id = ? LIMIT 1`,
    [defenseId]
  );
  const defense = defenseRows[0];
  if (!defense) {
    return { error: 'Defense not found' };
  }

  await db.query(
    `UPDATE defenses SET status = 'rejected', verified_by = ?, verified_at = NOW() WHERE id = ?`,
    [coordinatorId, defenseId]
  );

  if (notes) {
    await db.query(
      `INSERT INTO defense_verifications (id, defense_id, verified_by, notes)
       VALUES (UUID(), ?, ?, ?)`,
      [defenseId, coordinatorId, notes]
    );
  }

  // Notify all project members
  const { rows: members } = await db.query(
    'SELECT user_id FROM project_members WHERE project_id = ?',
    [defense.project_id]
  );

  const notifTitle = 'Defense Proposal Rejected';
  const notifMessage = `The ${defense.defense_type} defense proposal for "${defense.project_title}" has been rejected.${notes ? ' Reason: ' + notes : ''}`;

  for (const member of members) {
    await createNotification({
      userId: member.user_id,
      type: 'defense_rejected',
      title: notifTitle,
      message: notifMessage,
      metadata: { defenseId, projectId: defense.project_id },
    });
  }

  return { data: { success: true } };
}

async function setDefenseVenue(defenseId, coordinatorId, venue) {
  const { rows } = await db.query(
    'SELECT * FROM defenses WHERE id = ? LIMIT 1',
    [defenseId]
  );
  if (!rows[0]) {
    return { error: 'Defense not found' };
  }

  await db.query(
    'UPDATE defenses SET venue = ?, verified_by = ?, verified_at = NOW() WHERE id = ?',
    [venue, coordinatorId, defenseId]
  );

  return { data: { success: true } };
}

// ─── Dashboard Stats ────────────────────────────────────────────────────────

async function getCoordinatorStats(institutionId) {
  const [projectsResult, advisersResult, defensesResult, coursesResult] = await Promise.all([
    db.query(
      'SELECT COUNT(*) AS count FROM projects WHERE institution_id = ?',
      [institutionId]
    ),
    db.query(
      `SELECT COUNT(*) AS count FROM user_roles WHERE institution_id = ? AND role = 'adviser'`,
      [institutionId]
    ),
    db.query(
      `SELECT COUNT(*) AS count FROM defenses d
       INNER JOIN projects p ON d.project_id = p.id
       WHERE p.institution_id = ?
         AND d.verified_by IS NULL
         AND d.status IN ('pending', 'scheduled')`,
      [institutionId]
    ),
    db.query(
      'SELECT COUNT(*) AS count FROM courses WHERE institution_id = ?',
      [institutionId]
    ),
  ]);

  return {
    totalProjects: projectsResult.rows[0]?.count || 0,
    totalAdvisers: advisersResult.rows[0]?.count || 0,
    pendingDefenses: defensesResult.rows[0]?.count || 0,
    totalCourses: coursesResult.rows[0]?.count || 0,
  };
}

async function createDefenseForCourse(institutionId, coordinatorId, payload) {
  const { courseId, defenseType, scheduledAt, location, venue } = payload;

  if (!courseId) return { error: 'courseId is required' };
  if (!defenseType || !['proposal', 'midterm', 'final'].includes(defenseType)) {
    return { error: 'defenseType must be one of: proposal, midterm, final' };
  }
  if (!scheduledAt) return { error: 'scheduledAt is required' };
  if (!location) return { error: 'location is required' };

  const course = await getCourseById(courseId);
  if (!course || course.institution_id !== institutionId) {
    return { error: 'Course not found in your institution' };
  }

  const { rows: projects } = await db.query(
    'SELECT id, title, project_code FROM projects WHERE course_id = ? AND institution_id = ?',
    [courseId, institutionId]
  );

  if (projects.length === 0) {
    return { error: 'No projects found in this course' };
  }

  const createdDefenses = [];

  for (const project of projects) {
    await db.query(
      `INSERT INTO defenses (id, project_id, defense_type, scheduled_at, location, venue, status, verified_by, verified_at, created_by)
       VALUES (UUID(), ?, ?, ?, ?, ?, 'scheduled', ?, NOW(), ?)`,
      [project.id, defenseType, scheduledAt, location, venue || null, coordinatorId, coordinatorId]
    );

    const { rows: defenseRows } = await db.query(
      'SELECT * FROM defenses WHERE project_id = ? AND created_by = ? ORDER BY created_at DESC LIMIT 1',
      [project.id, coordinatorId]
    );

    if (defenseRows[0]) {
      createdDefenses.push({ ...defenseRows[0], project_title: project.title, project_code: project.project_code });
    }

    const { rows: members } = await db.query(
      'SELECT user_id FROM project_members WHERE project_id = ?',
      [project.id]
    );

    const notifTitle = `${defenseType.charAt(0).toUpperCase() + defenseType.slice(1)} Defense Scheduled`;
    const notifMessage = `A ${defenseType} defense for "${project.title}" has been scheduled on ${new Date(scheduledAt).toLocaleDateString()} at ${location}.`;

    for (const member of members) {
      await createNotification({
        userId: member.user_id,
        type: 'schedule',
        title: notifTitle,
        message: notifMessage,
        metadata: { defenseId: defenseRows[0]?.id, projectId: project.id },
      });
    }
  }

  return { data: { count: createdDefenses.length, defenses: createdDefenses } };
}

async function getProjectsByInstitution(institutionId) {
  const { rows } = await db.query(
    `SELECT
       p.id, p.title, p.project_code, p.status, p.project_type, p.created_at, p.updated_at,
       p.course_id,
       c.course_name, c.code AS course_code
     FROM projects p
     LEFT JOIN courses c ON p.course_id = c.id
     WHERE p.institution_id = ?
     ORDER BY p.created_at DESC`,
    [institutionId]
  );
  return rows;
}

async function getProjectsByAdviserInInstitution(institutionId) {
  const { rows } = await db.query(
    `SELECT
       u.id AS adviser_id, u.full_name AS adviser_name, u.email AS adviser_email, u.avatar_url AS adviser_avatar,
       p.id AS project_id, p.title AS project_title, p.project_code, p.status AS project_status,
       p.project_type, p.created_at AS project_created_at
     FROM user_roles ur
     INNER JOIN users u ON u.id = ur.user_id
     LEFT JOIN project_members pm ON pm.user_id = u.id AND pm.role = 'adviser'
     LEFT JOIN projects p ON p.id = pm.project_id
     WHERE ur.institution_id = ? AND ur.role = 'adviser'
     ORDER BY u.full_name ASC, p.title ASC`,
    [institutionId]
  );

  const adviserMap = new Map();
  for (const row of rows) {
    if (!adviserMap.has(row.adviser_id)) {
      adviserMap.set(row.adviser_id, {
        id: row.adviser_id,
        full_name: row.adviser_name,
        email: row.adviser_email,
        avatar_url: row.adviser_avatar,
        projects: [],
      });
    }
    if (row.project_id) {
      adviserMap.get(row.adviser_id).projects.push({
        id: row.project_id,
        title: row.project_title,
        project_code: row.project_code,
        status: row.project_status,
        project_type: row.project_type,
        created_at: row.project_created_at,
      });
    }
  }

  return Array.from(adviserMap.values());
}

module.exports = {
  getInstitutionByCoordinator,
  getInstitutionById,
  getAdvisersInInstitution,
  addAdviserToInstitution,
  removeAdviserFromInstitution,
  getCoursesByInstitution,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  getPendingDefenses,
  getAllDefensesForInstitution,
  verifyDefense,
  rejectDefense,
  setDefenseVenue,
  getCoordinatorStats,
  createDefenseForCourse,
  getProjectsByInstitution,
  getProjectsByAdviserInInstitution,
};
