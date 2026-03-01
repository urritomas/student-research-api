const db = require('../../../config/db');

async function createProject({ title, abstract, keywords, researchType, program, course, section, documentReference, createdBy }) {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.execute(
      `INSERT INTO projects (title, description, abstract, keywords, paper_standard, program, course, section, document_reference, created_by, status, project_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'thesis')`,
      [
        title,
        abstract,
        abstract,
        JSON.stringify(keywords || []),
        (researchType || 'ieee').toLowerCase(),
        program || null,
        course || null,
        section || null,
        documentReference || null,
        createdBy,
      ]
    );

    const [rows] = await conn.execute(
      'SELECT * FROM projects WHERE id = LAST_INSERT_ID() OR (created_by = ? AND title = ?) ORDER BY created_at DESC LIMIT 1',
      [createdBy, title]
    );

    if (!rows.length) {
      throw new Error('Failed to retrieve created project');
    }

    const project = rows[0];

    await conn.execute(
      `INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'leader', 'accepted')`,
      [project.id, createdBy]
    );

    await conn.commit();
    return project;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getProjectsByUser(userId) {
  const { rows } = await db.query(
    `SELECT DISTINCT p.*
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id
     WHERE p.created_by = ? OR pm.user_id = ?
     ORDER BY p.created_at DESC`,
    [userId, userId]
  );
  return rows;
}

async function getProjectById(projectId) {
  const { rows } = await db.query('SELECT * FROM projects WHERE id = ?', [projectId]);
  return rows[0] || null;
}

async function getProjectMembers(projectId) {
  const { rows } = await db.query(
    `SELECT pm.*, u.full_name, u.email, u.avatar_url
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ?
     ORDER BY pm.invited_at ASC`,
    [projectId]
  );

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    role: r.role,
    status: r.status,
    users: {
      full_name: r.full_name,
      email: r.email,
      avatar_url: r.avatar_url,
    },
  }));
}

async function addProjectFile({ projectId, fileUrl, fileName, fileSize, mimeType, uploadedBy }) {
  await db.query(
    `INSERT INTO project_files (project_id, file_url, file_name, file_size, mime_type, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [projectId, fileUrl, fileName, fileSize, mimeType || null, uploadedBy]
  );
}

async function updateProjectDocumentRef(projectId, documentReference) {
  await db.query(
    'UPDATE projects SET document_reference = ? WHERE id = ?',
    [documentReference, projectId]
  );
}

async function getProjectFiles(projectId) {
  const { rows } = await db.query(
    'SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at DESC',
    [projectId]
  );
  return rows;
}

module.exports = {
  createProject,
  getProjectsByUser,
  getProjectById,
  getProjectMembers,
  addProjectFile,
  updateProjectDocumentRef,
  getProjectFiles,
};
