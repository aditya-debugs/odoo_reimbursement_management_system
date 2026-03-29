const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { runMigrations } = require('./db/migrate');

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const PORT = process.env.PORT || 5000;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(cors({ origin: frontendUrl, credentials: true }));
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/approvals', require('./routes/approvals'));
app.use('/api/rules', require('./routes/rules'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/budgets', require('./routes/budgets'));
app.use('/api/gst', require('./routes/gst'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: err.message || 'Server error' });
});

const server = http.createServer(app);

server.listen(PORT, async () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log('Leave this terminal open while you use the app. Press Ctrl+C to stop the server.');
  try {
    await runMigrations();
  } catch (e) {
    console.error('Migrations did not complete:', e.message);
  }
});

server.on('error', (err) => {
  console.error('Server failed to start:', err.message);
  process.exit(1);
});

server.on('close', () => {
  console.log('HTTP server closed.');
});

// Windows / some IDEs: stdin can end immediately; without active handles Node may exit.
// The HTTP server should already keep the process alive; this avoids edge cases.
try {
  if (process.stdin.isTTY) process.stdin.resume();
} catch {
  /* ignore */
}
