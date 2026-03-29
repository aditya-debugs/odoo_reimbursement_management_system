const express = require('express');
const { query } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// All routes: available to ALL authenticated users (employee-scoped)
// Employees only see their own data; managers/admins can see their team

const scopeClause = (user) => {
  if (user.role === 'admin' || user.role === 'financer' || user.role === 'director') {
    return { where: 'e.company_id = $1', params: [user.company_id] };
  }
  if (user.role === 'manager') {
    return {
      where: `e.company_id = $1 AND (e.employee_id = $2 OR e.employee_id IN (SELECT id FROM users WHERE manager_id = $2 AND company_id = $1))`,
      params: [user.company_id, user.id],
    };
  }
  // employee
  return { where: 'e.company_id = $1 AND e.employee_id = $2', params: [user.company_id, user.id] };
};

const addDateFilters = (conds, params, from, to) => {
  let p = params.length + 1;
  if (from) { conds.push(`e.expense_date >= $${p++}`); params.push(from); }
  if (to)   { conds.push(`e.expense_date <= $${p++}`); params.push(to); }
  return p;
};

// ─── GET /api/employee-analytics/summary ────────────────────────────────────
router.get('/summary', auth, async (req, res) => {
  const { from, to, category_id, status, min_amount, max_amount } = req.query;
  const s = scopeClause(req.user);
  const conds = [s.where];
  const params = [...s.params];
  let p = params.length + 1;

  if (from)         { conds.push(`e.expense_date >= $${p++}`);  params.push(from); }
  if (to)           { conds.push(`e.expense_date <= $${p++}`);  params.push(to); }
  if (category_id)  { conds.push(`e.category_id = $${p++}`);   params.push(category_id); }
  if (status)       { conds.push(`e.status = $${p++}`);         params.push(status); }
  if (min_amount)   { conds.push(`e.amount_in_company_currency >= $${p++}`); params.push(parseFloat(min_amount)); }
  if (max_amount)   { conds.push(`e.amount_in_company_currency <= $${p++}`); params.push(parseFloat(max_amount)); }

  const where = conds.join(' AND ');
  try {
    const r = await query(
      `SELECT
         COUNT(*)::int                                                          AS total_count,
         COALESCE(SUM(e.amount_in_company_currency), 0)::numeric               AS total_amount,
         COALESCE(SUM(e.amount_in_company_currency) FILTER (WHERE e.status = 'approved'), 0)::numeric  AS approved_amount,
         COALESCE(SUM(e.amount_in_company_currency) FILTER (WHERE e.status = 'pending'),  0)::numeric  AS pending_amount,
         COALESCE(SUM(e.amount_in_company_currency) FILTER (WHERE e.status = 'rejected'), 0)::numeric  AS rejected_amount,
         COUNT(*) FILTER (WHERE e.status = 'approved')::int                    AS approved_count,
         COUNT(*) FILTER (WHERE e.status = 'pending')::int                     AS pending_count,
         COUNT(*) FILTER (WHERE e.status = 'rejected')::int                    AS rejected_count,
         COALESCE(MAX(e.amount_in_company_currency), 0)::numeric               AS highest_expense,
         COALESCE(AVG(e.amount_in_company_currency), 0)::numeric               AS avg_expense,
         MIN(e.expense_date)                                                    AS first_date,
         MAX(e.expense_date)                                                    AS last_date
       FROM expenses e WHERE ${where}`,
      params
    );
    const row = r.rows[0];
    // avg per day between first and last date
    const daySpan = row.first_date && row.last_date
      ? Math.max(1, Math.round((new Date(row.last_date) - new Date(row.first_date)) / 86400000) + 1)
      : 1;
    const avgPerDay = row.total_count > 0
      ? Math.round((parseFloat(row.total_amount) / daySpan) * 100) / 100
      : 0;
    const approvalRate = (row.approved_count + row.rejected_count) > 0
      ? Math.round((row.approved_count / (row.approved_count + row.rejected_count)) * 100)
      : 0;

    return res.json({ ...row, avg_per_day: avgPerDay, approval_rate_percent: approvalRate });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load summary' });
  }
});

