const Tesseract = require('tesseract.js');
const path = require('path');

const extractFields = (text, categories = []) => {
  const raw = text.replace(/\r/g, '\n');
  const result = {
    amount: null,
    date: null,
    vendor: null,
    rawText: raw.trim().slice(0, 2000),
    suggested_category_id: null,
    suggested_category_name: null,
    line_items: [],
  };

  const amountMatch =
    raw.match(/(?:total|amount|due|balance)\s*[:\s]*[\$€£₹]?\s*([\d,]+\.?\d*)/i) ||
    raw.match(/[\$€£₹]\s*([\d,]+\.?\d*)/);
  if (amountMatch) {
    const n = parseFloat(amountMatch[1].replace(/,/g, ''));
    if (!Number.isNaN(n)) result.amount = n;
  }

  const datePatterns = [
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
    /(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/,
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})/i,
  ];
  for (const p of datePatterns) {
    const m = raw.match(p);
    if (m) {
      const d = new Date(m[1]);
      if (!Number.isNaN(d.getTime())) {
        result.date = d.toISOString().slice(0, 10);
        break;
      }
    }
  }

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 0) {
    const skip = /^(receipt|invoice|tax|total|date|thank)/i;
    const vendorLine = lines.find((l) => l.length > 2 && l.length < 80 && !skip.test(l));
    if (vendorLine) result.vendor = vendorLine;
  }

  const low = raw.toLowerCase();
  const hints = [
    { keys: ['restaurant', 'meal', 'food', 'cafe', 'lunch', 'dinner', 'pizza'], name: 'Meals' },
    { keys: ['flight', 'hotel', 'uber', 'taxi', 'train', 'travel', 'airline'], name: 'Travel' },
    { keys: ['office', 'supply', 'staples', 'amazon', 'equipment'], name: 'Office supplies' },
  ];
  for (const h of hints) {
    if (h.keys.some((k) => low.includes(k))) {
      const cat = categories.find(
        (c) => c.name.toLowerCase().includes(h.name.toLowerCase()) || h.name.toLowerCase().includes(c.name.toLowerCase())
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
      if (n.length >= 3 && low.includes(n.slice(0, Math.min(6, n.length)))) {
        result.suggested_category_id = c.id;
        result.suggested_category_name = c.name;
        break;
      }
    }
  }

  const lineAmount = /^\s*(.+?)\s+[\$€£₹]?\s*([\d,]+\.\d{2})\s*$/;
  for (const line of lines.slice(0, 15)) {
    const m = line.match(lineAmount);
    if (m && !/total|subtotal|tax/i.test(line)) {
      result.line_items.push({ description: m[1].trim(), amount: parseFloat(m[2].replace(/,/g, '')) });
    }
  }

  return result;
};

const runOcrOnFile = async (filePath, categories = []) => {
  const abs = path.resolve(filePath);
  const {
    data: { text },
  } = await Tesseract.recognize(abs, 'eng', { logger: () => {} });
  return extractFields(text, categories);
};

module.exports = { runOcrOnFile, extractFields };
