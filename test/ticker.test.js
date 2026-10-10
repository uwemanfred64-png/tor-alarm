const test = require('node:test');
const assert = require('node:assert');
const tk = require('../src/popup/designs/ticker.js');

const BL = { id: 54, name: 'Bundesliga', short: 'Bundesliga' };
const BL2 = { id: 146, name: '2. Bundesliga', short: '2. Liga' };
const team = (name) => ({ name, full: name, logo: null });
const at = new Date(2026, 9, 10, 17, 5);

test('Plugin-Schnittstelle vorhanden', () => {
  for (const fn of ['mount', 'update', 'destroy']) assert.strictEqual(typeof tk.design[fn], 'function');
});

test('Minuten wie im Ticker', () => {
  assert.strictEqual(tk.minuteText('78'), "78'");
  assert.strictEqual(tk.minuteText(7), "7'");
  assert.strictEqual(tk.minuteText('45+2'), "45.+2'");
  assert.strictEqual(tk.minuteText('90 + 4'), "90.+4'");
  assert.strictEqual(tk.minuteText('90+4’'), "90.+4'");
  assert.strictEqual(tk.minuteText('Halbzeit'), '');
  assert.strictEqual(tk.minuteText(null), '');
});

test('Zeit links: Spielminute bei Toren, sonst Uhrzeit bzw. Spielstand', () => {
  assert.strictEqual(tk.sideTime({ type: 'goal', minute: '50', goal: { minute: '45+2' } }, at), "45.+2'");
  assert.strictEqual(tk.sideTime({ type: 'goal', minute: '63', goal: null }, at), "63'");
  assert.strictEqual(tk.sideTime({ type: 'redcard', minute: '58' }, at), "58'");
  assert.strictEqual(tk.sideTime({ type: 'halftime', minute: 'Halbzeit' }, at), '17:05');
  assert.strictEqual(tk.sideTime({ type: 'fulltime', minute: 'Ende' }, at), '17:05');
  assert.strictEqual(tk.sideTime({ type: 'kickoff', minute: '1' }, at), '17:05');
  assert.strictEqual(tk.sideTime({ type: 'missed', minute: '67' }, at), "67'");
  assert.strictEqual(tk.sideTime({ type: 'missed', minute: 'Ende' }, at), 'Ende');
  assert.strictEqual(tk.sideTime({ type: 'missed', minute: 'Halbzeit' }, at), 'Pause');
});

test('Fußzeile: Wettbewerb und Spieltag/Runde', () => {
  assert.strictEqual(tk.roundText({ competition: BL, round: '5' }), 'Bundesliga, 5. Spieltag');
  assert.strictEqual(tk.roundText({ competition: { id: 209, name: 'DFB-Pokal' }, round: '2' }), 'DFB-Pokal, 2. Runde');
  assert.strictEqual(tk.roundText({ competition: { id: 42, name: 'Champions League' }, round: 'Final' }), 'Champions League, Finale');
  assert.strictEqual(tk.roundText({ competition: BL, round: null }), 'Bundesliga');
  assert.strictEqual(tk.roundText({ round: '5' }), '5. Spieltag');
  assert.strictEqual(tk.roundText({}), '');
});

test('Überschrift kommt aus card.text, Lieblingsverein immer mit TOOOR', () => {
  const c = { type: 'goal', team: 'Augsburg', text: { headline: 'Tor für Augsburg', sentence: 'x' } };
  assert.strictEqual(tk.headlineOf(c), 'Tor für Augsburg');
  assert.strictEqual(tk.headlineOf({ ...c, favorite: true, text: { headline: 'TOOOR für Augsburg!' } }), 'TOOOR für Augsburg!');
  assert.strictEqual(tk.headlineOf({ ...c, favorite: true }), 'TOOOR für Augsburg!');
  assert.strictEqual(tk.headlineOf({ ...c, favorite: true, text: null }), 'TOOOR für Augsburg!');
  assert.strictEqual(tk.headlineOf({ ...c, favorite: true, reinstated: true, text: { headline: 'Tor zählt doch' } }), 'Tor zählt doch');
  // Ersatztexte, falls card.text fehlt
  assert.strictEqual(tk.headlineOf({ type: 'goal', team: 'Bayern', conceded: true }), 'Gegentor');
  assert.strictEqual(tk.headlineOf({ type: 'disallowed', team: 'Bayern' }), 'Kein Tor für Bayern');
  assert.strictEqual(tk.headlineOf({ type: 'redcard', team: 'Bayern' }), 'Rote Karte für Bayern');
  assert.strictEqual(tk.headlineOf({ type: 'missed' }), 'Verpasste Tore');
  assert.strictEqual(tk.headlineOf({ type: 'conference' }), 'Alle Spiele');
  // ohne card.team: Name über side, sonst ohne "für …"
  assert.strictEqual(tk.headlineOf({ type: 'goal', favorite: true, side: 'away', away: team('Bayern') }), 'TOOOR für Bayern!');
  assert.strictEqual(tk.headlineOf({ type: 'goal', favorite: true }), 'TOOOR!');
  assert.strictEqual(tk.headlineOf({ type: 'goal' }), 'Tor');
});