// ─── GET /api/employee-analytics/trends ──────────────────────────────────────
// view = 'monthly' | 'daily'   default: monthly
router.get('/trends', auth, async (req, res) => {
  const { from, to, view = 'monthly', category_id, status } = req.query;
  const s = scopeClause(req.user);
  const conds = [s.where];
  const params = [...s.params];
  let p = params.length + 1;

  if (from)        { conds.push(`e.expense_date >= $${p++}`); params.push(from); }
  if (to)          { conds.push(`e.expense_date <= $${p++}`); params.push(to); }
  if (category_id) { conds.push(`e.category_id = $${p++}`);  params.push(category_id); }
  if (status)      { conds.push(`e.status = $${p++}`);        params.push(status); }

  const trunc = view === 'daily' ? 'day' : 'month';
  const label = view === 'daily'
    ? `to_char(date_trunc('day', e.expense_date), 'DD Mon')`
    : `to_char(date_trunc('month', e.expense_date), 'Mon YYYY')`;

  try {
    const r = await query(
      `SELECT ${label} AS label,
              date_trunc('${trunc}', e.expense_date)::date AS period,
              COALESCE(SUM(e.amount_in_company_currency), 0)::numeric AS total,
              COUNT(*)::int AS count,
              COALESCE(SUM(e.amount_in_company_currency) FILTER (WHERE e.status = 'approved'), 0)::numeric AS approved,
              COALESCE(SUM(e.amount_in_company_currency) FILTER (WHERE e.status = 'pending'),  0)::numeric AS pending,
              COALESCE(SUM(e.amount_in_company_currency) FILTER (WHERE e.status = 'rejected'), 0)::numeric AS rejected
       FROM expenses e
       WHERE ${conds.join(' AND ')}
       GROUP BY 1, 2 ORDER BY 2 ASC`,
      params
    );
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load trends' });
  }
});

// ─── GET /api/employee-analytics/categories ──────────────────────────────────
router.get('/categories', auth, async (req, res) => {
  const { from, to, status } = req.query;
  const s = scopeClause(req.user);
  const conds = [s.where];
  const params = [...s.params];
  let p = params.length + 1;

  if (from)   { conds.push(`e.expense_date >= $${p++}`); params.push(from); }
  if (to)     { conds.push(`e.expense_date <= $${p++}`); params.push(to); }
  if (status) { conds.push(`e.status = $${p++}`);        params.push(status); }

  try {
    const r = await query(
      `SELECT
         COALESCE(c.name, 'Uncategorized') AS name,
         c.id AS category_id,
         COALESCE(SUM(e.amount_in_company_currency), 0)::numeric    AS total,
         COUNT(*)::int                                                AS count,
         COALESCE(AVG(e.amount_in_company_currency), 0)::numeric     AS avg_amount,
         COALESCE(MAX(e.amount_in_company_currency), 0)::numeric     AS max_amount
       FROM expenses e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE ${conds.join(' AND ')}
       GROUP BY COALESCE(c.name, 'Uncategorized'), c.id
       ORDER BY total DESC`,
      params
    );
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load categories' });
  }
});

// ─── GET /api/employee-analytics/top-expenses ────────────────────────────────
router.get('/top-expenses', auth, async (req, res) => {
  const { from, to, limit = 5, status } = req.query;
  const s = scopeClause(req.user);
  const conds = [s.where];
  const params = [...s.params];
  let p = params.length + 1;

  if (from)   { conds.push(`e.expense_date >= $${p++}`); params.push(from); }
  if (to)     { conds.push(`e.expense_date <= $${p++}`); params.push(to); }
  if (status) { conds.push(`e.status = $${p++}`);        params.push(status); }

  try {
    const r = await query(
      `SELECT e.id, e.title, e.amount, e.currency_code,
              e.amount_in_company_currency, e.expense_date,
              e.status, e.description,
              COALESCE(c.name, 'Uncategorized') AS category_name,
              u.name AS employee_name
       FROM expenses e
       JOIN users u ON u.id = e.employee_id
       LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE ${conds.join(' AND ')}
       ORDER BY e.amount_in_company_currency DESC NULLS LAST
       LIMIT $${p}`,
      [...params, parseInt(limit)]
    );
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load top expenses' });
  }
});

