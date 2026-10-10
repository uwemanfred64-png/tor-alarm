const test = require('node:test');
const assert = require('node:assert');
const feed = require('../src/feed');

const fotmobList = {
  leagues: [
    { id: 47, primaryId: 47, matches: [{ id: 1, home: { id: 1, name: 'X', score: 1 }, away: { id: 2, name: 'Y', score: 0 }, status: {} }] },
    {
      id: 54,
      primaryId: 54,
      matches: [
        {
          id: 5881179,
          tournamentStage: '5',
          home: { id: 8406, name: 'Augsburg', score: 1 },
          away: { id: 9823, name: 'Bayern München', score: 0 },
          status: { utcTime: '2026-10-10T13:30:00.000Z', started: true, ongoing: true, finished: false, liveTime: { short: '41‎’‎' } },
        },
        {
          id: 5881180,
          home: { id: 1, name: 'Mainz' },
          away: { id: 2, name: 'Köln' },
          status: { utcTime: '2026-10-10T16:30:00.000Z', started: false, finished: false },
        },
      ],
    },
  ],
};

test('FotMob: nur Bundesliga, Minute bereinigt, fehlender Stand = 0', () => {
  const list = feed.parseFotmobMatches(fotmobList);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].id, 'fm-5881179');
  assert.strictEqual(list[0].status, 'live');
  assert.strictEqual(list[0].minute, '41');
  assert.strictEqual(list[1].status, 'pre');
  assert.strictEqual(list[1].homeScore, 0);
});

test('FotMob: Torschütze per Spielstand, sonst n-tes Tor der Mannschaft', () => {
  const details = {
    content: {
      matchFacts: {
        events: {
          events: [
            { type: 'Goal', isHome: true, newScore: [1, 0], time: 1, fullName: 'Robin Fellhauer', playerId: 1, shotmapEvent: { situation: 'RegularPlay' } },
            { type: 'Card', isHome: false },
            { type: 'Goal', isHome: false, newScore: [1, 1], time: 45, overloadTime: 2, fullName: 'Harry Kane', playerId: 2, shotmapEvent: { situation: 'Penalty' } },
          ],
        },
      },
    },
  };
  const g = feed.pickFotmobGoal(details, 'away', [1, 1], 1);
  assert.strictEqual(g.scorer, 'Harry Kane');
  assert.strictEqual(g.minute, '45+2');
  assert.strictEqual(g.penalty, true);
  const fallback = feed.pickFotmobGoal(details, 'home', [9, 9], 1);
  assert.strictEqual(fallback.scorer, 'Robin Fellhauer');
  assert.strictEqual(feed.pickFotmobGoal(details, 'home', [9, 9], 2), null);
});

test('OpenLigaDB: Stand aus letztem Tor, Torschütze passend zum Stand', () => {
  const raw = [
    {
      matchID: 83192,
      matchDateTimeUTC: '2026-10-09T18:30:00Z',
      matchIsFinished: false,
      group: { groupOrderID: 5 },
      team1: { teamId: 7, teamName: 'Borussia Dortmund', shortName: 'Dortmund', teamIconUrl: 'a' },
      team2: { teamId: 134, teamName: 'SV Werder Bremen', shortName: 'Bremen', teamIconUrl: 'b' },
      matchResults: [],
      goals: [
        { goalID: 2, scoreTeam1: 1, scoreTeam2: 1, matchMinute: 85, goalGetterName: 'B', isPenalty: true, isOwnGoal: false },
        { goalID: 1, scoreTeam1: 1, scoreTeam2: 0, matchMinute: 80, goalGetterName: 'A', isPenalty: false, isOwnGoal: false },
      ],
    },
  ];
  const [m] = feed.parseOpenLiga(raw, new Date('2026-10-09T19:00:00Z'));
  assert.strictEqual(m.homeScore, 1);
  assert.strictEqual(m.awayScore, 1);
  assert.strictEqual(m.status, 'live');
  assert.strictEqual(feed.pickOpenLigaGoal(m, 'away', [1, 1], 1).scorer, 'B');
  assert.strictEqual(feed.pickOpenLigaGoal(m, 'home', [5, 5], 1).scorer, 'A');
});

test('FotMob: Ereignisse neueste-zuerst werden chronologisch sortiert, <TBD> ist kein Name', () => {
  const details = {
    content: {
      matchFacts: {
        events: {
          events: [
            { type: 'Goal', isHome: true, newScore: [2, 0], time: 42, fullName: '<TBD>', playerId: 0, player: { id: 0, name: '<TBD>' } },
            { type: 'Goal', isHome: true, newScore: [1, 0], time: 5, fullName: 'Erster', playerId: 7 },
          ],
        },
      },
    },
  };
  assert.strictEqual(feed.pickFotmobGoal(details, 'home', [9, 9], 1).scorer, 'Erster');
  const tbd = feed.pickFotmobGoal(details, 'home', [2, 0], 2);
  assert.strictEqual(tbd.scorer, null);
  assert.strictEqual(tbd.minute, '42');
});

