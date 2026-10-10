// Texte zu den Karten: eine Überschrift und ein Satz, so wie ein Ticker-Redakteur schreibt.
// Spielstand immer Heim:Gast. Wo es mehrere Formulierungen gibt, entscheidet ein Hash aus Spiel und
// Spielstand – dieselbe Lage ergibt also immer denselben Satz, auch wenn das Popup neu zeichnet.
// forwardMessage() macht daraus die Nachricht fürs Handy (ntfy) und für Discord.
// Keine Funktion hier wirft: describe() läuft beim Bauen jeder Karte.

// ---------------------------------------------------------------- Hilfen

// FNV-1a (32 Bit) – reicht, um gleichmäßig zwischen ein paar Formulierungen zu wählen.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const pick = (list, key) => list[hash(key) % list.length];

// Nur echte Texte/Zahlen – ein Objekt an falscher Stelle soll nie als "[object Object]" im Satz landen.
const clean = (s) => (typeof s === 'string' || typeof s === 'number' ? String(s) : '').replace(/\s+/g, ' ').trim();

// Personennamen aus den Daten. FotMob schreibt "<TBD>", solange der Schütze nicht feststeht.
function person(s) {
  const n = clean(s);
  return n && !/^<.*>$/.test(n) && !/^(null|undefined)$/i.test(n) ? n : '';
}

const teamName = (t) => clean(t && (t.name || t.full));

function scoreOf(s) {
  if (!Array.isArray(s)) return null;
  const h = Number(s[0]);
  const a = Number(s[1]);
  return Number.isInteger(h) && Number.isInteger(a) && h >= 0 && a >= 0 ? [h, a] : null;
}

const scoreStr = (s) => (s ? `${s[0]}:${s[1]}` : '');

const count = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

// Platzhalter {X} füllen
const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => (v[k] == null ? '' : String(v[k])));

