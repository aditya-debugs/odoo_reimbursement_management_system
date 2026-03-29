const express = require('express');
const { param, validationResult } = require('express-validator');
const { query } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Derive a human-readable "stage label" for an approval step.
 * We infer from role of approver, is_manager_step flag, or sequence_order.
 */
function deriveStageLabel(approval, approverRole, sequenceOrder, totalSteps) {
  if (approval.is_manager_step) return 'Manager Approval';
  if (approverRole === 'director') return 'Director Approval';
  if (approverRole === 'financer') return 'Finance Approval';
  if (approverRole === 'manager') return 'Manager Approval';
  // fallback by position
  if (totalSteps >= 3) {
    if (sequenceOrder === 1) return 'Manager Approval';
    if (sequenceOrder === totalSteps) return 'Director Approval';
    return 'Finance Approval';
  }
  if (totalSteps === 2) {
    return sequenceOrder === 1 ? 'Manager Approval' : 'Finance Approval';
  }
  return `Step ${sequenceOrder}`;
}

/**
 * Detect whether a pending approval step is "delayed" (past expected days).
 * We use the created_at of the approval row vs now.
 */
function isDelayed(approval, stageConfig) {
  if (approval.status !== 'pending') return false;
  const created = new Date(approval.created_at);
  const now = new Date();
  const elapsedDays = (now - created) / (1000 * 60 * 60 * 24);
  const maxDays = stageConfig?.max_days ?? 3;
  return elapsedDays > maxDays;
}

/**
 * Calculate working-day ETA from a set of remaining stage configs.
 * Skips weekends naively.
 */
function calcETA(remainingStageConfigs) {
  let minDays = 0;
  let maxDays = 0;
  let avgDays = 0;
  for (const cfg of remainingStageConfigs) {
    minDays += cfg.min_days ?? 1;
    maxDays += cfg.max_days ?? 3;
    avgDays += parseFloat(cfg.avg_days ?? 2);
  }
  return { minDays, maxDays, avgDays: Math.round(avgDays * 10) / 10 };
}

