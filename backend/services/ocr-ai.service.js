const axios = require('axios');
const sharp = require('sharp');

const ALLOWED_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'INR']);

/** Groq rejects base64 payloads over ~4MB; stay under this encoded length */
const GROQ_MAX_B64_CHARS = 3_500_000;

function buildReceiptPrompts(tesseractText, categories = []) {
  const categoryNames = categories.map((c) => c.name).filter(Boolean);
  const system = `You are a receipt data extractor for an expense system. Output valid JSON only.
Rules:
- amount = final total the customer pays (prefer TOTAL over SUBTOTAL; include tax if that is what TOTAL shows).
- date = transaction date on the receipt as YYYY-MM-DD (infer US vs EU date order from context and currency).
- vendor = short merchant name (e.g. store banner), not address.
- currency_code = one of: USD, EUR, GBP, INR — from symbols on the receipt.
- suggested_category_name = best match from the provided list only, or null if none fits.
- line_items = itemized lines if clearly visible, else [].
- Do not invent numbers; use null if unreadable.`;

  const userText = `Expense categories for this company (exact names): ${JSON.stringify(categoryNames)}

Local OCR text (often wrong — use image as truth, this as hint):
---
${(tesseractText || '').slice(0, 8000)}
---

Return JSON with keys: amount (number|null), date (string YYYY-MM-DD|null), vendor (string|null), currency_code (string|null), suggested_category_name (string|null), line_items (array of {description: string, amount: number}), confidence ("high"|"medium"|"low").`;

  return { system, userText };
}

/**
 * Groq: JPEG + resize so base64 stays under limit.
 * OpenAI: PNG data URL; optional JPEG if huge.
 */
async function imageToDataUrl(imageBuffer, provider) {
  if (provider === 'groq') {
    let buf = await sharp(imageBuffer).rotate().jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    let width = 1600;
    while (buf.toString('base64').length > GROQ_MAX_B64_CHARS && width > 480) {
      width -= 240;
      buf = await sharp(imageBuffer)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer();
    }
    const b64 = buf.toString('base64');
    return { dataUrl: `data:image/jpeg;base64,${b64}`, mime: 'jpeg' };
  }

  const b64 = imageBuffer.toString('base64');
  let dataUrl = `data:image/png;base64,${b64}`;
  if (b64.length > GROQ_MAX_B64_CHARS) {
    const buf = await sharp(imageBuffer).rotate().jpeg({ quality: 85, mozjpeg: true }).resize({ width: 2048 }).toBuffer();
    dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
  return { dataUrl, mime: dataUrl.includes('jpeg') ? 'jpeg' : 'png' };
}

/**
 * @returns {'groq' | 'openai' | null}
 */
function resolveVisionProvider() {
  const explicit = (process.env.OCR_AI_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'groq' || explicit === 'openai') return explicit;

  const groq = (process.env.GROQ_API_KEY || '').trim();
  const openai = (process.env.OPENAI_API_KEY || '').trim();
  if (groq) return 'groq';
  if (openai) return 'openai';
  return null;
}

function apiErrorCode(err) {
  const d = err.response?.data;
  return d?.error?.code || d?.error?.type || 'llm_error';
}

/**
 * @returns {{ data: object|null, error_code: string|null, provider: string|null }}
 */
async function refineReceiptWithOpenAI(imagePngBuffer, tesseractText, categories = []) {
  if (String(process.env.OCR_AI_DISABLED).toLowerCase() === 'true') {
    console.log('[ocr-ai] LLM vision skipped — OCR_AI_DISABLED=true');
    return { data: null, error_code: null, provider: null };
  }

  const provider = resolveVisionProvider();
  if (!provider) {
    console.log('[ocr-ai] LLM vision skipped — no GROQ_API_KEY or OPENAI_API_KEY (Tesseract-only pipeline)');
    return { data: null, error_code: null, provider: null };
  }

  const apiKey =
    provider === 'groq'
      ? (process.env.GROQ_API_KEY || '').trim()
      : (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    console.log(
      `[ocr-ai] LLM vision skipped — OCR_AI_PROVIDER=${provider} but the matching API key is empty`
    );
    return { data: null, error_code: null, provider: null };
  }

  const { system, userText } = buildReceiptPrompts(tesseractText, categories);
  let dataUrl;
  try {
    const enc = await imageToDataUrl(imagePngBuffer, provider);
    dataUrl = enc.dataUrl;
  } catch (e) {
    console.error('[ocr-ai] image encode failed:', e.message);
    return { data: null, error_code: 'image_encode_error', provider };
  }

  const groqModel = process.env.OCR_GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
  const openaiModel = process.env.OCR_AI_MODEL || 'gpt-4o-mini';
  if (provider === 'groq') {
    console.log(`[ocr-ai] calling Groq vision → model=${groqModel}`);
  } else {
    console.log(`[ocr-ai] calling OpenAI vision → model=${openaiModel}`);
  }

  const imagePart =
    provider === 'openai'
      ? { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
      : { type: 'image_url', image_url: { url: dataUrl } };

  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [{ type: 'text', text: userText }, imagePart],
    },
  ];

  try {
    let responseData;
    if (provider === 'groq') {
      const model = groqModel;
      const { data } = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model,
          temperature: 0.1,
          max_completion_tokens: 800,
          response_format: { type: 'json_object' },
          messages,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 90000,
        }
      );
      responseData = data;
    } else {
      const model = openaiModel;
      const { data } = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          temperature: 0.1,
          max_tokens: 800,
          response_format: { type: 'json_object' },
          messages,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );
      responseData = data;
    }

    const raw = responseData?.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== 'string') {
      console.log(`[ocr-ai] ${provider} response had no message content — using Tesseract parse only`);
      return { data: null, error_code: 'empty_response', provider };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.log(`[ocr-ai] ${provider} returned non-JSON — using Tesseract parse only`);
      return { data: null, error_code: 'invalid_response', provider };
    }
    const normalized = normalizeAiPayload(parsed);
    if (!normalized || !hasUsefulAiData(normalized)) {
      console.log(
        `[ocr-ai] ${provider} JSON had no usable fields (amount/vendor/date/currency) — using Tesseract parse only`
      );
      return { data: null, error_code: null, provider };
    }
    const bits = [
      normalized.vendor && `vendor="${normalized.vendor}"`,
      normalized.amount != null && `amount=${normalized.amount}`,
      normalized.date && `date=${normalized.date}`,
      normalized.currency_code && `currency=${normalized.currency_code}`,
    ].filter(Boolean);
    console.log(
      `[ocr-ai] ${provider} vision OK — merged over Tesseract [${bits.join(', ') || 'fields updated'}]`
    );
    return { data: normalized, error_code: null, provider };
  } catch (err) {
    const label = provider === 'groq' ? 'Groq' : 'OpenAI';
    console.error(`[ocr-ai] ${label} request failed:`, err.response?.data || err.message);
    console.log(`[ocr-ai] falling back to Tesseract-only (error_code=${apiErrorCode(err)})`);
    return { data: null, error_code: apiErrorCode(err), provider };
  }
}

