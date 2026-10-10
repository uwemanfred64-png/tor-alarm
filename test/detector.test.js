const test = require('node:test');
const assert = require('node:assert');
const { GoalDetector, StatusTracker } = require('../src/detector');

const m = (id, h, a) => ({ id, homeScore: h, awayScore: a, home: { name: 'H' }, away: { name: 'A' } });

test('erster Abruf meldet nichts', () => {
  const d = new GoalDetector();
  assert.deepStrictEqual(d.update([m('x', 2, 1)]), []);
});

test('ein Tor wird mit Zwischenstand gemeldet', () => {
  const d = new GoalDetector();
  d.update([m('x', 0, 0)]);
  const ev = d.update([m('x', 1, 0)]);
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].type, 'goal');
  assert.strictEqual(ev[0].side, 'home');
  assert.deepStrictEqual(ev[0].score, [1, 0]);
  assert.strictEqual(ev[0].nth, 1);
});

test('zwei Tore zwischen zwei Abrufen ergeben zwei Meldungen', () => {
  const d = new GoalDetector();
  d.update([m('x', 0, 0)]);
  const ev = d.update([m('x', 1, 1)]);
  assert.deepStrictEqual(ev.map((e) => [e.side, ...e.score]), [['home', 1, 0], ['away', 1, 1]]);
});

test('kurzer Ausreißer nach unten (Cache) löst nichts aus', () => {
  const d = new GoalDetector();
  d.update([m('x', 0, 0)]);
  d.update([m('x', 1, 0)]);
  assert.deepStrictEqual(d.update([m('x', 0, 0)]), []);
  assert.deepStrictEqual(d.update([m('x', 1, 0)]), []); // kein doppeltes Tor
});

test('aberkanntes Tor wird nach zwei Bestätigungen gemeldet', () => {
  const d = new GoalDetector();
  d.update([m('x', 0, 0)]);
  d.update([m('x', 0, 1)]);
  assert.deepStrictEqual(d.update([m('x', 0, 0)]), []);
  const ev = d.update([m('x', 0, 0)]);
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].type, 'disallowed');
  assert.strictEqual(ev[0].side, 'away');
  // danach zählt ein neues Tor wieder normal
  assert.strictEqual(d.update([m('x', 0, 1)])[0].type, 'goal');
});

test('neu auftauchendes Spiel wird nur gemerkt', () => {
  const d = new GoalDetector();
  d.update([m('x', 0, 0)]);
  assert.deepStrictEqual(d.update([m('x', 0, 0), m('y', 3, 0)]), []);
  assert.strictEqual(d.update([m('x', 0, 0), m('y', 4, 0)]).length, 1);
});

test('reset startet wieder still', () => {
  const d = new GoalDetector();
  d.update([m('x', 0, 0)]);
  d.reset();
  assert.deepStrictEqual(d.update([m('x', 2, 0)]), []);
});

test('aberkannt auf der einen Seite verschluckt kein Tor auf der anderen', () => {
  const d = new GoalDetector();
  d.update([m('x', 0, 0)]);
  d.update([m('x', 1, 0)]);
  const first = d.update([m('x', 0, 1)]);
  assert.deepStrictEqual(first.map((e) => [e.type, e.side, ...e.score]), [['goal', 'away', 1, 1]]);
  const second = d.update([m('x', 0, 1)]);
  assert.deepStrictEqual(second.map((e) => [e.type, e.side, ...e.score]), [['disallowed', 'home', 0, 1]]);
  assert.deepStrictEqual(second[0].prev, [1, 1]);
});

test('silentDrops (OpenLigaDB): kurze Rückgänge ignorieren, lange still angleichen', () => {
  const d = new GoalDetector();
  const o = { dropConfirm: 4, silentDrops: true };
  d.update([m('x', 2, 0)], o);
  assert.deepStrictEqual(d.update([m('x', 1, 0)], o), []);
  assert.deepStrictEqual(d.update([m('x', 1, 0)], o), []);
  assert.deepStrictEqual(d.update([m('x', 2, 0)], o), []); // Ausreißer vorbei, nichts passiert
  assert.strictEqual(d.update([m('x', 3, 0)], o)[0].nth, 3);
  // vier Mal niedriger: Stand wird ohne Meldung angeglichen
  for (let i = 0; i < 4; i++) assert.deepStrictEqual(d.update([m('x', 2, 0)], o), []);
  const again = d.update([m('x', 3, 0)], o);
  assert.strictEqual(again.length, 1);
  assert.strictEqual(again[0].nth, 3); // main.js filtert das über die announced-Liste
});

