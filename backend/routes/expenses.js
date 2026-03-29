const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { body, param, validationResult } = require('express-validator');
const { query, withTransaction } = require('../db');
const auth = require('../middleware/auth');
const { convertAmount } = require('../services/currency.service');
const { detectFraud, normalizeMerchant } = require('../services/fraud.service');
const { startWorkflowForExpense } = require('../services/approval.service');
const { runOcrOnFile } = require('../services/ocr.service');
const { createNotification } = require('../lib/notify');
const { appendAuditBlock } = require('../services/audit.service');
const { computeApprovalPrediction } = require('../services/prediction.service');

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

const listFilterSql = (user) => {
  if (user.role === 'admin' || user.role === 'financer' || user.role === 'director') {
    return { text: 'e.company_id = $1', params: [user.company_id] };
  }
  if (user.role === 'manager') {
    return {
      text: `(e.employee_id = $1 OR e.employee_id IN (SELECT id FROM users WHERE manager_id = $1 AND company_id = $2))`,
      params: [user.id, user.company_id],
    };
  }
  return { text: 'e.employee_id = $1', params: [user.id] };
};

router.get('/', auth, async (req, res) => {
  const { status, from, to, category_id } = req.query;
  const f = listFilterSql(req.user);
  const conds = [f.text];
  const params = [...f.params];
  let p = params.length + 1;
  if (status) {
    conds.push(`e.status = $${p++}`);
    params.push(status);
  }
  if (from) {
    conds.push(`e.expense_date >= $${p++}`);
    params.push(from);
  }
  if (to) {
    conds.push(`e.expense_date <= $${p++}`);
    params.push(to);
  }
  if (category_id) {
    conds.push(`e.category_id = $${p++}`);
    params.push(category_id);
  }

  try {
    const r = await query(
      `SELECT e.*, u.name as employee_name, c.name as category_name
       FROM expenses e
       JOIN users u ON u.id = e.employee_id
       LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE ${conds.join(' AND ')}
       ORDER BY e.submitted_at DESC NULLS LAST, e.created_at DESC`,
      params
    );
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to list expenses' });
  }
});

router.post(
  '/ocr',
  auth,
  (req, res, next) => {
    if (req.user.role !== 'employee') return res.status(403).json({ message: 'Only employees can use OCR' });
    next();
  },
  upload.single('receipt'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'receipt file required' });
    try {
      const catRes = await query(
        `SELECT id, name FROM expense_categories WHERE company_id = $1 AND is_active = true`,
        [req.user.company_id]
      );
      const parsed = await runOcrOnFile(req.file.path, catRes.rows);
      return res.json(parsed);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'OCR failed' });
    }
  }
);

router.post(
  '/',
  auth,
  upload.single('receipt'),
  [
    body('title').trim().notEmpty(),
    body('amount').isFloat({ gt: 0 }),
    body('currency_code').trim().notEmpty(),
    body('expense_date').matches(/^\d{4}-\d{2}-\d{2}$/),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    if (req.user.role !== 'employee') {
      return res.status(403).json({ message: 'Only employees can submit expenses' });
    }

    const { title, description, amount, currency_code, category_id, expense_date } = req.body;

    let ocrPayload = null;
    try {
      if (req.body.ocr_payload) {
        ocrPayload =
          typeof req.body.ocr_payload === 'string' ? JSON.parse(req.body.ocr_payload) : req.body.ocr_payload;
      }
    } catch {
      ocrPayload = null;
    }

    try {
      const companyRes = await query(`SELECT currency_code FROM companies WHERE id = $1`, [req.user.company_id]);
      const companyCurrency = companyRes.rows[0]?.currency_code || 'USD';
      const { converted, rate } = await convertAmount(parseFloat(amount), currency_code, companyCurrency);

      const receipt_url = req.file ? `/uploads/${req.file.filename}` : null;
      const receipt_filename = req.file ? req.file.originalname : null;
      const merchant_key = normalizeMerchant(title, description, ocrPayload?.vendor);
      const ocrAmount = ocrPayload?.amount != null ? parseFloat(ocrPayload.amount) : null;

      let gstBase = null;
      let gstAmt = null;
      let gstItc = null;
      if (category_id) {
        const catr = await query(
          `SELECT gst_applicable, gst_rate_percent FROM expense_categories WHERE id = $1 AND company_id = $2`,
          [category_id, req.user.company_id]
        );
        const cat = catr.rows[0];
        if (cat?.gst_applicable && cat.gst_rate_percent != null) {
          const rGst = parseFloat(cat.gst_rate_percent) / 100;
          const total = parseFloat(converted);
          gstBase = Math.round((total / (1 + rGst)) * 100) / 100;
          gstAmt = Math.round((total - gstBase) * 100) / 100;
          gstItc = true;
        }
      }

      const result = await withTransaction(async (client) => {
        const ins = await client.query(
          `INSERT INTO expenses (
            employee_id, company_id, category_id, title, description, amount, currency_code,
            amount_in_company_currency, exchange_rate, conversion_at, expense_date, receipt_url, receipt_filename,
            status, ocr_payload, merchant_key, gst_base_amount, gst_amount, gst_itc_eligible
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10::date,$11,$12,'pending',$13::jsonb,$14,$15,$16,$17)
          RETURNING *`,
          [
            req.user.id,
            req.user.company_id,
            category_id || null,
            title,
            description || null,
            amount,
            currency_code,
            converted,
            rate,
            expense_date,
            receipt_url,
            receipt_filename,
            ocrPayload ? JSON.stringify(ocrPayload) : null,
            merchant_key,
            gstBase,
            gstAmt,
            gstItc,
          ]
        );
        let exp = ins.rows[0];

        let category_name = null;
        if (category_id) {
          const cat = await client.query(`SELECT name FROM expense_categories WHERE id = $1`, [category_id]);
          category_name = cat.rows[0]?.name || null;
        }

        const fraud = await detectFraud({
          ...exp,
          employee_id: req.user.id,
          category_name,
          ocr_amount: ocrAmount,
          ocr_vendor: ocrPayload?.vendor,
          merchant_key,
        });

        await client.query(
          `UPDATE expenses SET fraud_flags = $2::jsonb, fraud_score = $3, fraud_level = $4, fraud_summary = $5 WHERE id = $1`,
          [exp.id, JSON.stringify(fraud.flags), fraud.score, fraud.level, fraud.summary]
        );
        exp = { ...exp, fraud_flags: fraud.flags, fraud_score: fraud.score, fraud_level: fraud.level, fraud_summary: fraud.summary };

        if (fraud.flags.length) {
          const admins = await client.query(
            `SELECT id FROM users WHERE company_id = $1 AND role = 'admin' AND is_active = true`,
            [req.user.company_id]
          );
          for (const a of admins.rows) {
            await createNotification(client, {
              userId: a.id,
              expenseId: exp.id,
              title: 'Fraud flags detected',
              message: `Expense "${title}" risk ${fraud.level} (${fraud.score}/100). ${fraud.summary}`,
            });
          }
        }

        await appendAuditBlock(client, {
          companyId: req.user.company_id,
          action: 'expense_submitted',
          actorId: req.user.id,
          expenseId: exp.id,
          payload: { title, amount: parseFloat(amount), currency_code },
        });

        const submitter = await client.query(`SELECT name FROM users WHERE id = $1`, [req.user.id]);
        await startWorkflowForExpense(client, exp, req.user.company_id, submitter.rows[0].name);

        const full = await client.query(
          `SELECT e.*, u.name as employee_name, c.name as category_name
           FROM expenses e
           JOIN users u ON u.id = e.employee_id
           LEFT JOIN expense_categories c ON c.id = e.category_id
           WHERE e.id = $1`,
          [exp.id]
        );
        return full.rows[0];
      });

      return res.status(201).json(result);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Failed to submit expense' });
    }
  }
);

