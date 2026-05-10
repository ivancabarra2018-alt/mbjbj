export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key no configurada' });
  }

  const { today } = req.body || {};

  const prompt = `Hoy es ${today || 'hoy'}. Eres un analista de fútbol experto. Identifica los 2 partidos de fútbol más destacados que se juegan HOY en las principales ligas europeas (LaLiga, Premier League, Bundesliga, Serie A, Ligue 1, UCL, Europa League). Si no hay partidos hoy, usa los partidos más próximos o relevantes de la semana.

Para cada partido, devuelve un análisis completo en JSON con estadísticas REALES de la temporada actual.

Responde SOLO con JSON válido, sin texto adicional, sin markdown, sin backticks. Formato exacto:
[
  {
    "league": "nombre liga",
    "home": {"name": "nombre equipo local", "badge": "siglas 2-3 letras", "color": "#hexcolor oscuro"},
    "away": {"name": "nombre equipo visitante", "badge": "siglas 2-3 letras", "color": "#hexcolor oscuro"},
    "time": "HH:MM",
    "featured": true,
    "hform": ["W","W","D","L","W"],
    "aform": ["L","W","W","D","W"],
    "odds": {"h": 2.10, "d": 3.40, "a": 3.20},
    "hstats": {"pos": 58, "tiros": 13.5, "corners": 6.1, "def": 72},
    "astats": {"pos": 42, "tiros": 10.2, "corners": 5.0, "def": 65},
    "prono": {
      "pick": "descripción del pronóstico",
      "pct": 74,
      "conf": "h",
      "cuota": 1.85,
      "nota": "justificación estadística con datos reales, máximo 2 frases"
    }
  }
]

Reglas:
- conf es "h" si pct >= 70, "m" si es menor
- odds deben ser realistas
- hstats/astats deben ser estadísticas reales de la temporada actual aproximadas
- hform/aform deben reflejar la forma reciente real
- La nota debe mencionar datos estadísticos concretos`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    const text = data.content.map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const matches = JSON.parse(clean).slice(0, 2);

    return res.status(200).json(matches);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
