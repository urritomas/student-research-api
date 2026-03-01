const db = require('../../../config/db');

const ALLOWED_ROLE_VALUES = new Set(['student', 'teacher', 'adviser']);

function normalizeRole(role) {
  if (!role || typeof role !== 'string') return null;
  const normalized = role.trim().toLowerCase();
  if (!ALLOWED_ROLE_VALUES.has(normalized)) return null;
  return normalized === 'teacher' ? 'adviser' : normalized;
}

function normalizeDisplayName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return null;
  return trimmed;
}

function normalizeAvatarUrl(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 1024);
}

async function getProfileByUserId(userId) {
  const query = `
    SELECT
      u.id,
      u.email,
      u.full_name,
      u.avatar_url,
      u.status,
      u.status_text,
      ur.role
    FROM users u
    LEFT JOIN user_roles ur
      ON ur.user_id = u.id
      AND ur.id = (
        SELECT ur2.id
        FROM user_roles ur2
        WHERE ur2.user_id = u.id
        ORDER BY ur2.created_at DESC
        LIMIT 1
      )
    WHERE u.id = ?
    LIMIT 1
  `;

  const { rows } = await db.query(query, [userId]);
  return rows[0] || null;
}

async function profileExists(userId) {
  const { rows } = await db.query('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows.length > 0;
}

function normalizeStatusText(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length > 255) return undefined;
  return trimmed || null;
}

async function updateMyProfile(userId, payload) {
  const fullName = payload.full_name !== undefined ? normalizeDisplayName(payload.full_name) : undefined;
  const avatarUrl = payload.avatar_url !== undefined ? normalizeAvatarUrl(payload.avatar_url) : undefined;
  const statusText = payload.status_text !== undefined ? normalizeStatusText(payload.status_text) : undefined;

  if (payload.full_name !== undefined && !fullName) {
    return { error: 'full_name must be between 2 and 80 characters' };
  }

  if (payload.avatar_url !== undefined && payload.avatar_url !== null && !avatarUrl) {
    return { error: 'avatar_url must be a valid non-empty string or null' };
  }

  if (payload.status_text !== undefined && statusText === undefined) {
    return { error: 'status_text must be a string of 255 characters or fewer' };
  }

  const updates = [];
  const params = [];

  if (payload.full_name !== undefined) {
    updates.push('full_name = ?');
    params.push(fullName);
  }

  if (payload.avatar_url !== undefined) {
    updates.push('avatar_url = ?');
    params.push(avatarUrl);
  }

  if (payload.status_text !== undefined) {
    updates.push('status_text = ?');
    params.push(statusText);
  }

  if (updates.length === 0) {
    return { error: 'No supported fields to update' };
  }

  updates.push('updated_at = NOW()');
  params.push(userId);

  const result = await db.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
    params,
  );

  if (!result.rows || result.rows.affectedRows === 0) {
    return { error: 'Profile not found', status: 404 };
  }

  const profile = await getProfileByUserId(userId);
  return { data: profile };
}

async function completeProfile(userId, payload) {
  const displayName = normalizeDisplayName(payload.displayName);
  const role = normalizeRole(payload.role);

  if (!displayName) {
    return { error: 'displayName must be between 2 and 80 characters' };
  }

  if (!role) {
    return { error: 'role must be one of: student, teacher, adviser' };
  }

  const email = typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim() : null;
  const avatarUrl = normalizeAvatarUrl(payload.avatarUrl || payload.googlePhotoUrl || null);

  const existing = await getProfileByUserId(userId);

  if (existing) {
    const updateParams = [displayName, avatarUrl, userId];
    await db.query(
      'UPDATE users SET full_name = ?, avatar_url = ?, updated_at = NOW() WHERE id = ?',
      updateParams,
    );
  } else {
    if (!email) {
      return { error: 'email is required when creating a profile' };
    }

    await db.query(
      `INSERT INTO users (id, email, full_name, avatar_url, auth_provider, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'email', 1, NOW(), NOW())`,
      [userId, email, displayName, avatarUrl],
    );
  }

  const currentRole = await db.query(
    'SELECT id, role FROM user_roles WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId],
  );

  if (!currentRole.rows[0]) {
    await db.query(
      'INSERT INTO user_roles (id, user_id, role, created_at) VALUES (UUID(), ?, ?, NOW())',
      [userId, role],
    );
  } else if (currentRole.rows[0].role !== role) {
    await db.query(
      'UPDATE user_roles SET role = ? WHERE id = ?',
      [role, currentRole.rows[0].id],
    );
  }

  return {
    data: {
      success: true,
      redirectPath: role === 'student' ? '/student' : '/adviser',
    },
  };
}

async function getRoleByUserId(userId) {
  const { rows } = await db.query(
    'SELECT role FROM user_roles WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId],
  );
  return rows[0]?.role || null;
}

module.exports = {
  completeProfile,
  getProfileByUserId,
  getRoleByUserId,
  profileExists,
  updateMyProfile,
};
