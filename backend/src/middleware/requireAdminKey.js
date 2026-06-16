const requireAdminKey = (req, res, next) => {
  const adminKey = process.env.ADMIN_API_KEY || 'super-secret-admin-key';
  const provided = req.headers['x-admin-key'];
  if (!provided || provided !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
};

module.exports = { requireAdminKey };
