const express = require('express');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');
const { query } = require('../db');
const { verifyCompanyChain } = require('../services/audit.service');

const router = express.Router();

router.get('/chain', auth, roles('admin'), async (req, res) => {
  try {
    const r = await query(
      `SELECT id, chain_index, action, actor_id, expense_id, payload, prev_hash, hash, created_at
       FROM audit_chain WHERE company_id = $1 ORDER BY chain_index ASC`,
      [req.user.company_id]
    );
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load audit chain' });
  }
});

router.post('/verify', auth, roles('admin'), async (_req, res) => {
  try {
    const result = await verifyCompanyChain(_req.user.company_id);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Verification failed' });
  }
});

module.exports = router;
