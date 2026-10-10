const test = require('node:test');
const assert = require('node:assert');
const TT = require('../src/popup/designs/teletext-font');
const vt = require('../src/popup/designs/videotext');

const BL = { id: 54, name: 'Bundesliga', short: 'Bundesliga' };
const team = (name) => ({ id: null, name, code: name.slice(0, 3).toUpperCase(), full: name, logo: null });
const card = (o) => ({
  key: 'k', design: 'videotext', duration: 14000, favorite: false, conceded: false, demo: false,
  competition: BL, round: '5', url: 'https://www.fotmob.com/de/match/1', home: team('Augsburg'), away: team('Bayern'),
  score: [2, 1], minute: '78', side: 'home', team: 'Augsburg', goal: null, pending: false, varPending: false,
  reinstated: false, text: { headline: 'Tor für Augsburg', sentence: 'Robin Fellhauer verwandelt den Elfmeter zum 2:1.' },
  ...o,
});

// Seite als Textzeilen (Kopfzeile mit fester Uhrzeit)
function page(c, sub = 0) {
  const rows = vt.bodyRowsFor(c, new Date(2026, 9, 10, 15, 31));
  const layout = vt.compose(c, { bodyRows: rows, shownAt: new Date(2026, 9, 10, 15, 31) });
  const lines = vt.linesAt(layout, new Date(2026, 9, 10, 16, 42, 13), sub);
  return { rows, layout, lines, text: lines.map((l) => l.toString()) };
}

// ---------------------------------------------------------------- Schrift

