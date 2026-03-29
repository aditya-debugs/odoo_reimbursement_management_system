const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query, withTransaction } = require('../db');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

const router = express.Router();

router.use(auth, roles('admin'));

router.get('/', async (req, res) => {
  try {
    const rules = await query(
      `SELECT * FROM approval_rules WHERE company_id = $1 ORDER BY created_at DESC`,
      [req.user.company_id]
    );
    const out = [];
    for (const rule of rules.rows) {
      const steps = await query(
        `SELECT s.*, u.name as approver_name, u.email as approver_email
         FROM approval_rule_steps s
         JOIN users u ON u.id = s.approver_id
         WHERE s.rule_id = $1
         ORDER BY s.step_order`,
        [rule.id]
      );
      out.push({ ...rule, steps: steps.rows });
    }
    return res.json(out);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to list rules' });
  }
});

router.post(
  '/',
  [
    body('name').trim().notEmpty(),
    body('rule_type').isIn(['sequential', 'percentage', 'specific_approver', 'hybrid']),
    body('steps').isArray({ min: 1 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, description, rule_type, percentage_threshold, specific_approver_id, steps } = req.body;

    try {
      const created = await withTransaction(async (client) => {
        const r = await client.query(
          `INSERT INTO approval_rules (
            company_id, name, description, rule_type, percentage_threshold, specific_approver_id
          ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [
            req.user.company_id,
            name,
            description || null,
            rule_type,
            percentage_threshold != null ? percentage_threshold : null,
            specific_approver_id || null,
          ]
        );
        const rule = r.rows[0];
        for (const st of steps) {
          const chk = await client.query(
            `SELECT id FROM users WHERE id = $1 AND company_id = $2`,
            [st.approver_id, req.user.company_id]
          );
          if (!chk.rows.length) throw Object.assign(new Error('Invalid approver in steps'), { status: 400 });
          await client.query(
            `INSERT INTO approval_rule_steps (rule_id, approver_id, step_order) VALUES ($1,$2,$3)`,
            [rule.id, st.approver_id, st.step_order]
          );
        }
        const stepRows = await client.query(
          `SELECT s.*, u.name as approver_name FROM approval_rule_steps s
           JOIN users u ON u.id = s.approver_id WHERE s.rule_id = $1 ORDER BY s.step_order`,
          [rule.id]
        );
        return { ...rule, steps: stepRows.rows };
      });
      return res.status(201).json(created);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      return res.status(status).json({ message: err.message || 'Failed to create rule' });
    }
  }
);

router.patch(
  '/:id',
  [param('id').isUUID()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    const { name, description, rule_type, percentage_threshold, specific_approver_id, is_active, steps } = req.body;

    try {
      const updated = await withTransaction(async (client) => {
        const ex = await client.query(
          `SELECT id FROM approval_rules WHERE id = $1 AND company_id = $2`,
          [id, req.user.company_id]
        );
        if (!ex.rows.length) throw Object.assign(new Error('Not found'), { status: 404 });

        const fields = [];
        const vals = [];
        let i = 1;
        if (name != null) {
          fields.push(`name = $${i++}`);
          vals.push(name);
        }
        if (description !== undefined) {
          fields.push(`description = $${i++}`);
          vals.push(description);
        }
        if (rule_type != null) {
          fields.push(`rule_type = $${i++}`);
          vals.push(rule_type);
        }
        if (percentage_threshold !== undefined) {
          fields.push(`percentage_threshold = $${i++}`);
          vals.push(percentage_threshold);
        }
        if (specific_approver_id !== undefined) {
          fields.push(`specific_approver_id = $${i++}`);
          vals.push(specific_approver_id || null);
        }
        if (is_active !== undefined) {
          fields.push(`is_active = $${i++}`);
          vals.push(Boolean(is_active));
        }
        if (fields.length) {
          vals.push(id, req.user.company_id);
          await client.query(
            `UPDATE approval_rules SET ${fields.join(', ')} WHERE id = $${i++} AND company_id = $${i}`,
            vals
          );
        }

        if (Array.isArray(steps)) {
          await client.query(`DELETE FROM approval_rule_steps WHERE rule_id = $1`, [id]);
          for (const st of steps) {
            const chk = await client.query(
              `SELECT id FROM users WHERE id = $1 AND company_id = $2`,
              [st.approver_id, req.user.company_id]
            );
            if (!chk.rows.length) throw Object.assign(new Error('Invalid approver in steps'), { status: 400 });
            await client.query(
              `INSERT INTO approval_rule_steps (rule_id, approver_id, step_order) VALUES ($1,$2,$3)`,
              [id, st.approver_id, st.step_order]
            );
          }
        }

        const ruleRes = await client.query(`SELECT * FROM approval_rules WHERE id = $1`, [id]);
        const stepRows = await client.query(
          `SELECT s.*, u.name as approver_name FROM approval_rule_steps s
           JOIN users u ON u.id = s.approver_id WHERE s.rule_id = $1 ORDER BY s.step_order`,
          [id]
        );
        return { ...ruleRes.rows[0], steps: stepRows.rows };
      });
      return res.json(updated);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      return res.status(status).json({ message: err.message || 'Failed to update rule' });
    }
  }
);

router.delete('/:id', [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const r = await query(`DELETE FROM approval_rules WHERE id = $1 AND company_id = $2 RETURNING id`, [
      req.params.id,
      req.user.company_id,
    ]);
    if (!r.rows.length) return res.status(404).json({ message: 'Not found' });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to delete rule' });
  }
});

module.exports = router;
