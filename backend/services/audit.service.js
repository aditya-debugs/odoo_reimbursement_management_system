const crypto = require('crypto');
const { query, withTransaction } = require('../db');

const stableValue = (v) => {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(stableValue);
  if (typeof v !== 'object') return v;
  const out = {};
  for (const k of Object.keys(v).sort()) {
    out[k] = stableValue(v[k]);
  }
  return out;
};

const canonicalBlock = (chainIndex, action, actorId, expenseId, payload, prevHash) =>
  JSON.stringify({
    chain_index: chainIndex,
    action,
    actor_id: actorId,
    expense_id: expenseId,
    payload: stableValue(payload && typeof payload === 'object' ? payload : {}),
    prev_hash: prevHash,
  });

const computeHash = (chainIndex, action, actorId, expenseId, payload, prevHash) =>
  crypto.createHash('sha256').update(canonicalBlock(chainIndex, action, actorId, expenseId, payload, prevHash)).digest('hex');

const appendAuditBlock = async (client, { companyId, action, actorId, expenseId, payload = {} }) => {
  const maxRes = await client.query(
    `SELECT COALESCE(MAX(chain_index), -1)::bigint AS m FROM audit_chain WHERE company_id = $1`,
    [companyId]
  );
  const nextIndex = Number(maxRes.rows[0].m) + 1;
  const prevRes = await client.query(
    `SELECT hash FROM audit_chain WHERE company_id = $1 AND chain_index = $2`,
    [companyId, nextIndex - 1]
  );
  const prev_hash = nextIndex === 0 ? '0'.repeat(64) : prevRes.rows[0]?.hash || '0'.repeat(64);

  const hash = computeHash(nextIndex, action, actorId, expenseId, payload, prev_hash);

  const ins = await client.query(
    `INSERT INTO audit_chain (company_id, chain_index, action, actor_id, expense_id, payload, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING *`,
    [companyId, nextIndex, action, actorId || null, expenseId || null, JSON.stringify(payload), prev_hash, hash]
  );
  return ins.rows[0];
};

const appendAuditBlockQuery = ({ companyId, action, actorId, expenseId, payload = {} }) =>
  withTransaction((client) => appendAuditBlock(client, { companyId, action, actorId, expenseId, payload }));

async function verifyCompanyChain(companyId) {
  const r = await query(
    `SELECT * FROM audit_chain WHERE company_id = $1 ORDER BY chain_index ASC`,
    [companyId]
  );
  const rows = r.rows;
  let prev = '0'.repeat(64);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.prev_hash !== prev) {
      return { valid: false, error: `prev_hash mismatch at index ${row.chain_index}`, index: row.chain_index };
    }
    const expected = computeHash(
      row.chain_index,
      row.action,
      row.actor_id,
      row.expense_id,
      row.payload,
      row.prev_hash
    );
    if (expected !== row.hash) {
      return { valid: false, error: `hash mismatch at index ${row.chain_index}`, index: row.chain_index };
    }
    prev = row.hash;
  }
  return { valid: true, blocks: rows.length };
}

module.exports = { appendAuditBlock, appendAuditBlockQuery, verifyCompanyChain, computeHash, canonicalBlock };
