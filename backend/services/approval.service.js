const { createNotification } = require('../lib/notify');

const getActiveRule = async (client, companyId) => {
  const r = await client.query(
    `SELECT * FROM approval_rules WHERE company_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`,
    [companyId]
  );
  return r.rows[0] || null;
};

const getRuleSteps = async (client, ruleId) => {
  const r = await client.query(
    `SELECT s.* FROM approval_rule_steps s WHERE s.rule_id = $1 ORDER BY s.step_order ASC`,
    [ruleId]
  );
  return r.rows;
};

const createApprovalRecords = async (client, expenseId, rule, steps) => {
  if (!steps.length) return;

  const isSequential = rule.rule_type === 'sequential';
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const seq = i + 1;
    const status = isSequential && seq > 1 ? 'skipped' : 'pending';
    await client.query(
      `INSERT INTO expense_approvals (expense_id, approver_id, rule_step_id, sequence_order, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [expenseId, step.approver_id, step.id, seq, status]
    );
  }

  if (isSequential) {
    await client.query(`UPDATE expenses SET current_approver_sequence = 1 WHERE id = $1`, [expenseId]);
  } else {
    await client.query(`UPDATE expenses SET current_approver_sequence = 0 WHERE id = $1`, [expenseId]);
  }
};

const notifyApproversForNewExpense = async (client, expenseId, ruleType, steps, submitterName, title) => {
  if (ruleType === 'sequential' && steps.length) {
    await createNotification(client, {
      userId: steps[0].approver_id,
      expenseId,
      title: 'Expense pending your approval',
      message: `${submitterName} submitted "${title}" — your action is required.`,
    });
    return;
  }
  for (const s of steps) {
    await createNotification(client, {
      userId: s.approver_id,
      expenseId,
      title: 'Expense pending your approval',
      message: `${submitterName} submitted "${title}" — please review.`,
    });
  }
};

const startWorkflowForExpense = async (client, expense, companyId, submitterName) => {
  const rule = await getActiveRule(client, companyId);
  if (!rule) {
    await client.query(`UPDATE expenses SET status = 'approved', current_approver_sequence = 0 WHERE id = $1`, [
      expense.id,
    ]);
    await createNotification(client, {
      userId: expense.employee_id,
      expenseId: expense.id,
      title: 'Expense auto-approved',
      message: 'No approval rule is configured; your expense was approved automatically.',
    });
    return;
  }

  const steps = await getRuleSteps(client, rule.id);
  if (!steps.length) {
    await client.query(`UPDATE expenses SET status = 'approved', current_approver_sequence = 0 WHERE id = $1`, [
      expense.id,
    ]);
    await createNotification(client, {
      userId: expense.employee_id,
      expenseId: expense.id,
      title: 'Expense auto-approved',
      message: 'Approval rule has no steps; your expense was approved automatically.',
    });
    return;
  }

  await createApprovalRecords(client, expense.id, rule, steps);
  await notifyApproversForNewExpense(client, expense.id, rule.rule_type, steps, submitterName, expense.title);
};

const finalizeReject = async (client, expenseId, employeeId) => {
  await client.query(`UPDATE expenses SET status = 'rejected' WHERE id = $1`, [expenseId]);
  await client.query(
    `UPDATE expense_approvals SET status = 'skipped', updated_at = NOW()
     WHERE expense_id = $1 AND status = 'pending'`,
    [expenseId]
  );
  await createNotification(client, {
    userId: employeeId,
    expenseId,
    title: 'Expense rejected',
    message: 'Your expense claim was rejected.',
  });
};

const finalizeApprove = async (client, expenseId, employeeId) => {
  await client.query(`UPDATE expenses SET status = 'approved' WHERE id = $1`, [expenseId]);
  await client.query(
    `UPDATE expense_approvals SET status = 'skipped', updated_at = NOW()
     WHERE expense_id = $1 AND status = 'pending'`,
    [expenseId]
  );
  await createNotification(client, {
    userId: employeeId,
    expenseId,
    title: 'Expense approved',
    message: 'Your expense claim was fully approved.',
  });
};

const activateNextSequential = async (client, expenseId, nextSeq) => {
  const next = await client.query(
    `SELECT id, approver_id FROM expense_approvals WHERE expense_id = $1 AND sequence_order = $2`,
    [expenseId, nextSeq]
  );
  if (!next.rows.length) return false;
  await client.query(`UPDATE expense_approvals SET status = 'pending', updated_at = NOW() WHERE id = $1`, [
    next.rows[0].id,
  ]);
  await client.query(`UPDATE expenses SET current_approver_sequence = $2 WHERE id = $1`, [expenseId, nextSeq]);
  const exp = await client.query(`SELECT title FROM expenses WHERE id = $1`, [expenseId]);
  await createNotification(client, {
    userId: next.rows[0].approver_id,
    expenseId,
    title: 'Expense pending your approval',
    message: `"${exp.rows[0].title}" — your turn to approve (step ${nextSeq}).`,
  });
  return true;
};

const processSequentialApprove = async (client, expense, eaRow, comments) => {
  const seq = eaRow.sequence_order;
  await client.query(
    `UPDATE expense_approvals SET status = 'approved', action_at = NOW(), comments = $2 WHERE id = $1`,
    [eaRow.id, comments || null]
  );
  const hasNext = await activateNextSequential(client, expense.id, seq + 1);
  if (!hasNext) {
    await finalizeApprove(client, expense.id, expense.employee_id);
  }
};

const countApprovalProgress = async (client, expenseId) => {
  const r = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
       COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
       COUNT(*)::int AS total
     FROM expense_approvals WHERE expense_id = $1`,
    [expenseId]
  );
  return r.rows[0];
};

