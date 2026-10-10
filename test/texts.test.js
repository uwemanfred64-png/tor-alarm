process.env.TZ = 'Europe/Berlin'; // Anstoßzeiten in der Konferenz
const test = require('node:test');
const assert = require('node:assert');
const texts = require('../src/texts');

const FCA = { id: 8406, name: 'Augsburg', code: 'FCA', full: 'Augsburg', logo: null };
const FCB = { id: 9823, name: 'Bayern', code: 'FCB', full: 'Bayern München', logo: null };
const HSV = { id: 9790, name: 'HSV', code: 'HSV', full: 'Hamburger SV', logo: null };
const SVW = { id: 8697, name: 'Werder', code: 'SVW', full: 'Werder Bremen', logo: null };
const BL = { id: 54, name: 'Bundesliga', short: 'Bundesliga' };
const POKAL = { id: 209, name: 'DFB-Pokal', short: 'Pokal' };
const URL = 'https://www.fotmob.com/de/match/5881179';

function card(extra) {
  return {
    key: 'k1',
    design: 'ticker',
    type: 'goal',
    home: FCA,
    away: FCB,
    competition: BL,
    round: '5',
    url: URL,
    score: [0, 0],
    minute: '78',
    side: null,
    team: null,
    favorite: false,
    conceded: false,
    favoriteSide: null,
    demo: false,
    goal: null,
    pending: false,
    varPending: false,
    reinstated: false,
    ...extra,
  };
}

// Tor: side + Spielstand danach, g = Torschützen-Daten (null = noch unbekannt)
function goal(side, score, g, extra) {
  return card({ type: 'goal', side, team: side === 'home' ? 'Augsburg' : 'Bayern', score, goal: g, pending: !g, ...extra });
}
const G = (scorer, more) => ({ scorer, minute: '78', ownGoal: false, penalty: false, assist: null, ...more });
const sentence = (c) => texts.describe(c).sentence;
const headline = (c) => texts.describe(c).headline;

function oneOf(actual, list) {
  assert.ok(list.includes(actual), `"${actual}" ist keine der erwarteten Formulierungen:\n  ${list.join('\n  ')}`);
}

// ---------------------------------------------------------------- Tore nach Spielsituation

test('1:0 und 0:1: Führung durch das erste Tor', () => {
  oneOf(sentence(goal('home', [1, 0], G('Robin Fellhauer'))), [
    'Robin Fellhauer trifft zum 1:0.',
    'Robin Fellhauer bringt Augsburg in Führung.',
    'Robin Fellhauer erzielt das 1:0.',
  ]);
  oneOf(sentence(goal('away', [0, 1], G('Harry Kane'))), [
    'Harry Kane trifft zum 0:1.',
    'Harry Kane bringt Bayern in Führung.',
    'Harry Kane erzielt das 0:1.',
  ]);
  assert.strictEqual(headline(goal('home', [1, 0], G('Robin Fellhauer'))), 'Tor für Augsburg');
  assert.strictEqual(headline(goal('away', [0, 1], G('Harry Kane'))), 'Tor für Bayern');
});

test('Führung nach Gleichstand', () => {
  oneOf(sentence(goal('home', [2, 1], G('Robin Fellhauer'))), [
    'Robin Fellhauer bringt Augsburg in Führung.',
    'Robin Fellhauer trifft zum 2:1, Augsburg führt.',
    'Robin Fellhauer schießt Augsburg in Führung.',
  ]);
  oneOf(sentence(goal('away', [1, 2], G('Harry Kane'))), [
    'Harry Kane bringt Bayern in Führung.',
    'Harry Kane trifft zum 1:2, Bayern führt.',
    'Harry Kane schießt Bayern in Führung.',
  ]);
});

test('Ausgleich', () => {
  oneOf(sentence(goal('away', [1, 1], G('Harry Kane'))), [
    'Harry Kane gleicht zum 1:1 aus.',
    'Harry Kane trifft zum 1:1-Ausgleich.',
    'Harry Kane erzielt den Ausgleich zum 1:1.',
  ]);
  oneOf(sentence(goal('home', [3, 3], G('Robin Fellhauer'))), [
    'Robin Fellhauer gleicht zum 3:3 aus.',
    'Robin Fellhauer trifft zum 3:3-Ausgleich.',
    'Robin Fellhauer erzielt den Ausgleich zum 3:3.',
  ]);
});

test('Anschluss und verkürzen', () => {
  oneOf(sentence(goal('home', [1, 2], G('Robin Fellhauer'))), ['Robin Fellhauer verkürzt auf 1:2.', 'Robin Fellhauer erzielt den Anschlusstreffer zum 1:2.']);
  oneOf(sentence(goal('away', [2, 1], G('Harry Kane'))), ['Harry Kane verkürzt auf 2:1.', 'Harry Kane erzielt den Anschlusstreffer zum 2:1.']);
  // weiter zwei Tore hinten: kein "Anschlusstreffer"
  oneOf(sentence(goal('home', [1, 3], G('Robin Fellhauer'))), ['Robin Fellhauer verkürzt auf 1:3.', 'Robin Fellhauer trifft zum 1:3.']);
});

test('Ausbau, auch bei 10:2', () => {
  oneOf(sentence(goal('home', [3, 0], G('Robin Fellhauer'))), [
    'Robin Fellhauer erhöht auf 3:0.',
    'Robin Fellhauer legt das 3:0 nach.',
    'Robin Fellhauer baut die Führung auf 3:0 aus.',
  ]);
  oneOf(sentence(goal('home', [10, 2], G('Robin Fellhauer'))), [
    'Robin Fellhauer erhöht auf 10:2.',
    'Robin Fellhauer legt das 10:2 nach.',
    'Robin Fellhauer baut die Führung auf 10:2 aus.',
  ]);
  oneOf(sentence(goal('away', [0, 3], G('Harry Kane'))), ['Harry Kane erhöht auf 0:3.', 'Harry Kane legt das 0:3 nach.', 'Harry Kane baut die Führung auf 0:3 aus.']);
});

