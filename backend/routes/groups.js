const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query, withTransaction } = require('../db');
const auth = require('../middleware/auth');
const { startWorkflowForExpense } = require('../services/approval.service');
const { appendAuditBlock } = require('../services/audit.service');

const router = express.Router();

// ─── Group Management ────────────────────────────────────────────────────────

// List groups for the authenticated user
router.get('/', auth, async (req, res) => {
  try {
    const r = await query(
      `SELECT g.*, COUNT(gm.user_id) AS member_count
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = $1 AND g.company_id = $2
       GROUP BY g.id ORDER BY g.created_at DESC`,
      [req.user.id, req.user.company_id]
    );
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load groups' });
  }
});

// Create a new group
router.post(
  '/',
  auth,
  [
    body('name').trim().notEmpty().withMessage('Group name is required'),
    body('description').optional().trim(),
    body('tag').optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, description, tag } = req.body;

    try {
      const result = await withTransaction(async (client) => {
        const ins = await client.query(
          `INSERT INTO groups (name, description, tag, company_id, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [name, description || null, tag || null, req.user.company_id, req.user.id]
        );
        const group = ins.rows[0];

        // Add creator as Admin
        await client.query(
          `INSERT INTO group_members (group_id, user_id, role)
           VALUES ($1, $2, 'admin')`,
          [group.id, req.user.id]
        );

        return group;
      });

      return res.status(201).json(result);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Failed to create group' });
    }
  }
);

// Get group dashboard data (group info, balances, expenses)
router.get('/:id', auth, [param('id').isUUID()], async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Group info
    const groupRes = await query(
      `SELECT g.*, u.name AS creator_name
       FROM groups g
       JOIN users u ON u.id = g.created_by
       WHERE g.id = $1 AND g.company_id = $2`,
      [id, req.user.company_id]
    );
    if (!groupRes.rows.length) return res.status(404).json({ message: 'Group not found' });

    const group = groupRes.rows[0];

    // 2. Members info
    const membersRes = await query(
        `SELECT gm.*, u.name, u.email, u.role AS user_role
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = $1`,
        [id]
    );
    const members = membersRes.rows;

    // Verify requesting user is part of the group
    if (!members.find(m => m.user_id === req.user.id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // 3. Expenses info
    const expensesRes = await query(
      `SELECT e.*, u.name AS paid_by_name, c.name AS category_name
       FROM expenses e
       JOIN users u ON u.id = e.employee_id
       LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE e.group_id = $1
       ORDER BY e.expense_date DESC`,
      [id]
    );

    // 4. Calculate balances per user (net)
    // Balance = (Amount paid by user) - (Amount user owes from splits)
    const balancesRaw = await query(
        `WITH user_paid AS (
            SELECT employee_id AS user_id, COALESCE(SUM(amount_in_company_currency), 0) AS paid
            FROM expenses WHERE group_id = $1 GROUP BY employee_id
         ),
         user_owes AS (
            SELECT es.user_id, COALESCE(SUM(es.amount), 0) AS owes
            FROM expense_splits es
            JOIN expenses e ON e.id = es.expense_id
            WHERE e.group_id = $1 GROUP BY es.user_id
         )
         SELECT u.id, u.name,
                COALESCE(up.paid, 0) - COALESCE(uo.owes, 0) AS net_balance
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         LEFT JOIN user_paid up ON up.user_id = u.id
         LEFT JOIN user_owes uo ON uo.user_id = u.id
         WHERE gm.group_id = $1`,
        [id]
    );

    return res.json({
      group,
      members,
      expenses: expensesRes.rows,
      balances: balancesRaw.rows
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load group details' });
  }
});

// Add member to group
router.post(
  '/:id/members',
  auth,
  [
    param('id').isUUID(),
    body('user_id').isUUID().withMessage('User ID is required'),
    body('role').optional().isIn(['admin', 'member']),
  ],
  async (req, res) => {
    const { id } = req.params;
    const { user_id, role } = req.body;

    try {
      // Check if requester is admin of the group
      const checkAdmin = await query(
        `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
        [id, req.user.id]
      );
      if (!checkAdmin.rows.length || checkAdmin.rows[0].role !== 'admin') {
        return res.status(403).json({ message: 'Only group admins can add members' });
      }

      await query(
        `INSERT INTO group_members (group_id, user_id, role)
         VALUES ($1, $2, $3) ON CONFLICT (group_id, user_id) DO NOTHING`,
        [id, user_id, role || 'member']
      );

      return res.json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Failed to add member' });
    }
  }
);

// Add shared expense to group
router.post(
  '/:id/expenses',
  auth,
  [
    param('id').isUUID(),
    body('title').trim().notEmpty(),
    body('amount').isFloat({ gt: 0 }),
    body('currency_code').trim().notEmpty(),
    body('expense_date').matches(/^\d{4}-\d{2}-\d{2}$/),
    body('splits').isArray().notEmpty(),
  ],
  async (req, res) => {
    const { id } = req.params;
    const { title, description, amount, currency_code, category_id, expense_date, splits } = req.body;

    try {
      // Verify group membership
      const checkMbr = await query(
        `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
        [id, req.user.id]
      );
      if (!checkMbr.rows.length) return res.status(403).json({ message: 'Forbidden' });

      // Calculate company currency conversion (mock logic or use currency service)
      const companyRes = await query(`SELECT currency_code FROM companies WHERE id = $1`, [req.user.company_id]);
      const companyCurrency = companyRes.rows[0]?.currency_code || 'INR';

      // (Assuming a simple conversion for now, ideally use currency.service)
      const converted = parseFloat(amount); // For simplicity, 1:1 if same currency in this example

      const result = await withTransaction(async (client) => {
        // 1. Create the base expense
        const ins = await client.query(
          `INSERT INTO expenses (
            employee_id, company_id, category_id, title, description, amount, currency_code,
            amount_in_company_currency, expense_date, status, group_id, submitted_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,'pending',$10, NOW())
          RETURNING *`,
          [req.user.id, req.user.company_id, category_id || null, title, description || null, amount, currency_code, converted, expense_date, id]
        );
        const expense = ins.rows[0];

        // 2. Create splits
        // Verify total sum of splits matches amount (simplified validation)
        let totalSplitAmount = 0;
        for (const s of splits) {
          await client.query(
            `INSERT INTO expense_splits (expense_id, user_id, amount, percentage)
             VALUES ($1, $2, $3, $4)`,
            [expense.id, s.user_id, s.share_amount, s.share_percentage || null]
          );
          totalSplitAmount += parseFloat(s.share_amount);
        }

        // 3. Start approval workflow
        const submitter = await client.query(`SELECT name FROM users WHERE id = $1`, [req.user.id]);
        await startWorkflowForExpense(client, expense, req.user.company_id, submitter.rows[0].name);

        // 4. Audit block
        await appendAuditBlock(client, {
          companyId: req.user.company_id,
          action: 'group_expense_submitted',
          actorId: req.user.id,
          expenseId: expense.id,
          payload: { group_id: id, title, amount: parseFloat(amount), splits },
        });

        return expense;
      });

      return res.status(201).json(result);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Failed to create group expense' });
    }
  }
);

// ─── Settlement Logic ────────────────────────────────────────────────────────

// Simplify debts logic (Bonus implementation)
router.get('/:id/simplify', auth, async (req, res) => {
    // This is essentially calculating who owes whom in the most efficient way
    const { id } = req.params;
    try {
        const balancesRaw = await query(
            `WITH user_paid AS (
                SELECT employee_id AS user_id, COALESCE(SUM(amount_in_company_currency), 0) AS paid
                FROM expenses WHERE group_id = $1 GROUP BY employee_id
             ),
             user_owes AS (
                SELECT es.user_id, COALESCE(SUM(es.amount), 0) AS owes
                FROM expense_splits es
                JOIN expenses e ON e.id = es.expense_id
                WHERE e.group_id = $1 GROUP BY es.user_id
             )
             SELECT u.id, u.name,
                    CAST(COALESCE(up.paid, 0) - COALESCE(uo.owes, 0) AS float) AS balance
             FROM group_members gm
             JOIN users u ON u.id = gm.user_id
             LEFT JOIN user_paid up ON up.user_id = u.id
             LEFT JOIN user_owes uo ON uo.user_id = u.id
             WHERE gm.group_id = $1`,
            [id]
        );

        let creditors = [];
        let debtors = [];
        balancesRaw.rows.forEach(row => {
            if (row.balance > 0.01) creditors.push({ id: row.id, name: row.name, amount: row.balance });
            else if (row.balance < -0.01) debtors.push({ id: row.id, name: row.name, amount: Math.abs(row.balance) });
        });

        let transactions = [];
        creditors.sort((a,b) => b.amount - a.amount);
        debtors.sort((a,b) => b.amount - a.amount);

        let i = 0, j = 0;
        while (i < creditors.length && j < debtors.length) {
            let amount = Math.min(creditors[i].amount, debtors[j].amount);
            transactions.push({
                from: debtors[j].name,
                from_id: debtors[j].id,
                to: creditors[i].name,
                to_id: creditors[i].id,
                amount: parseFloat(amount.toFixed(2))
            });
            creditors[i].amount -= amount;
            debtors[j].amount -= amount;

            if (creditors[i].amount < 0.01) i++;
            if (debtors[j].amount < 0.01) j++;
        }

        return res.json(transactions);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Failed to simplify debts' });
    }
});

module.exports = router;