function hasUsefulAiData(a) {
  return (
    a.amount != null ||
    !!a.date ||
    !!a.vendor ||
    !!a.currency_code ||
    (a.line_items && a.line_items.length > 0) ||
    !!a.suggested_category_name
  );
}

function normalizeAiPayload(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out = {
    amount: null,
    date: null,
    vendor: null,
    currency_code: null,
    suggested_category_name: null,
    line_items: [],
    confidence: typeof parsed.confidence === 'string' ? parsed.confidence : null,
  };

  if (typeof parsed.amount === 'number' && parsed.amount > 0 && parsed.amount < 10_000_000) {
    out.amount = Math.round(parsed.amount * 100) / 100;
  }

  if (typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
    const [y, m, d] = parsed.date.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (!Number.isNaN(dt.getTime())) out.date = parsed.date;
  }

  if (typeof parsed.vendor === 'string') {
    const v = parsed.vendor.trim();
    if (v.length > 0 && v.length <= 200) out.vendor = v;
  }

  if (typeof parsed.currency_code === 'string') {
    const c = parsed.currency_code.trim().toUpperCase();
    if (ALLOWED_CURRENCIES.has(c)) out.currency_code = c;
  }

  if (typeof parsed.suggested_category_name === 'string') {
    const s = parsed.suggested_category_name.trim();
    out.suggested_category_name = s.length ? s : null;
  }

  if (Array.isArray(parsed.line_items)) {
    for (const row of parsed.line_items.slice(0, 30)) {
      if (!row || typeof row !== 'object') continue;
      const desc = typeof row.description === 'string' ? row.description.trim() : '';
      const amt = typeof row.amount === 'number' ? row.amount : parseFloat(row.amount);
      if (desc && !Number.isNaN(amt) && amt >= 0) {
        out.line_items.push({ description: desc.slice(0, 500), amount: Math.round(amt * 100) / 100 });
      }
    }
  }

  return out;
}

/**
 * @param {object} base — Tesseract extractFields result
 * @param {object|null} ai — normalized AI payload
 * @param {{ id: string, name: string }[]} categories
 * @param {string|null} llmProvider — 'groq' | 'openai'
 */
function mergeTesseractAndAi(base, ai, categories = [], llmProvider = null) {
  if (!ai) {
    return { ...base, ocr_source: 'tesseract', ai_refined: false };
  }

  const out = { ...base };

  if (ai.amount != null) out.amount = ai.amount;
  if (ai.date) out.date = ai.date;
  if (ai.vendor) out.vendor = ai.vendor;
  if (ai.currency_code) out.suggested_currency_code = ai.currency_code;
  if (ai.line_items.length > 0) out.line_items = ai.line_items;

  if (ai.suggested_category_name && categories.length) {
    const want = ai.suggested_category_name.toLowerCase();
    const exact = categories.find((c) => c.name.toLowerCase() === want);
    const fuzzy =
      exact ||
      categories.find(
        (c) =>
          want.includes(c.name.toLowerCase()) ||
          c.name.toLowerCase().includes(want) ||
          c.name.toLowerCase().split(/[\s(&]+/)[0] === want.split(/[\s(&]+/)[0]
      );
    if (fuzzy) {
      out.suggested_category_id = fuzzy.id;
      out.suggested_category_name = fuzzy.name;
    }
  }

  out.ai_refined = true;
  out.ocr_source = llmProvider ? `tesseract+${llmProvider}` : 'tesseract+llm';
  if (ai.confidence) out.ai_confidence = ai.confidence;

  return out;
}

module.exports = {
  refineReceiptWithOpenAI,
  mergeTesseractAndAi,
};
