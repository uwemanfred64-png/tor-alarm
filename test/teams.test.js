const test = require('node:test');
const assert = require('node:assert');
const { norm, short, code, sameTeam } = require('../src/teams');

test('FotMob- und OpenLigaDB-Namen ergeben denselben Schlüssel', () => {
  const pairs = [
    ['Hamburger SV', 'Hamburger SV'],
    ['Schalke 04', 'FC Schalke 04'],
    ['Bayern München', 'FC Bayern München'],
    ['Mainz 05', '1. FSV Mainz 05'],
    ['RB Leipzig', 'RB Leipzig'],
    ['Hoffenheim', 'TSG 1899 Hoffenheim'],
    ['1. FC Köln', '1. FC Köln'],
    ['Union Berlin', '1. FC Union Berlin'],
    ['Elversberg', 'SV 07 Elversberg'],
    ['Paderborn', 'SC Paderborn 07'],
    ['Borussia Mönchengladbach', 'Borussia Mönchengladbach'],
    ['Werder Bremen', 'SV Werder Bremen'],
    ['Heidenheim', '1. FC Heidenheim 1846'],
  ];
  for (const [a, b] of pairs) assert.strictEqual(norm(a), norm(b), `${a} / ${b}`);
});

test('Kurznamen wie im Stadion', () => {
  assert.strictEqual(short('Borussia Mönchengladbach'), 'Gladbach');
  assert.strictEqual(short('Hamburger SV'), 'HSV');
  assert.strictEqual(short('FC Schalke 04'), 'Schalke');
  assert.strictEqual(short('Unbekannter Verein'), 'Unbekannter Verein');
});

test('Teamfilter: keine falschen Treffer', () => {
  assert.ok(sameTeam('Hamburger SV', 'Hamburger SV'));
  assert.ok(sameTeam('Schalke 04', 'FC Schalke 04'));
  assert.ok(!sameTeam('Bayern München', 'Bayer Leverkusen'));
  assert.ok(!sameTeam('Borussia Dortmund', 'Borussia Mönchengladbach'));
  assert.ok(!sameTeam('Union Berlin', 'Hertha BSC'));
});

// ---------------------------------------------------------------- echte Namen, Saison 2026/27
// [FotMob-ID, Name in der FotMob-Tabelle (api/data/leagues?id=…), Name bei OpenLigaDB (getavailableteams/blX/2026)]

const BL1 = [
  [9789, 'Borussia Dortmund', 'Borussia Dortmund'],
  [9823, 'Bayern München', 'FC Bayern München'],
  [8358, 'Freiburg', 'SC Freiburg'],
  [8178, 'Bayer Leverkusen', 'Bayer 04 Leverkusen'],
  [8406, 'Augsburg', 'FC Augsburg'],
  [8697, 'Werder Bremen', 'SV Werder Bremen'],
  [9905, 'Mainz 05', '1. FSV Mainz 05'],
  [8232, 'Elversberg', 'SV 07 Elversberg'],
  [178475, 'RB Leipzig', 'RB Leipzig'],
  [10269, 'VfB Stuttgart', 'VfB Stuttgart'],
  [8226, 'Hoffenheim', 'TSG Hoffenheim'],
  [9810, 'Eintracht Frankfurt', 'Eintracht Frankfurt'],
  [10189, 'Schalke 04', 'FC Schalke 04'],
  [8722, '1. FC Köln', '1. FC Köln'],
  [8460, 'Paderborn', 'SC Paderborn 07'],
  [8149, 'Union Berlin', '1. FC Union Berlin'],
  [9790, 'Hamburger SV', 'Hamburger SV'],
  [9788, 'Borussia Mönchengladbach', 'Borussia Mönchengladbach'],
];