test('seed: Startstand von außen, danach normale Meldungen', () => {
  const d = new GoalDetector();
  d.seed('x', [1, 0]);
  const ev = d.update([m('x', 2, 0)]);
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].nth, 2);
});

// ---------------------------------------------------------------- StatusTracker

const START = Date.parse('2026-10-10T13:30:00.000Z');
const MIN = 60_000;
// Spiel wie aus feed.js: status, minute, redCards
const s = (id, status, minute = null, redCards = [0, 0]) => ({ id, status, minute, redCards, startUtc: '2026-10-10T13:30:00.000Z', home: { name: 'H' }, away: { name: 'A' } });
const kinds = (ev) => ev.map((e) => (e.type === 'redcard' ? `redcard:${e.side}:${e.nth}` : e.type));

test('Status: erster Abruf still, danach Anpfiff bei pre -> live', () => {
  const t = new StatusTracker();
  assert.deepStrictEqual(t.update([s('x', 'pre'), s('y', 'live', '30', [1, 0])], { now: START - MIN }), []);
  const ev = t.update([s('x', 'live', '1'), s('y', 'live', '31', [1, 0])], { now: START + MIN });
  assert.deepStrictEqual(kinds(ev), ['kickoff']);
  assert.strictEqual(ev[0].match.id, 'x');
});

test('Status: Anpfiff nur einmal, auch wenn FotMob kurz einen alten Stand liefert', () => {
  const t = new StatusTracker();
  t.update([s('x', 'pre')], { now: START });
  assert.deepStrictEqual(kinds(t.update([s('x', 'live', '1')], { now: START + MIN })), ['kickoff']);
  assert.deepStrictEqual(t.update([s('x', 'pre')], { now: START + 2 * MIN }), []);
  assert.deepStrictEqual(t.update([s('x', 'live', '3')], { now: START + 3 * MIN }), []);
});

test('Status: kein Anpfiff, wenn das Spiel schon lange läuft (Standby, Halbzeit verpasst)', () => {
  const t = new StatusTracker();
  t.update([s('x', 'pre'), s('y', 'pre')], { now: START - MIN });
  assert.deepStrictEqual(t.update([s('x', 'live', '70'), s('y', 'live', 'Halbzeit')], { now: START + 80 * MIN }).map((e) => [e.type, e.match.id]), [['halftime', 'y']]);
  // Abpfiff kommt trotzdem
  assert.deepStrictEqual(kinds(t.update([s('x', 'done', null), s('y', 'live', '60')], { now: START + 120 * MIN })), ['fulltime']);
});

test('Status: OpenLigaDB ohne Minute – Anpfiff nur kurz nach der Anstoßzeit', () => {
  const t = new StatusTracker();
  t.update([s('x', 'pre'), s('y', 'pre')], { now: START - MIN });
  const late = { ...s('y', 'live'), startUtc: '2026-10-10T12:30:00.000Z' }; // vor einer Stunde angepfiffen
  const ev = t.update([s('x', 'live'), late], { now: new Date(START + 5 * MIN) });
  assert.deepStrictEqual(ev.map((e) => [e.type, e.match.id]), [['kickoff', 'x']]);
});

test('Status: Halbzeit genau einmal pro Spiel', () => {
  const t = new StatusTracker();
  t.update([s('x', 'live', '44')]);
  assert.deepStrictEqual(t.update([s('x', 'live', '45+2')]), []);
  assert.deepStrictEqual(kinds(t.update([s('x', 'live', 'Halbzeit')])), ['halftime']);
  assert.deepStrictEqual(t.update([s('x', 'live', 'Halbzeit')]), []);
  assert.deepStrictEqual(t.update([s('x', 'live', '46')]), []);
  assert.deepStrictEqual(t.update([s('x', 'live', 'Halbzeit')]), []); // alter Stand aus dem Cache
  assert.deepStrictEqual(t.update([s('x', 'live', 'Pause')]), []); // Pause vor der Verlängerung
});

test('Status: zur Halbzeit eingeschaltet – keine Halbzeit-Meldung', () => {
  const t = new StatusTracker();
  t.update([s('x', 'live', 'Halbzeit')]);
  assert.deepStrictEqual(t.update([s('x', 'live', 'Halbzeit')]), []);
  assert.deepStrictEqual(t.update([s('x', 'live', '46')]), []);
});

test('Status: Abpfiff bei live -> done, einmal; pre -> done und Absage bleiben still', () => {
  const t = new StatusTracker();
  t.update([s('x', 'live', '88'), s('y', 'pre'), s('z', 'live', '20'), s('w', 'done')]);
  const ev = t.update([s('x', 'done'), s('y', 'done'), s('z', 'cancelled'), s('w', 'done')]);
  assert.deepStrictEqual(ev.map((e) => [e.type, e.match.id]), [['fulltime', 'x']]);
  assert.deepStrictEqual(t.update([s('x', 'live', '90+5')]), []);
  assert.deepStrictEqual(t.update([s('x', 'done')]), []); // kein zweiter Abpfiff nach Cache-Rücksprung
});