test('Minuten: Zahlen bleiben, Kürzel werden deutsch', () => {
  assert.strictEqual(feed.liveMinute({ short: '90+4‎’‎' }), '90+4');
  assert.strictEqual(feed.liveMinute({ short: 'HT' }), 'Halbzeit');
  assert.strictEqual(feed.liveMinute({ short: '45 + 2' }), '45+2');
  assert.strictEqual(feed.liveMinute(null), null);
});

// ---------------------------------------------------------------- 1.1: Wettbewerbe, Rote Karten, Teams
// Ausschnitte aus echten Antworten (gekürzt), Stand 10.10.2026.

// api/data/matches?date=… – Bundesliga/2./3. Liga vom 10.10., CL vom 13.10., Frauen vom 04.10., Pokal vom 27.10.
const LIVE = '83\u200e\u2019\u200e';
const REAL_LIST = {
  leagues: [
    {
      id: 54, primaryId: 54, name: 'Bundesliga', ccode: 'GER',
      matches: [
        {
          id: 5881183, leagueId: 54, tournamentStage: '5',
          home: { id: 8226, score: 2, name: 'Hoffenheim', redCards: 1, shortName: 'Hoffenheim', longName: 'Hoffenheim' },
          away: { id: 9790, score: 1, name: 'Hamburger SV', longName: 'Hamburger SV' },
          status: { utcTime: '2026-10-10T13:30:00.000Z', numberOfHomeRedCards: 1, finished: false, started: true, cancelled: false, ongoing: true, liveTime: { short: LIVE, shortKey: '', long: '82:09', maxTime: 90, basePeriod: 90, addedTime: 0 } },
        },
        {
          id: 5881186, leagueId: 54, tournamentStage: '5',
          home: { id: 178475, score: 0, name: 'RB Leipzig', shortName: 'RB Leipzig', longName: 'RB Leipzig' },
          away: { id: 9810, score: 0, name: 'Eintracht Frankfurt', shortName: 'Frankfurt', longName: 'Eintracht Frankfurt' },
          status: { utcTime: '2026-10-10T16:30:00.000Z', finished: false, started: false, cancelled: false },
        },
      ],
    },
    { id: 47, primaryId: 47, name: 'Premier League', ccode: 'ENG', matches: [{ id: 1, home: { id: 1, name: 'X', score: 1 }, away: { id: 2, name: 'Y', score: 0 }, status: {} }] },
    {
      id: 146, primaryId: 146, name: '2. Bundesliga', ccode: 'GER',
      matches: [
        {
          id: 5881683, leagueId: 146, tournamentStage: '7',
          home: { id: 8262, score: 3, name: 'Darmstadt', longName: 'Darmstadt' },
          away: { id: 8398, score: 1, name: 'Energie Cottbus', longName: 'Energie Cottbus' },
          status: { utcTime: '2026-10-10T11:00:00.000Z', finished: true, started: true, cancelled: false, reason: { short: 'FT', shortKey: 'fulltime_short', long: 'Full-Time', longKey: 'finished' } },
        },
      ],
    },
    {
      id: 208, primaryId: 208, name: '3. Liga', ccode: 'GER',
      matches: [
        {
          id: 5905926, leagueId: 208, tournamentStage: '8',
          home: { id: 7789, score: 5, name: 'Jahn Regensburg', longName: 'Jahn Regensburg' },
          away: { id: 89338, score: 0, name: 'TSV Havelse', redCards: 1, longName: 'TSV Havelse' },
          status: { utcTime: '2026-10-10T12:00:00.000Z', numberOfAwayRedCards: 1, finished: true, started: true, cancelled: false, reason: { short: 'FT', shortKey: 'fulltime_short', long: 'Full-Time', longKey: 'finished' } },
        },
        {
          id: 5905919, leagueId: 208, tournamentStage: '8',
          home: { id: 8293, score: 0, name: 'MSV Duisburg', longName: 'MSV Duisburg' },
          away: { id: 94940, score: 2, name: 'Hoffenheim II', longName: 'Hoffenheim II' },
          status: { utcTime: '2026-10-10T14:30:00.000Z', finished: false, started: true, cancelled: false, ongoing: true, liveTime: { short: 'HT', shortKey: 'halftime_short', long: 'Half-Time', longKey: 'pause_match', maxTime: 45, basePeriod: 45, addedTime: 0 } },
        },
      ],
    },
    {
      id: 943230, primaryId: 42, name: 'Champions League', ccode: 'INT', parentLeagueId: 42,
      matches: [
        {
          id: 6106414, leagueId: 943230, tournamentStage: '2',
          home: { id: 8588, score: 0, name: 'Lens', longName: 'Lens' },
          away: { id: 9768, score: 0, name: 'Sporting CP', longName: 'Sporting CP' },
          status: { utcTime: '2026-10-13T16:45:00.000Z', finished: false, started: false, cancelled: false },
        },
      ],
    },
    {
      id: 9676, primaryId: 9676, name: 'Frauen-Bundesliga', ccode: 'GER',
      matches: [
        {
          id: 5934541, leagueId: 9676, tournamentStage: '6',
          home: { id: 394121, score: 2, name: 'VfL Wolfsburg (W)', longName: 'VfL Wolfsburg (W)' },
          away: { id: 1638021, score: 1, name: 'Hamburger SV (W)', longName: 'Hamburger SV (W)' },
          status: { utcTime: '2026-10-04T11:45:00.000Z', finished: true, started: true, cancelled: false, reason: { short: 'FT', shortKey: 'fulltime_short', long: 'Full-Time', longKey: 'finished' } },
        },
      ],
    },
    {
      id: 936417, primaryId: 209, name: 'DFB Pokal', ccode: 'GER', parentLeagueId: 209,
      matches: [
        {
          id: 6162739, leagueId: 936417, tournamentStage: '2',
          home: { id: 9911, score: 0, name: 'Bochum', longName: 'Bochum' },
          away: { id: 9905, score: 0, name: 'Mainz 05', shortName: 'Mainz', longName: 'Mainz 05' },
          status: { utcTime: '2026-10-27T17:00:00.000Z', finished: false, started: false, cancelled: false },
        },
      ],
    },
  ],
};

