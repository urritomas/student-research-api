const { createDefense, getDefensesByUser } = require('./defenses.service');

async function postDefense(req, res) {
  const result = await createDefense(req.user.id, req.body || {});
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  return res.status(201).json(result.data);
}

async function getMyDefenses(req, res) {
  const defenses = await getDefensesByUser(req.user.id);
  return res.json(defenses);
}

module.exports = { postDefense, getMyDefenses };