router.get('/:id', auth, [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const r = await query(
      `SELECT e.*, u.name as employee_name, c.name as category_name,
              c.gst_applicable AS category_gst_applicable, c.gst_rate_percent AS category_gst_rate
       FROM expenses e
       JOIN users u ON u.id = e.employee_id
       LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Not found' });
    const exp = r.rows[0];
    if (exp.company_id !== req.user.company_id) return res.status(404).json({ message: 'Not found' });

    if (req.user.role === 'employee' && exp.employee_id !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (req.user.role === 'manager' && exp.employee_id !== req.user.id) {
      const sub = await query(`SELECT id FROM users WHERE id = $1 AND manager_id = $2`, [
        exp.employee_id,
        req.user.id,
      ]);
      if (!sub.rows.length) return res.status(403).json({ message: 'Forbidden' });
    }

    const approvals = await query(
      `SELECT ea.*, u.name as approver_name
       FROM expense_approvals ea
       JOIN users u ON u.id = ea.approver_id
       WHERE ea.expense_id = $1
       ORDER BY ea.sequence_order, ea.created_at`,
      [req.params.id]
    );

    const snapRes = await query(`SELECT * FROM expense_workflow_snapshots WHERE expense_id = $1`, [req.params.id]);
    const workflow_snapshot = snapRes.rows[0] || null;

    const splitsRes = await query(
      `SELECT es.*, u.name as user_name, u.email as user_email
       FROM expense_splits es
       JOIN users u ON u.id = es.user_id
       WHERE es.expense_id = $1`,
      [req.params.id]
    );

    return res.json({
      ...exp,
      approvals: approvals.rows,
      workflow_snapshot,
      approval_prediction,
      splits: splitsRes.rows
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load expense' });
  }
});

router.patch('/:id/cancel', auth, [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const r = await query(`SELECT * FROM expenses WHERE id = $1 AND company_id = $2`, [
      req.params.id,
      req.user.company_id,
    ]);
    if (!r.rows.length) return res.status(404).json({ message: 'Not found' });
    const exp = r.rows[0];
    if (exp.employee_id !== req.user.id) return res.status(403).json({ message: 'Only owner can cancel' });
    if (exp.status !== 'pending') return res.status(400).json({ message: 'Only pending expenses can be cancelled' });

    await withTransaction(async (client) => {
      await client.query(`UPDATE expenses SET status = 'cancelled' WHERE id = $1`, [exp.id]);
      await client.query(
        `UPDATE expense_approvals SET status = 'skipped', updated_at = NOW() WHERE expense_id = $1 AND status = 'pending'`,
        [exp.id]
      );
      await appendAuditBlock(client, {
        companyId: req.user.company_id,
        action: 'expense_cancelled',
        actorId: req.user.id,
        expenseId: exp.id,
        payload: {},
      });
    });

    return res.json({ ok: true, status: 'cancelled' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to cancel' });
  }
});

module.exports = router;
