const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

async function runMigrations() {
  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query(sql);
      console.log(`Migration applied: ${file}`);
    }
  } catch (err) {
    console.error('Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
