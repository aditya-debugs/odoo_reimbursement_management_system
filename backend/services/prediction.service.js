const { query } = require('../db');

/**
 * Heuristic approval likelihood from similar past expenses (same company).
 */
async function computeApprovalPrediction({
  companyId,
  employeeId,
  categoryId,
  amountInCompanyCurrency,
}) {
  if (!categoryId || amountInCompanyCurrency == null) {
    return { approval_chance_percent: null, reason: 'Not enough data' };
  }
  const amt = parseFloat(amountInCompanyCurrency);
  const bandLow = amt * 0.7;
  const bandHigh = amt * 1.3;

  try {
    const r = await query(
      `SELECT
         COUNT(*) FILTER (WHERE e.status = 'approved')::int AS approved,
         COUNT(*) FILTER (WHERE e.status = 'rejected')::int AS rejected,
         COUNT(*)::int AS total
       FROM expenses e
       WHERE e.company_id = $1
         AND e.category_id = $2
         AND e.id != $3::uuid
         AND e.amount_in_company_currency BETWEEN $4 AND $5
         AND e.status IN ('approved', 'rejected')`,
      [companyId, categoryId, '00000000-0000-0000-0000-000000000000', bandLow, bandHigh]
    );
    const { approved, rejected, total } = r.rows[0];
    if (total < 3) {
      return { approval_chance_percent: null, reason: 'Need more historical claims in this range' };
    }
    const pct = Math.round((approved / total) * 100);
    return {
      approval_chance_percent: pct,
      reason: `Based on ${total} similar claims (±30% amount, same category) in your company.`,
    };
  } catch (e) {
    return { approval_chance_percent: null, reason: 'Could not compute' };
  }
}

module.exports = { computeApprovalPrediction };
