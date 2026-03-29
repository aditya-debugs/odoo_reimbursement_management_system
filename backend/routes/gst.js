const express = require('express');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');
const { query } = require('../db');

const router = express.Router();

router.get('/report', auth, roles('admin', 'financer', 'director'), async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ message: 'from and to (YYYY-MM-DD) required' });

  try {
    const r = await query(
      `SELECT e.id, e.expense_date, e.title, e.amount_in_company_currency AS total_company_currency,
              e.gst_base_amount, e.gst_amount, e.gst_itc_eligible,
              c.name AS category_name, u.name AS employee_name
       FROM expenses e
       JOIN users u ON u.id = e.employee_id
       LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE e.company_id = $1 AND e.status = 'approved'
         AND e.gst_amount IS NOT NULL
         AND e.expense_date >= $2::date AND e.expense_date <= $3::date
       ORDER BY e.expense_date`,
      [req.user.company_id, from, to]
    );

    const lines = r.rows.map((row) =>
      [
        row.id,
        row.expense_date,
        row.employee_name,
        row.category_name || '',
        row.title.replace(/,/g, ' '),
        row.gst_base_amount,
        row.gst_amount,
        row.gst_itc_eligible ? 'Y' : 'N',
        row.total_company_currency,
      ].join(',')
    );
    const header = 'id,date,employee,category,title,gst_base,gst_amount,itc_eligible,total_company_currency';
    const csv = [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="gst-report.csv"');
    return res.send(csv);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to export' });
  }
});

module.exports = router;