test('Ersatz-Sätze nach Torart', () => {
  const c = { type: 'goal', team: 'Augsburg', score: [2, 1] };
  assert.strictEqual(tk.sentenceOf({ ...c, goal: { scorer: 'Robin Fellhauer', penalty: true } }), 'Robin Fellhauer verwandelt den Elfmeter zum 2:1.');
  assert.strictEqual(tk.sentenceOf({ ...c, goal: { scorer: 'Jeanuël Belocian', ownGoal: true } }), 'Eigentor von Jeanuël Belocian – 2:1.');
  assert.strictEqual(tk.sentenceOf({ ...c, goal: null }), 'Augsburg trifft zum 2:1.');
  assert.strictEqual(tk.sentenceOf({ ...c, text: { headline: 'h', sentence: 'Aus texts.js.' } }), 'Aus texts.js.');
  assert.strictEqual(tk.sentenceOf({ type: 'disallowed', prev: [2, 2], score: [2, 1] }), 'Das 2:2 zählt nicht.');
  assert.strictEqual(tk.sentenceOf({ type: 'conference', matches: [] }), 'Heute kein Spiel.');
});

test('Ereignis-Kennzeichnung: nur Tor rot, rote Karte als Kärtchen, nichts doppelt', () => {
  assert.deepStrictEqual(tk.kindOf({ type: 'goal' }, 'Tor für Augsburg'), { text: 'Tor', red: true });
  assert.deepStrictEqual(tk.kindOf({ type: 'goal', conceded: true }, 'Gegentor'), { text: 'Tor', red: false });
  assert.deepStrictEqual(tk.kindOf({ type: 'redcard' }, 'Rote Karte für Bayern'), { card: true });
  assert.deepStrictEqual(tk.kindOf({ type: 'disallowed' }, 'Kein Tor für Bayern'), { text: 'VAR' });
  assert.strictEqual(tk.kindOf({ type: 'kickoff' }, 'Anpfiff'), null);
  assert.deepStrictEqual(tk.kindOf({ type: 'kickoff' }, 'Anpfiff in Leipzig'), { text: 'Anpfiff' });
  assert.strictEqual(tk.kindOf({ type: 'missed' }, 'Verpasste Tore'), null);
});

test('Verpasste Tore: wer wie oft getroffen hat', () => {
  const c = { home: team('Mainz'), away: team('Leverkusen') };
  assert.deepStrictEqual(tk.missedLines({ ...c, missed: { home: 2, away: 1 } }), ['2 Tore für Mainz', '1 Tor für Leverkusen']);
  assert.deepStrictEqual(tk.missedLines({ ...c, missed: { home: 0, away: 1 } }), ['1 Tor für Leverkusen']);
  assert.deepStrictEqual(tk.missedLines({ ...c }), []);
});

test('Konferenz-Spalte: Minute, Halbzeit, Ende, Anstoßzeit', () => {
  const utc = '2026-10-10T16:30:00.000Z';
  const d = new Date(utc);
  const local = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  assert.strictEqual(tk.stateText({ status: 'pre', startUtc: utc }), local);
  assert.strictEqual(tk.stateText({ status: 'live', minute: '67' }), "67'");
  assert.strictEqual(tk.stateText({ status: 'live', minute: '90+4' }), "90.+4'");
  assert.strictEqual(tk.stateText({ status: 'live', minute: 'Halbzeit' }), 'Halbzeit');
  assert.strictEqual(tk.stateText({ status: 'live', minute: 'Elfmeterschießen' }), 'Elfm.');
  assert.strictEqual(tk.stateText({ status: 'done', minute: 'Ende' }), 'Ende');
  assert.strictEqual(tk.stateText({ status: 'done', minute: 'n. V.' }), 'n. V.');
  assert.strictEqual(tk.stateText({ status: 'cancelled' }), 'abgesagt');
});

test('Konferenz: live zuerst, dann nach Anstoß, Gruppen mit Live-Spielen vorn', () => {
  const m = (name, status, startUtc, competition = BL) => ({ home: team(name), away: team('X'), status, startUtc, competition });
  const list = [
    m('Fertig', 'done', '2026-10-10T11:00:00Z'),
    m('Später', 'pre', '2026-10-10T16:30:00Z'),
    m('Früher', 'pre', '2026-10-10T13:30:00Z'),
    m('Live', 'live', '2026-10-10T13:30:00Z'),
    m('Zweite Liga live', 'live', '2026-10-10T11:00:00Z', BL2),
    m('Zweite Liga fertig', 'done', '2026-10-10T11:00:00Z', BL2),
  ];
  const sorted = tk.sortMatches(list.filter((x) => x.competition === BL)).map((x) => x.home.name);
  assert.deepStrictEqual(sorted, ['Live', 'Früher', 'Später', 'Fertig']);
  const groups = tk.groupMatches(list);
  assert.deepStrictEqual(groups.map((g) => g.comp.id), [54, 146]);
  assert.deepStrictEqual(groups[1].matches.map((x) => x.home.name), ['Zweite Liga live', 'Zweite Liga fertig']);
  // Ohne Live-Spiele in der Bundesliga steht die 2. Liga mit ihrem Live-Spiel vorn
  const g2 = tk.groupMatches(list.filter((x) => x.home.name !== 'Live'));
  assert.deepStrictEqual(g2.map((g) => g.comp.id), [146, 54]);
  assert.deepStrictEqual(tk.groupMatches(undefined), []);
});