const BL2 = [
  [8177, 'Hertha BSC', 'Hertha BSC'],
  [8165, '1. FC Nürnberg', '1. FC Nürnberg'],
  [94937, 'FC Heidenheim', '1. FC Heidenheim 1846'],
  [8188, 'Magdeburg', '1. FC Magdeburg'],
  [8350, 'Kaiserslautern', '1. FC Kaiserslautern'],
  [8721, 'Wolfsburg', 'VfL Wolfsburg'],
  [8398, 'Energie Cottbus', 'Energie Cottbus'],
  [9775, 'VfL Osnabrück', 'VfL Osnabrück'],
  [9776, 'Eintracht Braunschweig', 'Eintracht Braunschweig'],
  [8152, 'St. Pauli', 'FC St. Pauli'],
  [9911, 'Bochum', 'VfL Bochum'],
  [9904, 'Hannover 96', 'Hannover 96'],
  [8262, 'Darmstadt', 'SV Darmstadt 98'],
  [8357, 'Greuther Fürth', 'SpVgg Greuther Fürth'],
  [9912, 'Arminia Bielefeld', 'DSC Arminia Bielefeld'],
  [8480, 'Dynamo Dresden', 'Dynamo Dresden'],
  [8295, 'Karlsruher SC', 'Karlsruher SC'],
  [8150, 'Holstein Kiel', 'Holstein Kiel'],
];

const BL3 = [
  [8293, 'MSV Duisburg', 'MSV Duisburg'],
  [94940, 'Hoffenheim II', 'TSG 1899 Hoffenheim II'],
  [276267, 'Viktoria Köln 1904', 'Viktoria Köln'],
  [8296, 'RW Essen', 'Rot-Weiss Essen'],
  [8294, 'Hansa Rostock', 'Hansa Rostock'],
  [8271, 'Saarbrücken', '1. FC Saarbrücken'],
  [9743, 'Waldhof Mannheim', 'SV Waldhof Mannheim'],
  [8171, 'Preussen Münster', 'Preußen Münster'],
  [8396, 'Alemannia Aachen', 'Alemannia Aachen'],
  [7786, 'Fortuna Köln', 'Fortuna Köln'],
  [8194, 'Fortuna Düsseldorf', 'Fortuna Düsseldorf'],
  [7783, 'SC Verl', 'SC Verl'],
  [7789, 'Jahn Regensburg', 'Jahn Regensburg'],
  [8458, 'VfB Stuttgart II', 'VfB Stuttgart II'],
  [8234, 'Ingolstadt', 'FC Ingolstadt 04'],
  [94941, 'Sonnenhof Großaspach', 'SG Sonnenhof Großaspach'],
  [145486, 'Würzburger Kickers', 'Würzburger Kickers'],
  [79904, 'Meppen', 'SV Meppen'],
  [8196, 'Wehen Wiesbaden', 'SV Wehen Wiesbaden'],
  [89338, 'TSV Havelse', 'TSV Havelse'],
];

// Frauen-Bundesliga: [Name in der Tabelle, FotMob-ID des Männerteams desselben Vereins].
// Im Spielplan (api/data/matches) heißen sie "VfL Wolfsburg (W)", "FC Köln (W)" …
const FBL = [
  ['Bayern München', 9823],
  ['VfL Wolfsburg', 8721],
  ['Eintracht Frankfurt', 9810],
  ['Bayer Leverkusen', 8178],
  ['Werder Bremen', 8697],
  ['Freiburg', 8358],
  ['FC Köln', 8722],
  ['VfB Stuttgart', 10269],
  ['RB Leipzig', 178475],
  ['TSG 1899 Hoffenheim', 8226],
  ['Union Berlin', 8149],
  ['Hamburger SV', 9790],
  ['Nürnberg', 8165],
  ['Mainz 05', 9905],
];