test('Elfmeter in jeder Lage', () => {
  const pen = (side, score) => sentence(goal(side, score, G(side === 'home' ? 'Robin Fellhauer' : 'Harry Kane', { penalty: true })));
  oneOf(pen('home', [2, 1]), ['Robin Fellhauer verwandelt den Elfmeter zum 2:1.', 'Robin Fellhauer bringt Augsburg per Elfmeter in Führung.', 'Robin Fellhauer trifft vom Punkt zum 2:1.']);
  oneOf(pen('away', [1, 1]), ['Harry Kane verwandelt den Elfmeter zum 1:1.', 'Harry Kane gleicht per Elfmeter zum 1:1 aus.', 'Harry Kane trifft vom Punkt zum 1:1-Ausgleich.']);
  oneOf(pen('home', [1, 2]), ['Robin Fellhauer verwandelt den Elfmeter zum 1:2.', 'Robin Fellhauer verkürzt per Elfmeter auf 1:2.']);
  oneOf(pen('home', [3, 0]), ['Robin Fellhauer verwandelt den Elfmeter zum 3:0.', 'Robin Fellhauer erhöht per Elfmeter auf 3:0.', 'Robin Fellhauer trifft vom Punkt zum 3:0.']);
});

test('Elfmeter mit Vorlage: keine Vorlage bei Strafstößen', () => {
  const s = sentence(goal('home', [2, 1], G('Robin Fellhauer', { penalty: true, assist: 'Elvis Rexhbecaj' })));
  assert.ok(!s.includes('Vorlage'), s);
  oneOf(s, ['Robin Fellhauer verwandelt den Elfmeter zum 2:1.', 'Robin Fellhauer bringt Augsburg per Elfmeter in Führung.', 'Robin Fellhauer trifft vom Punkt zum 2:1.']);
});

test('Vorlage wird angehängt', () => {
  const s = sentence(goal('home', [2, 0], G('Robin Fellhauer', { assist: 'Elvis Rexhbecaj' })));
  assert.ok(s.endsWith(' Vorlage: Elvis Rexhbecaj.'), s);
  oneOf(s.replace(' Vorlage: Elvis Rexhbecaj.', ''), ['Robin Fellhauer erhöht auf 2:0.', 'Robin Fellhauer legt das 2:0 nach.', 'Robin Fellhauer baut die Führung auf 2:0 aus.']);
  // Vorlagengeber = Schütze (Datenfehler) wird weggelassen
  assert.ok(!sentence(goal('home', [1, 0], G('Robin Fellhauer', { assist: 'Robin Fellhauer' }))).includes('Vorlage'));
});

test('Eigentor: Schütze gehört zum anderen Team', () => {
  const home = goal('home', [1, 0], G('Dayot Upamecano', { ownGoal: true, assist: 'Irgendwer' }));
  assert.strictEqual(headline(home), 'Tor für Augsburg');
  oneOf(sentence(home), ['Eigentor von Dayot Upamecano – 1:0 für Augsburg.', 'Dayot Upamecano trifft ins eigene Tor.']);

  // Eigentor auswärts: ein Augsburger trifft ins eigene Tor, Bayern führt 0:1
  const away = goal('away', [0, 1], G('Jeffrey Gouweleeuw', { ownGoal: true }));
  assert.strictEqual(headline(away), 'Tor für Bayern');
  oneOf(sentence(away), ['Eigentor von Jeffrey Gouweleeuw – 0:1 für Bayern.', 'Jeffrey Gouweleeuw trifft ins eigene Tor.']);

  oneOf(sentence(goal('away', [1, 1], G('Jeffrey Gouweleeuw', { ownGoal: true }))), [
    'Eigentor von Jeffrey Gouweleeuw zum 1:1-Ausgleich.',
    'Ausgleich durch ein Eigentor von Jeffrey Gouweleeuw: 1:1.',
  ]);
  oneOf(sentence(goal('home', [2, 1], G('Dayot Upamecano', { ownGoal: true }))), [
    'Eigentor von Dayot Upamecano – 2:1, Augsburg führt.',
    'Dayot Upamecano trifft ins eigene Tor.',
  ]);
  oneOf(sentence(goal('home', [1, 2], G('Dayot Upamecano', { ownGoal: true }))), ['Eigentor von Dayot Upamecano – nur noch 1:2.', 'Eigentor von Dayot Upamecano zum 1:2.']);
  // Eigentor schlägt Elfmeter (beides zugleich gibt es nicht)
  assert.match(sentence(goal('home', [1, 0], G('Dayot Upamecano', { ownGoal: true, penalty: true }))), /eigene|Eigentor/);
  // Eigentor, Schütze unbekannt
  assert.strictEqual(sentence(goal('away', [0, 1], G(null, { ownGoal: true }))), 'Eigentor – 0:1 für Bayern.');
});

test('unbekannter Schütze: Mannschaft trifft', () => {
  const s = sentence(goal('home', [2, 1], null));
  oneOf(s, ['Augsburg trifft zum 2:1.', 'Augsburg geht in Führung.']);
  oneOf(sentence(goal('away', [1, 1], null)), ['Bayern trifft zum 1:1.', 'Bayern gleicht zum 1:1 aus.']);
  oneOf(sentence(goal('home', [3, 0], null)), ['Augsburg trifft zum 3:0.', 'Augsburg erhöht auf 3:0.']);
  // FotMob-Platzhalter "<TBD>" ist kein Name
  oneOf(sentence(goal('home', [2, 1], G('<TBD>'))), ['Augsburg trifft zum 2:1.', 'Augsburg geht in Führung.']);
  // Elfmeter ohne bekannten Schützen
  oneOf(sentence(goal('home', [2, 1], G(null, { penalty: true }))), ['Augsburg trifft per Elfmeter zum 2:1.', 'Augsburg geht per Elfmeter in Führung.']);
  // Vorlage ohne Schütze ergibt keinen halben Satz
  assert.ok(!sentence(goal('home', [2, 1], G(null, { assist: 'Elvis Rexhbecaj' }))).includes('Vorlage'));
});