const ALL_IDS = [54, 146, 208, 9676, 209, 42, 73, 10216];
const clone = (x) => JSON.parse(JSON.stringify(x));
const jsonResponse = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(data) });

test('COMPETITIONS: IDs, Kurznamen, OpenLigaDB-Kürzel und Europapokal laut Bauplan', () => {
  assert.deepStrictEqual(feed.COMPETITIONS.map((c) => c.id), ALL_IDS);
  const by = Object.fromEntries(feed.COMPETITIONS.map((c) => [c.id, c]));
  assert.deepStrictEqual([by[54].ol, by[146].ol, by[208].ol, by[9676].ol, by[209].ol], ['bl1', 'bl2', 'bl3', undefined, undefined]);
  assert.deepStrictEqual(feed.COMPETITIONS.filter((c) => c.intl).map((c) => c.short), ['CL', 'EL', 'ECL']);
  assert.deepStrictEqual([by[146].short, by[208].short, by[9676].short, by[209].short], ['2. Liga', '3. Liga', 'Frauen-BL', 'Pokal']);
});

test('FotMob: ohne Auswahl nur Bundesliga (alter Aufruf), mit Auswahl Filter über primaryId', () => {
  assert.deepStrictEqual(feed.parseFotmobMatches(REAL_LIST).map((m) => m.rawId), [5881183, 5881186]);
  const all = feed.parseFotmobMatches(REAL_LIST, { competitions: ALL_IDS });
  assert.deepStrictEqual(all.map((m) => m.rawId), [5881183, 5881186, 5881683, 5905926, 5905919, 6106414, 5934541, 6162739]);
  // Europapokal und Pokal stehen unter einer Saison-ID (943230 / 936417), gefiltert wird über primaryId
  const cl = feed.parseFotmobMatches(REAL_LIST, { competitions: [42] });
  assert.strictEqual(cl.length, 1);
  assert.deepStrictEqual(cl[0].competition, { id: 42, name: 'Champions League', short: 'CL', intl: true });
  assert.strictEqual(cl[0].round, '2');
  const cup = feed.parseFotmobMatches(REAL_LIST, { competitions: ['209'] });
  assert.deepStrictEqual(cup[0].competition, { id: 209, name: 'DFB-Pokal', short: 'Pokal' });
  assert.deepStrictEqual(feed.parseFotmobMatches(REAL_LIST, { competitions: [] }), []);
});

test('FotMob: Spiel-Objekt mit Wettbewerb, Roten Karten, Halbzeit und Kürzeln', () => {
  const all = feed.parseFotmobMatches(REAL_LIST, { competitions: ALL_IDS });
  const by = Object.fromEntries(all.map((m) => [m.rawId, m]));
  const hoff = by[5881183];
  assert.deepStrictEqual(hoff.competition, { id: 54, name: 'Bundesliga', short: 'Bundesliga' });
  assert.deepStrictEqual(hoff.redCards, [1, 0]);
  assert.strictEqual(hoff.minute, '83');
  assert.strictEqual(hoff.status, 'live');
  assert.deepStrictEqual(hoff.home, { id: 8226, name: 'Hoffenheim', code: 'TSG', full: 'Hoffenheim', logo: 'https://images.fotmob.com/image_resources/logo/teamlogo/8226.png' });
  assert.strictEqual(hoff.url, 'https://www.fotmob.com/de/match/5881183');
  assert.deepStrictEqual(by[5881186].redCards, [0, 0]);
  assert.deepStrictEqual(by[5905926].redCards, [0, 1]);
  assert.strictEqual(by[5905926].status, 'done');
  assert.strictEqual(by[5905919].minute, 'Halbzeit');
  assert.deepStrictEqual([by[5905919].away.name, by[5905919].away.code], ['Hoffenheim II', 'TS2']);
  assert.deepStrictEqual(by[5881683].competition.short, '2. Liga');
  assert.deepStrictEqual([by[5881683].away.name, by[5881683].away.code], ['Cottbus', 'FCE']);
  // Frauen: "(W)" fällt im Kurznamen weg, der volle Name bleibt
  const w = by[5934541];
  assert.deepStrictEqual([w.home.name, w.home.code, w.home.full], ['Wolfsburg', 'WOB', 'VfL Wolfsburg (W)']);
  assert.deepStrictEqual([w.away.name, w.away.code], ['HSV', 'HSV']);
  assert.strictEqual(w.competition.short, 'Frauen-BL');
});

