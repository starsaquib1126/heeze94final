// GET /api/geo
// Returns the visitor's detected currency based on Vercel's built-in
// IP geolocation header — no third-party service, no API key needed.
// Rates are fixed/manual (set by the business), not live — simpler and
// more predictable than a live exchange-rate API for a small store.
// Update these numbers periodically as real exchange rates shift.

const RATES = {
  IN: { code: 'INR', symbol: '₹', rate: 1 },       // base currency, no conversion
  AE: { code: 'AED', symbol: 'AED ', rate: 0.044 },  // UAE / Dubai
  US: { code: 'USD', symbol: '$', rate: 0.012 },
};
const DEFAULT = { code: 'USD', symbol: '$', rate: 0.012 }; // fallback for every other country

export default function handler(req, res) {
  const country = req.headers['x-vercel-ip-country'] || 'IN';
  const currency = RATES[country] || DEFAULT;

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  return res.status(200).json({ country, ...currency });
}