test('VAR prüft noch', () => {
  const s = sentence(goal('home', [1, 0], G('Robin Fellhauer'), { varPending: true }));
  assert.ok(s.endsWith('. Der VAR prüft noch.'), s);
  oneOf(s.replace(' Der VAR prüft noch.', ''), ['Robin Fellhauer trifft zum 1:0.', 'Robin Fellhauer bringt Augsburg in Führung.', 'Robin Fellhauer erzielt das 1:0.']);
  assert.match(sentence(goal('home', [1, 0], null, { varPending: true })), /^Augsburg (trifft zum 1:0|geht in Führung)\. Der VAR prüft noch\.$/);
  // Nach dem Check verschwindet der Hinweis wieder
  assert.ok(!sentence(goal('home', [1, 0], G('Robin Fellhauer'), { varPending: false })).includes('VAR'));
});

test('Nachspielzeit und kurz vor der Pause', () => {
  assert.strictEqual(sentence(goal('away', [2, 2], G('Harry Kane', { minute: '90+4' }))), 'Harry Kane gleicht in der Nachspielzeit zum 2:2 aus.');
  assert.strictEqual(sentence(goal('home', [1, 0], G('Robin Fellhauer', { minute: '45+1' }))), 'Robin Fellhauer trifft kurz vor der Pause zum 1:0.');
  assert.strictEqual(sentence(goal('home', [3, 0], G('Robin Fellhauer', { minute: '120+1' }))), 'Robin Fellhauer erhöht in der Nachspielzeit auf 3:0.');
  // Solange der Schütze fehlt, zählt die Spielminute
  assert.strictEqual(sentence(goal('home', [1, 1], null, { minute: '90+3' })), 'Augsburg gleicht in der Nachspielzeit zum 1:1 aus.');
  // normale Minute: keine Zeitangabe im Satz
  assert.ok(!/Nachspielzeit|Pause/.test(sentence(goal('home', [1, 1], G('Robin Fellhauer', { minute: '88' })))));
});

test('Länge: Sätze passen in die Designs (Ticker 2 Zeilen, Videotext 2 x 31 Zeichen)', () => {
  let maxMain = '';
  let maxFull = '';
  for (let id = 0; id < 60; id++) {
    for (const score of [[1, 0], [2, 1], [1, 1], [1, 2], [1, 3], [3, 0], [10, 2]]) {
      for (const minute of ['78', '90+4', '45+1']) {
        for (const extra of [{}, { penalty: true }, { ownGoal: true }]) {
          const c = (more) =>
            card({ home: { ...FCA, id }, side: 'home', team: 'Augsburg', score, minute, goal: G('Robin Fellhauer', { minute, ...extra, ...more }) });
          const main = sentence(c({}));
          const full = sentence({ ...c({ assist: 'Elvis Rexhbecaj' }), varPending: true });
          if (main.length > maxMain.length) maxMain = main;
          if (full.length > maxFull.length) maxFull = full;
        }
      }
    }
  }
  assert.ok(maxMain.length <= 60, `${maxMain.length}: ${maxMain}`);
  assert.ok(maxFull.length <= 105, `${maxFull.length}: ${maxFull}`);
});

// ---------------------------------------------------------------- Überschriften

test('Überschriften für Lieblingsverein, Gegentor und zurückgenommene Entscheidungen', () => {
  assert.strictEqual(headline(goal('home', [1, 0], G('Robin Fellhauer'), { favorite: true, favoriteSide: 'home' })), 'TOOOR für Augsburg!');
  assert.strictEqual(headline(goal('away', [1, 1], G('Harry Kane'), { conceded: true, favoriteSide: 'home' })), 'Gegentor');
  assert.strictEqual(headline(goal('home', [2, 1], G('Robin Fellhauer'), { reinstated: true })), 'Tor zählt doch');
  assert.strictEqual(headline(goal('away', [2, 2], G('Harry Kane'), { reinstated: true, conceded: true })), 'Gegentor zählt doch');
  assert.strictEqual(headline(goal('home', [2, 1], G('Robin Fellhauer'), { reinstated: true, favorite: true })), 'TOOOR für Augsburg!');
});

test('Tor zählt doch: Satz sagt, welches Tor', () => {
  oneOf(sentence(goal('home', [2, 1], G('Robin Fellhauer'), { reinstated: true })), [
    'Das 2:1 durch Robin Fellhauer zählt doch.',
    'Kommando zurück: Das 2:1 durch Robin Fellhauer zählt.',
  ]);
  oneOf(sentence(goal('away', [1, 2], null, { reinstated: true })), ['Das 1:2 für Bayern zählt doch.', 'Kommando zurück: Das 1:2 für Bayern zählt.']);
  assert.strictEqual(
    sentence(goal('home', [2, 1], G('Robin Fellhauer', { penalty: true }), { reinstated: true })),
    'Der Elfmetertreffer von Robin Fellhauer zählt doch.'
  );
  assert.strictEqual(sentence(goal('home', [1, 0], G('Dayot Upamecano', { ownGoal: true }), { reinstated: true })), 'Das Eigentor von Dayot Upamecano zählt doch.');
  assert.strictEqual(sentence(goal('home', [1, 0], G(null, { ownGoal: true }), { reinstated: true })), 'Das Eigentor zum 1:0 zählt doch.');
});

