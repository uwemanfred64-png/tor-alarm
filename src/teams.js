// Vereinsnamen: FotMob und OpenLigaDB schreiben sie unterschiedlich ("Hamburger SV" / "HSV",
// "Preussen Münster" / "Preußen Münster", "Greuther Fürth" / "SpVgg Greuther Fürth"). norm() macht daraus
// einen gemeinsamen Schlüssel, short() den Namen, den man im Stadion sagt, code() das Kürzel auf der Tafel.
// Frauen-Teams heißen bei FotMob "VfL Wolfsburg (W)" und bekommen denselben Schlüssel wie die Männer.
// Zweite Mannschaften ("Hoffenheim II") bekommen einen eigenen Schlüssel mit "ii" am Ende.

// Wörter, die nur die Vereinsform beschreiben. Zahlen ("04", "1899") fallen sowieso weg.
const STRIP = new Set([
  'fc', 'sv', 'vfl', 'vfb', 'tsg', 'sc', 'fsv', 'rb', 'bsc', 'borussia', 'bayer', 'eintracht', 'werder',
  'sg', 'ssv', 'msv', 'tsv', 'spvgg', 'dsc',
]);

// Andere Schreibweisen desselben Vereins -> ein Schlüssel
const ALIAS = {
  rwessen: 'rotweissessen',
  gladbach: 'monchengladbach',
  mgladbach: 'monchengladbach',
  bayernmunich: 'bayernmunchen',
  sechzigmunich: 'sechzigmunchen',
  kiel: 'holsteinkiel',
  dusseldorf: 'fortunadusseldorf',
};

// Schlüssel -> [Kurzname, Kürzel]. Kürzel höchstens 3 Zeichen (mehr passt auf der Tafel nicht neben den
// Spielstand). Wo zwei Vereine üblicherweise dasselbe Kürzel haben, behält es der höherklassige, der
// andere bekommt die ersten Buchstaben seines Kurznamens (Waldhof MAN statt SVW, Münster MÜN statt SCP).
const CLUBS = {
  // Bundesliga
  bayernmunchen: ['Bayern', 'FCB'],
  dortmund: ['Dortmund', 'BVB'],
  leverkusen: ['Leverkusen', 'B04'],
  leipzig: ['Leipzig', 'RBL'],
  frankfurt: ['Frankfurt', 'SGE'],
  stuttgart: ['Stuttgart', 'VFB'],
  freiburg: ['Freiburg', 'SCF'],
  hoffenheim: ['Hoffenheim', 'TSG'],
  mainz: ['Mainz', 'M05'],
  augsburg: ['Augsburg', 'FCA'],
  wolfsburg: ['Wolfsburg', 'WOB'],
  monchengladbach: ['Gladbach', 'BMG'],
  bremen: ['Werder', 'SVW'],
  unionberlin: ['Union', 'FCU'],
  koln: ['Köln', 'KOE'],
  hamburger: ['HSV', 'HSV'],
  schalke: ['Schalke', 'S04'],
  heidenheim: ['Heidenheim', 'FCH'],
  paderborn: ['Paderborn', 'SCP'],
  elversberg: ['Elversberg', 'SVE'],
  // 2. Bundesliga
  hertha: ['Hertha', 'BSC'],
  nurnberg: ['Nürnberg', 'FCN'],
  magdeburg: ['Magdeburg', 'FCM'],
  kaiserslautern: ['Lautern', 'FCK'],
  energiecottbus: ['Cottbus', 'FCE'],
  osnabruck: ['Osnabrück', 'OSN'],
  braunschweig: ['Braunschweig', 'EBS'],
  stpauli: ['St. Pauli', 'STP'],
  bochum: ['Bochum', 'BOC'],
  hannover: ['Hannover', 'H96'],
  darmstadt: ['Darmstadt', 'D98'],
  greutherfurth: ['Fürth', 'SGF'],
  arminiabielefeld: ['Bielefeld', 'DSC'],
  dynamodresden: ['Dresden', 'SGD'],
  karlsruher: ['Karlsruhe', 'KSC'],
  holsteinkiel: ['Kiel', 'KSV'],
  // 3. Liga
  duisburg: ['Duisburg', 'MSV'],
  viktoriakoln: ['Viktoria Köln', 'VIK'],
  rotweissessen: ['Essen', 'RWE'],
  hansarostock: ['Rostock', 'HRO'],
  saarbrucken: ['Saarbrücken', 'FCS'],
  waldhofmannheim: ['Mannheim', 'MAN'],
  preussenmunster: ['Münster', 'MÜN'],
  alemanniaaachen: ['Aachen', 'AAC'],
  fortunakoln: ['Fortuna Köln', 'FOR'],
  fortunadusseldorf: ['Düsseldorf', 'F95'],
  verl: ['Verl', 'SCV'],
  jahnregensburg: ['Regensburg', 'SSV'],
  ingolstadt: ['Ingolstadt', 'FCI'],
  sonnenhofgrossaspach: ['Großaspach', 'SGS'],
  wurzburgerkickers: ['Würzburg', 'FWK'],
  meppen: ['Meppen', 'SVM'],
  wehenwiesbaden: ['Wehen', 'WEH'],
  havelse: ['Havelse', 'HAV'],
  // waren zuletzt in der 2. oder 3. Liga
  sechzigmunchen: ['1860', 'M60'],
  ulm: ['Ulm', 'ULM'],
  erzgebirgeaue: ['Aue', 'AUE'],
  sandhausen: ['Sandhausen', 'SVS'],
  // Europapokal: nur, wo die ersten drei Buchstaben in die Irre führen (MAN, REA, ATL …)
  parissaintgermain: [null, 'PSG'],
  manchesterunited: [null, 'MUN'],
  manchestercity: [null, 'MCI'],
  realmadrid: [null, 'RMA'],
  atleticomadrid: [null, 'ATM'],
  realbetis: [null, 'BET'],
  realsociedad: [null, 'RSO'],
  astonvilla: [null, 'AVL'],
  crystalpalace: [null, 'CRY'],
  brightonhovealbion: [null, 'BHA'],
  clubbrugge: [null, 'BRU'],
  unionstgilloise: [null, 'USG'],
  viktoriaplzen: [null, 'PLZ'],
  celtavigo: [null, 'VIG'],
  nkcelje: [null, 'CLJ'],
  braga: [null, 'SCB'],
  brann: [null, 'BRN'],
  youngboys: [null, 'YBO'],
};

