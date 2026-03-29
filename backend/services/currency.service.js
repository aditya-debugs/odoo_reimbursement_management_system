const axios = require('axios');

let ratesCache = {};
let lastFetch = {};

const getExchangeRates = async (baseCurrency) => {
  const now = Date.now();
  const TTL = 60 * 60 * 1000; // 1 hour cache
  if (ratesCache[baseCurrency] && now - lastFetch[baseCurrency] < TTL) {
    return ratesCache[baseCurrency];
  }
  try {
    const res = await axios.get(`https://api.exchangerate-api.com/v4/latest/${baseCurrency}`);
    ratesCache[baseCurrency] = res.data.rates;
    lastFetch[baseCurrency] = now;
    return res.data.rates;
  } catch (err) {
    console.error('Currency fetch error:', err.message);
    return ratesCache[baseCurrency] || { [baseCurrency]: 1 };
  }
};

const convertAmount = async (amount, fromCurrency, toCurrency) => {
  if (fromCurrency === toCurrency) return { converted: amount, rate: 1 };
  const rates = await getExchangeRates(fromCurrency);
  const rate = rates[toCurrency];
  if (!rate) return { converted: amount, rate: 1 };
  return { converted: parseFloat((amount * rate).toFixed(2)), rate };
};

module.exports = { getExchangeRates, convertAmount };
