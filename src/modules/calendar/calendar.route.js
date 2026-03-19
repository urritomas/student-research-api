const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const {
  getMeeting,
  getMyMeetings,
  getUserMeetings,
  getAdviserMeetings,
  getProjectMeetings,
  getMeetingsByRange,
  postMeeting,
  patchMeeting,
  patchCancelMeeting,
  patchCompleteMeeting,
  patchRescheduleMeeting,
} = require('./calendar.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(requireAuth);

// GET endpoints
router.get('/range', asyncHandler(getMeetingsByRange));
router.get('/my', asyncHandler(getMyMeetings));
router.get('/adviser/:adviserId', asyncHandler(getAdviserMeetings));
router.get('/project/:projectId', asyncHandler(getProjectMeetings));
router.get('/user/:userId', asyncHandler(getUserMeetings));
router.get('/:id', asyncHandler(getMeeting));

// POST endpoint
router.post('/', asyncHandler(postMeeting));

// PATCH endpoints
router.patch('/:id', asyncHandler(patchMeeting));
router.patch('/:id/cancel', asyncHandler(patchCancelMeeting));
router.patch('/:id/complete', asyncHandler(patchCompleteMeeting));
router.patch('/:id/reschedule', asyncHandler(patchRescheduleMeeting));

module.exports = router;
