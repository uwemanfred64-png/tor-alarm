// Datenquellen: FotMob (schnell, primär) und OpenLigaDB (Fallback).
// Beide liefern am Ende dasselbe Format, damit der Rest der App nicht wissen muss, woher die Daten kommen.

const FOTMOB = 'https://www.fotmob.com/api/data';
const OPENLIGA = 'https://api.openligadb.de';
const BUNDESLIGA_ID = 54;
const { short, code } = require('./teams');

// Wählbare Wettbewerbe. id = FotMob-Liga (primaryId), ol = Kürzel bei OpenLigaDB (dort gibt es nur die
// drei Männer-Ligen), intl = Europapokal.
const COMPETITIONS = [
  { id: 54, name: 'Bundesliga', short: 'Bundesliga', ol: 'bl1' },
  { id: 146, name: '2. Bundesliga', short: '2. Liga', ol: 'bl2' },
  { id: 208, name: '3. Liga', short: '3. Liga', ol: 'bl3' },
  { id: 9676, name: 'Frauen-Bundesliga', short: 'Frauen-BL' },
  { id: 209, name: 'DFB-Pokal', short: 'Pokal' },
  { id: 42, name: 'Champions League', short: 'CL', intl: true },
  { id: 73, name: 'Europa League', short: 'EL', intl: true },
  { id: 10216, name: 'Conference League', short: 'ECL', intl: true },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

let fetchImpl = (...a) => fetch(...a);
function setFetch(fn) { fetchImpl = fn; }

async function getJson(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

const fotmobLogo = (teamId) => `https://images.fotmob.com/image_resources/logo/teamlogo/${teamId}.png`;
const leagueUrl = (id) => `https://www.fotmob.com/de/leagues/${id}/overview`;

// Gewünschte Liga-IDs aus { competitions }. Ohne Angabe: nur Bundesliga (alter Aufruf fotmobToday(now)).
function wantedIds(opts) {
  const list = opts && Array.isArray(opts.competitions) ? opts.competitions : [BUNDESLIGA_ID];
  return new Set(list.map(Number).filter(Number.isFinite));
}

// Competition-Objekt für ein Spiel – eigene Kopie, damit niemand COMPETITIONS verändert.
function competitionOf(id, fallbackName) {
  const c = COMPETITIONS.find((x) => x.id === id);
  if (!c) {
    const name = fallbackName || `Liga ${id}`;
    return { id, name, short: name };
  }
  const out = { id: c.id, name: c.name, short: c.short };
  if (c.intl) out.intl = true;
  return out;
}

// ---------------------------------------------------------------- FotMob

function fotmobStatus(s = {}) {
  if (s.cancelled) return 'cancelled';
  if (s.finished) return 'done';
  if (s.started || s.ongoing) return 'live';
  return 'pre';
}

// FotMob liefert "41’", "45+2’" – oder englische Kürzel wie "HT". Wir geben Zahlen als "41" / "45+2"
// zurück und Kürzel als deutsches Wort.
const PERIOD = { HT: 'Halbzeit', IR: 'unterbrochen', ET: 'Verlängerung', AET: 'n. V.', PEN: 'Elfmeterschießen', FT: 'Ende', BREAK: 'Pause' };
function liveMinute(lt) {
  const s = String((lt && lt.short) || '').replace(/[\u200e\u200f\u2019']/g, '').trim();
  if (!s) return null;
  if (/^\d/.test(s)) return s.replace(/\s+/g, '');
  return PERIOD[s.toUpperCase()] || s;
}

// Rote Karten (Gelb-Rot zählt mit). Im Spielplan stehen sie nur, wenn es welche gibt.
function redCount(st, t, key) {
  const n = Number.isFinite(st[key]) ? st[key] : Number.isFinite(t.redCards) ? t.redCards : 0;
  return Math.max(0, n | 0);
}

function fotmobTeam(t) {
  return { id: t.id, name: short(t.name, t.shortName), code: code(t.name, t.shortName), full: t.name, logo: fotmobLogo(t.id) };
}

function parseFotmobMatch(m, competition) {
  const st = m.status || {};
  return {
    id: `fm-${m.id}`,
    rawId: m.id,
    source: 'fotmob',
    competition,
    round: m.tournamentStage ? String(m.tournamentStage) : null,
    home: fotmobTeam(m.home),
    away: fotmobTeam(m.away),
    homeScore: Number.isFinite(m.home.score) ? m.home.score : 0,
    awayScore: Number.isFinite(m.away.score) ? m.away.score : 0,
    status: fotmobStatus(st),
    startUtc: st.utcTime || null,
    minute: liveMinute(st.liveTime),
    redCards: [redCount(st, m.home, 'numberOfHomeRedCards'), redCount(st, m.away, 'numberOfAwayRedCards')],
    url: `https://www.fotmob.com/de/match/${m.id}`,
  };
}

// Europapokal und Pokal stehen unter einer Saison-ID (z. B. 943230) mit primaryId 42. Eine Liga kann
// mehrfach auftauchen (Gruppen, Runden) – jedes Spiel nur einmal nehmen.
function parseFotmobMatches(json, opts) {
  const ids = wantedIds(opts);
  const leagues = (json && json.leagues) || [];
  const seen = new Set();
  const out = [];
  for (const lg of leagues) {
    const pid = ids.has(lg.primaryId) ? lg.primaryId : ids.has(lg.id) ? lg.id : null;
    if (pid == null) continue;
    const competition = competitionOf(pid, lg.name);
    for (const m of lg.matches || []) {
      if (!m || !m.home || !m.away || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(parseFotmobMatch(m, { ...competition }));
    }
  }
  return out;
}

async function fotmobToday(now = new Date(), opts) {
  const ids = wantedIds(opts);
  if (!ids.size) return [];
  const url = `${FOTMOB}/matches?date=${ymd(now)}&timezone=${encodeURIComponent('Europe/Berlin')}&ccode3=DEU`;
  return parseFotmobMatches(await getJson(url), { competitions: [...ids] });
}

// Ereignisse eines Spiels chronologisch. FotMob liefert laufende Spiele neueste zuerst; bei gleicher
// Minute entscheidet die eventId, ohne eventId (kommt vor: 0) die ursprüngliche Reihenfolge.
function timeline(details, keep) {
  const ev = (((details || {}).content || {}).matchFacts || {}).events || {};
  const list = (ev.events || []).filter(keep);
  if (ev.ongoing === true) list.reverse();
  return list.sort((a, b) => (a.time - b.time) || ((a.overloadTime || 0) - (b.overloadTime || 0)) || ((a.eventId || 0) - (b.eventId || 0)));
}

function eventMinute(ev, fallback) {
  const base = ev.time ?? fallback ?? '';
  return `${base}${ev.overloadTime ? `+${ev.overloadTime}` : ''}` || null;
}

// Solange FotMob den Spieler nicht kennt, steht dort "<TBD>".
function eventPlayer(ev) {
  const name = ev.fullName || ev.nameStr || (ev.player && ev.player.name) || null;
  return name && !/^<.*>$/.test(name) ? name : null;
}

// Sucht in den Spieldetails das Tor, das zu einem bestimmten Spielstand geführt hat.
// side: 'home' | 'away', nth: das wievielte Tor dieser Mannschaft (1-basiert)
function pickFotmobGoal(details, side, scoreAfter, nth) {
  const list = timeline(details, (e) => e.type === 'Goal' && !e.isPenaltyShootoutEvent);
  const exact = list.find(
    (e) => Array.isArray(e.newScore) && e.newScore[0] === scoreAfter[0] && e.newScore[1] === scoreAfter[1]
  );
  let ev = exact;
  if (!ev) {
    const isHome = side === 'home';
    const mine = list.filter((e) => !!e.isHome === isHome);
    ev = mine[nth - 1] || null;
  }
  if (!ev) return null;

  const shot = ev.shotmapEvent || {};
  const desc = String(ev.goalDescription || ev.suffix || '').toLowerCase();
  // Bei Toren gilt ein Name erst, wenn auch die Spieler-ID da ist (vorher steht dort "<TBD>" mit ID 0).
  const name = eventPlayer(ev);
  const known = name && (ev.playerId || (ev.player && ev.player.id));
  return {
    scorer: known ? name : null,
    minute: eventMinute(ev, shot.min),
    ownGoal: !!(ev.ownGoal || shot.isOwnGoal),
    penalty: shot.situation === 'Penalty' || desc.includes('pen') || desc.includes('elfmeter'),
    assist: ev.assistStr ? String(ev.assistStr).replace(/^assist by\s*/i, '').trim() : null,
  };
}

// Die nth-te Rote Karte (Rot oder Gelb-Rot) einer Mannschaft, chronologisch.
// Spieler-ID 0 kommt bei Karten mit echtem Namen vor (z. B. Betreuer) – der Name zählt trotzdem.
function pickFotmobRedCard(details, side, nth) {
  const isHome = side === 'home';
  const list = timeline(details, (e) => e.type === 'Card' && (e.card === 'Red' || e.card === 'YellowRed') && !!e.isHome === isHome);
  const ev = list[nth - 1];
  if (!ev) return null;
  return { player: eventPlayer(ev), minute: eventMinute(ev), yellowRed: ev.card === 'YellowRed' };
}

function fotmobColors(details) {
  const c = details && details.general && details.general.teamColors;
  if (!c || !c.lightMode) return null;
  return { home: c.lightMode.home, away: c.lightMode.away };
}

function fotmobVarPending(details) {
  if (!details) return false;
  if (details.hasPendingVAR) return true;
  const events = (((details.content || {}).matchFacts || {}).events || {}).events || [];
  return events.some((e) => e.type === 'VAR' && e.VAR && e.VAR.pendingDecision);
}

const fotmobDetails = (match) => getJson(`${FOTMOB}/matchDetails?matchId=${match.rawId}`, 8000);

async function fotmobGoalInfo(match, side, scoreAfter, nth) {
  const details = await fotmobDetails(match);
  return {
    goal: pickFotmobGoal(details, side, scoreAfter, nth),
    colors: fotmobColors(details),
    varPending: fotmobVarPending(details),
  };
}

// Teams aus der Tabelle. Ligen mit Gruppen/Konferenzen haben mehrere Teiltabellen, der Pokal gar keine.
function parseFotmobTeams(json) {
  const byId = new Map();
  const tables = Array.isArray(json && json.table) ? json.table : [];
  for (const t of tables) {
    const data = (t && t.data) || {};
    const parts = Array.isArray(data.tables) ? data.tables : [data];
    for (const p of parts) {
      for (const r of (p && p.table && p.table.all) || []) {
        if (r && r.id != null && r.name && !byId.has(r.id)) byId.set(r.id, { id: r.id, name: r.name });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

async function fotmobTeams(leagueId = BUNDESLIGA_ID) {
  return parseFotmobTeams(await getJson(`${FOTMOB}/leagues?id=${leagueId}`));
}

// ---------------------------------------------------------------- OpenLigaDB

function parseOpenLiga(list, now = new Date(), competition = BUNDESLIGA_ID) {
  const compId = typeof competition === 'object' && competition ? competition.id : competition;
  const comp = competitionOf(compId);
  return (list || []).map((m) => {
    const goals = (m.goals || []).slice().sort((a, b) => a.goalID - b.goalID);
    const last = goals[goals.length - 1];
    const end = (m.matchResults || []).find((r) => r.resultTypeID === 2);
    const homeScore = last ? last.scoreTeam1 : end ? end.pointsTeam1 : 0;
    const awayScore = last ? last.scoreTeam2 : end ? end.pointsTeam2 : 0;
    const start = m.matchDateTimeUTC ? new Date(m.matchDateTimeUTC) : null;
    let status = 'pre';
    if (m.matchIsFinished) status = 'done';
    else if (start && now >= start) status = 'live';
    const team = (t) => ({
      id: t.teamId,
      name: short(t.teamName, t.shortName),
      code: code(t.teamName, t.shortName),
      full: t.teamName,
      // Nur echte https-Bilder übernehmen (die Adresse kommt ungeprüft aus OpenLigaDB)
      logo: typeof t.teamIconUrl === 'string' && /^https:\/\//i.test(t.teamIconUrl) ? t.teamIconUrl : null,
    });
    return {
      id: `ol-${m.matchID}`,
      rawId: m.matchID,
      source: 'openligadb',
      competition: { ...comp },
      round: m.group && m.group.groupOrderID ? String(m.group.groupOrderID) : null,
      home: team(m.team1),
      away: team(m.team2),
      homeScore,
      awayScore,
      status,
      startUtc: m.matchDateTimeUTC || null,
      minute: null,
      redCards: [0, 0], // OpenLigaDB kennt keine Karten
      url: leagueUrl(comp.id),
      _goals: goals,
    };
  });
}

// Fragt alle gewählten Ligen parallel ab. Fällt eine aus, kommen die anderen trotzdem;
// nur wenn alle ausfallen, gibt es einen Fehler.
async function openLigaToday(now = new Date(), opts) {
  const ids = wantedIds(opts);
  const comps = COMPETITIONS.filter((c) => c.ol && ids.has(c.id));
  if (!comps.length) return [];
  const results = await Promise.allSettled(
    comps.map((c) => getJson(`${OPENLIGA}/getmatchdata/${c.ol}`).then((list) => parseOpenLiga(list, now, c)))
  );
  const ok = results.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw results[0].reason;
  const today = ymd(now);
  // Nur Spiele von heute (nach lokaler Zeit), sonst würde der ganze Spieltag auftauchen.
  return ok.flatMap((r) => r.value).filter((m) => m.startUtc && ymd(new Date(m.startUtc)) === today);
}

function pickOpenLigaGoal(match, side, scoreAfter, nth) {
  const goals = match._goals || [];
  let g = goals.find((x) => x.scoreTeam1 === scoreAfter[0] && x.scoreTeam2 === scoreAfter[1]);
  if (!g) {
    let h = 0;
    let a = 0;
    const mine = [];
    for (const x of goals) {
      if (x.scoreTeam1 > h) mine.push({ x, side: 'home' });
      else if (x.scoreTeam2 > a) mine.push({ x, side: 'away' });
      h = x.scoreTeam1;
      a = x.scoreTeam2;
    }
    const hit = mine.filter((y) => y.side === side)[nth - 1];
    g = hit ? hit.x : null;
  }
  if (!g) return null;
  return {
    scorer: g.goalGetterName || null,
    minute: g.matchMinute != null ? String(g.matchMinute) : null,
    ownGoal: !!g.isOwnGoal,
    penalty: !!g.isPenalty,
    assist: null,
  };
}

// ---------------------------------------------------------------- Fassade

async function goalInfo(match, side, scoreAfter, nth) {
  if (match.source === 'fotmob') return fotmobGoalInfo(match, side, scoreAfter, nth);
  // OpenLigaDB liefert Torschützen direkt mit – frisch nachladen, falls er noch fehlt.
  const list = await getJson(`${OPENLIGA}/getmatchdata/${match.rawId}`).catch(() => null);
  const fresh = list ? parseOpenLiga([list], new Date(), match.competition || BUNDESLIGA_ID)[0] : match;
  return { goal: pickOpenLigaGoal(fresh, side, scoreAfter, nth), colors: null, varPending: false };
}

// Wer hat Rot gesehen? { player, minute, yellowRed } oder null (noch nicht in den Details, OpenLigaDB,
// Netzfehler). Wirft nie – der Aufrufer fragt einfach später noch einmal.
async function redCardInfo(match, side, nth) {
  if (!match || match.source !== 'fotmob') return null;
  try {
    return pickFotmobRedCard(await fotmobDetails(match), side, nth);
  } catch {
    return null;
  }
}

module.exports = {
  COMPETITIONS,
  setFetch,
  ymd,
  fotmobToday,
  openLigaToday,
  goalInfo,
  redCardInfo,
  fotmobTeams,
  parseFotmobMatches,
  parseFotmobTeams,
  parseOpenLiga,
  pickFotmobGoal,
  pickFotmobRedCard,
  pickOpenLigaGoal,
  liveMinute,
};
