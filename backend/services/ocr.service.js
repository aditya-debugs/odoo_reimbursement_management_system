const path = require('path');
const sharp = require('sharp');
const { createWorker, PSM } = require('tesseract.js');
const { refineReceiptWithOpenAI, mergeTesseractAndAi } = require('./ocr-ai.service');

/** @typedef {{ id: string, name: string }} Category */

const toLines = (text) =>
  text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** Street / address lines — exclude from category keyword matching (e.g. "Market St.") */
const looksLikeAddressLine = (l) =>
  /\b(st|ave|rd|blvd|street|suite|apt|unit|zip|pin)\b\.?/i.test(l) && /\d/.test(l);

/**
 * Prefer true TOTAL / GRAND TOTAL / AMOUNT DUE, never SUBTOTAL or line-item totals.
 */
function extractTotalAmount(lines) {
  const candidates = [];
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    if (/\bSUBTOTAL\b|\bSUB-TOTAL\b/i.test(l)) continue;
    if (/\bTAX\b\s*[:]/i.test(l) && !/\bTOTAL\b/i.test(l)) continue;
    if (/\bCHANGE\b|\bPAYMENT\b|\bVISA\b|\bMASTERCARD\b|\bCASH\b|\bDEBIT\b/i.test(l) && !/\bTOTAL\b/i.test(l))
      continue;

    const patterns = [
      /\b(?:GRAND\s+)?TOTAL\b\s*[:\s]*[\$€£₹]?\s*([\d,]+\.\d{1,2})\b/i,
      /\bAMOUNT\s+DUE\b\s*[:\s]*[\$€£₹]?\s*([\d,]+\.\d{1,2})\b/i,
      /\bBALANCE\s+DUE\b\s*[:\s]*[\$€£₹]?\s*([\d,]+\.\d{1,2})\b/i,
    ];
    for (const p of patterns) {
      const m = l.match(p);
      if (m) {
        const n = parseFloat(m[1].replace(/,/g, ''));
        if (!Number.isNaN(n) && n > 0 && n < 1_000_000) candidates.push(n);
      }
    }
  }
  if (candidates.length) return candidates[candidates.length - 1];

  // Fallback: last "TOTAL" amount on a line (scan bottom-up)
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (/\bSUBTOTAL\b/i.test(l)) continue;
    const m = l.match(/\bTOTAL\b\s*[:\s]*[\$€£₹]?\s*([\d,]+\.\d{1,2})\b/i);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!Number.isNaN(n) && n > 0) return n;
    }
  }

  // Weak fallback: currency + amount (prefer larger amounts typical of totals)
  const money = [];
  const re = /[\$€£₹]\s*([\d,]+\.\d{1,2})\b/g;
  let mm;
  const blob = lines.join('\n');
  while ((mm = re.exec(blob)) !== null) {
    const n = parseFloat(mm[1].replace(/,/g, ''));
    if (!Number.isNaN(n) && n >= 1 && n < 100_000) money.push(n);
  }
  if (money.length) return Math.max(...money);

  return null;
}

/**
 * @param {string} token
 * @param {'mdy' | 'dmy'} order
 */
