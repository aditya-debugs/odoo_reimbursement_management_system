const Tesseract = require('tesseract.js');
const path = require('path');

const extractFields = (text) => {
  const raw = text.replace(/\r/g, '\n');
  const result = { amount: null, date: null, vendor: null, rawText: raw.trim().slice(0, 2000) };

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

  return result;
};

const runOcrOnFile = async (filePath) => {
  const abs = path.resolve(filePath);
  const {
    data: { text },
  } = await Tesseract.recognize(abs, 'eng', { logger: () => {} });
  return extractFields(text);
};

module.exports = { runOcrOnFile, extractFields };