// Gegner im Europapokal 2026/27 (CL 42, EL 73, ECL 10216), deutsche Vereine stehen auch in BL1
const INTL = [
  'Paris Saint-Germain', 'Barcelona', 'Manchester United', 'Como', 'Sporting CP', 'Manchester City', 'Aston Villa',
  'Lens', 'Real Betis', 'Liverpool', 'Real Madrid', 'Arsenal', 'AEK Athens', 'Roma', 'Shakhtar Donetsk', 'Fenerbahçe',
  'PSV Eindhoven', 'Villarreal', 'Club Brugge', 'Lille', 'Slavia Prague', 'Atlético Madrid', 'Inter', 'LASK', 'Napoli',
  'Galatasaray', 'Viking', 'FC Porto', 'Feyenoord', 'Sabah FK', 'Slovan Bratislava', 'Bodø/Glimt', 'Juventus',
  'Crystal Palace', 'Sparta Prague', 'Beşiktaş', 'Union St.Gilloise', 'Ferencváros', 'Benfica', 'OFI Crete',
  'AFC Bournemouth', 'Lyon', 'Torreense', 'Olympiacos', 'Salzburg', 'Omonia Nicosia', 'Sunderland', 'Dinamo Zagreb',
  'Hapoel Beer Sheva', 'Rennes', 'Sturm Graz', 'Jagiellonia Białystok', 'Anderlecht', 'Lillestrøm', 'Real Sociedad',
  'AZ Alkmaar', 'Celta Vigo', 'Levski Sofia', 'Celtic', 'Milan', 'NK Celje', 'Marseille', 'Ararat Armenia',
  'Viktoria Plzeň', 'Lech Poznań', 'NEC Nijmegen', 'AGF', 'Ajax', 'Atalanta', 'Borac Banja Luka', 'Braga', 'Brann',
  'Brighton & Hove Albion', 'CSKA Sofia', 'Egnatia', 'FC København', 'FC Midtjylland', 'Nordsjælland', 'FC Twente',
  'FK Crvena Zvezda', 'FK Kauno Žalgiris', 'Gent', 'Getafe', 'Hajduk Split', 'Heart of Midlothian', 'Iberia 1999',
  "Inter Club d'Escaldes", 'Jablonec', 'Kairat Almaty', 'KuPS', 'Lincoln Red Imps FC', 'Lugano', 'Mjällby', 'Monaco',
  'Pafos FC', 'Panathinaikos', 'Riga FC', 'St.Truiden', 'Thun', 'Trabzonspor', 'Universitatea Craiova',
];

const MEN = [...BL1, ...BL2, ...BL3];

// Alle Schreibweisen mit Vereinszugehörigkeit (club = FotMob-ID des Männerteams)
function allNames() {
  const out = [];
  for (const [id, fm, ol] of MEN) out.push({ name: fm, club: id }, { name: ol, club: id });
  for (const [name, id] of FBL) out.push({ name, club: id }, { name: `${name} (W)`, club: id });
  INTL.forEach((name, i) => out.push({ name, club: `intl-${i}` }));
  return out;
}

test('alle 56 Vereine der drei Ligen: FotMob- und OpenLigaDB-Name ergeben denselben Schlüssel', () => {
  assert.strictEqual(MEN.length, 56);
  for (const [, fm, ol] of MEN) assert.strictEqual(norm(fm), norm(ol), `${fm} / ${ol}`);
});

test('keine zwei Vereine mit demselben Schlüssel (Männer und Frauen eines Vereins teilen ihn)', () => {
  const seen = new Map();
  for (const { name, club } of allNames()) {
    const key = norm(name);
    assert.ok(key, `leerer Schlüssel für ${name}`);
    if (seen.has(key)) assert.strictEqual(seen.get(key).club, club, `${name} kollidiert mit ${seen.get(key).name} (${key})`);
    else seen.set(key, { name, club });
  }
});

test('sameTeam über alle echten Namen: gleicher Verein ja, verschiedene Vereine nie', () => {
  const all = allNames();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      assert.strictEqual(sameTeam(a.name, b.name), a.club === b.club, `${a.name} / ${b.name}`);
    }
  }
});

test('jeder Verein der drei Ligen hat Kurznamen und ein eindeutiges Kürzel mit höchstens 3 Zeichen', () => {
  const codes = new Map();
  for (const [id, fm, ol] of MEN) {
    const c = code(fm);
    assert.match(c, /^[A-Z0-9ÄÖÜ]{3}$/, `${fm}: ${c}`);
    assert.strictEqual(code(ol), c, `${ol}`);
    assert.strictEqual(short(ol), short(fm), `${ol}`);
    assert.ok(!codes.has(c) || codes.get(c) === id, `${fm} und ${codes.get(c)} haben beide ${c}`);
    codes.set(c, id);
  }
  // Frauen: wie die Männer desselben Vereins, auch mit "(W)"
  for (const [name, id] of FBL) {
    const men = MEN.find((m) => m[0] === id)[1];
    assert.strictEqual(code(`${name} (W)`), code(men), name);
    assert.strictEqual(short(`${name} (W)`), short(men), name);
  }
});

