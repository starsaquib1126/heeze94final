// POST /api/chat
// Server-side proxy for the HEEZE 94 AI Fragrance Advisor.
// The Gemini API key lives only here (as an environment variable), never
// in the browser — this replaces the earlier version that called Gemini
// directly from the frontend, which exposed the key in page source.
// Body: { history: [{role:'user'|'model', parts:[{text}]}, ...] }

const SYSTEM = `You are the fragrance advisor for HEEZE 94, a premium attar house whose oils are crafted in Dubai. You speak with quiet, elegant authority — like a knowledgeable consultant in a luxury perfume boutique.

Our attar collection (pure concentrated oils, 3ml / 6ml / 12ml):
- Black Oud: Smoked agarwood, dark resin, leather accord, deep woods, warm musk. Intense, ceremonial. ₹499–₹1499.
- Golden Oud: Saffron, golden honey, radiant oud, amber, soft woods. Warm, luminous, regal. ₹499–₹1499.
- Rose Musk: Fresh rose petals, velvet damask rose, soft white musk. Tender, romantic, skin-close. ₹399–₹1299.

Parfums (Al-Durrah, Arabian Knights and more) are coming soon — direct them to the Parfums page.

Help customers find their perfect attar. Ask about their preferences, lifestyle, occasions. Keep responses to 2-4 sentences of refined prose (no bullet points). Always end with a question or gentle invitation.`;

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
          generationConfig: { maxOutputTokens: 200, temperature: 0.78 }
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