function parseSlashedDate(token, order) {
  const m = token.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return null;
  let p1 = parseInt(m[1], 10);
  let p2 = parseInt(m[2], 10);
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2000;

  let month;
  let day;
  if (order === 'mdy') {
    month = p1;
    day = p2;
    if (p1 > 12) {
      day = p1;
      month = p2;
    }
  } else {
    day = p1;
    month = p2;
    if (p2 > 12) {
      month = p1;
      day = p2;
    }
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(y, month - 1, day));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function extractDate(lines, raw, preferMDY) {
  const order = preferMDY ? 'mdy' : 'dmy';
  const dateToken = /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/;

  for (let i = 0; i < Math.min(15, lines.length); i++) {
    const l = lines[i];
    if (/\bdate\b/i.test(l)) {
      const m = l.match(dateToken);
      if (m) {
        const iso = parseSlashedDate(m[1], order);
        if (iso) return iso;
      }
    }
  }

  for (let i = 0; i < Math.min(12, lines.length); i++) {
    const m = lines[i].match(dateToken);
    if (m) {
      const iso = parseSlashedDate(m[1], order);
      if (iso) return iso;
    }
  }

  const isoMatch = raw.match(/(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})/);
  if (isoMatch) {
    const d = new Date(isoMatch[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  const m = raw.match(dateToken);
  if (m) {
    const iso = parseSlashedDate(m[1], order);
    if (iso) return iso;
  }

  const textMonth = raw.match(
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})/i
  );
  if (textMonth) {
    const d = new Date(textMonth[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  return null;
}

function inferCurrency(raw, totalLineContext) {
  const sample = `${totalLineContext || ''}\n${raw}`.slice(0, 4000);
  const counts = {
    USD: (sample.match(/\$/g) || []).length,
    EUR: (sample.match(/€|EUR\b/gi) || []).length,
    GBP: (sample.match(/£|GBP\b/gi) || []).length,
    INR: (sample.match(/₹|INR\b|Rs\.?\s*\d/gi) || []).length,
  };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (best[1] > 0) return best[0];
  return null;
}

/** House number + street — never use as merchant title */
function looksLikeStreetLine(l) {
  if (looksLikeAddressLine(l)) return true;
  if (/^\d{1,5}\s+.+\b(st|ave|rd|blvd|street|lane|dr\.?|drive|ct|court|way|plaza|hwy|highway)\b/i.test(l))
    return true;
  if (/^[A-Za-z][A-Za-z\s]+,\s*(USA|UK|UAE|India)\b/i.test(l) && l.length < 48) return true;
  return false;
}

function extractVendor(lines) {
  const skipStart =
    /^(receipt|invoice|tax\s*invoice|tel|phone|fax|date|time|thank|www\.|http|order|cashier|subtotal|total|tax\b)/i;
  const phone = /(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/;

  const isGoodCandidate = (l) => {
    if (l.length < 2 || l.length > 72) return false;
    if (!/[A-Za-z]/.test(l)) return false;
    if (skipStart.test(l)) return false;
    if (looksLikeStreetLine(l)) return false;
    if (phone.test(l) && l.length < 30) return false;
    if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(l)) return false;
    if (/^#?\d{5,}$/.test(l)) return false;
    if (/^[\d\s#\-:@]+$/.test(l)) return false;
    if (/^\d+[x×]\s/i.test(l)) return false;
    return true;
  };

  const head = Math.min(14, lines.length);
  // Prefer store banner: starts with a letter (skip "1234 Market St."-style lines)
  for (let i = 0; i < head; i++) {
    const l = lines[i].trim();
    if (!isGoodCandidate(l)) continue;
    if (/^[A-Za-z]/.test(l)) return l.replace(/\s+/g, ' ');
  }
  for (let i = 0; i < head; i++) {
    const l = lines[i].trim();
    if (!isGoodCandidate(l)) continue;
    if (/^\d/.test(l) && !/[A-Za-z]{4,}/.test(l)) continue;
    return l.replace(/\s+/g, ' ');
  }
  return null;
}

/**
 * @param {string} text
 * @param {Category[]} categories
 */
const extractFields = (text, categories = []) => {
  const raw = text.replace(/\r/g, '\n');
  const lines = toLines(raw);
  const result = {
    amount: null,
    date: null,
    vendor: null,
    rawText: raw.trim().slice(0, 2000),
    suggested_category_id: null,
    suggested_category_name: null,
    suggested_currency_code: null,
    line_items: [],
  };

  const preferMDY = inferCurrency(raw, lines.join('\n')) === 'USD' || /\$\s*\d/.test(raw);

  result.amount = extractTotalAmount(lines);
  result.date = extractDate(lines, raw, preferMDY);
  result.vendor = extractVendor(lines);
  result.suggested_currency_code = inferCurrency(raw, lines.slice(-8).join('\n'));

  const lowForHints = lines
    .filter((l) => !looksLikeAddressLine(l))
    .join(' ')
    .toLowerCase();

  const hints = [
    { keys: ['restaurant', 'meal', 'food', 'cafe', 'lunch', 'dinner', 'pizza', 'grocery'], name: 'Meals' },
    { keys: ['flight', 'hotel', 'uber', 'taxi', 'train', 'travel', 'airline'], name: 'Travel' },
    { keys: ['office', 'supply', 'staples', 'amazon', 'equipment'], name: 'Office supplies' },
  ];
  for (const h of hints) {
    if (h.keys.some((k) => lowForHints.includes(k))) {
      const cat = categories.find(
        (c) =>
          c.name.toLowerCase().includes(h.name.toLowerCase()) ||
          h.name.toLowerCase().includes(c.name.toLowerCase())
      );
      if (cat) {
        result.suggested_category_id = cat.id;
        result.suggested_category_name = cat.name;
        break;
      }
    }
  }

  if (!result.suggested_category_id && categories.length) {
    for (const c of categories) {
      const n = c.name.toLowerCase();
      if (n.length < 3) continue;
      const prefix = n.slice(0, Math.min(6, n.length));
      if (prefix.length >= 4 && lowForHints.includes(prefix)) {
        result.suggested_category_id = c.id;
        result.suggested_category_name = c.name;
        break;
      }
    }
  }

  const lineAmount = /^\s*(.+?)\s+[\$€£₹]?\s*([\d,]+\.\d{2})\s*$/;
  for (const line of lines.slice(0, 20)) {
    const m = line.match(lineAmount);
    if (m && !/total|subtotal|tax|change|payment|balance|discount/i.test(line)) {
      result.line_items.push({ description: m[1].trim(), amount: parseFloat(m[2].replace(/,/g, '')) });
    }
  }

  return result;
};

async function preprocessForOcr(filePath) {
  const abs = path.resolve(filePath);
  const meta = await sharp(abs).metadata();
  const w = meta.width || 1200;

  let img = sharp(abs).rotate();
  if (w < 900) {
    img = img.resize({ width: 1200, kernel: sharp.kernel.lanczos3, withoutEnlargement: false });
  } else if (w > 2200) {
    img = img.resize({ width: 2000, kernel: sharp.kernel.lanczos3, withoutEnlargement: true });
  }

  return img.greyscale().normalize({ lower: 2, upper: 98 }).sharpen().png().toBuffer();
}

async function runOcrOnFile(filePath, categories = []) {
  const imageBuffer = await preprocessForOcr(filePath);
  let worker;
  let text = '';
  try {
    worker = await createWorker('eng', 1, { logger: () => {} });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
    });
    const {
      data: { text: ocrText },
    } = await worker.recognize(imageBuffer);
    text = ocrText || '';
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }

  const tessChars = (text || '').trim().length;
  console.log(`[ocr] Tesseract finished — ${tessChars} chars extracted`);

  const base = extractFields(text, categories);
  const aiOut = await refineReceiptWithOpenAI(imageBuffer, text, categories);
  const merged = mergeTesseractAndAi(base, aiOut.data, categories, aiOut.provider);
  if (aiOut.error_code) merged.ocr_ai_error = aiOut.error_code;

  const pipeline = merged.ocr_source || 'unknown';
  const llmBit = merged.ai_refined
    ? `LLM=${aiOut.provider || 'unknown'} (refined)`
    : 'LLM=off (Tesseract parse only)';
  const errBit = merged.ocr_ai_error ? ` llm_error=${merged.ocr_ai_error}` : '';
  console.log(`[ocr] result — pipeline=${pipeline} | ${llmBit}${errBit}`);

  return merged;
}

module.exports = { runOcrOnFile, extractFields };
