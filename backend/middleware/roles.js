const APPROVER_ROLES = ['admin', 'manager', 'financer', 'director'];
const ANALYTICS_ROLES = ['admin', 'manager', 'financer', 'director'];

function roles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: `Access denied. Requires one of: ${allowedRoles.join(', ')}` });
    }
    next();
  };
}

roles.canAccessApprovals = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
  if (!APPROVER_ROLES.includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied' });
  }
  next();
};

roles.canAccessAnalytics = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
  if (!ANALYTICS_ROLES.includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied' });
  }
  next();
};

roles.APPROVER_ROLES = APPROVER_ROLES;
roles.ANALYTICS_ROLES = ANALYTICS_ROLES;

module.exports = roles;
