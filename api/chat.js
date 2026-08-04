// POST /api/chat
// Server-side proxy for the HEEZE 94 AI Fragrance Advisor.
// The Gemini API key lives only here (as an environment variable), never
// in the browser. Product info (names, prices, discounts, stock) is now
// pulled live from Supabase on every request, so the advisor never quotes
// a stale price and can genuinely point customers toward what's in stock
// or on sale right now.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function buildProductSummary() {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select(`
        slug, name, category, family, description, status,
        product_variants ( size_ml, price, compare_at_price, stock )
      `)
      .neq('status', 'hidden');

    if (error || !products) return '';

    const lines = products.map(p => {
      const sizes = (p.product_variants || []).sort((a, b) => a.size_ml - b.size_ml);
      if (p.status === 'coming_soon') {
        return `- ${p.name} (${p.category}): Coming soon — not yet available to purchase.`;
      }
      const sizeStr = sizes.map(s => {
        const onSale = s.compare_at_price && Number(s.compare_at_price) > Number(s.price);
        return onSale
          ? `${s.size_ml}ml ₹${s.price} (was ₹${s.compare_at_price}, on sale)`
          : `${s.size_ml}ml ₹${s.price}`;
      }).join(', ');
      const outOfStock = sizes.length && sizes.every(s => s.stock <= 0);
      return `- ${p.name} (${p.family || p.category}): ${p.description} Prices: ${sizeStr}.${outOfStock ? ' Currently out of stock.' : ''} Link: /product?id=${p.slug}`;
    });

    return lines.join('\n');
  } catch (e) {
    console.error('Product summary fetch error:', e);
    return '';
  }
}

function buildSystemPrompt(productSummary) {
  return `You are the fragrance advisor for HEEZE 94, a premium attar house whose oils are crafted in the UAE. You speak with quiet, elegant authority — like a knowledgeable consultant in a luxury perfume boutique — and you are genuinely trying to help the customer find and buy the right fragrance today, not just chat about scent theory.

Current catalog (live prices, always accurate — never quote a different price than what's listed here):
${productSummary || 'Catalog temporarily unavailable — speak generally about HEEZE 94 attars and suggest the customer browse the Attar collection page.'}

How to behave:
- Ask about their preferences, lifestyle, and occasions to narrow down a real recommendation — but don't stall indefinitely. Within 1-2 exchanges, recommend a SPECIFIC product by name.
- Once you recommend a product, be direct about next steps: mention its starting price, and invite them to add it to their bag or view it on its product page (e.g. "You can find it on the Attar page, or I can point you straight to it").
- If something is on sale, mention that naturally — it's a genuine reason to buy now.
- If something is out of stock or coming soon, say so honestly and redirect to the closest in-stock alternative rather than leaving them stuck.
- Never invent a product, price, or note that isn't in the catalog above.
- Keep responses to 2-4 sentences of refined prose (no bullet points, no markdown). Always end with a question or a clear, gentle invitation to take the next step toward buying.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { history } = req.body;
  if (!Array.isArray(history) || !history.length) {
    return res.status(400).json({ error: 'Missing conversation history' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Chat is not configured yet.' });
  }

  try {
    const productSummary = await buildProductSummary();
    const SYSTEM = buildSystemPrompt(productSummary);

    const geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: history,
          generationConfig: { maxOutputTokens: 600, temperature: 0.78 }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errText);
      return res.status(502).json({ error: 'Chat service unavailable' });
    }

    const data = await geminiRes.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || null;

    if (!reply) {
      return res.status(502).json({ error: 'No reply generated' });
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error('Chat handler error:', err);
    return res.status(500).json({ error: 'Chat service error' });
  }
}