test('Vereine mit Artikel: der HSV, der SC Freiburg, die TSG Hoffenheim', () => {
  const hsv = (extra) => card({ home: HSV, away: SVW, side: 'home', team: 'HSV', ...extra });
  assert.strictEqual(headline(hsv({ score: [1, 0], goal: G('Robert Glatzel') })), 'Tor für den HSV');
  assert.strictEqual(headline(hsv({ score: [1, 0], favorite: true })), 'TOOOR für den HSV!');
  assert.match(sentence(hsv({ score: [2, 1], goal: null, pending: true })), /^Der HSV (trifft zum 2:1|geht in Führung)\.$/);
  assert.strictEqual(headline(hsv({ type: 'disallowed', score: [0, 0], prev: [1, 0] })), 'Kein Tor für den HSV');
  assert.strictEqual(headline(hsv({ type: 'redcard', player: null })), 'Rote Karte für den HSV');
  assert.strictEqual(sentence(hsv({ type: 'redcard', player: null, minute: '12' })), 'Der HSV muss ab der 12. Minute in Unterzahl spielen.');
  oneOf(sentence(card({ type: 'fulltime', home: HSV, away: SVW, score: [2, 1], minute: 'Ende' })), ['Der HSV gewinnt 2:1 gegen Werder.', 'Der HSV schlägt Werder 2:1.']);
  oneOf(sentence(card({ type: 'fulltime', home: SVW, away: HSV, score: [1, 2], minute: 'Ende' })), ['Werder verliert 1:2 gegen den HSV.', 'Auswärtssieg für den HSV: 1:2.']);
  oneOf(sentence(card({ type: 'fulltime', home: HSV, away: SVW, score: [0, 0], minute: 'Ende' })), [
    'Der HSV und Werder trennen sich 0:0.',
    'Torloses Unentschieden zwischen dem HSV und Werder.',
  ]);
  const team = (name) => ({ id: name, name, full: name });
  assert.strictEqual(headline(card({ home: team('SC Freiburg'), away: FCA, side: 'home', team: 'SC Freiburg', score: [1, 0] })), 'Tor für den SC Freiburg');
  assert.strictEqual(headline(card({ home: team('TSG Hoffenheim'), away: FCA, side: 'home', team: 'TSG Hoffenheim', score: [1, 0] })), 'Tor für die TSG Hoffenheim');
  assert.strictEqual(headline(card({ home: team('1. FC Köln'), away: FCA, side: 'home', team: '1. FC Köln', score: [1, 0] })), 'Tor für den 1. FC Köln');
  assert.strictEqual(headline(card({ home: team('RB Leipzig'), away: FCA, side: 'home', team: 'RB Leipzig', score: [1, 0] })), 'Tor für RB Leipzig');
  assert.strictEqual(headline(card({ home: team('St. Pauli'), away: FCA, side: 'home', team: 'St. Pauli', score: [1, 0] })), 'Tor für St. Pauli');
  assert.strictEqual(headline(card({ home: team('Gladbach'), away: FCA, side: 'home', team: 'Gladbach', score: [1, 0] })), 'Tor für Gladbach');
});

test('Mannschaft ohne card.team: Name kommt aus side', () => {
  assert.strictEqual(headline(card({ side: 'away', team: null, score: [0, 1] })), 'Tor für Bayern');
});

// ---------------------------------------------------------------- Aberkannt

test('aberkanntes Tor', () => {
  const c = card({ type: 'disallowed', side: 'away', team: 'Bayern', score: [2, 1], prev: [2, 2] });
  assert.strictEqual(headline(c), 'Kein Tor für Bayern');
  oneOf(sentence(c), [
    'Das 2:2 zählt nicht – es bleibt beim 2:1.',
    'Der Treffer zum 2:2 wird zurückgenommen, es steht weiter 2:1.',
    'Das 2:2 wird aberkannt, es bleibt beim 2:1.',
  ]);
  // ohne prev: ein Tor mehr auf der Seite
  oneOf(sentence(card({ type: 'disallowed', side: 'home', team: 'Augsburg', score: [0, 0] })), [
    'Das 1:0 zählt nicht – es bleibt beim 0:0.',
    'Der Treffer zum 1:0 wird zurückgenommen, es steht weiter 0:0.',
    'Das 1:0 wird aberkannt, es bleibt beim 0:0.',
  ]);
  // zwei Tore auf einmal weg
  assert.strictEqual(
    sentence(card({ type: 'disallowed', side: 'home', team: 'Augsburg', score: [1, 1], prev: [3, 1] })),
    'Der Spielstand wird korrigiert: 1:1 statt 3:1.'
  );
  assert.strictEqual(sentence(card({ type: 'disallowed', side: 'home', team: 'Augsburg', score: null })), 'Das Tor zählt nicht.');
});

// ---------------------------------------------------------------- Verpasste Tore

test('verpasste Tore nach Standby', () => {
  const missed = (score, home, away, minute) => texts.describe(card({ type: 'missed', score, missed: { home, away }, minute }));
  assert.deepStrictEqual(missed([2, 1], 2, 1, '63'), {
    headline: 'Verpasste Tore',
    sentence: 'Augsburg hat zweimal getroffen, Bayern einmal. Es steht jetzt 2:1.',
  });
  assert.deepStrictEqual(missed([1, 0], 1, 0, '30'), { headline: 'Verpasstes Tor', sentence: 'Augsburg hat getroffen. Es steht jetzt 1:0.' });
  assert.strictEqual(missed([3, 1], 1, 1, 'Ende').sentence, 'Augsburg und Bayern haben je einmal getroffen. Endstand: 3:1.');
  assert.strictEqual(missed([0, 2], 0, 2, 'Halbzeit').sentence, 'Bayern hat zweimal getroffen. Halbzeitstand: 0:2.');
  // Wende: nur eine Mannschaft hat getroffen und das Spiel gedreht
  assert.strictEqual(missed([2, 1], 2, 0, '80').sentence, 'Augsburg hat das Spiel gedreht: Aus 0:1 wurde 2:1.');
  assert.strictEqual(missed([2, 2], 0, 2, 'Ende').sentence, 'Bayern hat den Rückstand aufgeholt: Aus 2:0 wurde 2:2. Das Spiel ist aus.');
  assert.strictEqual(missed([4, 0], 4, 0, '70').sentence, 'Augsburg hat viermal getroffen. Es steht jetzt 4:0.');
});