// ─── GET /api/tracking/:expenseId ────────────────────────────────────────────
// Returns full tracking data: timeline, ETA, progress, history log
router.get(
  '/:expenseId',
  auth,
  [param('expenseId').isUUID()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { expenseId } = req.params;

    try {
      // 1. Load expense
      const expRes = await query(
        `SELECT e.*, u.name AS employee_name, c.name AS category_name
         FROM expenses e
         JOIN users u ON u.id = e.employee_id
         LEFT JOIN expense_categories c ON c.id = e.category_id
         WHERE e.id = $1`,
        [expenseId]
      );
      if (!expRes.rows.length) return res.status(404).json({ message: 'Expense not found' });

      const expense = expRes.rows[0];
      if (expense.company_id !== req.user.company_id) {
        return res.status(404).json({ message: 'Not found' });
      }
      // Access control: employees can only see their own
      if (req.user.role === 'employee' && expense.employee_id !== req.user.id) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      if (req.user.role === 'manager' && expense.employee_id !== req.user.id) {
        const sub = await query(
          `SELECT id FROM users WHERE id = $1 AND manager_id = $2`,
          [expense.employee_id, req.user.id]
        );
        if (!sub.rows.length) return res.status(403).json({ message: 'Forbidden' });
      }

      // 2. Load all approval steps with approver info
      const approvalsRes = await query(
        `SELECT ea.*,
                u.name AS approver_name,
                u.role AS approver_role,
                u.email AS approver_email
         FROM expense_approvals ea
         JOIN users u ON u.id = ea.approver_id
         WHERE ea.expense_id = $1
         ORDER BY ea.sequence_order ASC, ea.created_at ASC`,
        [expenseId]
      );
      const approvals = approvalsRes.rows;
      const totalSteps = approvals.length;

      // 3. Load stage time configs (company-specific first, fall back to global)
      const stageConfigRes = await query(
        `SELECT * FROM stage_time_config
         WHERE company_id = $1 OR company_id IS NULL
         ORDER BY company_id NULLS LAST`,
        [req.user.company_id]
      );
      // Build a map: stage_name -> config (prefer company-specific)
      const stageConfigMap = {};
      for (const cfg of stageConfigRes.rows) {
        if (!stageConfigMap[cfg.stage_name]) {
          stageConfigMap[cfg.stage_name] = cfg;
        }
      }

      // 4. Build timeline steps
      const SUBMITTED_STEP = {
        id: 'submitted',
        stage_name: 'Submitted',
        status: 'completed',
        approver_name: expense.employee_name,
        approver_role: 'employee',
        sequence_order: 0,
        action_at: expense.submitted_at || expense.created_at,
        comments: null,
        is_active: false,
        is_delayed: false,
        delay_hours: 0,
      };

      const approvalSteps = approvals.map((a) => {
        const stageLabel = deriveStageLabel(a, a.approver_role, a.sequence_order, totalSteps);
        const stageConf = stageConfigMap[stageLabel] || { min_days: 1, max_days: 3, avg_days: 2 };
        const delayed = isDelayed(a, stageConf);

        // Compute how long it has been pending (hours)
        const created = new Date(a.created_at);
        const ref = a.action_at ? new Date(a.action_at) : new Date();
        const delayHours = Math.round((ref - created) / (1000 * 60 * 60));

        return {
          id: a.id,
          stage_name: stageLabel,
          status:
            a.status === 'approved'
              ? 'completed'
              : a.status === 'rejected'
              ? 'rejected'
              : a.status === 'skipped'
              ? 'skipped'
              : 'pending',
          raw_status: a.status,
          approver_name: a.approver_name,
          approver_role: a.approver_role,
          approver_email: a.approver_email,
          sequence_order: a.sequence_order,
          action_at: a.action_at,
          created_at: a.created_at,
          comments: a.comments,
          is_manager_step: a.is_manager_step,
          is_active: a.status === 'pending',
          is_delayed: delayed,
          delay_hours: delayHours,
          stage_config: {
            min_days: stageConf.min_days,
            max_days: stageConf.max_days,
            avg_days: stageConf.avg_days,
          },
        };
      });

      // Final outcome step
      let finalStep = null;
      if (expense.status === 'approved') {
        const lastApproved = [...approvals].reverse().find((a) => a.status === 'approved');
        finalStep = {
          id: 'completed',
          stage_name: 'Completed',
          status: 'completed',
          approver_name: null,
          sequence_order: totalSteps + 1,
          action_at: lastApproved?.action_at || expense.updated_at,
          comments: 'All approvals received. Reimbursement is being processed.',
          is_active: false,
          is_delayed: false,
        };
      } else if (expense.status === 'rejected') {
        const rejectedStep = approvals.find((a) => a.status === 'rejected');
        finalStep = {
          id: 'rejected',
          stage_name: 'Rejected',
          status: 'rejected',
          approver_name: rejectedStep?.approver_name || null,
          sequence_order: totalSteps + 1,
          action_at: rejectedStep?.action_at || expense.updated_at,
          comments: rejectedStep?.comments || 'Rejected.',
          is_active: false,
          is_delayed: false,
        };
      } else if (expense.status === 'cancelled') {
        finalStep = {
          id: 'cancelled',
          stage_name: 'Cancelled',
          status: 'cancelled',
          approver_name: null,
          sequence_order: totalSteps + 1,
          action_at: expense.updated_at,
          comments: 'This expense was cancelled by the employee.',
          is_active: false,
          is_delayed: false,
        };
      }

      const timelineSteps = [SUBMITTED_STEP, ...approvalSteps];
      if (finalStep) timelineSteps.push(finalStep);

      // 5. Calculate progress
      const completedCount = approvals.filter(
        (a) => a.status === 'approved' || a.status === 'rejected'
      ).length;
      const totalApprovalSteps = approvals.filter((a) => a.status !== 'skipped').length;
      const progressPct =
        expense.status === 'approved' || expense.status === 'rejected' || expense.status === 'cancelled'
          ? 100
          : totalApprovalSteps > 0
          ? Math.round((completedCount / totalApprovalSteps) * 100)
          : 0;

      // 6. Calculate ETA (remaining stages only)
      const remainingApprovals = approvals.filter((a) => a.status === 'pending' || a.status === 'skipped');
      const remainingConfigs = remainingApprovals.map((a) => {
        const stageLabel = deriveStageLabel(a, a.approver_role, a.sequence_order, totalSteps);
        return stageConfigMap[stageLabel] || { min_days: 1, max_days: 3, avg_days: 2 };
      });
      const eta = expense.status === 'pending' ? calcETA(remainingConfigs) : null;

      // 7. Determine current active stage label
      const currentActiveStep = approvalSteps.find((s) => s.is_active);
      const currentStageLabel = currentActiveStep
        ? `Currently with ${currentActiveStep.stage_name.replace(' Approval', ' Team')}`
        : expense.status === 'approved'
        ? 'Fully Approved'
        : expense.status === 'rejected'
        ? 'Rejected'
        : 'Cancelled';

      // 8. History log (audit-light) — all actioned steps
      const historyLog = approvals
        .filter((a) => a.action_at)
        .sort((a, b) => new Date(a.action_at) - new Date(b.action_at))
        .map((a) => {
          const stageLabel = deriveStageLabel(a, a.approver_role, a.sequence_order, totalSteps);
          return {
            actor: a.approver_name,
            actor_role: a.approver_role,
            stage: stageLabel,
            action: a.status,
            timestamp: a.action_at,
            comments: a.comments,
          };
        });

      // 9. Average processing time across company (for bonus stats)
      const avgRes = await query(
        `SELECT AVG(EXTRACT(EPOCH FROM (ea.action_at - ea.created_at)) / 86400)::numeric(5,2) AS avg_processing_days
         FROM expense_approvals ea
         JOIN expenses e ON e.id = ea.expense_id
         WHERE e.company_id = $1
           AND ea.action_at IS NOT NULL
           AND ea.status IN ('approved', 'rejected')`,
        [req.user.company_id]
      );
      const avgProcessingDays = avgRes.rows[0]?.avg_processing_days
        ? parseFloat(avgRes.rows[0].avg_processing_days)
        : null;

      return res.json({
        expense: {
          id: expense.id,
          title: expense.title,
          amount: expense.amount,
          currency_code: expense.currency_code,
          amount_in_company_currency: expense.amount_in_company_currency,
          status: expense.status,
          submitted_at: expense.submitted_at || expense.created_at,
          employee_name: expense.employee_name,
          category_name: expense.category_name,
          description: expense.description,
        },
        timeline: timelineSteps,
        progress: {
          percent: progressPct,
          completed_steps: completedCount,
          total_steps: totalApprovalSteps,
        },
        eta,
        current_stage_label: currentStageLabel,
        history_log: historyLog,
        avg_processing_days: avgProcessingDays,
        has_delay: approvalSteps.some((s) => s.is_delayed),
      });
    } catch (err) {
      console.error('Tracking error:', err);
      return res.status(500).json({ message: 'Failed to load tracking data' });
    }
  }
);

// ─── GET /api/tracking/:expenseId/stage-config ────────────────────────────────
// Returns stage time configurations for editing by admin
router.get('/:expenseId/stage-config', auth, [param('expenseId').isUUID()], async (req, res) => {
  try {
    const cfgRes = await query(
      `SELECT * FROM stage_time_config WHERE company_id = $1 OR company_id IS NULL ORDER BY stage_name`,
      [req.user.company_id]
    );
    return res.json(cfgRes.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load stage config' });
  }
});

module.exports = router;
