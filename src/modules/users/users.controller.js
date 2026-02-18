const {
  completeProfile,
  getProfileByUserId,
  getRoleByUserId,
  profileExists,
  updateMyProfile,
} = require('./users.service');

async function getMe(req, res) {
  const profile = await getProfileByUserId(req.user.id);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  return res.json(profile);
}

async function getUserById(req, res) {
  const { userId } = req.params;
  if (userId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const profile = await getProfileByUserId(userId);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  return res.json(profile);
}

async function getMyProfileExists(req, res) {
  const exists = await profileExists(req.user.id);
  const role = exists ? await getRoleByUserId(req.user.id) : null;
  return res.json({ exists, role: role || undefined });
}

async function patchMe(req, res) {
  const result = await updateMyProfile(req.user.id, req.body || {});
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function postCompleteProfile(req, res) {
  const result = await completeProfile(req.user.id, req.body || {});
  if (result.error) {
    return res.status(400).json({ error: result.error, success: false });
  }
  return res.status(200).json(result.data);
}

async function getMyRole(req, res) {
  const role = await getRoleByUserId(req.user.id);
  if (!role) {
    return res.status(404).json({ error: 'Role not found' });
  }
  return res.json({ role });
}

module.exports = {
  getMe,
  getMyProfileExists,
  getMyRole,
  getUserById,
  patchMe,
  postCompleteProfile,
};
