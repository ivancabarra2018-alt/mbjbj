 export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const FOOTBALL_KEY = process.env.FOOTBALL_DATA_KEY;

  if (!ANTHROPIC_KEY || !FOOTBALL_KEY) {
    return res.status(500).json({ error: 'API keys no configuradas' });
  }

  try {
    // ── 1. Obtener partidos de hoy de football-data.org ──────────────────
    const today = new Date().toISOString().split('T')[0];
    const leagueIds = [2021, 2014, 2002, 2019, 2015, 2001, 2018]; // PL, LaLiga, Bundesliga, SerieA, Ligue1, UCL, EuropLeague

    const fixturesRes = await fetch(
      `https://api.football-data.org/v4/matches?dateFrom=${today}&dateTo=${today}`,
      { headers: { 'X-Auth-Token': FOOTBALL_KEY } }
    );

    if (!fixturesRes.ok) throw new Error('Error al obtener partidos: ' + fixturesRes.status);
    const fixturesData = await fixturesRes.json();

    // Filtrar solo ligas principales
    let matches = (fixturesData.matches || []).filter(m =>
      leagueIds.includes(m.competition?.id)
    );

    // Si no hay partidos hoy, buscar los próximos 3 días
    if (matches.length === 0) {
      const future = new Date();
      future.setDate(future.getDate() + 3);
      const futureDate = future.toISOString().split('T')[0];
      const futRes = await fetch(
        `https://api.football-data.org/v4/matches?dateFrom=${today}&dateTo=${futureDate}`,
        { headers: { 'X-Auth-Token': FOOTBALL_KEY } }
      );
      const futData = await futRes.json();
      matches = (futData.matches || []).filter(m => leagueIds.includes(m.competition?.id));
    }

    // Tomar los 5 más relevantes para enviar a Claude
    const top = matches.slice(0, 5).map(m => ({
      league: m.competition?.name,
      home: m.homeTeam?.name,
      away: m.awayTeam?.name,
      date: m.utcDate,
      status: m.status,
      score: m.score?.fullTime || null,
    }));

    if (top.length === 0) {
      return res.status(200).json({ error: 'no_matches', message: 'No hay partidos disponibles en las próximas fechas.' });
    }

    // ── 2. Obtener estadísticas de temporada para cada equipo ────────────
    const enriched = await Promise.all(top.map(async (match) => {
      try {
        // Buscar standing/stats de los equipos en sus ligas
        const m = matches.find(x => x.homeTeam?.name === match.home);
        const leagueId = m?.competition?.id;
        const season = new Date().getFullYear();

        if (leagueId) {
          const standRes = await fetch(
            `https://api.football-data.org/v4/competitions/${leagueId}/standings?season=${season}`,
            { headers: { 'X-Auth-Token': FOOTBALL_KEY } }
          );
          if (standRes.ok) {
            const standData = await standRes.json();
            const table = standData.standings?.[0]?.table || [];
            const homeStand = table.find(t => t.team?.name === match.home);
            const awayStand = table.find(t => t.team?.name === match.away);
            return {
              ...match,
              homeStats: homeStand ? {
                position: homeStand.position,
                played: homeStand.playedGames,
                won: homeStand.won,
                draw: homeStand.draw,
                lost: homeStand.lost,
                goalsFor: homeStand.goalsFor,
                goalsAgainst: homeStand.goalsAgainst,
                points: homeStand.points,
              } : null,
              awayStats: awayStand ? {
                position: awayStand.position,
                played: awayStand.playedGames,
                won: awayStand.won,
                draw: awayStand.draw,
                lost: awayStand.lost,
                goalsFor: awayStand.goalsFor,
                goalsAgainst: awayStand.goalsAgainst,
                points: awayStand.points,
              } : null,
            };
          }
        }
      } catch (e) {
        // si falla para un partido, continuar sin stats
      }
      return match;
    }));

    // ── 3. Enviar datos reales a Claude para análisis ────────────────────
    const dataStr = JSON.stringify(enriched, null, 2);
    const prompt = `Eres un analista de fútbol experto. Aquí tienes datos REALES de partidos obtenidos de football-data.org:

${dataStr}

Basándote ÚNICAMENTE en estos datos reales, selecciona los 2 partidos más destacados y genera un análisis completo para cada uno.

Responde SOLO con JSON válido, sin texto adicional, sin markdown, sin backticks:
[
  {
    "league": "nombre liga",
    "home": {"name": "nombre equipo local", "badge": "siglas 2-3 letras", "color": "#hexcolor oscuro del equipo"},
    "away": {"name": "nombre equipo visitante", "badge": "siglas 2-3 letras", "color": "#hexcolor oscuro del equipo"},
    "time": "HH:MM",
    "featured": true,
    "hform": ["W","W","D","L","W"],
    "aform": ["L","W","W","D","W"],
    "odds": {"h": 2.10, "d": 3.40, "a": 3.20},
    "hstats": {"pos": 58, "tiros": 13.5, "corners": 6.1, "def": 72},
    "astats": {"pos": 42, "tiros": 10.2, "corners": 5.0, "def": 65},
    "prono": {
      "pick": "pronóstico concreto basado en los datos",
      "pct": 74,
      "conf": "h",
      "cuota": 1.85,
      "nota": "justificación con datos estadísticos REALES de los datos proporcionados, máximo 2 frases"
    }
  }
]

Reglas:
- Usa los datos reales de posición, goles, victorias/derrotas para calcular probabilidades
- conf es "h" si pct >= 70, "m" si es menor
- La hora debe estar en formato HH:MM en hora española (UTC+2)
- Los colores deben ser los colores reales del equipo
- La nota DEBE mencionar estadísticas de los datos reales proporcionados
- hstats.pos = posesión estimada basada en posición en tabla y goles
- hstats.def = solidez defensiva estimada (100 - (goalsAgainst/played)*10)`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeRes.ok) throw new Error('Error Claude: ' + claudeRes.status);
    const claudeData = await claudeRes.json();
    const text = claudeData.content.map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean).slice(0, 2);

    return res.status(200).json(result);

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