const processParallelApprove = async (client, expense, rule, eaRow, userId, comments) => {
  await client.query(
    `UPDATE expense_approvals SET status = 'approved', action_at = NOW(), comments = $2 WHERE id = $1`,
    [eaRow.id, comments || null]
  );

  const specificId = rule.specific_approver_id;
  const threshold = rule.percentage_threshold != null ? parseFloat(rule.percentage_threshold) : null;

  if (rule.rule_type === 'specific_approver') {
    if (specificId && userId === specificId) {
      await finalizeApprove(client, expense.id, expense.employee_id);
    }
    return;
  }

  if (rule.rule_type === 'hybrid' && specificId && userId === specificId) {
    await finalizeApprove(client, expense.id, expense.employee_id);
    return;
  }

  const prog = await countApprovalProgress(client, expense.id);
  const usePct = rule.rule_type === 'percentage' || rule.rule_type === 'hybrid';
  if (!usePct) return;

  const need = threshold != null ? Math.max(1, Math.ceil((threshold / 100) * prog.total)) : prog.total;
  if (prog.approved >= need) {
    await finalizeApprove(client, expense.id, expense.employee_id);
    return;
  }

  if (prog.pending === 0 && prog.approved < need) {
    await finalizeReject(client, expense.id, expense.employee_id);
  }
};

const processApprovalAction = async (client, { expenseApprovalId, userId, userRole, companyId, action, comments }) => {
  const eaRes = await client.query(
    `SELECT ea.*, e.employee_id, e.company_id, e.status AS expense_status, e.title, e.current_approver_sequence
     FROM expense_approvals ea
     JOIN expenses e ON e.id = ea.expense_id
     WHERE ea.id = $1`,
    [expenseApprovalId]
  );
  if (!eaRes.rows.length) {
    const err = new Error('Approval record not found');
    err.status = 404;
    throw err;
  }
  const ea = eaRes.rows[0];
  if (ea.company_id !== companyId) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  if (ea.expense_status !== 'pending') {
    const err = new Error('Expense is not pending');
    err.status = 400;
    throw err;
  }
  const adminOverride = userRole === 'admin';
  if (ea.approver_id !== userId && !adminOverride) {
    const err = new Error('Not your approval to action');
    err.status = 403;
    throw err;
  }
  if (ea.status !== 'pending') {
    const err = new Error('Already actioned');
    err.status = 400;
    throw err;
  }

  const rule = await getActiveRule(client, ea.company_id);
  if (!rule) {
    const err = new Error('No active approval rule');
    err.status = 400;
    throw err;
  }

  if (action === 'reject') {
    await client.query(
      `UPDATE expense_approvals SET status = 'rejected', action_at = NOW(), comments = $2 WHERE id = $1`,
      [expenseApprovalId, comments || null]
    );
    await client.query(
      `UPDATE expense_approvals SET status = 'skipped', updated_at = NOW()
       WHERE expense_id = $1 AND id != $2 AND status = 'pending'`,
      [ea.expense_id, expenseApprovalId]
    );
    await finalizeReject(client, ea.expense_id, ea.employee_id);
    return { ok: true, expenseStatus: 'rejected' };
  }

  const expense = {
    id: ea.expense_id,
    employee_id: ea.employee_id,
    title: ea.title,
  };

  if (rule.rule_type === 'sequential') {
    const cur = ea.current_approver_sequence != null ? ea.current_approver_sequence : 1;
    if (!adminOverride && ea.sequence_order !== cur) {
      const err = new Error('Not your turn in the approval sequence');
      err.status = 400;
      throw err;
    }
    await processSequentialApprove(client, { ...expense, id: ea.expense_id }, ea, comments);
    const updated = await client.query(`SELECT status FROM expenses WHERE id = $1`, [ea.expense_id]);
    return { ok: true, expenseStatus: updated.rows[0].status };
  }

  const actorId = ea.approver_id;
  await processParallelApprove(client, expense, rule, ea, actorId, comments);
  const updated = await client.query(`SELECT status FROM expenses WHERE id = $1`, [ea.expense_id]);
  return { ok: true, expenseStatus: updated.rows[0].status };
};

module.exports = {
  getActiveRule,
  getRuleSteps,
  startWorkflowForExpense,
  processApprovalAction,
};
