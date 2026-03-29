const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const { query } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

const fetchCurrencyForCountry = async (countryName) => {
  try {
    const res = await axios.get(
      `https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}?fullText=false`,
      { timeout: 8000 }
    );
    const country = res.data[0];
    const code = Object.keys(country.currencies || {})[0];
    const symbol = code ? country.currencies[code]?.symbol || code : '$';
    return { currency_code: code || 'USD', currency_symbol: symbol };
  } catch {
    return { currency_code: 'USD', currency_symbol: '$' };
  }
};

router.post(
  '/signup',
  [
    body('company_name').trim().notEmpty(),
    body('country').trim().notEmpty(),
    body('name').trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { company_name, country, name, email, password } = req.body;
    try {
      const dup = await query('SELECT id FROM users WHERE email = $1', [email]);
      if (dup.rows.length) return res.status(409).json({ message: 'Email already registered' });

      const { currency_code, currency_symbol } = await fetchCurrencyForCountry(country);
      const password_hash = await bcrypt.hash(password, 10);

      const companyRes = await query(
        `INSERT INTO companies (name, country, currency_code, currency_symbol)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [company_name, country, currency_code, currency_symbol]
      );
      const company = companyRes.rows[0];

      const userRes = await query(
        `INSERT INTO users (company_id, name, email, password_hash, role, is_manager_approver)
         VALUES ($1, $2, $3, $4, 'admin', true) RETURNING id, name, email, role, company_id, manager_id, is_manager_approver`,
        [company.id, name, email, password_hash]
      );
      const user = userRes.rows[0];

      await query(
        `INSERT INTO expense_categories (company_id, name, description) VALUES
         ($1, 'Travel', 'Travel and transport'),
         ($1, 'Meals', 'Meals and entertainment'),
         ($1, 'Office supplies', 'Office and equipment')`,
        [company.id]
      );

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      });

      return res.status(201).json({
        token,
        user: { ...user, company },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Signup failed' });
    }
  }
);

router.post(
  '/login',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    try {
      const result = await query(
        `SELECT u.*, c.name as company_name, c.country, c.currency_code, c.currency_symbol
         FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = $1`,
        [email]
      );
      if (!result.rows.length) return res.status(401).json({ message: 'Invalid credentials' });
      const row = result.rows[0];
      if (!row.is_active) return res.status(401).json({ message: 'Account inactive' });
      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

      const token = jwt.sign({ userId: row.id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      });

      const company = {
        id: row.company_id,
        name: row.company_name,
        country: row.country,
        currency_code: row.currency_code,
        currency_symbol: row.currency_symbol,
      };
      const user = {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        company_id: row.company_id,
        manager_id: row.manager_id,
        is_manager_approver: row.is_manager_approver,
        company,
      };
      return res.json({ token, user });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Login failed' });
    }
  }
);

router.get('/me', auth, async (req, res) => {
  try {
    const r = await query(`SELECT * FROM companies WHERE id = $1`, [req.user.company_id]);
    const company = r.rows[0];
    return res.json({
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        company_id: req.user.company_id,
        manager_id: req.user.manager_id,
        is_manager_approver: req.user.is_manager_approver,
      },
      company,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load profile' });
  }
});

module.exports = router;
