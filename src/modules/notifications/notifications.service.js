const db = require('../../../config/db');

async function createNotification({ userId, type, title, message, metadata }) {
  await db.query(
    `INSERT INTO notifications (user_id, type, title, message, metadata)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, type, title, message, metadata ? JSON.stringify(metadata) : null]
  );
}

async function getNotificationsForUser(userId, { limit = 50 } = {}) {
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
  const { rows } = await db.query(
    `SELECT id, user_id, type, title, message, metadata, is_read, read_at, created_at
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, safeLimit]
  );

  return rows.map((row) => ({
    ...row,
    metadata: typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : (row.metadata || null),
    is_read: Boolean(row.is_read),
  }));
}

async function markNotificationAsRead(notificationId, userId) {
  const { rows } = await db.query(
    `UPDATE notifications
     SET is_read = 1, read_at = NOW()
     WHERE id = ? AND user_id = ?`,
    [notificationId, userId]
  );
  return rows;
}

async function markAllNotificationsAsRead(userId) {
  const { rows } = await db.query(
    `UPDATE notifications
     SET is_read = 1, read_at = NOW()
     WHERE user_id = ? AND is_read = 0`,
    [userId]
  );
  return rows;
}

module.exports = {
  createNotification,
  getNotificationsForUser,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};
