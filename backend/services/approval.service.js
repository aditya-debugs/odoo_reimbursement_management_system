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

const loadSnapshot = async (client, expenseId) => {
  const r = await client.query(`SELECT * FROM expense_workflow_snapshots WHERE expense_id = $1`, [expenseId]);
  return r.rows[0] || null;
};

const isParallelType = (ruleType) =>
  ruleType === 'percentage' || ruleType === 'specific_approver' || ruleType === 'hybrid';

/** Build ordered steps JSON and persist snapshot; insert expense_approvals */
const createWorkflowFromRule = async (client, expense, companyId, submitterId, submitterName) => {
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
    return { autoApproved: true };
  }

  const dbSteps = await getRuleSteps(client, rule.id);
  if (!dbSteps.length) {
    await client.query(`UPDATE expenses SET status = 'approved', current_approver_sequence = 0 WHERE id = $1`, [
      expense.id,
    ]);
    await createNotification(client, {
      userId: expense.employee_id,
      expenseId: expense.id,
      title: 'Expense auto-approved',
      message: 'Approval rule has no steps; your expense was approved automatically.',
    });
    return { autoApproved: true };
  }

  const empRes = await client.query(
    `SELECT u.manager_id, m.is_manager_approver
     FROM users u
     LEFT JOIN users m ON m.id = u.manager_id AND m.company_id = u.company_id
     WHERE u.id = $1`,
    [submitterId]
  );
  const emp = empRes.rows[0];
  let managerPrepended = false;
  let ordered = dbSteps.map((s) => ({
    approver_id: s.approver_id,
    rule_step_id: s.id,
    step_order: s.step_order,
    is_manager_step: false,
  }));

  if (emp?.manager_id && emp.is_manager_approver) {
    managerPrepended = true;
    ordered = [
      {
        approver_id: emp.manager_id,
        rule_step_id: null,
        step_order: 0,
        is_manager_step: true,
      },
      ...ordered.map((s) => ({ ...s, step_order: s.step_order + 1 })),
    ];
  } else {
    ordered = ordered.map((s) => ({ ...s, step_order: s.step_order }));
  }

  const snapSteps = ordered.map((s, idx) => ({
    approver_id: s.approver_id,
    rule_step_id: s.rule_step_id,
    step_order: idx + 1,
    is_manager_step: s.is_manager_step,
  }));

  await client.query(
    `INSERT INTO expense_workflow_snapshots (
      expense_id, company_id, rule_id, rule_type, manager_prepended, sequential_conditional_override,
      percentage_threshold, specific_approver_id, steps
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      expense.id,
      companyId,
      rule.id,
      rule.rule_type,
      managerPrepended,
      Boolean(rule.sequential_conditional_override),
      rule.percentage_threshold != null ? parseFloat(rule.percentage_threshold) : null,
      rule.specific_approver_id || null,
      JSON.stringify(snapSteps),
    ]
  );

  const snapshot = {
    rule_type: rule.rule_type,
    manager_prepended: managerPrepended,
    sequential_conditional_override: Boolean(rule.sequential_conditional_override),
    percentage_threshold: rule.percentage_threshold != null ? parseFloat(rule.percentage_threshold) : null,
    specific_approver_id: rule.specific_approver_id || null,
    steps: snapSteps,
  };

  await insertApprovalRows(client, expense.id, snapshot);
  await notifyApproversForNewExpense(client, expense.id, snapshot, submitterName, expense.title);
  return { autoApproved: false };
};

const insertApprovalRows = async (client, expenseId, snapshot) => {
  const steps = [...snapshot.steps].sort((a, b) => a.step_order - b.step_order);
  const isSeq = snapshot.rule_type === 'sequential';
  const parallel = isParallelType(snapshot.rule_type);

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    let status = 'pending';
    if (isSeq) {
      status = s.step_order === 1 ? 'pending' : 'skipped';
    } else if (parallel && snapshot.manager_prepended) {
      status = s.is_manager_step ? 'pending' : 'skipped';
    } else if (parallel) {
      status = 'pending';
    }
    await client.query(
      `INSERT INTO expense_approvals (expense_id, approver_id, rule_step_id, sequence_order, status, is_manager_step)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [expenseId, s.approver_id, s.rule_step_id, s.step_order, status, Boolean(s.is_manager_step)]
    );
  }

  if (isSeq) {
    await client.query(`UPDATE expenses SET current_approver_sequence = 1 WHERE id = $1`, [expenseId]);
  } else {
    await client.query(`UPDATE expenses SET current_approver_sequence = 0 WHERE id = $1`, [expenseId]);
  }
};