test('Schrift: alle nötigen Zeichen, jede Glyphe 10 Zeilen x 5 Punkte', () => {
  const need = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÄÖÜäöüß.,:;\'-+/()!?&" ';
  for (const ch of need) {
    assert.ok(TT.chars.includes(ch), `Zeichen fehlt: ${ch}`);
    const g = TT.glyph(ch);
    assert.strictEqual(g.length, 10, ch);
    for (const row of g) assert.match(row, /^[#.]{5}$/, ch);
  }
});

test('Schrift: Buchstaben, Ziffern und Umlaute sind eindeutig', () => {
  const seen = new Map();
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÄÖÜäöüß') {
    const key = TT.glyph(ch).join('/');
    assert.ok(!seen.has(key), `${ch} sieht aus wie ${seen.get(key)}`);
    seen.set(key, ch);
  }
});

test('Schrift: Akzente auf Grundbuchstaben, Umlaute bleiben, Unbekanntes wird Leerzeichen', () => {
  assert.strictEqual(TT.clean('Andrej Kramarić'), 'Andrej Kramaric');
  assert.strictEqual(TT.clean('Bambasé Conté'), 'Bambase Conte');
  assert.strictEqual(TT.clean('Ødegaard, Łukasz, Çalhanoğlu'), 'Odegaard, Lukasz, Calhanoglu');
  assert.strictEqual(TT.clean('Müller schießt, Größe: Übersicht'), 'Müller schießt, Größe: Übersicht');
  assert.strictEqual(TT.clean('é'), 'e'); // zerlegter Akzent
  assert.strictEqual(TT.clean('„Tor“ – 1:0…'), '"Tor" - 1:0...');
  assert.strictEqual(TT.clean('A中B'), 'A B');
  assert.strictEqual(TT.clean(null), '');
  assert.strictEqual(TT.measure('Kramarić'), 8);
});

test('Schrift: Glättung füllt Diagonalen mit halben Punkten', () => {
  const lit = (ch) => TT.runs(ch).reduce((n, r) => n + r[2], 0);
  const dots = (ch) => TT.glyph(ch).join('').split('#').length - 1;
  assert.strictEqual(lit('H'), dots('H') * 4); // nur Senkrechte/Waagerechte: nichts zu glätten
  assert.ok(lit('X') > dots('X') * 4, 'X wird geglättet');
  // "/" hat die Punkte (4,2) und (3,3) (Zeile 0 ist die leere Zeile oben). Als Pixel (2x2, dazu 2 px
  // leere Spalte links): (4,2) -> x 10..11, y 4..5; (3,3) -> x 8..9, y 6..7. Die Stufe dazwischen
  // füllt der SAA5050 mit zwei halben Punkten: (9,5) und (10,6).
  const px = new Set(TT.runs('/').flatMap(([x, y, w]) => Array.from({ length: w }, (_, i) => `${x + i},${y}`)));
  assert.ok(px.has('10,4') && px.has('8,7'), 'die Punkte selbst');
  assert.ok(px.has('9,5') && px.has('10,6'), 'halbe Punkte in der Stufe');
  assert.ok(!px.has('9,4') && !px.has('11,6'), 'sonst nichts');
});

// ---------------------------------------------------------------- Texte

test('Minuten und Konferenz-Zustand', () => {
  assert.strictEqual(vt.minuteText('78'), '78.');
  assert.strictEqual(vt.minuteText("45+2'"), '45.+2');
  assert.strictEqual(vt.minuteText('Halbzeit'), '');
  assert.strictEqual(vt.stateText({ status: 'live', minute: '67' }), '67.');
  assert.strictEqual(vt.stateText({ status: 'live', minute: '90+10' }), '90+10');
  assert.strictEqual(vt.stateText({ status: 'live', minute: 'Halbzeit' }), 'Pause');
  assert.strictEqual(vt.stateText({ status: 'done', minute: 'Ende' }), 'Ende');
  assert.strictEqual(vt.stateText({ status: 'cancelled' }), 'abg.');
  const start = new Date(2026, 9, 10, 18, 30).toISOString();
  assert.strictEqual(vt.stateText({ status: 'pre', startUtc: start }), '18:30');
});

test('Namen kürzen wie im Videotext', () => {
  assert.strictEqual(vt.abbr('Augsburg', 10), 'Augsburg');
  assert.strictEqual(vt.abbr('Preußen Münster', 9), 'Preußen');
  assert.strictEqual(vt.abbr('Kaiserslautern', 9), 'Kaisersl.');
  assert.deepStrictEqual(vt.fitPair('Rot-Weiss Essen', 'Mönchengladbach', 24), ['Rot-Weiss', 'Mönchengladbach']);
  const [a, b] = vt.fitPair('Kaiserslautern', 'Braunschweig', 18);
  assert.ok(a.length + b.length <= 18);
});

test('Satz umbrechen: ganze Sätze, Gedankenstrich bleibt beim Ergebnis', () => {
  assert.deepStrictEqual(vt.sentenceLines('', 31, 2), []);
  assert.deepStrictEqual(vt.sentenceLines('Eigentor von Dayot Upamecano – 1:0.', 31, 2),
    ['Eigentor von Dayot Upamecano', '- 1:0.']);
  // "Vorlage" fällt weg, wenn sonst nicht alles passt
  assert.deepStrictEqual(vt.sentenceLines('Serhou Guirassy bringt Dortmund in Führung. Vorlage: Julian Brandt.', 31, 2),
    ['Serhou Guirassy bringt Dortmund', 'in Führung.']);
  const cut = vt.sentenceLines('Andrej Kramarić gleicht zum 1:1 aus.', 31, 1);
  assert.strictEqual(cut.length, 1);
  assert.ok(cut[0].endsWith(' ...') && cut[0].length <= 31);
});

test('Torschütze: Minute, Name, Elfmeter/Eigentor; wartet ruhig auf den Namen', () => {
  const g = (o) =>
    vt.scorerText(card({ goal: { scorer: 'Robin Fellhauer', minute: '78', penalty: true, ...o } }), 'Augsburg');
  assert.strictEqual(g({}), '78. Robin Fellhauer (Elfmeter)');
  assert.strictEqual(g({ penalty: false, ownGoal: true, scorer: 'Dayot Upamecano' }), '78. Dayot Upamecano (Eigentor)');
  assert.strictEqual(g({ scorer: 'Jean-Philippe Mateta-Kowalczyk', minute: '90+4' }), '90.+4 Mateta-Kowalczyk');
  const wartet = card({ pending: true, goal: { scorer: null, minute: '78' } });
  assert.strictEqual(vt.scorerText(wartet, 'Augsburg'), '78. Torschütze folgt ...');
  assert.strictEqual(vt.scorerText(card({ goal: null }), 'Augsburg'), '78. Tor für Augsburg');
});

// ---------------------------------------------------------------- Seiten

test('Kopfzeile: Seitennummer, Tor-Text, Datum, sekundengenaue Uhr – 33 Zeichen', () => {
  const l = vt.headerLine(250, new Date(2026, 9, 10, 16, 42, 13));
  assert.strictEqual(l.toString(), ' 250 Tor-Text  Sa 10.10. 16:42:13');
  assert.strictEqual(l.cells.length, 33);
});

test('Alle Kartentypen: jede Zeile genau 33 Zellen, Band doppelt hoch, Fastext unten', () => {
  const types = [
    card({ type: 'goal', goal: { scorer: 'Robin Fellhauer', minute: '78', penalty: true } }),
    card({ type: 'goal', pending: true }),
    card({ type: 'goal', varPending: true }),
    card({ type: 'goal', favorite: true }),
    card({ type: 'goal', conceded: true }),
    card({ type: 'goal', demo: true }),
    card({ type: 'disallowed', prev: [2, 2], score: [1, 2], text: null }),
    card({ type: 'missed', missed: { home: 2, away: 1 }, minute: 'Ende' }),
    card({ type: 'kickoff', score: [0, 0] }),
    card({ type: 'halftime', minute: 'Halbzeit' }),
    card({ type: 'fulltime', minute: 'Ende' }),
    card({ type: 'redcard', side: 'away', team: 'Bayern', player: 'Dayot Upamecano', minute: '67' }),
    card({ type: 'conference', matches: [] }),
    card({ type: 'unbekannt' }),
  ];
  for (const c of types) {
    const p = page(c);
    for (const l of p.lines) assert.strictEqual(l.cells.length, 33, `${c.type}: ${l}`);
    assert.ok(p.lines[1].big, `${c.type}: Band in doppelter Höhe`);
    assert.strictEqual(p.lines.length, 1 + 1 + p.rows + 1);
    assert.match(p.text[p.text.length - 1], /Schließen/);
    const height = (1 + 2 + p.rows + 1) * 20 + 8 + 16;
    assert.ok(height <= 420, `${c.type}: ${height}`);
  }
});

test('Tor: "TOR!" blinkt, Lieblingsverein "TOOOR!" auf rotem Band, Gegentor ruhig', () => {
  const flashText = (p) => p.lines[1].cells.filter((c) => c.flash && c.ch !== ' ').map((c) => c.ch).join('');
  const normal = page(card({ type: 'goal' }));
  assert.strictEqual(flashText(normal), 'TOR!');
  assert.match(normal.text[1], /Bundesliga +TOR!/);
  assert.match(normal.text[2], /Augsburg - Bayern +2:1/);
  const fav = page(card({ type: 'goal', favorite: true }));
  assert.strictEqual(flashText(fav), 'TOOOR!');
  assert.ok(fav.lines[1].cells.some((c) => c.bg === 1), 'rotes Band');
  const leise = page(card({ type: 'goal', conceded: true }));
  assert.strictEqual(flashText(leise), '');
  assert.match(leise.text[1], /Gegentor/);
});

test('Tor: wer getroffen hat, steht im Ergebnis gelb', () => {
  const fg = (p, word) => {
    const s = p.lines[2].toString();
    return p.lines[2].cells[s.indexOf(word)].fg;
  };
  const home = page(card({ type: 'goal', side: 'home' }));
  assert.strictEqual(fg(home, 'Augsburg'), 3);
  assert.strictEqual(fg(home, 'Bayern'), 7);
  const away = page(card({ type: 'goal', side: 'away', score: [1, 2] }));
  assert.strictEqual(fg(away, 'Bayern'), 3);
});

test('Tor: Torschütze kommt per Update nach, Höhe bleibt', () => {
  const c = card({ type: 'goal', pending: true, goal: { scorer: null, minute: '90+4' },
    text: { sentence: 'Gladbach erhöht auf 1:3.' } });
  const before = page(c);
  assert.match(before.text.join('\n'), /90\.\+4 Torschütze folgt \.\.\./);
  Object.assign(c, { pending: false, goal: { scorer: 'Tim Kleindienst', minute: '90+4' },
    text: { sentence: 'Tim Kleindienst erhöht auf 1:3. Vorlage: Kevin Stöger.' } });
  const layout = vt.compose(c, { bodyRows: before.rows });
  const after = vt.linesAt(layout, new Date(), 0).map(String).join('\n');
  assert.match(after, /90\.\+4 Tim Kleindienst/);
  assert.match(after, /Vorlage: Kevin Stöger\./);
});

test('Rote Karte: roter Block im Band, bei langem Wettbewerb nur "Rot"', () => {
  const p = page(card({ type: 'redcard', side: 'away', team: 'Bayern', player: 'Dayot Upamecano', minute: '67' }));
  assert.match(p.text[1], /Bundesliga +Rote Karte/);
  assert.ok(p.lines[1].cells.some((c) => c.bg === 1 && c.ch === 'R'));
  assert.match(p.text.join('\n'), /67\. Dayot Upamecano \(Bayern\)/);
  const cl = page(card({ type: 'redcard', competition: { id: 42, name: 'Champions League', short: 'CL' }, player: 'X' }));
  assert.match(cl.text[1], /Champions League +Rot /);
  assert.strictEqual(cl.layout.pageNo, 230);
});

test('Fastext: Spiel, Tabelle, Liga, Schließen mit den richtigen Zielen', () => {
  const items = vt.fastextItems(card({ type: 'goal' }), BL);
  assert.deepStrictEqual(items.map((i) => i.label), ['Spiel', 'Tabelle', 'Liga', 'Schließen']);
  assert.deepStrictEqual(items.map((i) => i.color), [1, 2, 3, 6]);
  assert.strictEqual(items[0].url, 'https://www.fotmob.com/de/match/1');
  assert.strictEqual(items[1].url, 'https://www.fotmob.com/de/leagues/54/table');
  assert.strictEqual(items[2].url, 'https://www.fotmob.com/de/leagues/54/overview');
  assert.ok(items[3].close);
  const pokal = vt.fastextItems(card({ type: 'goal' }), { id: 209, name: 'DFB-Pokal', short: 'Pokal' });
  assert.strictEqual(pokal[2].label, 'Pokal');
  const line = vt.fastextLine(items);
  assert.strictEqual(line.cells.length, 33);
  const text = line.toString();
  for (const it of items) {
    const at = text.indexOf(it.label);
    assert.strictEqual(line.cells[at].link, it.id);
    assert.strictEqual(line.cells[at].fg, it.color);
  }
  // ohne Spiel-Link (keine URL) kein rotes "Spiel"
  assert.ok(!vt.fastextItems(card({ type: 'goal', url: null }), BL).some((i) => i.id === 'spiel'));
});

test('Konferenz: eine Zeile pro Spiel, Höhe wächst, viele Spiele auf Unterseiten', () => {
  const m = (h, a, comp, status = 'live', minute = '30') =>
    ({ home: team(h), away: team(a), score: [1, 0], minute, status, competition: comp, redCards: [0, 0],
      startUtc: new Date(2026, 9, 10, 15, 30).toISOString() });
  const BL2 = { id: 146, name: '2. Bundesliga', short: '2. Liga' };
  const few = page(card({ type: 'conference', matches: [m('Augsburg', 'Bayern', BL), m('Mainz', 'Köln', BL, 'pre')] }));
  assert.strictEqual(few.rows, 2);
  assert.match(few.text[2], /^ Augsburg - Bayern +1:0 +30\. $/);
  assert.match(few.text[3], /Mainz - Köln +-:- +15:30/);
  assert.strictEqual(few.layout.pageNo, 252);

  const six = page(card({ type: 'conference', matches: Array.from({ length: 6 }, (_, i) => m(`Heim${i}`, `G${i}`, BL)) }));
  assert.strictEqual(six.rows, 6);

  const many = [...Array.from({ length: 9 }, (_, i) => m(`Heim${i}`, `Gast${i}`, BL)),
    ...Array.from({ length: 9 }, (_, i) => m(`Haus${i}`, `Ziel${i}`, BL2))];
  const p = page(card({ type: 'conference', matches: many }));
  assert.ok(p.rows <= 15);
  assert.strictEqual(p.layout.pages.length, 2);
  assert.match(p.text[1], /Alle Spiele +1\/2/);
  const p2 = vt.linesAt(p.layout, new Date(), 1).map(String);
  assert.match(p2[1], /2\/2/);
  // Gruppe geht auf Seite 2 weiter -> Überschrift dort wieder oben
  assert.match(p2[2], /Bundesliga/);
  const all = [...p.text, ...p2].filter((t) => /(Heim|Haus)\d - /.test(t));
  assert.strictEqual(all.length, 18, 'jedes Spiel genau einmal');

  const leer = page(card({ type: 'conference', matches: [] }));
  assert.match(leer.text.join('\n'), /Heute keine Spiele\./);
});

test('Test-Karte: Hinweis in der letzten Inhaltszeile, Satz bleibt vollständig', () => {
  const p = page(card({ type: 'goal', demo: true }));
  const body = p.text.slice(2, 2 + p.rows);
  assert.match(body[body.length - 1], /Test: so sieht ein Tor aus/);
  assert.ok(body.some((t) => /Elfmeter zum 2:1\./.test(t)));
});
