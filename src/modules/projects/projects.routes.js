const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { createDocumentUpload } = require('../../middleware/multer');
const controller = require('./projects.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function handleDocumentUpload(req, res, next) {
  const upload = createDocumentUpload();
  upload(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
}

router.use(requireAuth);
router.post('/', handleDocumentUpload, asyncHandler(controller.create));
router.get('/', asyncHandler(controller.list));
router.get('/:id', asyncHandler(controller.getOne));
router.get('/:id/members', asyncHandler(controller.getMembers));
router.get('/:id/files', asyncHandler(controller.getFiles));

module.exports = router;
