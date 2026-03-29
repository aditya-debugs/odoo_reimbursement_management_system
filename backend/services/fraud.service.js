const { query } = require('../db');

/**
 * Rule-based fraud detection engine
 * Checks for:
 * 1. Duplicate bills (same amount + same category + same employee within 7 days)
 * 2. Unusually high amount (> 3x employee's 90-day category average)
 * 3. Weekend expense anomaly for certain categories
 */
const detectFraud = async (expense) => {
  const flags = [];

  try {
    // 1. Duplicate detection — same employee, same amount, same category, within 7 days
    const dupResult = await query(
      `SELECT id FROM expenses
       WHERE employee_id = $1
         AND amount_in_company_currency = $2
         AND category_id = $3
         AND expense_date BETWEEN $4::date - INTERVAL '7 days' AND $4::date
         AND id != $5
         AND status != 'rejected'`,
      [
        expense.employee_id,
        expense.amount_in_company_currency,
        expense.category_id,
        expense.expense_date,
        expense.id || '00000000-0000-0000-0000-000000000000',
      ]
    );
    if (dupResult.rows.length > 0) {
      flags.push({
        type: 'DUPLICATE',
        severity: 'high',
        message: `Possible duplicate: same amount submitted ${dupResult.rows.length} time(s) within the last 7 days.`,
      });
    }

    // 2. Unusual amount — compare vs 90-day average for this category
    if (expense.category_id) {
      const avgResult = await query(
        `SELECT AVG(amount_in_company_currency) as avg_amount, COUNT(*) as count
         FROM expenses
         WHERE employee_id = $1
           AND category_id = $2
           AND expense_date >= NOW() - INTERVAL '90 days'
           AND status != 'rejected'
           AND id != $3`,
        [
          expense.employee_id,
          expense.category_id,
          expense.id || '00000000-0000-0000-0000-000000000000',
        ]
      );
      const { avg_amount, count } = avgResult.rows[0];
      if (count >= 3 && avg_amount) {
        const threshold = parseFloat(avg_amount) * 3;
        if (parseFloat(expense.amount_in_company_currency) > threshold) {
          flags.push({
            type: 'UNUSUAL_AMOUNT',
            severity: 'medium',
            message: `Amount is ${Math.round(expense.amount_in_company_currency / avg_amount)}x higher than your 90-day average (${parseFloat(avg_amount).toFixed(2)}) for this category.`,
          });
        }
      }
    }

    // 3. Weekend office/travel expense anomaly
    const expDate = new Date(expense.expense_date);
    const dayOfWeek = expDate.getDay(); // 0=Sun, 6=Sat
    if ((dayOfWeek === 0 || dayOfWeek === 6) && expense.category_name) {
      const officeCategories = ['office supplies', 'office', 'equipment', 'utilities'];
      if (officeCategories.some(c => expense.category_name.toLowerCase().includes(c))) {
        flags.push({
          type: 'WEEKEND_ANOMALY',
          severity: 'low',
          message: `Office-related expense on a ${dayOfWeek === 0 ? 'Sunday' : 'Saturday'}. Please verify this is legitimate.`,
        });
      }
    }
  } catch (err) {
    console.error('Fraud detection error:', err.message);
  }

  return flags;
};

module.exports = { detectFraud };
