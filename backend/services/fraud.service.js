const { query } = require('../db');

const normalizeMerchant = (title, description, ocrVendor) => {
  const parts = [title, description, ocrVendor].filter(Boolean).join(' ').toLowerCase();
  return parts.replace(/\s+/g, ' ').trim().slice(0, 200) || null;
};

const isRoundNumberHeuristic = (amount, currencyCode) => {
  const n = parseFloat(amount);
  if (Number.isNaN(n) || n < 100) return false;
  const whole = Math.abs(n - Math.round(n)) < 0.01;
  if (!whole) return false;
  const r = Math.round(n);
  if (r % 1000 === 0 && r >= 1000) return true;
  if (currencyCode === 'INR' && r % 500 === 0 && r >= 500) return true;
  return false;
};

const scoreFromFlags = (flags) => {
  let score = 0;
  for (const f of flags) {
    if (f.severity === 'high') score += 35;
    else if (f.severity === 'medium') score += 22;
    else score += 12;
  }
  return Math.min(100, score);
};

const levelFromScore = (score) => {
  if (score >= 55) return 'red';
  if (score >= 25) return 'yellow';
  return 'green';
};

const summarize = (flags) => {
  if (!flags.length) return 'No fraud indicators';
  return flags.map((f) => f.message).join(' · ');
};

/**
 * Rule-based fraud detection with 0–100 score and severity flags.
 */
const detectFraud = async (expense) => {
  const flags = [];

  try {
    const merchantKey = expense.merchant_key || normalizeMerchant(expense.title, expense.description, expense.ocr_vendor);

    if (merchantKey && expense.amount_in_company_currency != null) {
      const dup48 = await query(
        `SELECT id FROM expenses
         WHERE employee_id = $1
           AND merchant_key IS NOT NULL
           AND merchant_key = $2
           AND amount_in_company_currency = $3
           AND submitted_at >= NOW() - INTERVAL '48 hours'
           AND id != $4::uuid
           AND status != 'rejected'`,
        [
          expense.employee_id,
          merchantKey,
          expense.amount_in_company_currency,
          expense.id || '00000000-0000-0000-0000-000000000000',
        ]
      );
      if (dup48.rows.length > 0) {
        flags.push({
          type: 'DUPLICATE_MERCHANT_48H',
          severity: 'high',
          message: `Possible duplicate: same amount and merchant within 48 hours.`,
        });
      }
    }

    const dup7 = await query(
      `SELECT id FROM expenses
       WHERE employee_id = $1
         AND amount_in_company_currency = $2
         AND category_id IS NOT DISTINCT FROM $3::uuid
         AND expense_date BETWEEN $4::date - INTERVAL '7 days' AND $4::date
         AND id != $5::uuid
         AND status != 'rejected'`,
      [
        expense.employee_id,
        expense.amount_in_company_currency,
        expense.category_id,
        expense.expense_date,
        expense.id || '00000000-0000-0000-0000-000000000000',
      ]
    );
    if (dup7.rows.length > 0) {
      flags.push({
        type: 'DUPLICATE_SIMILAR',
        severity: 'medium',
        message: `Similar submission: same amount and category within 7 days.`,
      });
    }

    if (expense.category_id) {
      const avgResult = await query(
        `SELECT AVG(amount_in_company_currency) as avg_amount, COUNT(*)::int as count
         FROM expenses
         WHERE employee_id = $1
           AND category_id = $2
           AND expense_date >= NOW() - INTERVAL '90 days'
           AND status != 'rejected'
           AND id != $3::uuid`,
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
            message: `Amount is much higher than your 90-day average for this category.`,
          });
        }
      }
    }

    const expDate = new Date(expense.expense_date);
    const dayOfWeek = expDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      flags.push({
        type: 'WEEKEND',
        severity: 'low',
        message: `Expense dated on a weekend — verify if expected.`,
      });
    }

    if (isRoundNumberHeuristic(expense.amount, expense.currency_code)) {
      flags.push({
        type: 'ROUND_NUMBER',
        severity: 'low',
        message: `Round amount (${expense.amount}) may warrant a quick receipt check.`,
      });
    }

    if (expense.ocr_amount != null && expense.amount != null) {
      const entered = parseFloat(expense.amount);
      const ocr = parseFloat(expense.ocr_amount);
      if (!Number.isNaN(entered) && !Number.isNaN(ocr) && ocr > 0) {
        const diff = Math.abs(entered - ocr) / ocr;
        if (diff > 0.05) {
          flags.push({
            type: 'OCR_MISMATCH',
            severity: 'high',
            message: `Entered amount differs from OCR-extracted total by ${Math.round(diff * 100)}%.`,
          });
        }
      }
    }
  } catch (err) {
    console.error('Fraud detection error:', err.message);
  }

  const score = scoreFromFlags(flags);
  const level = levelFromScore(score);
  const summary = summarize(flags);

  return { flags, score, level, summary };
};

module.exports = { detectFraud, normalizeMerchant };