// Zerlegt einen Namen in Wörter ohne Vereinsform, Akzente und Frauen-Kennung.
function parts(name) {
  let s = String(name || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[øœæłđı]/g, (c) => ({ ø: 'o', œ: 'oe', æ: 'ae', ł: 'l', đ: 'd', ı: 'i' })[c])
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(\s*w\s*\)/g, ' ')
    .trim();
  let reserve = false;
  s = s.replace(/\s+(ii|iii|2|u\s?\d\d)$/, () => {
    reserve = true;
    return '';
  });
  // "1860" ist der Name, nicht die Jahreszahl; "FSV Frankfurt" ist nicht die Eintracht.
  s = s.replace(/\b1860\b/g, ' sechzig ').replace(/\bfsv frankfurt\b/g, ' fsvfrankfurt ');
  const words = s.split(/[^a-z]+/).filter((w) => w && !STRIP.has(w));
  const joined = words.join('');
  return { words, reserve, base: ALIAS[joined] || joined };
}

function norm(name) {
  const p = parts(name);
  return p.base && p.reserve ? `${p.base}ii` : p.base;
}

// Bekannter Verein? Zweite Mannschaften erben Kurzname ("Hoffenheim II") und Kürzel ("TS2") vom ersten Team.
function known(name) {
  const p = parts(name);
  const club = CLUBS[p.base];
  if (!club) return null;
  if (!p.reserve) return { short: club[0], code: club[1] };
  return {
    short: club[0] ? `${club[0]} II` : null,
    code: /\d/.test(club[1]) ? club[1] : `${club[1].slice(0, 2)}2`,
  };
}

const plain = (name) => String(name || '').replace(/\s*\(\s*W\s*\)\s*$/i, '').trim();

// Kurzname wie im Stadion. alt = Kurzform der Datenquelle (FotMob "Man City"), falls wir den Verein nicht kennen.
function short(name, alt) {
  const k = known(name);
  return (k && k.short) || plain(alt) || plain(name);
}

// Unbekannte Vereine: erste drei Buchstaben ohne Vereinsform ("FC København" -> KOB), Umlaute bleiben.
function fallbackCode(text) {
  let s = String(text || '').trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/^(fc|ac|as|sc|sk|fk|nk|kf|afc|cf|cd|ud|sd|rc|fv|sv|tsv|ssv|fsv|msv|tsg|sg|spvgg|vfl|vfb|vfr|bsc|ksv|\d+\.?)\s+/i, '');
  } while (s !== prev);
  return s
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[^A-Za-z0-9ÄÖÜäöü]/g, (c) => c.normalize('NFD').replace(/[^A-Za-z]/g, ''))
    .slice(0, 3)
    .toUpperCase();
}

function code(name, alt) {
  const k = known(name);
  return (k && k.code) || fallbackCode(short(name, alt));
}

// Gleicher Verein? Gleicher Schlüssel – oder die kürzere Schreibweise steckt als ganze Wörter in der
// längeren ("Düsseldorf" / "Fortuna Düsseldorf"), aber nicht bei kurzen Allerweltsnamen wie "Köln",
// "Union", "Inter" und nie zwischen erster und zweiter Mannschaft ("Hoffenheim" / "Hoffenheim II").
function sameTeam(a, b) {
  const ka = norm(a);
  const kb = norm(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const pa = parts(a);
  const pb = parts(b);
  if (pa.reserve !== pb.reserve) return false;
  const [s, l] = pa.words.length <= pb.words.length ? [pa.words, pb.words] : [pb.words, pa.words];
  if (s.join('').length < 6) return false;
  for (let i = 0; i + s.length <= l.length; i++) {
    if (s.every((w, j) => l[i + j] === w)) return true;
  }
  return false;
}

module.exports = { norm, short, code, sameTeam };