// ---------------------------------------------------------------- Anpfiff, Halbzeit, Abpfiff

test('Anpfiff', () => {
  const t = texts.describe(card({ type: 'kickoff', score: [0, 0], minute: '1' }));
  assert.strictEqual(t.headline, 'Anpfiff');
  oneOf(t.sentence, ['Der Ball rollt.', 'Das Spiel läuft.', 'Die Partie ist angepfiffen.']);
});

test('Halbzeit', () => {
  const ht = (score) => texts.describe(card({ type: 'halftime', score, minute: 'Halbzeit' }));
  assert.strictEqual(ht([0, 0]).headline, 'Halbzeit');
  oneOf(ht([0, 0]).sentence, ['Torlos geht es in die Pause.', 'Zur Pause steht es 0:0.']);
  oneOf(ht([1, 1]).sentence, ['Zur Pause steht es 1:1.', 'Mit 1:1 geht es in die Kabinen.']);
  oneOf(ht([2, 1]).sentence, ['Augsburg führt zur Pause 2:1 gegen Bayern.', 'Zur Pause führt Augsburg mit 2:1.']);
  oneOf(ht([1, 2]).sentence, ['Augsburg liegt zur Pause 1:2 gegen Bayern zurück.', 'Zur Pause führt Bayern, es steht 1:2.']);
});

test('Abpfiff: Sieger, Remis, 0:0', () => {
  const ft = (score, extra) => texts.describe(card({ type: 'fulltime', score, minute: 'Ende', ...extra }));
  assert.strictEqual(ft([2, 1]).headline, 'Abpfiff');
  oneOf(ft([2, 1]).sentence, ['Augsburg gewinnt 2:1 gegen Bayern.', 'Augsburg schlägt Bayern 2:1.']);
  oneOf(ft([1, 2]).sentence, ['Augsburg verliert 1:2 gegen Bayern.', 'Auswärtssieg für Bayern: 1:2.']);
  oneOf(ft([1, 1]).sentence, ['Unentschieden: 1:1.', 'Augsburg und Bayern trennen sich 1:1.']);
  oneOf(ft([0, 0]).sentence, ['Augsburg und Bayern trennen sich 0:0.', 'Torloses Unentschieden zwischen Augsburg und Bayern.']);
});

test('Abpfiff mit Lieblingsverein: "Sieg!" nur beim Sieg', () => {
  const ft = (score, favoriteSide) => sentence(card({ type: 'fulltime', score, minute: 'Ende', favoriteSide }));
  assert.strictEqual(ft([2, 1], 'home'), 'Sieg! Augsburg gewinnt 2:1 gegen Bayern.');
  assert.strictEqual(ft([1, 2], 'home'), 'Augsburg verliert 1:2 gegen Bayern.');
  assert.strictEqual(ft([1, 2], 'away'), 'Sieg! Bayern gewinnt auswärts, Endstand 1:2.');
  assert.strictEqual(ft([2, 1], 'away'), 'Bayern verliert auswärts, Endstand 2:1.');
  oneOf(ft([1, 1], 'away'), ['Unentschieden: 1:1.', 'Augsburg und Bayern trennen sich 1:1.']);
  // ersatzweise favorite + side
  assert.strictEqual(sentence(card({ type: 'fulltime', score: [3, 0], minute: 'Ende', favorite: true, side: 'home' })), 'Sieg! Augsburg gewinnt 3:0 gegen Bayern.');
});

test('Abpfiff im Pokal: Unentschieden heißt Elfmeterschießen', () => {
  assert.strictEqual(
    sentence(card({ type: 'fulltime', competition: POKAL, score: [1, 1], minute: 'Ende' })),
    '1:1 nach Verlängerung – die Entscheidung fiel im Elfmeterschießen.'
  );
  assert.strictEqual(sentence(card({ type: 'fulltime', score: [3, 2], minute: 'n. V.' })), 'Augsburg gewinnt nach Verlängerung 3:2 gegen Bayern.');
});

// ---------------------------------------------------------------- Rote Karte

test('Rote Karte', () => {
  const red = (extra) => texts.describe(card({ type: 'redcard', side: 'away', team: 'Bayern', score: [1, 1], ...extra }));
  assert.strictEqual(red({ player: 'Dayot Upamecano' }).headline, 'Rote Karte für Bayern');
  oneOf(red({ player: 'Dayot Upamecano', minute: '78' }).sentence, [
    'Dayot Upamecano fliegt in der 78. Minute vom Platz.',
    'Platzverweis für Dayot Upamecano in der 78. Minute.',
    'Dayot Upamecano muss in der 78. Minute vom Platz.',
  ]);
  oneOf(red({ player: 'Dayot Upamecano', minute: '90+4' }).sentence, [
    'Dayot Upamecano fliegt in der Nachspielzeit vom Platz.',
    'Dayot Upamecano muss in der Nachspielzeit vom Platz.',
  ]);
  oneOf(red({ player: 'Dayot Upamecano', minute: '45+2' }).sentence, ['Dayot Upamecano fliegt kurz vor der Pause vom Platz.', 'Dayot Upamecano muss kurz vor der Pause vom Platz.']);
  oneOf(red({ player: 'Dayot Upamecano', minute: null }).sentence, ['Dayot Upamecano fliegt vom Platz.', 'Platzverweis für Dayot Upamecano.']);
  // Spieler wird noch nachgeladen
  assert.strictEqual(red({ player: null, minute: '61', pending: true }).sentence, 'Bayern muss ab der 61. Minute in Unterzahl spielen.');
  assert.strictEqual(red({ player: null, minute: '45+1' }).sentence, 'Bayern muss die zweite Halbzeit in Unterzahl bestreiten.');
  assert.strictEqual(red({ player: null, minute: 'Halbzeit' }).sentence, 'Bayern muss in Unterzahl weiterspielen.');
});