test('FotMob: Rote Karten notfalls aus dem Team-Objekt, Unsinn wird 0', () => {
  const list = clone(REAL_LIST);
  const m = list.leagues[0].matches[0];
  delete m.status.numberOfHomeRedCards; // nur noch home.redCards = 1
  m.status.numberOfAwayRedCards = -3;
  assert.deepStrictEqual(feed.parseFotmobMatches(list)[0].redCards, [1, 0]);
});

test('FotMob: Liga mehrfach in der Liste (Gruppen) – alle Spiele, keines doppelt', () => {
  const list = clone(REAL_LIST);
  const cl = list.leagues.find((l) => l.primaryId === 42);
  const groupB = { ...clone(cl), id: 943299, name: 'Champions League Grp. B' };
  groupB.matches.push({ ...clone(cl.matches[0]), id: 6106415 });
  list.leagues.push(groupB);
  const out = feed.parseFotmobMatches(list, { competitions: [42] });
  assert.deepStrictEqual(out.map((m) => m.rawId), [6106414, 6106415]);
  assert.ok(out.every((m) => m.competition.id === 42 && m.competition.short === 'CL'));
});

test('FotMob: jedes Spiel hat eine eigene Kopie des Wettbewerbs', () => {
  const [a, b] = feed.parseFotmobMatches(REAL_LIST);
  a.competition.short = 'kaputt';
  assert.strictEqual(b.competition.short, 'Bundesliga');
  assert.strictEqual(feed.COMPETITIONS[0].short, 'Bundesliga');
});

test('fotmobToday: Datum/Zeitzone in der URL, Auswahl wirkt, leere Auswahl fragt gar nicht', async () => {
  const urls = [];
  feed.setFetch(async (url) => {
    urls.push(url);
    return jsonResponse(REAL_LIST);
  });
  const now = new Date(2026, 9, 10, 17, 0);
  const old = await feed.fotmobToday(now);
  assert.deepStrictEqual(old.map((m) => m.rawId), [5881183, 5881186]);
  assert.strictEqual(urls[0], 'https://www.fotmob.com/api/data/matches?date=20261010&timezone=Europe%2FBerlin&ccode3=DEU');
  const sel = await feed.fotmobToday(now, { competitions: [146, 208] });
  assert.deepStrictEqual(sel.map((m) => m.competition.id), [146, 208, 208]);
  urls.length = 0;
  assert.deepStrictEqual(await feed.fotmobToday(now, { competitions: [] }), []);
  assert.strictEqual(urls.length, 0);
  feed.setFetch(async () => jsonResponse({}, 503));
  await assert.rejects(feed.fotmobToday(now), /HTTP 503/);
});

// api/data/matchDetails?matchId=… – nur Karten und Tore, Felder gekürzt.
// 5881183 Hoffenheim – HSV, läuft: FotMob liefert neueste zuerst
const DETAILS_HOFFENHEIM = { content: { matchFacts: { events: { ongoing: true, events: [
  { type: 'Card', time: 80, overloadTime: null, eventId: 14545696, isHome: true, fullName: 'Leon Avdullahu', nameStr: 'Leon Avdullahu', playerId: 1478148, player: { id: 1478148, name: 'Leon Avdullahu' }, card: 'Yellow' },
  { type: 'Card', time: 65, overloadTime: null, eventId: 14545207, isHome: true, fullName: 'Bernardo', nameStr: 'Bernardo', playerId: 637716, player: { id: 637716, name: 'Bernardo' }, card: 'YellowRed' },
  { type: 'Card', time: 55, overloadTime: null, eventId: 14544991, isHome: true, fullName: 'Bernardo', nameStr: 'Bernardo', playerId: 637716, player: { id: 637716, name: 'Bernardo' }, card: 'Yellow' },
  { type: 'Goal', time: 53, overloadTime: null, eventId: 14544923, isHome: true, fullName: 'Bambasé Conté', nameStr: 'Bambasé Conté', playerId: 1338957, player: { id: 1338957, name: 'Bambasé Conté' }, newScore: [2, 1] },
  { type: 'Goal', time: 45, overloadTime: 6, eventId: 14544145, isHome: true, fullName: 'Sebastiaan Bornauw', nameStr: 'Sebastiaan Bornauw', playerId: 922892, player: { id: 922892, name: 'Sebastiaan Bornauw' }, newScore: [1, 1] },
  { type: 'Goal', time: 12, overloadTime: null, eventId: 14543468, isHome: false, fullName: 'Yussuf Poulsen', nameStr: 'Yussuf Poulsen', playerId: 266527, player: { id: 266527, name: 'Yussuf Poulsen' }, newScore: [0, 1] },
] } } }, general: { teamColors: { lightMode: { home: '#1c63b7', away: '#0a3f86' } } }, hasPendingVAR: false };