// ─── GET /api/employee-analytics/recent ──────────────────────────────────────
router.get('/recent', auth, async (req, res) => {
  const { limit = 10 } = req.query;
  const s = scopeClause(req.user);
  const params = [...s.params];
  const p = params.length + 1;

  try {
    const r = await query(
      `SELECT e.id, e.title, e.amount, e.currency_code,
              e.amount_in_company_currency, e.expense_date,
              e.status, e.submitted_at,
              COALESCE(c.name, 'Uncategorized') AS category_name,
              u.name AS employee_name
       FROM expenses e
       JOIN users u ON u.id = e.employee_id
       LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE ${s.where}
       ORDER BY e.submitted_at DESC NULLS LAST, e.created_at DESC
       LIMIT $${p}`,
      [...params, parseInt(limit)]
    );
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load recent expenses' });
  }
});

// ─── GET /api/employee-analytics/insights ────────────────────────────────────
router.get('/insights', auth, async (req, res) => {
  const { from, to } = req.query;
  const s = scopeClause(req.user);
  const params = [...s.params];

  // Helper to build date-filtered query
  const withDates = (extraConds = []) => {
    const c = [s.where, ...extraConds];
    const p = [...params];
    let idx = params.length + 1;
    if (from) { c.push(`e.expense_date >= $${idx++}`); p.push(from); }
    if (to)   { c.push(`e.expense_date <= $${idx++}`); p.push(to); }
    return { where: c.join(' AND '), params: p };
  };

  try {
    const insights = [];
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

    // 1. Top spending category
    const catQ = withDates();
    const topCat = await query(
      `SELECT COALESCE(c.name,'Uncategorized') AS name,
              COALESCE(SUM(e.amount_in_company_currency),0)::numeric AS total
       FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE ${catQ.where} GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
      catQ.params
    );
    if (topCat.rows[0]?.total > 0) {
      insights.push({
        type: 'info',
        icon: '📊',
        text: `Your highest spending category is <strong>${topCat.rows[0].name}</strong> — ₹${Number(topCat.rows[0].total).toFixed(0)} total.`,
      });
    }

    // 2. This month vs last month comparison
    const thisM = await query(
      `SELECT COALESCE(SUM(e.amount_in_company_currency),0)::numeric AS total
       FROM expenses e WHERE ${s.where} AND e.expense_date >= $${params.length+1}`,
      [...params, thisMonthStart]
    );
    const lastM = await query(
      `SELECT COALESCE(SUM(e.amount_in_company_currency),0)::numeric AS total
       FROM expenses e WHERE ${s.where} AND e.expense_date >= $${params.length+1} AND e.expense_date <= $${params.length+2}`,
      [...params, lastMonthStart, lastMonthEnd]
    );
    const thisMTotal = parseFloat(thisM.rows[0]?.total || 0);
    const lastMTotal = parseFloat(lastM.rows[0]?.total || 0);
    if (lastMTotal > 0 && thisMTotal > 0) {
      const pct = Math.round(((thisMTotal - lastMTotal) / lastMTotal) * 100);
      if (pct > 10) {
        insights.push({ type: 'warning', icon: '📈', text: `Your spending this month is <strong>${pct}% higher</strong> than last month.` });
      } else if (pct < -10) {
        insights.push({ type: 'success', icon: '📉', text: `Great job! Your spending this month is <strong>${Math.abs(pct)}% lower</strong> than last month.` });
      } else {
        insights.push({ type: 'info', icon: '✅', text: `Your spending this month is on par with last month (${pct > 0 ? '+' : ''}${pct}%).` });
      }
    } else if (thisMTotal > 0 && lastMTotal === 0) {
      insights.push({ type: 'info', icon: '🆕', text: `First expenses recorded this month — ₹${thisMTotal.toFixed(0)} so far.` });
    }

    // 3. Pending count warning
    const pendingQ = await query(
      `SELECT COUNT(*)::int AS cnt FROM expenses e WHERE ${s.where} AND e.status = 'pending'`,
      params
    );
    const pending = pendingQ.rows[0]?.cnt || 0;
    if (pending >= 3) {
      insights.push({ type: 'warning', icon: '⏳', text: `You have <strong>${pending} expenses</strong> still pending approval.` });
    }

    // 4. Rejection rate
    const statQ = await query(
      `SELECT COUNT(*) FILTER (WHERE e.status='rejected')::int AS rej,
              COUNT(*) FILTER (WHERE e.status IN ('approved','rejected'))::int AS total
       FROM expenses e WHERE ${s.where}`,
      params
    );
    const { rej, total: tot } = statQ.rows[0];
    if (tot >= 5 && rej / tot > 0.25) {
      insights.push({ type: 'danger', icon: '❌', text: `Your rejection rate is <strong>${Math.round((rej/tot)*100)}%</strong>. Consider reviewing your expense descriptions.` });
    }

    // 5. Average expense
    const avgQ = await query(
      `SELECT COALESCE(AVG(e.amount_in_company_currency),0)::numeric AS avg
       FROM expenses e WHERE ${s.where}`,
      params
    );
    const avgExp = parseFloat(avgQ.rows[0]?.avg || 0);
    if (avgExp > 0) {
      insights.push({ type: 'info', icon: '💡', text: `Your average expense is <strong>₹${avgExp.toFixed(0)}</strong> per submission.` });
    }

    if (insights.length === 0) {
      insights.push({ type: 'info', icon: '📋', text: 'No significant insights yet. Submit more expenses to unlock patterns.' });
    }

    return res.json(insights);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to generate insights' });
  }
});

// ─── GET /api/employee-analytics/comparison ──────────────────────────────────
// Returns this-month vs last-month breakdown
router.get('/comparison', auth, async (req, res) => {
  const s = scopeClause(req.user);
  const params = [...s.params];

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
  const p = params.length;

  try {
    const [thisM, lastM] = await Promise.all([
      query(
        `SELECT
           COALESCE(SUM(e.amount_in_company_currency),0)::numeric AS total,
           COUNT(*)::int AS count,
           COALESCE(SUM(e.amount_in_company_currency) FILTER (WHERE e.status='approved'),0)::numeric AS approved,
           COALESCE(SUM(e.amount_in_company_currency) FILTER (WHERE e.status='rejected'),0)::numeric AS rejected,
           COALESCE(SUM(e.amount_in_company_currency) FILTER (WHERE e.status='pending'),0)::numeric  AS pending
         FROM expenses e WHERE ${s.where} AND e.expense_date >= $${p+1}`,
        [...params, thisMonthStart]
      ),
      query(
        `SELECT
           COALESCE(SUM(e.amount_in_company_currency),0)::numeric AS total,
           COUNT(*)::int AS count,
           COALESCE(SUM(e.amount_in_company_currency) FILTER (WHERE e.status='approved'),0)::numeric AS approved,
           COALESCE(SUM(e.amount_in_company_currency) FILTER (WHERE e.status='rejected'),0)::numeric AS rejected,
           COALESCE(SUM(e.amount_in_company_currency) FILTER (WHERE e.status='pending'),0)::numeric  AS pending
         FROM expenses e WHERE ${s.where} AND e.expense_date >= $${p+1} AND e.expense_date <= $${p+2}`,
        [...params, lastMonthStart, lastMonthEnd]
      ),
    ]);

    const thisTotal = parseFloat(thisM.rows[0]?.total || 0);
    const lastTotal = parseFloat(lastM.rows[0]?.total || 0);
    const changePct = lastTotal > 0 ? Math.round(((thisTotal - lastTotal) / lastTotal) * 100) : null;

    return res.json({
      this_month: thisM.rows[0],
      last_month: lastM.rows[0],
      change_percent: changePct,
      this_month_label: now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      last_month_label: new Date(now.getFullYear(), now.getMonth() - 1, 1)
        .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load comparison' });
  }
});

module.exports = router;
