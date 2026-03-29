const express = require('express');
const { query } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

router.use(auth);

router.get('/', async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.user.id]
    );
    const unread = await query(
      `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    return res.json({ items: r.rows, unread_count: unread.rows[0].c });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load notifications' });
  }
});

router.patch('/read-all', async (req, res) => {
  try {
    await query(`UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`, [req.user.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to update notifications' });
  }
});

module.exports = router;
