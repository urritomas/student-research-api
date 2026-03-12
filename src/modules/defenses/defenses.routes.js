const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { postDefense, getMyDefenses, getMyProjectDefenses } = require('./defenses.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(requireAuth);

router.post('/', asyncHandler(postDefense));
router.get('/me', asyncHandler(getMyDefenses));
router.get('/my-projects', asyncHandler(getMyProjectDefenses));

module.exports = router;