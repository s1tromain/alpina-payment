// Deprecated: webhook logic has been split into webhook-mod.js and webhook-user.js.
// This stub remains to avoid errors if the old endpoint receives stray requests.

module.exports = async (req, res) => {
  return res.status(200).json({ ok: true, notice: 'Use /api/webhook-mod or /api/webhook-user' });
};

module.exports.config = {
  api: { bodyParser: false }
};