// ---------------------------------------------------------------- Konferenz

test('Konferenz: Alle Spiele mit Anzahl live', () => {
  const M = (status, score, minute, startUtc = '2026-10-10T13:30:00.000Z') => ({
    home: FCA,
    away: FCB,
    score,
    minute,
    status,
    startUtc,
    competition: BL,
    redCards: [0, 0],
  });
  const conf = (matches) => texts.describe(card({ type: 'conference', matches }));
  assert.deepStrictEqual(conf([]), { headline: 'Alle Spiele', sentence: 'Heute kein Spiel.' });
  assert.strictEqual(conf(undefined).sentence, 'Heute kein Spiel.');
  assert.strictEqual(conf([M('live', [1, 0], '23')]).sentence, 'Ein Spiel läuft gerade.');
  assert.strictEqual(conf([M('live', [1, 0], '23'), M('live', [0, 0], '22'), M('live', [2, 2], '24')]).sentence, 'Drei Spiele laufen gerade.');
  assert.strictEqual(
    conf([M('live', [1, 0], '23'), M('done', [2, 2], 'Ende'), M('pre', [0, 0], null, '2026-10-10T16:30:00.000Z'), M('pre', [0, 0], null)]).sentence,
    'Ein Spiel läuft, eins ist beendet und zwei kommen noch.'
  );
  assert.strictEqual(conf([M('live', [1, 0], '50'), M('live', [1, 0], '50'), M('done', [1, 0], 'Ende'), M('done', [1, 0], 'Ende')]).sentence, 'Zwei Spiele laufen, zwei sind beendet.');
  assert.strictEqual(
    conf([M('pre', [0, 0], null, '2026-10-10T16:30:00.000Z'), M('pre', [0, 0], null, '2026-10-10T13:30:00.000Z')]).sentence,
    'Zwei Spiele heute, das erste beginnt um 15:30 Uhr.'
  );
  assert.strictEqual(conf([M('pre', [0, 0], null, '2026-10-10T16:30:00.000Z')]).sentence, 'Anpfiff um 18:30 Uhr.');
  assert.strictEqual(
    conf([M('done', [1, 0], 'Ende'), M('pre', [0, 0], null, '2026-10-10T16:30:00.000Z')]).sentence,
    'Gerade läuft kein Spiel – das nächste beginnt um 18:30 Uhr.'
  );
  assert.strictEqual(conf([M('done', [1, 0], 'Ende')]).sentence, 'Das Spiel ist beendet.');
  assert.strictEqual(conf([M('done', [1, 0], 'Ende'), M('done', [0, 0], 'Ende')]).sentence, 'Beide Spiele sind beendet.');
  assert.strictEqual(conf(Array.from({ length: 6 }, () => M('done', [1, 0], 'Ende'))).sentence, 'Alle sechs Spiele sind beendet.');
  // abgesagte Spiele zählen nicht
  assert.strictEqual(conf([M('cancelled', [0, 0], null)]).sentence, 'Heute kein Spiel.');
});

// ---------------------------------------------------------------- Minuten

test('Minuten im Text: "78." und "90.+4"', () => {
  assert.strictEqual(texts.formatMinute('78'), '78.');
  assert.strictEqual(texts.formatMinute('90+4'), '90.+4');
  assert.strictEqual(texts.formatMinute('45 + 2'), '45.+2');
  assert.strictEqual(texts.formatMinute("78'"), '78.');
  assert.strictEqual(texts.formatMinute('90.+4'), '90.+4');
  assert.strictEqual(texts.formatMinute('Halbzeit'), '');
  assert.strictEqual(texts.formatMinute(null), '');
});

// ---------------------------------------------------------------- Determinismus

test('deterministisch: gleiche Lage, gleicher Satz – auch nach Updates ohne neue Daten', () => {
  const c = goal('home', [2, 1], G('Robin Fellhauer', { assist: 'Elvis Rexhbecaj' }), { varPending: true });
  const first = texts.describe(c);
  for (let i = 0; i < 20; i++) assert.deepStrictEqual(texts.describe(c), first);
  assert.deepStrictEqual(texts.describe(JSON.parse(JSON.stringify(c))), first);
  // Flüchtiges (key, Anzeigedauer, Design, Farbe) ändert nichts am Text
  const other = { ...c, key: 'anders', duration: 30000, design: 'videotext', ledColor: 'rot', demo: true };
  assert.deepStrictEqual(texts.describe(other), first);
  // Update wie in popup.js: Object.assign
  const live = goal('home', [2, 1], null);
  const before = texts.describe(live).sentence;
  Object.assign(live, { varPending: false, pending: true });
  assert.strictEqual(texts.describe(live).sentence, before);
});

test('Abwechslung: verschiedene Spiele bekommen verschiedene Formulierungen', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const home = { id: 1000 + i, name: 'Augsburg', full: 'Augsburg' };
    seen.add(sentence(card({ type: 'goal', home, side: 'home', team: 'Augsburg', score: [1, 0], goal: G('Robin Fellhauer') })));
  }
  assert.ok(seen.size >= 3, [...seen].join(' | '));
});

// ---------------------------------------------------------------- Stil und Robustheit

const EMOJI = /\p{Extended_Pictographic}/u;