// Satz fertig machen: Leerzeichen, großer Anfang, Punkt am Ende.
function finish(s) {
  let t = clean(s).replace(/\s+([.,:])/g, '$1');
  if (!t) return '';
  t = t[0].toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

const join = (...parts) => parts.map(finish).filter(Boolean).join(' ');

// ---------------------------------------------------------------- Vereinsnamen mit Artikel

// Manche Vereine sagt man mit Artikel: "Tor für den HSV", "der SC Freiburg", "die TSG Hoffenheim".
// Städte und Spitznamen ("Augsburg", "Bayern", "Gladbach", "Union") stehen ohne.
const F_PREFIX = /^(TSG|SGE?|SpVgg|AS)(\s|$)/;
const M_PREFIX = /^(1\.\s?)?(FC|SV|VfB|VfL|SC|MSV|TSV|FSV|SSV|KFC|BSC|AC|FK|SK)\s/;
const ART = { m: ['der', 'den', 'dem'], f: ['die', 'die', 'der'] };

function genus(name) {
  if (F_PREFIX.test(name)) return 'f';
  if (M_PREFIX.test(name)) return 'm';
  if (/^(RB|PSG|AZ)(\s|$)/.test(name)) return null;
  if (/^[A-ZÄÖÜ][A-ZÄÖÜ0-9]{1,4}$/.test(name)) return 'm'; // HSV, KSC, BVB …
  return null;
}

// fall: 0 = wer (Nominativ), 1 = für wen (Akkusativ), 2 = zwischen wem (Dativ)
function ref(name, fall) {
  const g = name ? genus(name) : null;
  return g ? `${ART[g][fall]} ${name}` : name;
}

// Platzhalter für eine Mannschaft: {T} "der HSV", {T_akk} "den HSV", {T_dat} "dem HSV"
function teamVars(prefix, name) {
  return { [prefix]: ref(name, 0), [`${prefix}_akk`]: ref(name, 1), [`${prefix}_dat`]: ref(name, 2) };
}

// ---------------------------------------------------------------- Minuten

// '78' / "78'" / '90+4' / '45 + 2' -> { base, extra }; Wörter wie 'Halbzeit' -> null
function parseMinute(v) {
  const s = String(v == null ? '' : v)
    .replace(/['’‎‏\s]/g, '')
    .replace(/\.(?=\+|$)/, '');
  const m = /^(\d{1,3})(?:\+(\d{1,2}))?$/.exec(s);
  return m ? { base: Number(m[1]), extra: m[2] ? Number(m[2]) : 0 } : null;
}

// Minute so, wie sie im Text steht: '78.' bzw. '90.+4'
function formatMinute(v) {
  const p = parseMinute(v);
  if (!p) return '';
  return p.extra ? `${p.base}.+${p.extra}` : `${p.base}.`;
}

// Nachspielzeit in Worten – nur dafür, dass ein spätes Tor auch so klingt.
function stoppage(v) {
  const p = parseMinute(v);
  if (!p || !p.extra) return null;
  if (p.base === 45) return { when: 'kurz vor der Pause', rest: 'die zweite Halbzeit' };
  if (p.base === 105) return { when: 'kurz vor dem Seitenwechsel', rest: 'den Rest der Verlängerung' };
  if (p.base >= 90) return { when: 'in der Nachspielzeit', rest: 'die Nachspielzeit' };
  return null;
}

// ---------------------------------------------------------------- Tore

// Was ein Tor für die Mannschaft bedeutet, die es bekommt (bei Eigentoren: die begünstigte).
function situation(score, side) {
  const i = side === 'home' ? 0 : 1;
  const mine = score[i];
  const theirs = score[1 - i];
  if (mine < 1) return 'plain'; // Daten passen nicht zusammen – lieber neutral bleiben
  if (mine === 1 && theirs === 0) return 'opener';
  if (mine === theirs) return 'equalizer';
  if (mine === theirs + 1) return 'lead';
  if (mine > theirs) return 'extend';
  if (mine === theirs - 1) return 'close';
  return 'reduce';
}

// {S} Torschütze, {O} Eigentorschütze, {T}/{T_akk} Mannschaft, {R} Spielstand, {W} "in der Nachspielzeit"
// Formulierungen mit Spielstand aus Sicht einer Mannschaft ("mit 2:1 in Führung") gibt es bewusst
// nicht – bei Auswärtstoren läse sich das als "mit 1:2 in Führung".
const GOAL = {
  named: {
    opener: ['{S} trifft zum {R}.', '{S} bringt {T_akk} in Führung.', '{S} erzielt das {R}.'],
    lead: ['{S} bringt {T_akk} in Führung.', '{S} trifft zum {R}, {T} führt.', '{S} schießt {T_akk} in Führung.'],
    equalizer: ['{S} gleicht zum {R} aus.', '{S} trifft zum {R}-Ausgleich.', '{S} erzielt den Ausgleich zum {R}.'],
    close: ['{S} verkürzt auf {R}.', '{S} erzielt den Anschlusstreffer zum {R}.'],
    reduce: ['{S} verkürzt auf {R}.', '{S} trifft zum {R}.'],
    extend: ['{S} erhöht auf {R}.', '{S} legt das {R} nach.', '{S} baut die Führung auf {R} aus.'],
    plain: ['{S} trifft, es steht {R}.'],
  },
  // Nachspielzeit / kurz vor der Pause – je eine knappe Form, die Zeitangabe macht den Satz schon lang
  late: {
    opener: ['{S} trifft {W} zum {R}.'],
    lead: ['{S} trifft {W} zum {R}.'],
    equalizer: ['{S} gleicht {W} zum {R} aus.'],
    close: ['{S} verkürzt {W} auf {R}.'],
    reduce: ['{S} verkürzt {W} auf {R}.'],
    extend: ['{S} erhöht {W} auf {R}.'],
    plain: ['{S} trifft {W}, es steht {R}.'],
  },
  penalty: {
    opener: ['{S} verwandelt den Elfmeter zum {R}.', '{S} bringt {T_akk} per Elfmeter in Führung.', '{S} trifft vom Punkt zum {R}.'],
    lead: ['{S} verwandelt den Elfmeter zum {R}.', '{S} bringt {T_akk} per Elfmeter in Führung.', '{S} trifft vom Punkt zum {R}.'],
    equalizer: ['{S} verwandelt den Elfmeter zum {R}.', '{S} gleicht per Elfmeter zum {R} aus.', '{S} trifft vom Punkt zum {R}-Ausgleich.'],
    close: ['{S} verwandelt den Elfmeter zum {R}.', '{S} verkürzt per Elfmeter auf {R}.'],
    reduce: ['{S} verwandelt den Elfmeter zum {R}.', '{S} verkürzt per Elfmeter auf {R}.'],
    extend: ['{S} verwandelt den Elfmeter zum {R}.', '{S} erhöht per Elfmeter auf {R}.', '{S} trifft vom Punkt zum {R}.'],
    plain: ['{S} verwandelt den Elfmeter, es steht {R}.'],
  },
  // Schütze noch unbekannt
  team: {
    opener: ['{T} trifft zum {R}.', '{T} geht in Führung.'],
    lead: ['{T} trifft zum {R}.', '{T} geht in Führung.'],
    equalizer: ['{T} trifft zum {R}.', '{T} gleicht zum {R} aus.'],
    close: ['{T} trifft zum {R}.', '{T} verkürzt auf {R}.'],
    reduce: ['{T} trifft zum {R}.', '{T} verkürzt auf {R}.'],
    extend: ['{T} trifft zum {R}.', '{T} erhöht auf {R}.'],
    plain: ['{T} trifft, es steht {R}.'],
  },
  teamLate: {
    opener: ['{T} trifft {W} zum {R}.'],
    lead: ['{T} trifft {W} zum {R}.'],
    equalizer: ['{T} gleicht {W} zum {R} aus.'],
    close: ['{T} verkürzt {W} auf {R}.'],
    reduce: ['{T} verkürzt {W} auf {R}.'],
    extend: ['{T} erhöht {W} auf {R}.'],
    plain: ['{T} trifft {W}, es steht {R}.'],
  },
  teamPenalty: {
    opener: ['{T} trifft per Elfmeter zum {R}.', '{T} geht per Elfmeter in Führung.'],
    lead: ['{T} trifft per Elfmeter zum {R}.', '{T} geht per Elfmeter in Führung.'],
    equalizer: ['{T} trifft per Elfmeter zum {R}.', '{T} gleicht per Elfmeter zum {R} aus.'],
    close: ['{T} trifft per Elfmeter zum {R}.', '{T} verkürzt per Elfmeter auf {R}.'],
    reduce: ['{T} trifft per Elfmeter zum {R}.', '{T} verkürzt per Elfmeter auf {R}.'],
    extend: ['{T} trifft per Elfmeter zum {R}.', '{T} erhöht per Elfmeter auf {R}.'],
    plain: ['{T} trifft per Elfmeter, es steht {R}.'],
  },
  // Eigentor: {O} spielt für die andere Mannschaft, {T} ist die begünstigte
  own: {
    opener: ['Eigentor von {O} – {R} für {T_akk}.', '{O} trifft ins eigene Tor.'],
    lead: ['Eigentor von {O} – {R}, {T} führt.', '{O} trifft ins eigene Tor.'],
    equalizer: ['Eigentor von {O} zum {R}-Ausgleich.', 'Ausgleich durch ein Eigentor von {O}: {R}.'],
    close: ['Eigentor von {O} – nur noch {R}.', 'Eigentor von {O} zum {R}.'],
    reduce: ['Eigentor von {O} zum {R}.'],
    extend: ['Eigentor von {O} – {R} für {T_akk}.', '{O} trifft ins eigene Tor.'],
    plain: ['Eigentor von {O}, es steht {R}.'],
  },
  ownTeam: {
    opener: ['Eigentor – {R} für {T_akk}.'],
    lead: ['Eigentor – {R}, {T} führt.'],
    equalizer: ['Eigentor zum {R}-Ausgleich.'],
    close: ['Eigentor – nur noch {R}.'],
    reduce: ['Eigentor zum {R}.'],
    extend: ['Eigentor – {R} für {T_akk}.'],
    plain: ['Eigentor, es steht {R}.'],
  },
};

// Tor nach Rücknahme doch gegeben – kurz, die Überschrift sagt schon "Tor zählt doch"
const REINSTATED = {
  named: ['Das {R} durch {S} zählt doch.', 'Kommando zurück: Das {R} durch {S} zählt.'],
  penalty: ['Der Elfmetertreffer von {S} zählt doch.'],
  own: ['Das Eigentor von {O} zählt doch.'],
  team: ['Das {R} für {T_akk} zählt doch.', 'Kommando zurück: Das {R} für {T_akk} zählt.'],
  ownTeam: ['Das Eigentor zum {R} zählt doch.'],
};

// Bewusst kurz: der Satz muss mit Schütze und Vorlage in zwei Ticker-Zeilen passen.
const VAR = 'Der VAR prüft noch.';

function goalText(c, ctx) {
  const g = c.goal && typeof c.goal === 'object' ? c.goal : {};
  const scorer = person(g.scorer);
  const own = !!g.ownGoal;
  const penalty = !own && !!g.penalty;
  const { score, team, key } = ctx;
  const v = { S: scorer, O: scorer, R: scoreStr(score), ...teamVars('T', team) };

  let headline;
  if (c.favorite) headline = team ? `TOOOR für ${v.T_akk}!` : 'TOOOR!';
  else if (c.conceded) headline = c.reinstated ? 'Gegentor zählt doch' : 'Gegentor';
  else if (c.reinstated) headline = 'Tor zählt doch';
  else headline = team ? `Tor für ${v.T_akk}` : 'Tor';

  let main;
  if (!score || !team) {
    // Zu wenig Daten für einen richtigen Satz
    if (own) main = scorer ? 'Eigentor von {O}.' : 'Eigentor.';
    else if (scorer) main = penalty ? '{S} verwandelt den Elfmeter.' : '{S} trifft.';
    else main = team ? '{T} trifft.' : (score ? 'Es steht {R}.' : '');
  } else if (c.reinstated) {
    const pool = own ? (scorer ? 'own' : 'ownTeam') : scorer ? (penalty ? 'penalty' : 'named') : 'team';
    main = pick(REINSTATED[pool], `${key}|zurück|${pool}`);
  } else {
    const sit = situation(score, ctx.side);
    const late = stoppage(g.minute || c.minute);
    let pool;
    if (own) pool = scorer ? 'own' : 'ownTeam';
    else if (penalty) pool = scorer ? 'penalty' : 'teamPenalty';
    else if (late) pool = scorer ? 'late' : 'teamLate';
    else pool = scorer ? 'named' : 'team';
    if (late) v.W = late.when;
    main = pick(GOAL[pool][sit], `${key}|${pool}|${sit}`);
  }

  const parts = [fill(main, v)];
  // Vorlage nur bei echten Toren aus dem Spiel – Elfmeter und Eigentore haben keine.
  const assist = person(g.assist);
  if (assist && scorer && !own && !penalty && assist !== scorer) parts.push(`Vorlage: ${assist}`);
  if (c.varPending) parts.push(VAR);
  return { headline, sentence: join(...parts) };
}

// ---------------------------------------------------------------- Aberkannt

function disallowedText(c, ctx) {
  const { score, team, side, key } = ctx;
  const v = { R: scoreStr(score), ...teamVars('T', team) };
  const headline = team ? `Kein Tor für ${v.T_akk}` : 'Kein Tor';

  // Stand vor der Rücknahme – fehlt er, ist es eben ein Tor mehr auf dieser Seite.
  let prev = scoreOf(c.prev);
  if (!prev && score && (side === 'home' || side === 'away')) {
    prev = side === 'home' ? [score[0] + 1, score[1]] : [score[0], score[1] + 1];
  }
  v.P = scoreStr(prev);

  let s;
  if (!score) s = 'Das Tor zählt nicht.';
  else if (!prev || (prev[0] === score[0] && prev[1] === score[1])) s = 'Es bleibt beim {R}.';
  else if (prev[0] + prev[1] - score[0] - score[1] === 1 && prev[0] >= score[0] && prev[1] >= score[1]) {
    s = pick(
      [
        'Das {P} zählt nicht – es bleibt beim {R}.',
        'Der Treffer zum {P} wird zurückgenommen, es steht weiter {R}.',
        'Das {P} wird aberkannt, es bleibt beim {R}.',
      ],
      `${key}|weg`
    );
  } else s = 'Der Spielstand wird korrigiert: {R} statt {P}.';
  return { headline, sentence: finish(fill(s, v)) };
}

// ---------------------------------------------------------------- Verpasste Tore

const MAL = ['', 'einmal', 'zweimal', 'dreimal', 'viermal', 'fünfmal', 'sechsmal', 'siebenmal', 'achtmal', 'neunmal', 'zehnmal'];
const mal = (n) => MAL[n] || `${n}-mal`;

function missedText(c, ctx) {
  const { score } = ctx;
  const m = c.missed && typeof c.missed === 'object' ? c.missed : {};
  const mh = count(m.home);
  const ma = count(m.away);
  const headline = mh + ma === 1 ? 'Verpasstes Tor' : 'Verpasste Tore';
  const v = { R: scoreStr(score), ...teamVars('H', ctx.home), ...teamVars('A', ctx.away) };
  const min = clean(c.minute).toLowerCase();
  const done = min === 'ende';
  const half = min === 'halbzeit';

  // Hat nur eine Mannschaft getroffen und damit das Spiel gedreht, ist das die Nachricht.
  if (score && (mh === 0) !== (ma === 0)) {
    const i = mh ? 0 : 1;
    const before = score.slice();
    before[i] -= mh || ma;
    const who = i === 0 ? 'H' : 'A';
    if (before[i] >= 0 && before[i] < before[1 - i] && score[i] >= score[1 - i]) {
      v.B = scoreStr(before);
      const what =
        score[i] > score[1 - i] ? `{${who}} hat das Spiel gedreht: Aus {B} wurde {R}.` : `{${who}} hat den Rückstand aufgeholt: Aus {B} wurde {R}.`;
      const tail = done ? 'Das Spiel ist aus.' : half ? 'Jetzt ist Halbzeit.' : '';
      return { headline, sentence: join(fill(what, v), tail) };
    }
  }

  let what = '';
  if (mh && mh === ma) what = `{H} und {A} haben je ${mal(mh)} getroffen.`;
  else if (mh && ma) what = `{H} hat ${mal(mh)} getroffen, {A} ${mal(ma)}.`;
  else if (mh) what = mh === 1 ? '{H} hat getroffen.' : `{H} hat ${mal(mh)} getroffen.`;
  else if (ma) what = ma === 1 ? '{A} hat getroffen.' : `{A} hat ${mal(ma)} getroffen.`;
  let stand = '';
  if (score) stand = done ? 'Endstand: {R}.' : half ? 'Halbzeitstand: {R}.' : what ? 'Es steht jetzt {R}.' : 'Es steht {R}.';
  return { headline, sentence: join(fill(what, v), fill(stand, v)) };
}

// ---------------------------------------------------------------- Anpfiff, Halbzeit, Abpfiff

function halftimeText(c, ctx) {
  const { score, key } = ctx;
  const v = { R: scoreStr(score), ...teamVars('H', ctx.home), ...teamVars('A', ctx.away) };
  let pool;
  if (!score) pool = ['Halbzeit.'];
  else if (score[0] === 0 && score[1] === 0) pool = ['Torlos geht es in die Pause.', 'Zur Pause steht es 0:0.'];
  else if (score[0] === score[1]) pool = ['Zur Pause steht es {R}.', 'Mit {R} geht es in die Kabinen.'];
  else if (score[0] > score[1]) pool = ['{H} führt zur Pause {R} gegen {A_akk}.', 'Zur Pause führt {H} mit {R}.'];
  else pool = ['{H} liegt zur Pause {R} gegen {A_akk} zurück.', 'Zur Pause führt {A}, es steht {R}.'];
  return { headline: 'Halbzeit', sentence: finish(fill(pick(pool, `${key}|pause`), v)) };
}

const DFB_POKAL = 209;

function fulltimeText(c, ctx) {
  const { score, key } = ctx;
  const v = { R: scoreStr(score), ...teamVars('H', ctx.home), ...teamVars('A', ctx.away) };
  if (!score) return { headline: 'Abpfiff', sentence: 'Das Spiel ist aus.' };
  const [h, a] = score;
  const min = clean(c.minute).toLowerCase();
  const pens = /elfmeter|^n\.\s?e\.?$/.test(min);
  const aet = !pens && /verlängerung|^n\.\s?v\.?$/.test(min);
  const comp = c.competition && typeof c.competition === 'object' ? c.competition : {};
  // Spielt der Lieblingsverein mit? main.js setzt favoriteSide; ersatzweise favorite + side.
  const fav = c.favoriteSide === 'home' || c.favoriteSide === 'away' ? c.favoriteSide : c.favorite ? ctx.side : null;
  const nv = aet ? ' nach Verlängerung' : '';

  let s;
  if (h === a) {
    // Im Pokal endet kein Spiel unentschieden – dann hat das Elfmeterschießen entschieden.
    if (pens || comp.id === DFB_POKAL) s = '{R} nach Verlängerung – die Entscheidung fiel im Elfmeterschießen.';
    else if (h === 0) s = pick(['{H} und {A} trennen sich 0:0.', 'Torloses Unentschieden zwischen {H_dat} und {A_dat}.'], `${key}|ende`);
    else s = pick(['Unentschieden: {R}.', '{H} und {A} trennen sich {R}.'], `${key}|ende`);
  } else if (fav) {
    const won = (h > a) === (fav === 'home');
    if (fav === 'home') s = won ? `Sieg! {H} gewinnt${nv} {R} gegen {A_akk}.` : `{H} verliert${nv} {R} gegen {A_akk}.`;
    else s = won ? `Sieg! {A} gewinnt auswärts${nv}, Endstand {R}.` : `{A} verliert auswärts${nv}, Endstand {R}.`;
  } else if (h > a) {
    s = aet ? '{H} gewinnt nach Verlängerung {R} gegen {A_akk}.' : pick(['{H} gewinnt {R} gegen {A_akk}.', '{H} schlägt {A_akk} {R}.'], `${key}|ende`);
  } else {
    s = aet ? '{H} verliert nach Verlängerung {R} gegen {A_akk}.' : pick(['{H} verliert {R} gegen {A_akk}.', 'Auswärtssieg für {A_akk}: {R}.'], `${key}|ende`);
  }
  return { headline: 'Abpfiff', sentence: finish(fill(s, v)) };
}

function kickoffText(c, ctx) {
  return { headline: 'Anpfiff', sentence: pick(['Der Ball rollt.', 'Das Spiel läuft.', 'Die Partie ist angepfiffen.'], `${ctx.key}|los`) };
}

// ---------------------------------------------------------------- Rote Karte

function redcardText(c, ctx) {
  const { team, key } = ctx;
  const player = person(c.player);
  const v = { P: player, M: formatMinute(c.minute), ...teamVars('T', team) };
  const word = c.yellowRed ? 'Gelb-Rot' : 'Rote Karte';
  const headline = team ? `${word} für ${v.T_akk}` : word;
  const late = stoppage(c.minute);
  let s;
  // "fliegt vom Platz" passt für Rot und Gelb-Rot gleichermaßen.
  if (player) {
    if (late) {
      // Die genaue Minute (90.+4) zeigt jedes Design ohnehin an
      v.W = late.when;
      s = pick(['{P} fliegt {W} vom Platz.', '{P} muss {W} vom Platz.'], `${key}|rot`);
    } else if (v.M) {
      s = pick(['{P} fliegt in der {M} Minute vom Platz.', 'Platzverweis für {P} in der {M} Minute.', '{P} muss in der {M} Minute vom Platz.'], `${key}|rot`);
    } else s = pick(['{P} fliegt vom Platz.', 'Platzverweis für {P}.'], `${key}|rot`);
  } else if (team) {
    if (late) {
      v.REST = late.rest;
      s = '{T} muss {REST} in Unterzahl bestreiten.';
    } else if (v.M) s = '{T} muss ab der {M} Minute in Unterzahl spielen.';
    else s = '{T} muss in Unterzahl weiterspielen.';
  } else s = v.M ? 'Platzverweis in der {M} Minute.' : 'Platzverweis.';
  return { headline, sentence: finish(fill(s, v)) };
}

// ---------------------------------------------------------------- Konferenz

const ZAHL = ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];
const zahl = (n) => ZAHL[n] || String(n);
const pad = (n) => String(n).padStart(2, '0');

// Anstoßzeit in Ortszeit, "15:30"
function clock(utc) {
  const t = typeof utc === 'number' ? utc : Date.parse(utc);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function conferenceText(c) {
  const list = (Array.isArray(c.matches) ? c.matches : []).filter((m) => m && typeof m === 'object' && m.status !== 'cancelled');
  const headline = 'Alle Spiele';
  if (!list.length) return { headline, sentence: 'Heute kein Spiel.' };
  const by = (st) => list.filter((m) => m.status === st);
  const live = by('live').length;
  const done = by('done').length;
  const pre = by('pre');
  const next = pre
    .map((m) => Date.parse(m.startUtc))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  const at = next ? clock(next) : '';

  let s;
  if (live) {
    const first = live === 1 ? 'ein Spiel läuft' : `${zahl(live)} Spiele laufen`;
    const rest = [];
    if (done) rest.push(done === 1 ? 'eins ist beendet' : `${zahl(done)} sind beendet`);
    if (pre.length) rest.push(pre.length === 1 ? 'eins kommt noch' : `${zahl(pre.length)} kommen noch`);
    if (!rest.length) s = `${first} gerade.`;
    else if (rest.length === 1) s = `${first}, ${rest[0]}.`;
    else s = `${first}, ${rest[0]} und ${rest[1]}.`;
  } else if (pre.length && !done) {
    if (pre.length === 1) s = at ? `Anpfiff um ${at} Uhr.` : 'Das Spiel hat noch nicht begonnen.';
    else s = at ? `${zahl(pre.length)} Spiele heute, das erste beginnt um ${at} Uhr.` : `${zahl(pre.length)} Spiele heute, noch keins angepfiffen.`;
  } else if (pre.length) {
    s = at ? `Gerade läuft kein Spiel – das nächste beginnt um ${at} Uhr.` : 'Gerade läuft kein Spiel.';
  } else {
    s = done === 1 ? 'Das Spiel ist beendet.' : done === 2 ? 'Beide Spiele sind beendet.' : `Alle ${zahl(done)} Spiele sind beendet.`;
  }
  return { headline, sentence: finish(s) };
}

// ---------------------------------------------------------------- Einstieg

const TYPES = ['goal', 'disallowed', 'missed', 'kickoff', 'halftime', 'fulltime', 'redcard', 'conference'];
const HEADLINES = {
  goal: 'Tor',
  disallowed: 'Kein Tor',
  missed: 'Verpasste Tore',
  kickoff: 'Anpfiff',
  halftime: 'Halbzeit',
  fulltime: 'Abpfiff',
  redcard: 'Rote Karte',
  conference: 'Alle Spiele',
};
const BUILD = {
  goal: goalText,
  disallowed: disallowedText,
  missed: missedText,
  kickoff: kickoffText,
  halftime: halftimeText,
  fulltime: fulltimeText,
  redcard: redcardText,
  conference: conferenceText,
};

const typeOf = (c) => (TYPES.includes(c.type) ? c.type : 'goal');

function context(c) {
  const home = teamName(c.home);
  const away = teamName(c.away);
  const side = c.side === 'home' || c.side === 'away' ? c.side : null;
  const team = clean(c.team) || (side === 'home' ? home : side === 'away' ? away : '');
  const score = scoreOf(c.score);
  const id = (t) => (t && (t.id != null ? t.id : t.name)) || '';
  // Grundlage für die Wahl der Formulierung: Spiel + Spielstand + Ereignis, nichts Flüchtiges
  const key = `${id(c.home)}-${id(c.away)}|${typeOf(c)}|${side || ''}|${scoreStr(score)}`;
  return { home, away, side, team, score, key };
}

// describe(card) -> { headline, sentence }
function describe(card) {
  const c = card && typeof card === 'object' ? card : {};
  const type = typeOf(c);
  try {
    return BUILD[type](c, context(c));
  } catch {
    return { headline: HEADLINES[type], sentence: '' };
  }
}

// ---------------------------------------------------------------- Weiterleitung (ntfy, Discord)

const CUPS = [DFB_POKAL];

// "Bundesliga, 5. Spieltag" / "DFB-Pokal, 2. Runde"
function competitionLine(c) {
  const comp = c.competition && typeof c.competition === 'object' ? c.competition : {};
  const name = clean(comp.name || comp.short);
  const r = clean(c.round);
  const round = /^\d+$/.test(r) ? `${r}. ${CUPS.includes(comp.id) ? 'Runde' : 'Spieltag'}` : '';
  return [name, round].filter(Boolean).join(', ');
}

function minuteNote(min) {
  const f = formatMinute(min);
  if (f) return ` (${f})`;
  const s = clean(min);
  return /^(halbzeit|pause|ende|verlängerung|elfmeterschießen|n\. ?v\.)$/i.test(s) ? ` (${s})` : '';
}

const MAX_LINES = 10;

function conferenceLines(matches) {
  const list = (Array.isArray(matches) ? matches : []).filter((m) => m && typeof m === 'object' && m.status !== 'cancelled');
  const lines = list.slice(0, MAX_LINES).map((m) => {
    const h = teamName(m.home) || 'Heim';
    const a = teamName(m.away) || 'Gast';
    const s = scoreOf(m.score);
    if (m.status === 'pre' || !s) {
      const t = clock(m.startUtc);
      return t ? `${h} – ${a}, ${t} Uhr` : `${h} – ${a}`;
    }
    const note = m.status === 'done' ? ' (Ende)' : minuteNote(m.minute);
    return `${h} ${scoreStr(s)} ${a}${note}`;
  });
  if (list.length > MAX_LINES) lines.push(`… und ${list.length - MAX_LINES} weitere`);
  return lines;
}

// forwardMessage(card) -> { title, message, click, tags }
// Titel z. B. "Tor für Augsburg – 2:1", Nachricht "Augsburg 2:1 Bayern (78.)\n<Satz>".
// Keine Emojis im Text – das Symbol setzt die ntfy-App selbst anhand der Tags.
function forwardMessage(card) {
  const c = card && typeof card === 'object' ? card : {};
  try {
    return buildMessage(c);
  } catch {
    return { title: HEADLINES[typeOf(c)], message: '', click: null, tags: ['soccer'] };
  }
}

function buildMessage(c) {
  const type = typeOf(c);
  const t = describe(c);
  const home = teamName(c.home) || 'Heim';
  const away = teamName(c.away) || 'Gast';
  const score = scoreOf(c.score);
  const r = scoreStr(score);
  const line = score ? `${home} ${r} ${away}` : `${home} – ${away}`;
  const head = t.headline.replace(/!+$/, '');
  const withScore = r ? `${head} – ${r}` : head;

  let title;
  let lines;
  if (type === 'goal') {
    const min = formatMinute((c.goal && c.goal.minute) || c.minute);
    title = withScore;
    lines = [line + (min ? ` (${min})` : ''), t.sentence];
  } else if (type === 'disallowed') {
    const min = formatMinute(c.minute);
    title = head;
    lines = [line + (min ? ` (${min})` : ''), t.sentence];
  } else if (type === 'redcard') {
    // Minute nicht doppelt: steht sie schon im Satz ("in der 78. Minute"), bleibt die Zeile ohne
    const min = formatMinute(c.minute);
    title = head;
    lines = [line + (min && !t.sentence.includes(min) ? ` (${min})` : ''), t.sentence];
  } else if (type === 'missed') {
    title = withScore;
    lines = [line + minuteNote(c.minute), t.sentence];
  } else if (type === 'kickoff') {
    title = `Anpfiff: ${home} – ${away}`;
    lines = [t.sentence, competitionLine(c)];
  } else if (type === 'conference') {
    title = head;
    lines = [t.sentence, ...conferenceLines(c.matches)];
  } else {
    title = withScore; // Halbzeit, Abpfiff
    lines = [line, t.sentence];
  }

  const url = typeof c.url === 'string' && /^https:\/\/\S+$/.test(c.url) ? c.url : null;
  return {
    title,
    message: lines.filter(Boolean).join('\n'),
    click: url,
    tags: type === 'redcard' ? ['red_circle'] : ['soccer'],
  };
}

module.exports = { describe, forwardMessage, formatMinute };
