const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { createAvatarUpload } = require('../../middleware/multer');
const { getProfile, patchProfile, uploadAvatar } = require('./user.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(requireAuth);

router.get('/profile', asyncHandler(getProfile));
router.patch('/profile', asyncHandler(patchProfile));
router.post('/avatar', createAvatarUpload(), asyncHandler(uploadAvatar));

module.exports = router;
