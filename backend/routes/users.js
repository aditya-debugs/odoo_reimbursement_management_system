const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../db');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

const router = express.Router();

router.use(auth, roles('admin'));

router.get('/', async (req, res) => {
  try {
    const r = await query(
      `SELECT u.id, u.name, u.email, u.role, u.manager_id, u.is_manager_approver, u.is_active, u.created_at,
              m.name as manager_name
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
       WHERE u.company_id = $1
       ORDER BY u.created_at ASC`,
      [req.user.company_id]
    );
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to list users' });
  }
});

router.post(
  '/',
  [
    body('name').trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('role').isIn(['admin', 'manager', 'employee', 'financer', 'director']),
    body('manager_id')
      .optional({ nullable: true, checkFalsy: true })
      .isUUID()
      .withMessage('Manager must be a valid user id'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, password, role, manager_id, is_manager_approver } = req.body;
    try {
      const dup = await query('SELECT id FROM users WHERE email = $1', [email]);
      if (dup.rows.length) return res.status(409).json({ message: 'Email already in use' });

      if (manager_id) {
        const mgr = await query(
          `SELECT id FROM users WHERE id = $1 AND company_id = $2`,
          [manager_id, req.user.company_id]
        );
        if (!mgr.rows.length) return res.status(400).json({ message: 'Invalid manager' });
      }

      const password_hash = await bcrypt.hash(password, 10);
      const r = await query(
        `INSERT INTO users (company_id, name, email, password_hash, role, manager_id, is_manager_approver)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, email, role, manager_id, is_manager_approver, is_active, created_at`,
        [
          req.user.company_id,
          name,
          email,
          password_hash,
          role,
          manager_id || null,
          Boolean(is_manager_approver),
        ]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err) {
      console.error(err);
      if (err.code === '22P02') {
        return res.status(400).json({ message: 'Invalid id format (e.g. manager id must be a UUID)' });
      }
      return res.status(500).json({ message: 'Failed to create user' });
    }
  }
);

router.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('manager_id')
      .optional({ nullable: true, checkFalsy: true })
      .isUUID()
      .withMessage('Manager must be a valid user id'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    const { name, role, manager_id, is_manager_approver, is_active, password } = req.body;

    try {
      const existing = await query(
        `SELECT id FROM users WHERE id = $1 AND company_id = $2`,
        [id, req.user.company_id]
      );
      if (!existing.rows.length) return res.status(404).json({ message: 'User not found' });
      if (id === req.user.id && role && role !== 'admin') {
        return res.status(400).json({ message: 'Cannot demote yourself' });
      }

      const fields = [];
      const vals = [];
      let i = 1;
      if (name != null) {
        fields.push(`name = $${i++}`);
        vals.push(name);
      }
      if (role != null) {
        if (!['admin', 'manager', 'employee', 'financer', 'director'].includes(role)) {
          return res.status(400).json({ message: 'Invalid role' });
        }
        fields.push(`role = $${i++}`);
        vals.push(role);
      }
      if (manager_id !== undefined) {
        if (manager_id) {
          const mgr = await query(
            `SELECT id FROM users WHERE id = $1 AND company_id = $2`,
            [manager_id, req.user.company_id]
          );
          if (!mgr.rows.length) return res.status(400).json({ message: 'Invalid manager' });
        }
        fields.push(`manager_id = $${i++}`);
        vals.push(manager_id || null);
      }
      if (is_manager_approver !== undefined) {
        fields.push(`is_manager_approver = $${i++}`);
        vals.push(Boolean(is_manager_approver));
      }
      if (is_active !== undefined) {
        fields.push(`is_active = $${i++}`);
        vals.push(Boolean(is_active));
      }
      if (password) {
        const password_hash = await bcrypt.hash(password, 10);
        fields.push(`password_hash = $${i++}`);
        vals.push(password_hash);
      }

      if (!fields.length) return res.status(400).json({ message: 'No updates' });

      vals.push(id, req.user.company_id);
      const r = await query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $${i++} AND company_id = $${i}
         RETURNING id, name, email, role, manager_id, is_manager_approver, is_active, created_at`,
        vals
      );
      return res.json(r.rows[0]);
    } catch (err) {
      console.error(err);
      if (err.code === '22P02') {
        return res.status(400).json({ message: 'Invalid id format (e.g. manager id must be a UUID)' });
      }
      return res.status(500).json({ message: 'Failed to update user' });
    }
  }
);

router.delete('/:id', [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ message: 'Cannot delete yourself' });

  try {
    const r = await query(`DELETE FROM users WHERE id = $1 AND company_id = $2 RETURNING id`, [
      id,
      req.user.company_id,
    ]);
    if (!r.rows.length) return res.status(404).json({ message: 'User not found' });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to delete user' });
  }
});

module.exports = router;