function checkStyle(t, label) {
  assert.strictEqual(typeof t.headline, 'string', label);
  assert.strictEqual(typeof t.sentence, 'string', label);
  assert.ok(t.headline.length > 0, `leere Überschrift: ${label}`);
  for (const s of [t.headline, t.sentence]) {
    assert.ok(!/undefined|null|NaN|\[object/.test(s), `${label}: ${s}`);
    assert.ok(!EMOJI.test(s), `Emoji in ${label}: ${s}`);
    assert.ok(!/!!|\?\?|\s{2}|\s[.,:]/.test(s), `${label}: ${s}`);
  }
  // Ausrufezeichen nur beim großen Jubel bzw. "Sieg!"
  const bangs = (t.headline + t.sentence).match(/!/g) || [];
  assert.ok(bangs.length <= 1, `${label}: ${t.headline} / ${t.sentence}`);
  if (bangs.length) assert.ok(/^TOOOR/.test(t.headline) || /^Sieg! /.test(t.sentence), `${label}: ${t.headline} / ${t.sentence}`);
  if (t.sentence) {
    assert.match(t.sentence, /^[A-ZÄÖÜ0-9]/, `${label}: ${t.sentence}`);
    assert.match(t.sentence, /[.)]$|\.$/, `${label}: ${t.sentence}`);
  }
}

test('alle Kartentypen in vielen Lagen: sauberes Deutsch, nie leer, kein Emoji', () => {
  const types = ['goal', 'disallowed', 'missed', 'kickoff', 'halftime', 'fulltime', 'redcard', 'conference'];
  const scorers = [null, 'Robin Fellhauer', '<TBD>'];
  let n = 0;
  for (const type of types) {
    for (const side of ['home', 'away']) {
      for (let h = 0; h <= 4; h++) {
        for (let a = 0; a <= 4; a++) {
          for (const scorer of scorers) {
            for (const flags of [{}, { favorite: true }, { conceded: true }, { reinstated: true }, { varPending: true }]) {
              const c = card({
                type,
                side,
                team: side === 'home' ? 'Augsburg' : 'Bayern',
                score: [h, a],
                prev: side === 'home' ? [h + 1, a] : [h, a + 1],
                missed: { home: h % 3, away: a % 2 },
                player: scorer,
                minute: ['78', '90+4', 'Halbzeit', 'Ende', null][(h + a) % 5],
                favoriteSide: flags.favorite ? side : null,
                goal: scorer ? G(scorer, { penalty: h === 2, ownGoal: a === 3, assist: 'Elvis Rexhbecaj' }) : null,
                matches: [{ home: FCA, away: FCB, score: [h, a], minute: '50', status: ['live', 'pre', 'done'][h % 3], startUtc: '2026-10-10T13:30:00.000Z' }],
                ...flags,
              });
              const t = texts.describe(c);
              checkStyle(t, `${type} ${side} ${h}:${a} ${scorer} ${JSON.stringify(flags)}`);
              assert.ok(t.sentence.length > 0, `leerer Satz: ${type} ${side} ${h}:${a}`);
              checkStyle({ headline: texts.forwardMessage(c).title, sentence: '' }, `Titel ${type}`);
              n++;
            }
          }
        }
      }
    }
  }
  assert.ok(n > 2000);
});

