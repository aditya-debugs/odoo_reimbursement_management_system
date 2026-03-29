const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../db');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

const router = express.Router();

router.use(auth, roles('admin'));

router.get('/', async (req, res) => {
  try {
    const budgets = await query(
      `SELECT b.*, c.name AS category_name
       FROM category_budgets b
       JOIN expense_categories c ON c.id = b.category_id
       WHERE b.company_id = $1
       ORDER BY c.name`,
      [req.user.company_id]
    );
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);

    const spent = await query(
      `SELECT e.category_id,
              COALESCE(SUM(e.amount_in_company_currency), 0)::numeric AS spent
       FROM expenses e
       WHERE e.company_id = $1 AND e.status = 'approved'
         AND e.expense_date >= $2::date AND e.expense_date <= $3::date
       GROUP BY e.category_id`,
      [req.user.company_id, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
    );
    const spentMap = Object.fromEntries(spent.rows.map((r) => [r.category_id, parseFloat(r.spent)]));

    const rows = budgets.rows.map((b) => ({
      ...b,
      spent_mtd: spentMap[b.category_id] || 0,
      utilization_percent:
        parseFloat(b.monthly_cap) > 0
          ? Math.min(100, Math.round(((spentMap[b.category_id] || 0) / parseFloat(b.monthly_cap)) * 100))
          : 0,
    }));
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load budgets' });
  }
});

router.post(
  '/',
  [body('category_id').isUUID(), body('monthly_cap').isFloat({ gt: 0 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { category_id, monthly_cap } = req.body;
    try {
      const chk = await query(
        `SELECT id FROM expense_categories WHERE id = $1 AND company_id = $2`,
        [category_id, req.user.company_id]
      );
      if (!chk.rows.length) return res.status(400).json({ message: 'Invalid category' });

      const r = await query(
        `INSERT INTO category_budgets (company_id, category_id, monthly_cap)
         VALUES ($1, $2, $3)
         ON CONFLICT (company_id, category_id) DO UPDATE SET monthly_cap = EXCLUDED.monthly_cap, updated_at = NOW()
         RETURNING *`,
        [req.user.company_id, category_id, monthly_cap]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Failed to save budget' });
    }
  }
);

router.delete('/:id', [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const r = await query(`DELETE FROM category_budgets WHERE id = $1 AND company_id = $2 RETURNING id`, [
      req.params.id,
      req.user.company_id,
    ]);
    if (!r.rows.length) return res.status(404).json({ message: 'Not found' });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to delete' });
  }
});

module.exports = router;
