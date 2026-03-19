const {
  getMeetingById,
  getMeetingsByAdviser,
  getMeetingsByProject,
  getMeetingsForUser,
  getMeetingsByDateRange,
  createMeeting,
  updateMeeting,
  cancelMeeting,
  completeMeeting,
  rescheduleMeeting,
} = require('./calendar.service');

/**
 * GET /meetings/:id
 * Retrieves a single meeting by ID
 */
async function getMeeting(req, res) {
  try {
    const { id } = req.params;
    const meeting = await getMeetingById(id);

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    return res.json(meeting);
  } catch (err) {
    console.error('[calendar] error fetching meeting:', err.message);
    return res.status(500).json({ error: 'Failed to fetch meeting' });
  }
}

/**
 * GET /meetings/my
 * Retrieves all meetings for the authenticated user
 */
async function getMyMeetings(req, res) {
  try {
    const { status, defense_type, from_date, to_date } = req.query;

    const meetings = await getMeetingsByAdviser(req.user.id, {
      status,
      defense_type,
      from_date,
      to_date,
    });

    return res.json(meetings);
  } catch (err) {
    console.error('[calendar] error fetching user meetings:', err.message);
    return res.status(500).json({ error: 'Failed to fetch meetings' });
  }
}

/**
 * GET /meetings/user/:userId
 * Retrieves all meetings for a specific user
 */
async function getUserMeetings(req, res) {
  try {
    const { userId } = req.params;
    const meetings = await getMeetingsForUser(userId);

    return res.json(meetings);
  } catch (err) {
    console.error('[calendar] error fetching user meetings:', err.message);
    return res.status(500).json({ error: 'Failed to fetch meetings' });
  }
}

/**
 * GET /meetings/adviser/:adviserId
 * Retrieves all meetings for a specific adviser
 */
async function getAdviserMeetings(req, res) {
  try {
    const { adviserId } = req.params;
    const { status, defense_type, from_date, to_date } = req.query;

    const meetings = await getMeetingsByAdviser(adviserId, {
      status,
      defense_type,
      from_date,
      to_date,
    });

    return res.json(meetings);
  } catch (err) {
    console.error('[calendar] error fetching adviser meetings:', err.message);
    return res.status(500).json({ error: 'Failed to fetch meetings' });
  }
}

/**
 * GET /meetings/project/:projectId
 * Retrieves all meetings for a specific project
 */
async function getProjectMeetings(req, res) {
  try {
    const { projectId } = req.params;
    const meetings = await getMeetingsByProject(projectId);

    return res.json(meetings);
  } catch (err) {
    console.error('[calendar] error fetching project meetings:', err.message);
    return res.status(500).json({ error: 'Failed to fetch meetings' });
  }
}

/**
 * GET /meetings/range
 * Retrieves meetings within a date range
 * Query params: start_date, end_date, adviser_id (optional)
 */
async function getMeetingsByRange(req, res) {
  try {
    const { start_date, end_date, adviser_id } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        error: 'Missing required query parameters: start_date, end_date',
      });
    }

    const meetings = await getMeetingsByDateRange(start_date, end_date, adviser_id);
    return res.json(meetings);
  } catch (err) {
    console.error('[calendar] error fetching meetings by range:', err.message);
    return res.status(500).json({ error: 'Failed to fetch meetings' });
  }
}

/**
 * POST /meetings
 * Creates a new meeting
 */
async function postMeeting(req, res) {
  try {
    const {
      project_id,
      defense_type,
      scheduled_at,
      end_time,
      location,
      rubric_id,
      adviser_id,
    } = req.body;

    if (!project_id || !defense_type || !scheduled_at) {
      return res.status(400).json({
        error: 'Missing required fields: project_id, defense_type, scheduled_at',
      });
    }

    const meeting = await createMeeting({
      project_id,
      defense_type,
      scheduled_at,
      end_time,
      location,
      rubric_id,
      adviser_id,
      created_by: req.user.id,
    });

    return res.status(201).json(meeting);
  } catch (err) {
    console.error('[calendar] error creating meeting:', err.message);
    return res.status(500).json({ error: 'Failed to create meeting' });
  }
}

/**
 * PATCH /meetings/:id
 * Updates a meeting
 */
async function patchMeeting(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    const meeting = await getMeetingById(id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const updated = await updateMeeting(id, updates);
    return res.json(updated);
  } catch (err) {
    console.error('[calendar] error updating meeting:', err.message);
    return res.status(500).json({ error: 'Failed to update meeting' });
  }
}

/**
 * PATCH /meetings/:id/cancel
 * Cancels a meeting
 */
async function patchCancelMeeting(req, res) {
  try {
    const { id } = req.params;

    const meeting = await getMeetingById(id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const updated = await cancelMeeting(id);
    return res.json({
      success: true,
      message: 'Meeting cancelled',
      meeting: updated,
    });
  } catch (err) {
    console.error('[calendar] error cancelling meeting:', err.message);
    return res.status(500).json({ error: 'Failed to cancel meeting' });
  }
}

/**
 * PATCH /meetings/:id/complete
 * Marks a meeting as completed
 */
async function patchCompleteMeeting(req, res) {
  try {
    const { id } = req.params;

    const meeting = await getMeetingById(id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const updated = await completeMeeting(id);
    return res.json({
      success: true,
      message: 'Meeting marked as completed',
      meeting: updated,
    });
  } catch (err) {
    console.error('[calendar] error completing meeting:', err.message);
    return res.status(500).json({ error: 'Failed to complete meeting' });
  }
}

/**
 * PATCH /meetings/:id/reschedule
 * Reschedules a meeting
 */
async function patchRescheduleMeeting(req, res) {
  try {
    const { id } = req.params;
    const { scheduled_at, end_time } = req.body;

    if (!scheduled_at) {
      return res.status(400).json({ error: 'Missing required field: scheduled_at' });
    }

    const meeting = await getMeetingById(id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const updated = await rescheduleMeeting(id, scheduled_at, end_time);
    return res.json({
      success: true,
      message: 'Meeting rescheduled',
      meeting: updated,
    });
  } catch (err) {
    console.error('[calendar] error rescheduling meeting:', err.message);
    return res.status(500).json({ error: 'Failed to reschedule meeting' });
  }
}

module.exports = {
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
};