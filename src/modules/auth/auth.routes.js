const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const {
  register,
  login,
  getMe,
  logout,
  oAuthRedirect,
  googleCallback,
} = require('./auth.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));
router.post('/logout', asyncHandler(logout));
router.get('/me', requireAuth, asyncHandler(getMe));
router.post('/oauth', asyncHandler(oAuthRedirect));
router.get('/google/callback', asyncHandler(googleCallback));

module.exports = router;
