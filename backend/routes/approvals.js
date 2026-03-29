const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query, withTransaction } = require('../db');
const auth = require('../middleware/auth');
const rolesMiddleware = require('../middleware/roles');
const { processApprovalAction } = require('../services/approval.service');
const { appendAuditBlockQuery } = require('../services/audit.service');

const router = express.Router();

router.get('/pending', auth, rolesMiddleware.canAccessApprovals, async (req, res) => {
  try {
    let sql;
    let params;
    if (req.user.role === 'admin') {
      sql = `
        SELECT ea.*, e.title, e.amount, e.currency_code, e.amount_in_company_currency, e.expense_date,
               e.status as expense_status, e.employee_id, u.name as employee_name, e.receipt_url
        FROM expense_approvals ea
        JOIN expenses e ON e.id = ea.expense_id
        JOIN users u ON u.id = e.employee_id
        WHERE e.company_id = $1 AND ea.status = 'pending' AND e.status = 'pending'
        ORDER BY ea.created_at ASC`;
      params = [req.user.company_id];
    } else {
      sql = `
        SELECT ea.*, e.title, e.amount, e.currency_code, e.amount_in_company_currency, e.expense_date,
               e.status as expense_status, e.employee_id, u.name as employee_name, e.receipt_url
        FROM expense_approvals ea
        JOIN expenses e ON e.id = ea.expense_id
        JOIN users u ON u.id = e.employee_id
        WHERE ea.approver_id = $1 AND e.company_id = $2 AND ea.status = 'pending' AND e.status = 'pending'
        ORDER BY ea.created_at ASC`;
      params = [req.user.id, req.user.company_id];
    }
    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load pending approvals' });
  }
});

router.post(
  '/:id/action',
  auth,
  rolesMiddleware.canAccessApprovals,
  [
    param('id').isUUID(),
    body('action').isIn(['approve', 'reject']),
    body('comments').trim().notEmpty().withMessage('Comment is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { action, comments } = req.body;
    const expenseApprovalId = req.params.id;

    try {
      const result = await withTransaction((client) =>
        processApprovalAction(client, {
          expenseApprovalId,
          userId: req.user.id,
          userRole: req.user.role,
          companyId: req.user.company_id,
          action,
          comments,
        })
      );
      await appendAuditBlockQuery({
        companyId: req.user.company_id,
        action: action === 'approve' ? 'approval_approve' : 'approval_reject',
        actorId: req.user.id,
        expenseId: result.expenseId,
        payload: { expenseApprovalId, expenseStatus: result.expenseStatus },
      });
      return res.json(result);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      return res.status(status).json({ message: err.message || 'Action failed' });
    }
  }
);

module.exports = router;