// 5908652 Sivasspor – Pendikspor, beendet: chronologisch, alle eventId 0, zweite Rote gegen einen Ersatzspieler
const DETAILS_SIVAS = { content: { matchFacts: { events: { ongoing: false, events: [
  { type: 'Card', time: 33, overloadTime: null, eventId: 0, isHome: false, fullName: 'Hakan Yeşil', playerId: 1139233, card: 'Yellow' },
  { type: 'Card', time: 57, overloadTime: null, eventId: 0, isHome: false, fullName: 'Samuel Abifade', nameStr: 'Samuel Abifade', playerId: 953179, player: { id: 953179, name: 'Samuel Abifade' }, card: 'Red' },
  { type: 'Card', time: 58, overloadTime: null, eventId: 0, isHome: false, fullName: 'Bekir Karadeniz', playerId: 1398013, card: 'Yellow' },
  { type: 'Card', time: 69, overloadTime: null, eventId: 0, isHome: false, fullName: 'Kerem Kalafat', nameStr: 'Kerem Kalafat', playerId: 1078939, player: { id: 1078939, name: 'Kerem Kalafat' }, card: 'Red' },
] } } } };

// 5888078 Tondela – Torreense: drei Rote für Torreense (zwei in der 74.), eine in der Nachspielzeit, Spieler-ID 0
const DETAILS_TONDELA = { content: { matchFacts: { events: { ongoing: false, events: [
  { type: 'Card', time: 57, overloadTime: null, eventId: 14541885, isHome: false, fullName: 'Adriel Ramos', nameStr: 'Adriel Ramos', playerId: 1248662, player: { id: 1248662, name: 'Adriel Ramos' }, card: 'Red' },
  { type: 'Card', time: 74, overloadTime: null, eventId: 14541960, isHome: false, fullName: 'Mohamed Ali Diadie', nameStr: 'Mohamed Ali Diadie', playerId: 1695868, player: { id: 1695868, name: 'Mohamed Ali Diadie' }, card: 'Red' },
  { type: 'Card', time: 74, overloadTime: null, eventId: 14541965, isHome: false, fullName: 'Lucas Canizares', nameStr: 'Lucas Canizares', playerId: 0, player: { id: 0, name: 'Lucas Canizares' }, card: 'Red' },
  { type: 'Card', time: 90, overloadTime: 6, eventId: 14542078, isHome: true, fullName: 'Richarllyson', nameStr: 'Richarllyson', playerId: 2356465, player: { id: 2356465, name: 'Richarllyson' }, card: 'Red' },
  { type: 'Goal', time: 90, overloadTime: 10, eventId: 14542088, isHome: true, fullName: 'Cascavel', nameStr: 'Cascavel', playerId: 1390108, player: { id: 1390108, name: 'Cascavel' }, newScore: [1, 0] },
] } } } };

// 5794338 Arbroath – Greenock Morton, läuft: neueste zuerst, in der 10. Minute Karte vor Tor (eventId)
const DETAILS_ARBROATH = { content: { matchFacts: { events: { ongoing: true, events: [
  { type: 'Card', time: 28, overloadTime: null, eventId: 14544412, isHome: false, fullName: 'Christopher Cupps', nameStr: 'Christopher Cupps', playerId: 1724410, player: { id: 1724410, name: 'Christopher Cupps' }, card: 'Red' },
  { type: 'Card', time: 10, overloadTime: null, eventId: 14543898, isHome: true, fullName: 'Scott Constable', nameStr: 'Scott Constable', playerId: 1536462, player: { id: 1536462, name: 'Scott Constable' }, card: 'Red' },
  { type: 'Goal', time: 10, overloadTime: null, eventId: 14543909, isHome: false, fullName: 'Grant Gillespie', nameStr: 'Grant Gillespie', playerId: 0, player: { id: 0, name: 'Grant Gillespie' }, newScore: [0, 1] },
] } } } };

test('Rote Karte: n-te Karte der Seite, Gelb-Rot zählt, Gelb nicht', () => {
  assert.deepStrictEqual(feed.pickFotmobRedCard(DETAILS_HOFFENHEIM, 'home', 1), { player: 'Bernardo', minute: '65', yellowRed: true });
  assert.strictEqual(feed.pickFotmobRedCard(DETAILS_HOFFENHEIM, 'home', 2), null);
  assert.strictEqual(feed.pickFotmobRedCard(DETAILS_HOFFENHEIM, 'away', 1), null);
  assert.deepStrictEqual(feed.pickFotmobRedCard(DETAILS_ARBROATH, 'home', 1), { player: 'Scott Constable', minute: '10', yellowRed: false });
  assert.deepStrictEqual(feed.pickFotmobRedCard(DETAILS_ARBROATH, 'away', 1), { player: 'Christopher Cupps', minute: '28', yellowRed: false });
  assert.strictEqual(feed.pickFotmobRedCard(null, 'home', 1), null);
});

