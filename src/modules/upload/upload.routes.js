const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { createAvatarUpload } = require('../../middleware/multer');
const { uploadAvatar, uploadCropped } = require('./upload.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function handleAvatarUpload(req, res, next) {
  const upload = createAvatarUpload();
  upload(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
}

router.post('/avatar', requireAuth, handleAvatarUpload, asyncHandler(uploadAvatar));
// Accept a cropped image as base64 JSON payload
router.post('/avatar-cropped', requireAuth, asyncHandler(uploadCropped));

module.exports = router;