test('Kürzel wie im Stadion', () => {
  const want = {
    Kaiserslautern: 'FCK',
    'Hertha BSC': 'BSC',
    'Fortuna Düsseldorf': 'F95',
    'Hannover 96': 'H96',
    '1. FC Nürnberg': 'FCN',
    'Karlsruher SC': 'KSC',
    'Arminia Bielefeld': 'DSC',
    'Dynamo Dresden': 'SGD',
    'Greuther Fürth': 'SGF',
    'Hansa Rostock': 'HRO',
    'RW Essen': 'RWE',
    'MSV Duisburg': 'MSV',
    '1860 München': 'M60',
    'TSV 1860 München': 'M60',
  };
  for (const [name, c] of Object.entries(want)) assert.strictEqual(code(name), c, name);
});

test('Kurznamen der neuen Ligen', () => {
  const want = {
    Kaiserslautern: 'Lautern',
    'Hertha BSC': 'Hertha',
    'SpVgg Greuther Fürth': 'Fürth',
    'DSC Arminia Bielefeld': 'Bielefeld',
    'Preußen Münster': 'Münster',
    'Rot-Weiss Essen': 'Essen',
    'Viktoria Köln 1904': 'Viktoria Köln',
    'Fortuna Köln': 'Fortuna Köln',
    'TSG 1899 Hoffenheim II': 'Hoffenheim II',
    'VfL Wolfsburg (W)': 'Wolfsburg',
    'FC Köln (W)': 'Köln',
    'TSV 1860 München': '1860',
  };
  for (const [name, s] of Object.entries(want)) assert.strictEqual(short(name), s, name);
});

test('zweite Mannschaften: eigener Schlüssel, nie dasselbe Team wie die erste', () => {
  assert.notStrictEqual(norm('Hoffenheim'), norm('Hoffenheim II'));
  assert.strictEqual(norm('Hoffenheim 2'), norm('TSG 1899 Hoffenheim II'));
  assert.ok(!sameTeam('VfB Stuttgart', 'VfB Stuttgart II'));
  assert.ok(!sameTeam('Borussia Dortmund', 'Borussia Dortmund II'));
  assert.ok(!sameTeam('Hertha BSC', 'Hertha BSC U23'));
  assert.strictEqual(short('Borussia Dortmund II'), 'Dortmund II');
  assert.strictEqual(code('Hoffenheim II'), 'TS2');
  assert.strictEqual(code('VfB Stuttgart II'), 'VF2');
});

test('Schreibweisen: ß/ss, Kurzformen, Städte mit mehreren Vereinen', () => {
  assert.strictEqual(norm('Preussen Münster'), norm('SC Preußen Münster'));
  assert.strictEqual(norm('Holstein Kiel'), norm('Kiel'));
  assert.strictEqual(norm('Fortuna Düsseldorf'), norm('Düsseldorf'));
  assert.strictEqual(norm('1860 München'), norm('TSV 1860 München'));
  assert.ok(!sameTeam('Bayern München', 'TSV 1860 München'));
  assert.ok(!sameTeam('Eintracht Frankfurt', 'FSV Frankfurt'));
  assert.ok(!sameTeam('1. FC Köln', 'Fortuna Köln'));
  assert.ok(!sameTeam('1. FC Köln', 'Viktoria Köln'));
  assert.ok(!sameTeam('Freiburg', 'Freiburger FC'));
  assert.ok(!sameTeam('VfB Stuttgart', 'Stuttgarter Kickers'));
  assert.ok(sameTeam('Düsseldorf', 'Fortuna Düsseldorf'));
  assert.ok(sameTeam('Bayern München', 'Bayern München (W)'));
});

test('unbekannte Vereine: Name bleibt, Kürzel aus dem Namen ohne Vereinsform', () => {
  assert.strictEqual(short('Austria Wien (W)'), 'Austria Wien');
  assert.strictEqual(code('FC København'), 'KOB');
  assert.strictEqual(code('FC 08 Homburg'), 'HOM');
  assert.strictEqual(code('Bodø/Glimt'), 'BOD');
  assert.strictEqual(code('Mjällby'), 'MJÄ');
  // Kurzform der Datenquelle, falls wir den Verein nicht kennen
  assert.strictEqual(short('Heart of Midlothian', 'Hearts'), 'Hearts');
  assert.strictEqual(short('Bayern München', 'Bayern München'), 'Bayern');
  assert.strictEqual(code('Manchester City', 'Man City'), 'MCI');
  assert.strictEqual(code('Manchester United', 'Man United'), 'MUN');
  assert.strictEqual(code('Paris Saint-Germain', 'PSG'), 'PSG');
});