test('Rote Karte: chronologisch auch ohne eventId, Nachspielzeit, Name ohne Spieler-ID', () => {
  assert.strictEqual(feed.pickFotmobRedCard(DETAILS_SIVAS, 'away', 1).player, 'Samuel Abifade');
  assert.deepStrictEqual(feed.pickFotmobRedCard(DETAILS_SIVAS, 'away', 2), { player: 'Kerem Kalafat', minute: '69', yellowRed: false });
  assert.deepStrictEqual(
    [1, 2, 3].map((n) => feed.pickFotmobRedCard(DETAILS_TONDELA, 'away', n).player),
    ['Adriel Ramos', 'Mohamed Ali Diadie', 'Lucas Canizares']
  );
  assert.strictEqual(feed.pickFotmobRedCard(DETAILS_TONDELA, 'away', 3).minute, '74');
  assert.deepStrictEqual(feed.pickFotmobRedCard(DETAILS_TONDELA, 'home', 1), { player: 'Richarllyson', minute: '90+6', yellowRed: false });
});

test('Rote Karte: laufendes Spiel, gleiche Minute ohne eventId – Reihenfolge bleibt richtig; <TBD> ist kein Name', () => {
  const d = { content: { matchFacts: { events: { ongoing: true, events: [
    { type: 'Card', time: 74, eventId: 0, isHome: false, fullName: '<TBD>', playerId: 0, card: 'Red' },
    { type: 'Card', time: 74, eventId: 0, isHome: false, fullName: 'Zuerst', playerId: 5, card: 'Red' },
    { type: 'Card', time: 31, eventId: 0, isHome: false, fullName: 'Gelb', playerId: 6, card: 'Yellow' },
  ] } } } };
  assert.strictEqual(feed.pickFotmobRedCard(d, 'away', 1).player, 'Zuerst');
  assert.deepStrictEqual(feed.pickFotmobRedCard(d, 'away', 2), { player: null, minute: '74', yellowRed: false });
  // echt (5907607 Chesham – Chelmsford, live beobachtet): frische Rote steht erst ohne Spieler da
  const fresh = { content: { matchFacts: { events: { ongoing: true, events: [
    { type: 'Card', time: 80, overloadTime: null, eventId: 14547038, player: { id: 0, name: '<TBD>', profileUrl: '' }, isHome: false, nameStr: '<TBD>', fullName: '<TBD>', playerId: 0, card: 'Red' },
  ] } } } };
  assert.deepStrictEqual(feed.pickFotmobRedCard(fresh, 'away', 1), { player: null, minute: '80', yellowRed: false });
});

test('redCardInfo: lädt die Spieldetails; OpenLigaDB, Netzfehler und HTTP-Fehler geben null', async () => {
  const urls = [];
  feed.setFetch(async (url) => {
    urls.push(url);
    return jsonResponse(DETAILS_HOFFENHEIM);
  });
  const [match] = feed.parseFotmobMatches(REAL_LIST);
  assert.deepStrictEqual(await feed.redCardInfo(match, 'home', 1), { player: 'Bernardo', minute: '65', yellowRed: true });
  assert.strictEqual(urls[0], 'https://www.fotmob.com/api/data/matchDetails?matchId=5881183');
  assert.strictEqual(await feed.redCardInfo(match, 'away', 1), null);
  urls.length = 0;
  assert.strictEqual(await feed.redCardInfo({ ...match, source: 'openligadb' }, 'home', 1), null);
  assert.strictEqual(urls.length, 0);
  feed.setFetch(async () => {
    throw new Error('offline');
  });
  assert.strictEqual(await feed.redCardInfo(match, 'home', 1), null);
  feed.setFetch(async () => jsonResponse({}, 500));
  assert.strictEqual(await feed.redCardInfo(match, 'home', 1), null);
});

test('goalInfo wie bisher: Torschütze aus echten Details (neueste zuerst), Farben, VAR', async () => {
  assert.strictEqual(feed.pickFotmobGoal(DETAILS_HOFFENHEIM, 'away', [0, 1], 1).scorer, 'Yussuf Poulsen');
  const g = feed.pickFotmobGoal(DETAILS_HOFFENHEIM, 'home', [1, 1], 1);
  assert.deepStrictEqual([g.scorer, g.minute], ['Sebastiaan Bornauw', '45+6']);
  assert.strictEqual(feed.pickFotmobGoal(DETAILS_HOFFENHEIM, 'home', [9, 9], 2).scorer, 'Bambasé Conté');
  feed.setFetch(async () => jsonResponse(DETAILS_HOFFENHEIM));
  const [match] = feed.parseFotmobMatches(REAL_LIST);
  const info = await feed.goalInfo(match, 'home', [2, 1], 2);
  assert.strictEqual(info.goal.scorer, 'Bambasé Conté');
  assert.deepStrictEqual(info.colors, { home: '#1c63b7', away: '#0a3f86' });
  assert.strictEqual(info.varPending, false);
});