test('Status: Abpfiff auch nach kurzem Rücksprung auf pre', () => {
  const t = new StatusTracker();
  t.update([s('x', 'live', '89')]);
  t.update([s('x', 'pre')]);
  assert.deepStrictEqual(kinds(t.update([s('x', 'done')])), ['fulltime']);
});

test('Status: Rote Karten – pro neuer Karte ein Ereignis mit nth', () => {
  const t = new StatusTracker();
  t.update([s('x', 'live', '10')]);
  const one = t.update([s('x', 'live', '23', [1, 0])]);
  assert.deepStrictEqual(kinds(one), ['redcard:home:1']);
  assert.strictEqual(one[0].match.minute, '23');
  assert.deepStrictEqual(t.update([s('x', 'live', '24', [1, 0])]), []);
  assert.deepStrictEqual(kinds(t.update([s('x', 'live', '70', [3, 1])])), ['redcard:home:2', 'redcard:home:3', 'redcard:away:1']);
});

test('Status: Rote Karte zurückgenommen – erst nach zwei Abrufen, Cache-Ausreißer meldet nichts doppelt', () => {
  const t = new StatusTracker();
  t.update([s('x', 'live', '10', [0, 1])]);
  assert.deepStrictEqual(t.update([s('x', 'live', '11', [0, 0])]), []); // Ausreißer
  assert.deepStrictEqual(t.update([s('x', 'live', '12', [0, 1])]), []); // dieselbe Karte, nicht neu
  assert.deepStrictEqual(t.update([s('x', 'live', '13', [0, 0])]), []);
  assert.deepStrictEqual(t.update([s('x', 'live', '14', [0, 0])]), []); // jetzt bestätigt: VAR hat Rot zurückgenommen
  const again = t.update([s('x', 'live', '80', [0, 1])]);
  assert.deepStrictEqual(kinds(again), ['redcard:away:1']);
});

test('Status: neu auftauchendes Spiel wird nur gemerkt, danach normale Meldungen', () => {
  const t = new StatusTracker();
  t.update([s('x', 'pre')]);
  assert.deepStrictEqual(t.update([s('x', 'pre'), s('y', 'live', 'Halbzeit', [1, 0])]), []);
  assert.deepStrictEqual(kinds(t.update([s('x', 'pre'), s('y', 'live', '60', [1, 1])])), ['redcard:away:1']);
  assert.deepStrictEqual(kinds(t.update([s('x', 'pre'), s('y', 'done', null, [1, 1])])), ['fulltime']);
});

test('Status: Reihenfolge in einem Abruf – Anpfiff, Rote Karte, Halbzeit, Abpfiff', () => {
  const t = new StatusTracker();
  t.update([s('x', 'pre'), s('y', 'live', '44')], { now: START });
  const ev = t.update([s('x', 'live', '2', [0, 1]), s('y', 'live', 'Halbzeit', [1, 0])], { now: START + 3 * MIN });
  assert.deepStrictEqual(ev.map((e) => `${e.match.id}:${kinds([e])[0]}`), ['x:kickoff', 'x:redcard:away:1', 'y:redcard:home:1', 'y:halftime']);
  const end = t.update([s('x', 'done', null, [0, 2]), s('y', 'live', '50', [1, 0])], { now: START + 100 * MIN });
  assert.deepStrictEqual(kinds(end), ['redcard:away:2', 'fulltime']);
});

test('Status: reset startet wieder still, lastUpdate wie beim GoalDetector', () => {
  const t = new StatusTracker();
  t.update([s('x', 'pre')], { now: 1000 });
  assert.strictEqual(t.lastUpdate, 1000);
  t.reset();
  assert.strictEqual(t.lastUpdate, 0);
  assert.deepStrictEqual(t.update([s('x', 'live', '1', [1, 0])], { now: new Date(5000) }), []);
  assert.strictEqual(t.lastUpdate, 5000);
  assert.deepStrictEqual(t.update([s('x', 'live', '2', [1, 0])]), []);
});

test('Status: Spiele ohne redCards-Feld (alte Daten) gehen auch', () => {
  const t = new StatusTracker();
  t.update([{ id: 'x', status: 'pre', minute: null }]);
  assert.deepStrictEqual(kinds(t.update([{ id: 'x', status: 'live', minute: '1' }])), ['kickoff']);
});
