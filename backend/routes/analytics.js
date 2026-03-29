const express = require('express');
const { query } = require('../db');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

const router = express.Router();

const scopeSql = (user) => {
  if (user.role === 'admin') {
    return { clause: 'e.company_id = $1', params: [user.company_id] };
  }
  return {
    clause: `e.company_id = $1 AND (e.employee_id = $2 OR e.employee_id IN (SELECT id FROM users WHERE manager_id = $2))`,
    params: [user.company_id, user.id],
  };
};

router.get('/summary', auth, roles('admin', 'manager'), async (req, res) => {
  const { from, to } = req.query;
  const s = scopeSql(req.user);
  const conds = [s.clause];
  const params = [...s.params];
  let p = params.length + 1;
  if (from) {
    conds.push(`e.expense_date >= $${p++}`);
    params.push(from);
  }
  if (to) {
    conds.push(`e.expense_date <= $${p++}`);
    params.push(to);
  }
  const where = conds.join(' AND ');

  try {
    const r = await query(
      `SELECT
         COUNT(*) FILTER (WHERE e.status = 'pending')::int AS pending_count,
         COUNT(*) FILTER (WHERE e.status = 'approved')::int AS approved_count,
         COUNT(*) FILTER (WHERE e.status = 'rejected')::int AS rejected_count,
         COALESCE(SUM(e.amount_in_company_currency) FILTER (WHERE e.status = 'approved'), 0)::numeric AS total_approved_amount,
         COUNT(*)::int AS total_expenses
       FROM expenses e WHERE ${where}`,
      params
    );
    const total = r.rows[0].approved_count + r.rows[0].rejected_count;
    const rate = total > 0 ? Math.round((r.rows[0].approved_count / total) * 100) : 0;
    return res.json({ ...r.rows[0], approval_rate_percent: rate });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load summary' });
  }
});

router.get('/monthly', auth, roles('admin', 'manager'), async (req, res) => {
  const { from, to } = req.query;
  const s = scopeSql(req.user);
  const conds = [s.clause, `e.status = 'approved'`];
  const params = [...s.params];
  let p = params.length + 1;
  if (from) {
    conds.push(`e.expense_date >= $${p++}`);
    params.push(from);
  }
  if (to) {
    conds.push(`e.expense_date <= $${p++}`);
    params.push(to);
  }

  try {
    const r = await query(
      `SELECT date_trunc('month', e.expense_date)::date AS month,
              COALESCE(SUM(e.amount_in_company_currency), 0)::numeric AS total
       FROM expenses e
       WHERE ${conds.join(' AND ')}
       GROUP BY 1 ORDER BY 1`,
      params
    );
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load monthly data' });
  }
});

router.get('/categories', auth, roles('admin', 'manager'), async (req, res) => {
  const { from, to } = req.query;
  const s = scopeSql(req.user);
  const conds = [s.clause, `e.status = 'approved'`];
  const params = [...s.params];
  let p = params.length + 1;
  if (from) {
    conds.push(`e.expense_date >= $${p++}`);
    params.push(from);
  }
  if (to) {
    conds.push(`e.expense_date <= $${p++}`);
    params.push(to);
  }

  try {
    const r = await query(
      `SELECT COALESCE(c.name, 'Uncategorized') AS name,
              COALESCE(SUM(e.amount_in_company_currency), 0)::numeric AS value
       FROM expenses e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE ${conds.join(' AND ')}
       GROUP BY COALESCE(c.name, 'Uncategorized') ORDER BY value DESC`,
      params
    );
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load categories' });
  }
});

router.get('/employees', auth, roles('admin'), async (req, res) => {
  const { from, to } = req.query;
  const conds = ['e.company_id = $1', `e.status = 'approved'`];
  const params = [req.user.company_id];
  let p = 2;
  if (from) {
    conds.push(`e.expense_date >= $${p++}`);
    params.push(from);
  }
  if (to) {
    conds.push(`e.expense_date <= $${p++}`);
    params.push(to);
  }

  try {
    const r = await query(
      `SELECT u.name AS employee_name, u.id AS employee_id,
              COALESCE(SUM(e.amount_in_company_currency), 0)::numeric AS total
       FROM expenses e
       JOIN users u ON u.id = e.employee_id
       WHERE ${conds.join(' AND ')}
       GROUP BY u.id, u.name ORDER BY total DESC`,
      params
    );
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load employee stats' });
  }
});

module.exports = router;