// api/data/leagues?id=… – nur die Tabellen-Teile
const TABLE_146 = { table: [{ data: { leagueId: 146, composite: false, table: { all: [
  { name: 'Hertha BSC', shortName: 'Hertha BSC', id: 8177 },
  { name: '1. FC Nürnberg', shortName: '1. FC Nürnberg', id: 8165 },
  { name: 'FC Heidenheim', shortName: 'FC Heidenheim', id: 94937 },
] } } }] };
// MLS (130): Konferenzen als Teiltabellen, die Gesamttabelle wiederholt alle Teams
const TABLE_COMPOSITE = { table: [{ data: { leagueId: 130, composite: true, tables: [
  { leagueName: 'Eastern', leagueId: 10000001, table: { all: [{ name: 'Nashville SC', id: 915807 }, { name: 'New England Revolution', id: 6580 }] } },
  { leagueName: 'Western', leagueId: 10000002, table: { all: [{ name: 'Vancouver Whitecaps', id: 307691 }, { name: 'St. Louis City', id: 1427963 }] } },
  { leagueName: 'Supporters Shield', leagueId: 9999, table: { all: [{ name: 'Nashville SC', id: 915807 }, { name: 'Vancouver Whitecaps', id: 307691 }] } },
] } }] };
// DFB-Pokal (209): keine Tabelle
const TABLE_POKAL = { table: null, fixtures: { allMatches: [] } };

test('fotmobTeams: Tabelle, Teiltabellen ohne Doppelte, Pokal ohne Tabelle = []', async () => {
  assert.deepStrictEqual(feed.parseFotmobTeams(TABLE_146), [
    { id: 8165, name: '1. FC Nürnberg' },
    { id: 94937, name: 'FC Heidenheim' },
    { id: 8177, name: 'Hertha BSC' },
  ]);
  assert.deepStrictEqual(feed.parseFotmobTeams(TABLE_COMPOSITE).map((t) => t.id), [915807, 6580, 1427963, 307691]);
  assert.deepStrictEqual(feed.parseFotmobTeams(TABLE_POKAL), []);
  assert.deepStrictEqual(feed.parseFotmobTeams({}), []);
  const urls = [];
  feed.setFetch(async (url) => {
    urls.push(url);
    return jsonResponse(url.endsWith('=209') ? TABLE_POKAL : TABLE_146);
  });
  assert.strictEqual((await feed.fotmobTeams()).length, 3); // ohne Argument: Bundesliga
  assert.deepStrictEqual(await feed.fotmobTeams(209), []);
  assert.deepStrictEqual(urls, ['https://www.fotmob.com/api/data/leagues?id=54', 'https://www.fotmob.com/api/data/leagues?id=209']);
});

