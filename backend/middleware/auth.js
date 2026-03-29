const jwt = require('jsonwebtoken');
const { query } = require('../db');

const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await query(
      'SELECT id, name, email, role, company_id, manager_id, is_manager_approver, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(401).json({ message: 'User not found or inactive' });
    }
    req.user = result.rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ message: 'Token expired' });
    return res.status(401).json({ message: 'Invalid token' });
  }
};

module.exports = auth;
