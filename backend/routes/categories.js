const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../db');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM expense_categories WHERE company_id = $1 AND is_active = true ORDER BY name`,
      [req.user.company_id]
    );
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to list categories' });
  }
});

router.post(
  '/',
  auth,
  roles('admin'),
  [body('name').trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, description, gst_applicable, gst_rate_percent } = req.body;
    try {
      const r = await query(
        `INSERT INTO expense_categories (company_id, name, description, gst_applicable, gst_rate_percent)
         VALUES ($1, $2, $3, COALESCE($4, false), COALESCE($5, 18)) RETURNING *`,
        [req.user.company_id, name, description || null, gst_applicable, gst_rate_percent]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Failed to create category' });
    }
  }
);

router.patch(
  '/:id',
  auth,
  roles('admin'),
  [param('id').isUUID()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    const { name, description, is_active, gst_applicable, gst_rate_percent } = req.body;
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
    if (is_active !== undefined) {
      fields.push(`is_active = $${i++}`);
      vals.push(Boolean(is_active));
    }
    if (gst_applicable !== undefined) {
      fields.push(`gst_applicable = $${i++}`);
      vals.push(Boolean(gst_applicable));
    }
    if (gst_rate_percent !== undefined) {
      fields.push(`gst_rate_percent = $${i++}`);
      vals.push(gst_rate_percent);
    }
    if (!fields.length) return res.status(400).json({ message: 'No updates' });
    vals.push(id, req.user.company_id);
    try {
      const r = await query(
        `UPDATE expense_categories SET ${fields.join(', ')} WHERE id = $${i++} AND company_id = $${i} RETURNING *`,
        vals
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Not found' });
      return res.json(r.rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Failed to update category' });
    }
  }
);

router.delete('/:id', auth, roles('admin'), [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const r = await query(
      `DELETE FROM expense_categories WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, req.user.company_id]
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Not found' });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to delete category' });
  }
});

module.exports = router;