test('kaputte Eingaben werfen nie', () => {
  const bad = [
    null,
    undefined,
    42,
    'goal',
    {},
    { type: 'goal' },
    { type: 'goal', score: 'x', side: 'links', goal: 'y' },
    { type: 'goal', score: [NaN, 1], side: 'home', home: null, away: 7 },
    { type: 'goal', score: [-1, 2], side: 'home', team: 'Augsburg' },
    { type: 'disallowed', prev: 'x', score: [1] },
    { type: 'missed', missed: null, score: [1, 1] },
    { type: 'missed', missed: { home: 'zwei', away: -1 }, score: [2, 1] },
    { type: 'redcard', player: { name: 'x' }, minute: {} },
    { type: 'conference', matches: 'x' },
    { type: 'conference', matches: [null, 1, { status: 'live' }] },
    { type: 'fulltime', competition: 'Pokal', score: [1, 1] },
    { type: 'unbekannt', score: [1, 0], side: 'home', team: 'Augsburg' },
  ];
  for (const c of bad) {
    const t = texts.describe(c);
    assert.strictEqual(typeof t.headline, 'string');
    assert.strictEqual(typeof t.sentence, 'string');
    assert.ok(!/undefined|NaN|\[object/.test(t.headline + t.sentence), JSON.stringify(c) + ' -> ' + JSON.stringify(t));
    const f = texts.forwardMessage(c);
    assert.strictEqual(typeof f.title, 'string');
    assert.strictEqual(typeof f.message, 'string');
    assert.ok(Array.isArray(f.tags));
  }
  // Mannschaft ohne Spielstand: trotzdem ein Satz
  assert.strictEqual(sentence({ type: 'goal', side: 'home', team: 'Augsburg', home: FCA, away: FCB, goal: G('Robin Fellhauer') }), 'Robin Fellhauer trifft.');
  // Spielstand passt nicht zur Seite (0 Tore für die Seite): neutral statt Unsinn
  assert.strictEqual(sentence(goal('home', [0, 1], G('Robin Fellhauer'))), 'Robin Fellhauer trifft, es steht 0:1.');
});

// ---------------------------------------------------------------- Weiterleitung

test('forwardMessage: Tor wie im Bauplan', () => {
  const f = texts.forwardMessage(goal('home', [2, 1], G('Robin Fellhauer', { penalty: true })));
  assert.strictEqual(f.title, 'Tor für Augsburg – 2:1');
  const [line, s, ...rest] = f.message.split('\n');
  assert.strictEqual(line, 'Augsburg 2:1 Bayern (78.)');
  oneOf(s, ['Robin Fellhauer verwandelt den Elfmeter zum 2:1.', 'Robin Fellhauer bringt Augsburg per Elfmeter in Führung.', 'Robin Fellhauer trifft vom Punkt zum 2:1.']);
  assert.deepStrictEqual(rest, []);
  assert.strictEqual(f.click, URL);
  assert.deepStrictEqual(f.tags, ['soccer']);
});

test('forwardMessage: Lieblingsverein, Gegentor, Nachspielzeit-Minute', () => {
  assert.strictEqual(texts.forwardMessage(goal('home', [2, 1], G('Robin Fellhauer'), { favorite: true })).title, 'TOOOR für Augsburg – 2:1');
  const conceded = texts.forwardMessage(goal('away', [1, 2], G('Harry Kane', { minute: '90+4' }), { conceded: true }));
  assert.strictEqual(conceded.title, 'Gegentor – 1:2');
  assert.strictEqual(conceded.message.split('\n')[0], 'Augsburg 1:2 Bayern (90.+4)');
  // Schütze noch unbekannt: Spielminute
  assert.strictEqual(texts.forwardMessage(goal('home', [1, 0], null, { minute: '12' })).message.split('\n')[0], 'Augsburg 1:0 Bayern (12.)');
});

test('forwardMessage: übrige Kartentypen', () => {
  const red = texts.forwardMessage(card({ type: 'redcard', side: 'away', team: 'Bayern', player: 'Dayot Upamecano', minute: '78', score: [1, 1] }));
  assert.strictEqual(red.title, 'Rote Karte für Bayern');
  assert.deepStrictEqual(red.tags, ['red_circle']);
  assert.strictEqual(red.message.split('\n')[0], 'Augsburg 1:1 Bayern'); // Minute steht im Satz
  const late = texts.forwardMessage(card({ type: 'redcard', side: 'away', team: 'Bayern', player: 'Dayot Upamecano', minute: '90+4', score: [1, 1] }));
  assert.strictEqual(late.message.split('\n')[0], 'Augsburg 1:1 Bayern (90.+4)'); // Satz sagt nur "Nachspielzeit"

  const ko = texts.forwardMessage(card({ type: 'kickoff', minute: '1' }));
  assert.strictEqual(ko.title, 'Anpfiff: Augsburg – Bayern');
  assert.strictEqual(ko.message.split('\n')[1], 'Bundesliga, 5. Spieltag');
  assert.strictEqual(texts.forwardMessage(card({ type: 'kickoff', competition: POKAL, round: '2' })).message.split('\n')[1], 'DFB-Pokal, 2. Runde');

  const ht = texts.forwardMessage(card({ type: 'halftime', score: [0, 0], minute: 'Halbzeit' }));
  assert.strictEqual(ht.title, 'Halbzeit – 0:0');
  assert.strictEqual(ht.message.split('\n')[0], 'Augsburg 0:0 Bayern');

  const ft = texts.forwardMessage(card({ type: 'fulltime', score: [2, 1], minute: 'Ende', favoriteSide: 'home' }));
  assert.strictEqual(ft.title, 'Abpfiff – 2:1');
  assert.strictEqual(ft.message, 'Augsburg 2:1 Bayern\nSieg! Augsburg gewinnt 2:1 gegen Bayern.');

  const dis = texts.forwardMessage(card({ type: 'disallowed', side: 'away', team: 'Bayern', score: [2, 1], prev: [2, 2], minute: '80' }));
  assert.strictEqual(dis.title, 'Kein Tor für Bayern');
  assert.strictEqual(dis.message.split('\n')[0], 'Augsburg 2:1 Bayern (80.)');

  const missed = texts.forwardMessage(card({ type: 'missed', score: [2, 1], missed: { home: 2, away: 1 }, minute: 'Ende' }));
  assert.strictEqual(missed.title, 'Verpasste Tore – 2:1');
  assert.strictEqual(missed.message, 'Augsburg 2:1 Bayern (Ende)\nAugsburg hat zweimal getroffen, Bayern einmal. Endstand: 2:1.');

  const conf = texts.forwardMessage(
    card({
      type: 'conference',
      matches: [
        { home: FCA, away: FCB, score: [1, 0], minute: '23', status: 'live' },
        { home: HSV, away: SVW, score: [2, 2], minute: 'Ende', status: 'done' },
        { home: FCB, away: FCA, score: [0, 0], minute: null, status: 'pre', startUtc: '2026-10-10T16:30:00.000Z' },
      ],
    })
  );
  assert.strictEqual(conf.title, 'Alle Spiele');
  assert.strictEqual(
    conf.message,
    'Ein Spiel läuft, eins ist beendet und eins kommt noch.\nAugsburg 1:0 Bayern (23.)\nHSV 2:2 Werder (Ende)\nBayern – Augsburg, 18:30 Uhr'
  );
});

test('forwardMessage: Link nur mit https, nie Emojis', () => {
  assert.strictEqual(texts.forwardMessage(card({ url: 'http://www.fotmob.com/x', side: 'home', score: [1, 0] })).click, null);
  assert.strictEqual(texts.forwardMessage(card({ url: 'javascript:alert(1)', side: 'home', score: [1, 0] })).click, null);
  assert.strictEqual(texts.forwardMessage(card({ url: undefined, side: 'home', score: [1, 0] })).click, null);
  for (const type of ['goal', 'disallowed', 'missed', 'kickoff', 'halftime', 'fulltime', 'redcard', 'conference']) {
    const f = texts.forwardMessage(card({ type, side: 'home', team: 'Augsburg', score: [1, 0], favorite: true, player: 'X Y', missed: { home: 1, away: 0 } }));
    assert.ok(!EMOJI.test(f.title + f.message), `${type}: ${f.title} ${f.message}`);
  }
});