// api.openligadb.de/getmatchdata/bl2 – Freitag, Samstag 13 Uhr (mit 0:0-"Geistertor" ohne Schütze), Samstagabend
const OL_BL2 = [
  {
    matchID: 83609, matchDateTimeUTC: '2026-10-09T16:30:00Z', matchIsFinished: true, leagueShortcut: 'bl2', group: { groupOrderID: 7 },
    team1: { teamId: 199, teamName: '1. FC Heidenheim 1846', shortName: 'Heidenheim', teamIconUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/9d/1._FC_Heidenheim_1846.svg' },
    team2: { teamId: 76, teamName: '1. FC Kaiserslautern', shortName: 'Kaiserslautern', teamIconUrl: 'https://upload.wikimedia.org/wikipedia/commons/d/d3/Logo_1_FC_Kaiserslautern.svg' },
    matchResults: [{ resultTypeID: 1, pointsTeam1: 0, pointsTeam2: 0 }, { resultTypeID: 2, pointsTeam1: 0, pointsTeam2: 0 }],
    goals: [],
  },
  {
    matchID: 83611, matchDateTimeUTC: '2026-10-10T11:00:00Z', matchIsFinished: true, leagueShortcut: 'bl2', group: { groupOrderID: 7 },
    team1: { teamId: 118, teamName: 'SV Darmstadt 98', shortName: 'Darmstadt', teamIconUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/e5/SV_Darmstadt_98_Logo.svg' },
    team2: { teamId: 93, teamName: 'Energie Cottbus', shortName: 'Cottbus', teamIconUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/55/Logo_Energie_Cottbus.svg' },
    matchResults: [{ resultTypeID: 1, pointsTeam1: 1, pointsTeam2: 1 }, { resultTypeID: 2, pointsTeam1: 3, pointsTeam2: 1 }],
    goals: [
      { goalID: 149349, scoreTeam1: 0, scoreTeam2: 0, matchMinute: null, goalGetterName: '', isPenalty: false, isOwnGoal: false },
      { goalID: 149350, scoreTeam1: 0, scoreTeam2: 1, matchMinute: 4, goalGetterName: 'J. Butler', isPenalty: false, isOwnGoal: false },
      { goalID: 149353, scoreTeam1: 1, scoreTeam2: 1, matchMinute: 36, goalGetterName: 'Noah Weißhaupt', isPenalty: false, isOwnGoal: false },
      { goalID: 149355, scoreTeam1: 2, scoreTeam2: 1, matchMinute: 77, goalGetterName: 'A. Vukotic', isPenalty: false, isOwnGoal: false },
      { goalID: 149358, scoreTeam1: 3, scoreTeam2: 1, matchMinute: 88, goalGetterName: 'Y. Lührs', isPenalty: false, isOwnGoal: false },
    ],
  },
  {
    matchID: 83615, matchDateTimeUTC: '2026-10-10T18:30:00Z', matchIsFinished: false, leagueShortcut: 'bl2', group: { groupOrderID: 7 },
    team1: { teamId: 79, teamName: '1. FC Nürnberg', shortName: 'Nürnberg', teamIconUrl: 'https://upload.wikimedia.org/wikipedia/commons/f/fa/1._FC_Nürnberg_logo.svg' },
    team2: { teamId: 131, teamName: 'VfL Wolfsburg', shortName: 'Wolfsburg', teamIconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/VfL_Wolfsburg_logo_2026.svg/960px-VfL_Wolfsburg_logo_2026.svg.png' },
    matchResults: [],
    goals: [],
  },
];

test('openLigaToday: nur Ligen mit Kürzel, parallel, eine kaputte Liga stört die anderen nicht', async () => {
  const urls = [];
  feed.setFetch(async (url) => {
    urls.push(url);
    if (url.endsWith('/bl1')) throw new Error('bl1 down');
    if (url.endsWith('/bl2')) return jsonResponse(OL_BL2);
    return jsonResponse([]);
  });
  const now = new Date(2026, 9, 10, 17, 0);
  const list = await feed.openLigaToday(now, { competitions: ALL_IDS });
  assert.deepStrictEqual(urls.sort(), ['https://api.openligadb.de/getmatchdata/bl1', 'https://api.openligadb.de/getmatchdata/bl2', 'https://api.openligadb.de/getmatchdata/bl3']);
  assert.deepStrictEqual(list.map((m) => m.rawId), [83611, 83615]); // Freitagsspiel fällt raus
  const [dar, nue] = list;
  assert.deepStrictEqual(dar.competition, { id: 146, name: '2. Bundesliga', short: '2. Liga' });
  assert.deepStrictEqual(dar.redCards, [0, 0]);
  assert.deepStrictEqual([dar.homeScore, dar.awayScore, dar.status, dar.round], [3, 1, 'done', '7']);
  assert.deepStrictEqual([dar.home.name, dar.home.code, dar.away.name, dar.away.code], ['Darmstadt', 'D98', 'Cottbus', 'FCE']);
  assert.strictEqual(dar.url, 'https://www.fotmob.com/de/leagues/146/overview');
  assert.strictEqual(nue.status, 'pre');
  assert.deepStrictEqual([nue.away.name, nue.away.code], ['Wolfsburg', 'WOB']);
});

test('openLigaToday: alle Ligen weg = Fehler, keine passende Liga = [] ohne Abfrage, Standard nur bl1', async () => {
  const urls = [];
  feed.setFetch(async (url) => {
    urls.push(url);
    throw new Error(`weg: ${url}`);
  });
  const now = new Date(2026, 9, 10, 17, 0);
  await assert.rejects(feed.openLigaToday(now, { competitions: [54, 146] }), /weg/);
  urls.length = 0;
  assert.deepStrictEqual(await feed.openLigaToday(now, { competitions: [9676, 209, 42] }), []);
  assert.strictEqual(urls.length, 0);
  await assert.rejects(feed.openLigaToday(now));
  assert.deepStrictEqual(urls, ['https://api.openligadb.de/getmatchdata/bl1']);
});

test('OpenLigaDB: 0:0-Eintrag ohne Schütze wird beim Torschützen übersprungen', () => {
  const [m] = feed.parseOpenLiga([OL_BL2[1]], new Date('2026-10-10T13:00:00Z'), feed.COMPETITIONS[1]);
  assert.strictEqual(m.competition.id, 146);
  assert.strictEqual(feed.pickOpenLigaGoal(m, 'away', [9, 9], 1).scorer, 'J. Butler');
  assert.strictEqual(feed.pickOpenLigaGoal(m, 'home', [1, 1], 1).scorer, 'Noah Weißhaupt');
  assert.strictEqual(feed.pickOpenLigaGoal(m, 'home', [9, 9], 2).scorer, 'A. Vukotic');
  // ohne Wettbewerb wie bisher: Bundesliga
  assert.strictEqual(feed.parseOpenLiga([OL_BL2[1]])[0].competition.id, 54);
});

test('Minuten: echte FotMob-Zeichen (LRM, Apostroph) als Escape geprüft', () => {
  assert.strictEqual(feed.liveMinute({ short: LIVE }), '83');
  assert.strictEqual(feed.liveMinute({ short: '45+2\u2019' }), '45+2');
  assert.strictEqual(feed.liveMinute({ short: 'IR' }), 'unterbrochen');
});