const notifyApproversForNewExpense = async (client, expenseId, _snapshot, submitterName, title) => {
  const pending = await client.query(
    `SELECT approver_id FROM expense_approvals WHERE expense_id = $1 AND status = 'pending'`,
    [expenseId]
  );
  for (const row of pending.rows) {
    await createNotification(client, {
      userId: row.approver_id,
      expenseId,
      title: 'Expense pending your approval',
      message: `${submitterName} submitted "${title}" — your action is required.`,
    });
  }
};

const startWorkflowForExpense = async (client, expense, companyId, submitterName) => {
  return createWorkflowFromRule(client, expense, companyId, expense.employee_id, submitterName);
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

const unlockParallelSkipped = async (client, expenseId) => {
  await client.query(
    `UPDATE expense_approvals SET status = 'pending', updated_at = NOW()
     WHERE expense_id = $1 AND status = 'skipped'`,
    [expenseId]
  );
  const exp = await client.query(`SELECT title FROM expenses WHERE id = $1`, [expenseId]);
  const pending = await client.query(
    `SELECT approver_id FROM expense_approvals WHERE expense_id = $1 AND status = 'pending'`,
    [expenseId]
  );
  for (const row of pending.rows) {
    await createNotification(client, {
      userId: row.approver_id,
      expenseId,
      title: 'Expense pending your approval',
      message: `"${exp.rows[0].title}" — please review.`,
    });
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

const evaluateSequentialConditional = async (client, expenseId, snapshot, actorApproverId) => {
  if (!snapshot.sequential_conditional_override) return false;
  const spec = snapshot.specific_approver_id;
  const threshold = snapshot.percentage_threshold != null ? parseFloat(snapshot.percentage_threshold) : null;

  if (spec && actorApproverId === spec) {
    return true;
  }

  const prog = await countApprovalProgress(client, expenseId);
  if (threshold != null && prog.total > 0) {
    const need = Math.max(1, Math.ceil((threshold / 100) * prog.total));
    if (prog.approved >= need) return true;
  }
  return false;
};

const processSequentialApprove = async (client, expense, eaRow, comments, snapshot) => {
  const seq = eaRow.sequence_order;
  await client.query(
    `UPDATE expense_approvals SET status = 'approved', action_at = NOW(), comments = $2 WHERE id = $1`,
    [eaRow.id, comments || null]
  );

  const triggered = await evaluateSequentialConditional(client, expense.id, snapshot, eaRow.approver_id);
  if (triggered) {
    await finalizeApprove(client, expense.id, expense.employee_id);
    return;
  }

  const hasNext = await activateNextSequential(client, expense.id, seq + 1);
  if (!hasNext) {
    await finalizeApprove(client, expense.id, expense.employee_id);
  }
};

const processParallelApprove = async (client, expense, snapshot, eaRow, actorId, comments) => {
  await client.query(
    `UPDATE expense_approvals SET status = 'approved', action_at = NOW(), comments = $2 WHERE id = $1`,
    [eaRow.id, comments || null]
  );

  const ruleType = snapshot.rule_type;
  const specificId = snapshot.specific_approver_id;
  const threshold = snapshot.percentage_threshold != null ? parseFloat(snapshot.percentage_threshold) : null;

  if (ruleType === 'specific_approver') {
    if (specificId && actorId === specificId) {
      await finalizeApprove(client, expense.id, expense.employee_id);
    }
    return;
  }

  if (ruleType === 'hybrid' && specificId && actorId === specificId) {
    await finalizeApprove(client, expense.id, expense.employee_id);
    return;
  }

  const prog = await countApprovalProgress(client, expense.id);
  const usePct = ruleType === 'percentage' || ruleType === 'hybrid';
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

  let snapshotRow = await loadSnapshot(client, ea.expense_id);
  let snap;
  if (!snapshotRow) {
    const rule = await getActiveRule(client, ea.company_id);
    if (!rule) {
      const err = new Error('No workflow snapshot and no active rule');
      err.status = 400;
      throw err;
    }
    snap = {
      rule_type: rule.rule_type,
      manager_prepended: false,
      sequential_conditional_override: Boolean(rule.sequential_conditional_override),
      percentage_threshold: rule.percentage_threshold != null ? parseFloat(rule.percentage_threshold) : null,
      specific_approver_id: rule.specific_approver_id || null,
      steps: [],
    };
  } else {
    snap = {
      rule_type: snapshotRow.rule_type,
      manager_prepended: snapshotRow.manager_prepended,
      sequential_conditional_override: snapshotRow.sequential_conditional_override,
      percentage_threshold:
        snapshotRow.percentage_threshold != null ? parseFloat(snapshotRow.percentage_threshold) : null,
      specific_approver_id: snapshotRow.specific_approver_id || null,
      steps: typeof snapshotRow.steps === 'string' ? JSON.parse(snapshotRow.steps) : snapshotRow.steps,
    };
  }

  if (action === 'reject') {
    if (snap.rule_type === 'sequential') {
      const cur = ea.current_approver_sequence != null ? ea.current_approver_sequence : 1;
      if (!adminOverride && ea.sequence_order !== cur) {
        const err = new Error('Not your turn in the approval sequence');
        err.status = 400;
        throw err;
      }
    }
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
    return { ok: true, expenseStatus: 'rejected', expenseId: ea.expense_id };
  }

  const expense = {
    id: ea.expense_id,
    employee_id: ea.employee_id,
    title: ea.title,
  };

  if (snap.rule_type === 'sequential') {
    const cur = ea.current_approver_sequence != null ? ea.current_approver_sequence : 1;
    if (!adminOverride && ea.sequence_order !== cur) {
      const err = new Error('Not your turn in the approval sequence');
      err.status = 400;
      throw err;
    }
    await processSequentialApprove(client, { ...expense, id: ea.expense_id }, ea, comments, snap);
    const updated = await client.query(`SELECT status FROM expenses WHERE id = $1`, [ea.expense_id]);
    return { ok: true, expenseStatus: updated.rows[0].status, expenseId: ea.expense_id };
  }

  const actorId = ea.approver_id;
  if (snap.manager_prepended && ea.is_manager_step) {
    await client.query(
      `UPDATE expense_approvals SET status = 'approved', action_at = NOW(), comments = $2 WHERE id = $1`,
      [expenseApprovalId, comments || null]
    );
    await unlockParallelSkipped(client, ea.expense_id);
    const updated = await client.query(`SELECT status FROM expenses WHERE id = $1`, [ea.expense_id]);
    return { ok: true, expenseStatus: updated.rows[0].status, expenseId: ea.expense_id };
  }

  await processParallelApprove(client, expense, snap, ea, actorId, comments);
  const updated = await client.query(`SELECT status FROM expenses WHERE id = $1`, [ea.expense_id]);
  return { ok: true, expenseStatus: updated.rows[0].status, expenseId: ea.expense_id };
};

module.exports = {
  getActiveRule,
  getRuleSteps,
  loadSnapshot,
  startWorkflowForExpense,
  processApprovalAction,
};
