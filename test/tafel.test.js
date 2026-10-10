// Tafel-Design: was zu welcher Zeit auf der LED-Tafel steht (ohne Electron, ohne Zeichnen).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// board.js und designs/tafel.js wie im Browser laden – window ist hier ein leeres Objekt.
function load() {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['board.js', 'designs/tafel.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}
const win = load();
const tafel = win.TA_DESIGNS.tafel;
// Objekte aus dem vm-Kontext haben fremde Prototypen – für deepEqual flach kopieren.
const scene = (card, t) => JSON.parse(JSON.stringify(tafel.scene(card, t)));
const texts = (opts) => opts.map((o) => o.text);

const FCA = { id: 8406, name: 'Augsburg', code: 'FCA', full: 'Augsburg', logo: null };
const FCB = { id: 9823, name: 'Bayern', code: 'FCB', full: 'Bayern München', logo: null };
const BL = { id: 54, name: 'Bundesliga', short: 'Bundesliga' };
const card = (o) => ({
  design: 'tafel', type: 'goal', ledColor: 'amber', duration: 14000, favorite: false, conceded: false, demo: false,
  competition: BL, round: '5', url: 'https://www.fotmob.com/de/match/1', home: FCA, away: FCB, score: [2, 1],
  minute: '78', side: 'home', team: 'Augsburg', goal: null, pending: false, varPending: false, reinstated: false,
  ...o,
});

test('stellt sich als Design "tafel" mit mount/update/destroy bereit', () => {
  for (const k of ['mount', 'update', 'destroy']) assert.strictEqual(typeof tafel[k], 'function');
});

test('"TOOOR!" in vierfacher Größe passt genau auf die Tafel (124 von 128 Spalten)', () => {
  assert.strictEqual(win.LED.measure('TOOOR!', 4), 124);
});

test('Tor: "TOR!" 2,3 s, danach Spielstand, Torschütze, Elfmeter', () => {
  const c = card({ goal: { scorer: 'Robin Fellhauer', minute: '78', penalty: true, ownGoal: false, assist: null } });
  assert.strictEqual(scene(c, 1000).intro.word, 'TOR!');
  const s = scene(c, 2400);
  assert.strictEqual(s.intro, undefined);
  assert.deepStrictEqual([s.score.left, s.score.hs, s.score.as, s.score.right], ['FCA', '2', '1', 'FCB']);
  assert.strictEqual(s.line2, 'TOR FÜR Augsburg');
  assert.deepStrictEqual(texts(s.line3), ["78' Robin Fellhauer", 'ELFMETER']);
});

test('Tor ohne Schützen (pending): nur die Minute, VAR-Check blinkt', () => {
  const s = scene(card({ pending: true, varPending: true, minute: '45+2' }), 3000);
  assert.deepStrictEqual(s.line3, [{ text: "45+2'" }, { text: 'VAR-CHECK', blink: true }]);
});

test('Lieblingsverein: "TOOOR!" 3,5 s, Gegentor leise: kein Intro, "GEGENTOR"', () => {
  const fav = card({ favorite: true });
  assert.strictEqual(scene(fav, 3400).intro.word, 'TOOOR!');
  assert.strictEqual(scene(fav, 3600).line2, 'TOR FÜR Augsburg');
  const con = card({ conceded: true, side: 'away', team: 'Bayern', score: [1, 1] });
  assert.strictEqual(scene(con, 0).intro, undefined);
  assert.strictEqual(scene(con, 0).line2, 'GEGENTOR');
  assert.strictEqual(scene({ ...con, reinstated: true }, 0).line2, 'TOR ZÄHLT DOCH');
});

test('die Zahl der Mannschaft, die getroffen hat, blinkt nach dem Intro kurz', () => {
  const c = card({ side: 'away', team: 'Bayern' });
  assert.strictEqual(scene(c, 2300 + 100).score.off, undefined);
  assert.strictEqual(scene(c, 2300 + 400).score.off, 'away');
  assert.strictEqual(scene(c, 2300 + 2000).score.off, undefined);
});

test('aberkannt, verpasst', () => {
  const dis = scene(card({ type: 'disallowed', score: [1, 1], prev: [2, 1] }), 2400);
  assert.strictEqual(dis.line2, 'KEIN TOR FÜR Augsburg');
  assert.deepStrictEqual(texts(dis.line3), ['DAS 2:1 ZÄHLT NICHT']);
  const mis = scene(card({ type: 'missed', side: null, team: null, minute: 'Ende', score: [3, 2], missed: { home: 2, away: 1 } }), 0);
  assert.strictEqual(mis.line2, 'ENDSTAND');
  assert.deepStrictEqual(texts(mis.line3), ['3 TORE VERPASST', '+2 Augsburg', '+1 Bayern']);
});

test('Anpfiff, Halbzeit, Abpfiff: kein Intro, Wettbewerb und Uhrzeit im Wechsel', () => {
  const k = scene(card({ type: 'kickoff', side: null, team: null, score: [0, 0] }), 0);
  assert.strictEqual(k.intro, undefined);
  assert.strictEqual(k.line2, 'ANPFIFF');
  assert.strictEqual(k.line3[0].text, 'Bundesliga');
  assert.match(k.line3[1].text, /^\d\d:\d\d UHR$/);
  assert.strictEqual(scene(card({ type: 'halftime' }), 0).line2, 'HALBZEIT');
  const f = card({ type: 'fulltime', minute: 'Ende' });
  assert.strictEqual(scene(f, 1000).line2, 'ABPFIFF');
  assert.strictEqual(scene(f, 5000).line2, 'ENDSTAND');
});

test('Rote Karte: "ROT", dann Mannschaft und Spieler', () => {
  const c = card({ type: 'redcard', side: 'away', team: 'Bayern', player: null, minute: '67', pending: true });
  assert.strictEqual(scene(c, 500).intro.word, 'ROT');
  assert.strictEqual(scene(c, 2000).line2, 'ROTE KARTE Bayern');
  assert.deepStrictEqual(texts(scene(c, 2000).line3), ["67'"]);
  assert.deepStrictEqual(texts(scene({ ...c, player: 'Dayot Upamecano', minute: '66' }, 2000).line3), ["66' Dayot Upamecano"]);
});

test('Konferenz: blättert alle 3 s, zeigt "2/3", Anstoßzeit und öffnet das gezeigte Spiel', () => {
  const start = '2026-10-10T16:30:00.000Z';
  const d = new Date(start);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const matches = [
    { home: FCA, away: FCB, score: [2, 1], minute: '67', status: 'live', competition: BL, url: 'https://www.fotmob.com/de/match/1' },
    { home: FCB, away: FCA, score: [0, 0], minute: null, status: 'pre', startUtc: start, competition: { id: 146, name: '2. Bundesliga', short: '2. Liga' }, url: 'https://www.fotmob.com/de/match/2' },
    { home: FCA, away: FCB, score: [1, 1], minute: 'Ende', status: 'done', competition: BL },
  ];
  const c = card({ type: 'conference', matches, side: null, team: null });
  const p1 = scene(c, 100);
  assert.strictEqual(p1.page, '1/3');
  assert.strictEqual(p1.line2, "67'");
  assert.strictEqual(p1.url, 'https://www.fotmob.com/de/match/1');
  const p2 = scene(c, 3100);
  assert.strictEqual(p2.page, '2/3');
  assert.deepStrictEqual([p2.score.hs, p2.score.as], ['-', '-']);
  assert.strictEqual(p2.line2, `ANSTOSS ${hhmm}`);
  assert.deepStrictEqual(texts(p2.line3), ['2. Liga']);
  assert.strictEqual(scene(c, 6100).line2, 'ENDE');
  assert.strictEqual(scene(c, 9100).page, '1/3'); // und wieder von vorn
});

test('Konferenz mit einem oder keinem Spiel', () => {
  const one = scene(card({ type: 'conference', matches: [{ home: FCA, away: FCB, score: [0, 0], minute: 'Halbzeit', status: 'live', competition: BL }] }), 5000);
  assert.strictEqual(one.page, '');
  assert.strictEqual(one.line2, 'HALBZEIT');
  const none = scene(card({ type: 'conference', matches: [] }), 0);
  assert.strictEqual(none.line2, 'HEUTE KEIN SPIEL');
  assert.match(none.score.big, /^\d\d:\d\d$/);
});

test('Kürzel: eigenes Kürzel, sonst die ersten drei Buchstaben ohne Akzente', () => {
  const s = scene(card({ home: { name: 'Śląsk Wrocław' }, away: { name: 'İstanbul Başakşehir', code: '' } }), 2400);
  assert.deepStrictEqual([s.score.left, s.score.right], ['SLA', 'IST']);
  const n = scene(card({ home: {}, away: null, score: [null, undefined] }), 2400);
  assert.deepStrictEqual([n.score.left, n.score.hs, n.score.as, n.score.right], ['???', '-', '-', '???']);
});

test('Punktschrift: Umlaute bleiben, ß wird SS, Akzente fallen weg', () => {
  assert.strictEqual(win.LED.clean('Jürgen Kößler'), 'JÜRGEN KÖSSLER');
  assert.strictEqual(win.LED.clean('Łukasz Øyen-Çelik'), 'LUKASZ OYEN-CELIK');
});
