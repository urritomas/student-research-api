const { createDefense, getDefensesByUser, cancelDefense } = require('./defenses.service');

async function postDefense(req, res) {
  const result = await createDefense(req.user.id, req.body || {});
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.status(201).json(result.data);
}

async function getMyDefenses(req, res) {
  const defenses = await getDefensesByUser(req.user.id);
  return res.json(defenses);
}

async function patchCancelDefense(req, res) {
  const result = await cancelDefense(req.user.id, req.params.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json({
    success: true,
    message: 'Meeting cancelled',
    defense: result.data,
  });
}

module.exports = { postDefense, getMyDefenses, patchCancelDefense };