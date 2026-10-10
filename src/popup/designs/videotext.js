// Design "videotext": eine Videotext-Seite, wie man sie von den Sportseiten im Fernsehen kennt.
// Kopfzeile mit Seitennummer und sekündlich laufender Uhr, ein farbiges Band mit doppelt hohem Titel,
// darunter Ergebnis, Torschütze und ein Satz, ganz unten die Fastext-Leiste (Rot/Grün/Gelb/Cyan).
// Gezeichnet wird Zeichen für Zeichen auf ein Canvas – nach den Regeln des echten Videotexts:
// Steuerzeichen belegen eine Zelle, Hintergrund gibt es nur über "neuer Hintergrund", doppelt hohe
// Zeilen belegen zwei Rasterzeilen, Blinken wie beim SAA5050.

(() => {
  const WIDTH = 420; // Fensterbreite inkl. 8 px Rand rundum
  const COLS = 33; // Zeichen pro Zeile: 33 x 12 px = 396 px
  const CW = 12;
  const CH = 20;
  const PAD = 4; // schwarzer Rand ums Raster: 4 + 396 + 4 = 404
  const PAGE_W = COLS * CW + 2 * PAD;
  const TEXT_W = COLS - 2; // nutzbare Zeichen hinter der Steuerzelle, eine Zelle Rand rechts
  const MAX_HEIGHT = 420; // Fensterhöhe höchstens
  const MAX_BODY = Math.floor((MAX_HEIGHT - 16 - 2 * PAD) / CH) - 4; // Inhaltszeilen höchstens (15)
  const FLASH_PERIOD = 1280; // Blinken wie beim SAA5050: 0,96 s sichtbar, 0,32 s weg (~1 Hz)
  const FLASH_ON = 960;
  const SUBPAGE_MS = 7000; // Unterseiten der Konferenz blättern von selbst weiter

  // Die acht Videotext-Farben in voller Sättigung
  const PALETTE = ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'];
  const K = 0; // Schwarz
  const R = 1; // Rot
  const G = 2; // Grün
  const Y = 3; // Gelb
  const B = 4; // Blau
  const M = 5; // Magenta
  const C = 6; // Cyan
  const W = 7; // Weiß

  // Jeder Wettbewerb hat seine Videotext-Seite
  const PAGES = { 54: 250, 146: 260, 208: 270, 9676: 280, 209: 240, 42: 230, 73: 232, 10216: 234 };
  const CONFERENCE_PAGE = 252;
  const COMP_ORDER = [54, 146, 208, 9676, 209, 42, 73, 10216];
  const RANK = { live: 0, pre: 1, done: 2, cancelled: 3 };
  const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const FOTMOB = 'https://www.fotmob.com/de';

  // Die Schrift kommt aus teletext-font.js (im Popup vorher geladen, unter Node per require)
  const NODE_FONT =
    typeof window === 'undefined' && typeof require === 'function' ? require('./teletext-font.js') : null;
  const font = () => (typeof window !== 'undefined' && window.TA_TELETEXT) || NODE_FONT;

  // ---------------------------------------------------------------- Zeilen wie im Videotext

  // Steuerzeichen erscheinen als Leerzeichen. Schriftfarbe, doppelte Höhe und Blinken gelten ab der
  // nächsten Zelle, neuer/schwarzer Hintergrund, normale Höhe und "Blinken aus" schon ab der
  // Steuerzelle selbst. Am Zeilenanfang: Weiß auf Schwarz, normale Höhe, kein Blinken.
  class Line {
    constructor() {
      this.cells = [];
      this.fg = W;
      this.bg = K;
      this.dh = false;
      this.flash = false;
      this.link = null;
      this.big = false; // doppelte Höhe -> die Zeile belegt zwei Rasterzeilen
    }

    get col() {
      return this.cells.length;
    }

    put(ch) {
      if (this.cells.length < COLS) {
        this.cells.push({ ch, fg: this.fg, bg: this.bg, dh: this.dh, flash: this.flash, link: this.link });
      }
      return this;
    }

    text(s) {
      for (const ch of font().clean(s)) this.put(ch);
      return this;
    }

    color(c) {
      this.put(' ');
      this.fg = c;
      return this;
    }

    newBg() {
      this.bg = this.fg;
      return this.put(' ');
    }

    double() {
      this.put(' ');
      this.dh = true;
      this.big = true;
      return this;
    }

    normal() {
      this.dh = false;
      return this.put(' ');
    }

    flashing() {
      this.put(' ');
      this.flash = true;
      return this;
    }

    linkTo(id) {
      this.link = id;
      return this;
    }

    to(col) {
      while (this.cells.length < Math.min(col, COLS)) this.put(' ');
      return this;
    }

    done() {
      return this.to(COLS);
    }

    toString() {
      return this.cells.map((c) => c.ch).join('');
    }
  }

  // ---------------------------------------------------------------- Texte

  const pad2 = (n) => String(n).padStart(2, '0');
  const clock = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const teamName = (t) => String((t && (t.name || t.full || t.code)) || '?');
  const len = (s) => font().measure(s);

  function scoreText(s) {
    return Array.isArray(s) && s.length === 2 && s.every((v) => v != null && v !== '') ? `${s[0]}:${s[1]}` : '-:-';
  }

  // "78" -> "78.", "45+2" -> "45.+2"; Wörter wie "Halbzeit" -> ''
  function minuteText(min) {
    const s = String(min == null ? '' : min).replace(/['’‎‏]/g, '').replace(/\s+/g, '');
    const m = /^(\d{1,3})(?:\+(\d{1,2}))?$/.exec(s);
    if (!m) return '';
    return m[2] ? `${m[1]}.+${m[2]}` : `${m[1]}.`;
  }

  // Konferenz, rechte Spalte (höchstens 5 Zeichen): Minute, Pause, Ende oder Anstoßzeit
  const STATE_WORDS = {
    halbzeit: 'Pause',
    pause: 'Pause',
    ende: 'Ende',
    'verlängerung': 'Verl.',
    'elfmeterschießen': 'Elfm.',
    'n. v.': 'n.V.',
    unterbrochen: 'Unt.',
  };
  function stateText(m) {
    const min = String(m.minute == null ? '' : m.minute).trim();
    if (m.status === 'cancelled') return 'abg.';
    if (m.status === 'pre') {
      const t = Date.parse(m.startUtc);
      return Number.isFinite(t) ? clock(new Date(t)) : '';
    }
    if (m.status === 'done') return min.toLowerCase() === 'n. v.' ? 'n.V.' : 'Ende';
    const s = minuteText(min);
    if (s) return s.length > 5 ? s.replace('.', '') : s;
    return STATE_WORDS[min.toLowerCase()] || '';
  }

  // Zu lang? Erst ganze Wörter von vorn ("Preußen Münster" -> "Preußen"), sonst abkürzen wie im
  // Videotext: "Braunschweig" -> "Braunsch."
  function abbr(s, max) {
    s = font().clean(s).trim();
    if (s.length <= max) return s;
    if (max < 3) return s.slice(0, Math.max(0, max));
    let words = '';
    for (const w of s.split(' ')) {
      const next = words ? `${words} ${w}` : w;
      if (next.length > max) break;
      words = next;
    }
    if (words.length >= Math.min(6, max) && /[A-Za-zÄÖÜäöüß]{4}/.test(words)) return words;
    return `${s.slice(0, max - 1).trimEnd()}.`;
  }

  // Zwei Vereinsnamen auf zusammen höchstens max Zeichen bringen – den längeren zuerst kürzen.
  function fitPair(a, b, max) {
    a = font().clean(a).trim();
    b = font().clean(b).trim();
    while (a.length + b.length > max && (a.length > 4 || b.length > 4)) {
      if (a.length >= b.length) a = abbr(a, a.length - 1);
      else b = abbr(b, b.length - 1);
    }
    return [a, b];
  }

  // An Leerzeichen umbrechen, überlange Wörter hart trennen. Ein frei stehender Gedankenstrich
  // wandert mit dem folgenden Wort in die nächste Zeile ("– 1:0." bleibt zusammen).
  function wrapWords(text, width) {
    const words = [];
    for (const w of font().clean(text).split(/\s+/).filter(Boolean)) {
      const prev = words[words.length - 1];
      if (prev === '-' && `- ${w}`.length <= width) words[words.length - 1] = `- ${w}`;
      else words.push(w);
    }
    const out = [];
    let cur = '';
    for (let w of words) {
      while (w.length > width) {
        if (cur) out.push(cur);
        cur = '';
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!w) continue;
      if (!cur) cur = w;
      else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
      else {
        out.push(cur);
        cur = w;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  // Satz in höchstens maxLines Zeilen: ganze Sätze, solange sie passen ("Vorlage: …" fällt notfalls
  // weg); passt schon der erste nicht, endet die letzte Zeile mit "...".
  function sentenceLines(text, width, maxLines) {
    const parts = font().clean(text).trim().split(/(?<=[.!?])\s+/).filter(Boolean);
    if (maxLines <= 0 || !parts.length) return [];
    for (let n = parts.length; n > 0; n--) {
      const lines = wrapWords(parts.slice(0, n).join(' '), width);
      if (lines.length <= maxLines) return lines;
    }
    const lines = wrapWords(parts[0] || '', width).slice(0, maxLines);
    let last = lines[maxLines - 1] || '';
    while (last.length + 4 > width && last.includes(' ')) last = last.slice(0, last.lastIndexOf(' '));
    lines[maxLines - 1] = `${last.slice(0, width - 4)} ...`;
    return lines;
  }

  // "78. Robin Fellhauer (Elfmeter)" – bei Platzmangel nur der Nachname, dann ohne Zusatz
  function scorerText(c, team) {
    const g = c.goal || {};
    const min = minuteText(g.minute || c.minute);
    const pre = min ? `${min} ` : '';
    if (!g.scorer) {
      if (c.pending) return `${pre}Torschütze folgt ...`;
      return team ? `${pre}Tor für ${team}` : `${pre}Tor`;
    }
    const full = String(g.scorer).trim();
    const last = full.split(/\s+/).slice(1).join(' ') || full;
    const tag = g.ownGoal ? ' (Eigentor)' : g.penalty ? ' (Elfmeter)' : '';
    for (const s of [pre + full + tag, pre + last + tag, pre + full, pre + last]) if (len(s) <= TEXT_W) return s;
    return abbr(pre + last, TEXT_W);
  }

  function redCardText(c, team) {
    const min = minuteText(c.minute);
    const pre = min ? `${min} ` : '';
    if (!c.player) return team ? `${pre}Platzverweis für ${team}` : `${pre}Platzverweis`;
    const full = String(c.player).trim();
    const last = full.split(/\s+/).slice(1).join(' ') || full;
    const club = team ? ` (${team})` : '';
    for (const s of [pre + full + club, pre + last + club, pre + full, pre + last]) if (len(s) <= TEXT_W) return s;
    return abbr(pre + last, TEXT_W);
  }

  function pageNumber(c) {
    if (c.type === 'conference') return CONFERENCE_PAGE;
    const id = c.competition && c.competition.id;
    return PAGES[id] || 250;
  }

  // ---------------------------------------------------------------- Seitenbausteine

  // " 250 Tor-Text  Sa 10.10. 16:42:13" – genau 33 Zeichen
  function headerLine(page, d) {
    return new Line()
      .put(' ')
      .text(String(page).slice(0, 3))
      .color(Y)
      .text('Tor-Text')
      .put(' ')
      .color(W)
      .text(`${DAYS[d.getDay()]} ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.`)
      .color(Y)
      .text(`${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`)
      .done();
  }

  // Farbiges Band in doppelter Höhe: links der Titel (gelb), rechts ein Ereigniswort.
  // right = { text, alt (kürzer, falls der Titel sonst nicht passt), fg, flash, block (eigene
  // Hintergrundfarbe), small (normale Höhe) }
  function bandLine(titles, right, bandColor) {
    const l = new Line().color(bandColor).newBg().double().color(Y);
    const list = titles.filter(Boolean);
    // Zellen des rechten Teils: Steuerzellen + Wort + Rand; der Titel braucht davor eine Zelle Luft
    const tailOf = (r) => {
      if (!r) return 0;
      const block = r.block != null;
      return (block ? 3 : 1) + (r.small ? 1 : 0) + (r.flash ? 1 : 0) + len(r.text) + (block ? 2 : 1);
    };
    const roomFor = (r) => COLS - l.col - tailOf(r) - (r ? 1 : 0);
    if (right && right.alt && list.length && len(list[0]) > roomFor(right)) {
      const short = { ...right, text: right.alt };
      if (len(list[0]) <= roomFor(short)) right = short;
    }
    const room = roomFor(right);
    l.text(abbr(list.find((t) => len(t) <= room) || list[list.length - 1] || '', room));
    if (!right) return l.done();
    l.to(COLS - tailOf(right));
    if (right.small) l.normal();
    if (right.block != null) l.color(right.block).newBg();
    l.color(right.fg == null ? W : right.fg);
    if (right.flash) l.flashing();
    return l.text(right.text).done();
  }

  // "Augsburg - Bayern            2:1" – optional eine Seite farbig (die, die getroffen hat)
  function resultLine(home, away, score, hi) {
    const l = new Line();
    const s = scoreText(score);
    const start = COLS - 1 - s.length;
    const [h, a] = fitPair(home, away, start - 5);
    if (hi && hi[0] === 'home') l.color(hi[1]).text(h).color(W).text(`- ${a}`);
    else if (hi && hi[0] === 'away') l.put(' ').text(`${h} -`).color(hi[1]).text(a);
    else l.put(' ').text(`${h} - ${a}`);
    return l.to(start - 1).color(Y).text(s).done();
  }

  function infoLine(color, text) {
    return new Line().color(color).text(abbr(text, TEXT_W)).done();
  }

  function emptyLine() {
    return new Line().done();
  }

  // Fastext-Leiste: vier farbige Wörter, gleichmäßig verteilt. Jedes Wort ist ein Link; zum Link
  // gehören die Steuerzelle davor und eine Zelle danach (für die Hervorhebung bei Mausberührung).
  function fastextLine(items) {
    const l = new Line();
    const pads = items.map(() => 1);
    const width = () => items.reduce((n, it, i) => n + 1 + len(it.label) + pads[i], 0);
    for (let i = items.length - 1; i >= 0 && width() > COLS; i--) pads[i] = 0;
    const free = Math.max(0, COLS - width());
    const gaps = Math.max(1, items.length - 1);
    items.forEach((it, i) => {
      l.linkTo(it.id).color(it.color).text(it.label);
      if (pads[i]) l.put(' ');
      l.linkTo(null);
      if (i < items.length - 1) l.to(l.col + Math.floor(free / gaps) + (i < free % gaps ? 1 : 0));
    });
    return l.done();
  }

  function leagueLinks(comp) {
    const id = comp && comp.id;
    if (id == null || id === '') return [];
    const short = String(comp.short || '');
    return [
      {
        id: 'tabelle',
        label: 'Tabelle',
        color: G,
        url: `${FOTMOB}/leagues/${encodeURIComponent(id)}/table`,
        hint: 'Tabelle bei FotMob öffnen',
      },
      {
        id: 'liga',
        label: short && len(short) <= 5 ? short : 'Liga',
        color: Y,
        url: `${FOTMOB}/leagues/${encodeURIComponent(id)}/overview`,
        hint: 'Wettbewerb bei FotMob öffnen',
      },
    ];
  }

  function fastextItems(c, comp) {
    const items = [];
    if (c.type === 'conference') {
      items.push({ id: 'heute', label: 'Heute', color: R, url: FOTMOB, hint: 'Alle Spiele von heute bei FotMob' });
    } else if (c.url) {
      items.push({ id: 'spiel', label: 'Spiel', color: R, url: c.url, hint: 'Spiel bei FotMob öffnen' });
    }
    items.push(...leagueLinks(comp));
    items.push({ id: 'zu', label: 'Schließen', color: C, close: true, hint: 'Schließen' });
    return items;
  }

  // ---------------------------------------------------------------- Seiten je Kartentyp

  // Was auf einer Einzelkarte (Tor, Anpfiff, …) steht – noch ohne Zeilen.
  function singleSpec(c, shownAt) {
    const side = c.side === 'home' || c.side === 'away' ? c.side : null;
    const team = String(c.team || (side ? teamName(c[side]) : '') || '');
    const spec = {
      band: B,
      right: null,
      hi: null, // [Seite, Farbe]: wer getroffen hat, steht im Ergebnis gelb
      info: [], // [Farbe, Text] unter dem Ergebnis
      sentence: (c.text && c.text.sentence) || '',
      demo: c.demo ? (c.type === 'goal' ? 'Test: so sieht ein Tor aus' : 'Test: so sieht es aus') : '',
    };
    const info = spec.info;
    switch (c.type) {
      case 'goal': {
        const fav = !!c.favorite && !c.conceded;
        if (fav) spec.band = R;
        spec.right = c.conceded
          ? { text: 'Gegentor' }
          : { text: fav ? 'TOOOR!' : 'TOR!', fg: fav ? Y : W, flash: true };
        if (side) spec.hi = [side, Y];
        info.push([C, scorerText(c, team)]);
        if (c.varPending) info.push([M, 'Videobeweis läuft ...']);
        else if (c.reinstated) info.push([G, 'Tor zählt doch']);
        break;
      }
      case 'disallowed': {
        spec.right = { text: 'Aberkannt' };
        info.push([C, team ? `Kein Tor für ${team}` : 'Tor zurückgenommen']);
        const p = Array.isArray(c.prev) ? `${c.prev[0]}:${c.prev[1]}` : '';
        if (!spec.sentence && p) spec.sentence = `Das ${p} zählt nicht.`;
        break;
      }
      case 'missed': {
        const mi = c.missed || {};
        const n = (Number(mi.home) || 0) + (Number(mi.away) || 0);
        const min = String(c.minute || '');
        if (/^ende$/i.test(min)) spec.right = { text: 'Endstand' };
        else if (/halbzeit|pause/i.test(min)) spec.right = { text: 'Halbzeit' };
        else if (minuteText(min)) spec.right = { text: `${minuteText(min)} Min.` };
        info.push([C, n === 1 ? '1 Tor verpasst' : `${n} Tore verpasst`]);
        const parts = [];
        if (mi.home) parts.push(`+${mi.home} ${abbr(teamName(c.home), 12)}`);
        if (mi.away) parts.push(`+${mi.away} ${abbr(teamName(c.away), 12)}`);
        if (parts.length) info.push([W, parts.join(', ')]);
        break;
      }
      case 'kickoff':
        spec.right = { text: 'Anpfiff' };
        info.push([C, `Angepfiffen um ${clock(shownAt)} Uhr`]);
        break;
      case 'halftime':
        spec.right = { text: 'Halbzeit' };
        break;
      case 'fulltime':
        spec.right = { text: 'Abpfiff' };
        break;
      case 'redcard':
        spec.right = c.yellowRed ? { text: 'Gelb-Rot', block: R } : { text: 'Rote Karte', alt: 'Rot', block: R };
        info.push([C, redCardText(c, team)]);
        break;
      default:
        break;
    }
    return spec;
  }

  // Einzelkarte: Band + Inhaltszeilen (Ergebnis, Infos, Satz, ggf. Test-Hinweis in der letzten Zeile)
  function singlePages(c, bodyRows, shownAt) {
    const comp = c.competition || {};
    const spec = singleSpec(c, shownAt);
    const body = [resultLine(teamName(c.home), teamName(c.away), c.score, spec.hi)];
    for (const [col, t] of spec.info) body.push(infoLine(col, t));
    const room = bodyRows - body.length - (spec.demo ? 1 : 0);
    for (const s of sentenceLines(spec.sentence, TEXT_W, room)) body.push(infoLine(W, s));
    const rows = body.slice(0, spec.demo ? bodyRows - 1 : bodyRows);
    if (spec.demo) rows.push(infoLine(M, spec.demo));
    while (rows.length < bodyRows) rows.push(emptyLine());
    return { pages: [{ band: bandLine([comp.name, comp.short, 'Fußball'], spec.right, spec.band), body: rows }] };
  }

  // Konferenz: live zuerst, dann noch nicht angepfiffen, dann beendet – jeweils nach Anstoßzeit,
  // gruppiert nach Wettbewerb (Gruppen mit Live-Spielen zuerst).
  function groupMatches(list) {
    const t = (m) => {
      const v = Date.parse(m.startUtc);
      return Number.isFinite(v) ? v : Infinity;
    };
    const r = (m) => (m.status in RANK ? RANK[m.status] : 4);
    const sorted = (list || []).filter(Boolean).slice().sort((a, b) => r(a) - r(b) || t(a) - t(b));
    const groups = new Map();
    for (const m of sorted) {
      const comp = m.competition || {};
      const key = comp.id != null ? comp.id : comp.name || '';
      if (!groups.has(key)) groups.set(key, { comp, matches: [] });
      groups.get(key).matches.push(m);
    }
    const order = (g) => {
      const i = COMP_ORDER.indexOf(g.comp.id);
      return i < 0 ? COMP_ORDER.length : i;
    };
    const live = (g) => (g.matches.some((m) => m.status === 'live') ? 0 : 1);
    return [...groups.values()].sort((a, b) => live(a) - live(b) || order(a) - order(b));
  }

  // "Augsburg - Bayern     2:1   67." – Ergebnis gelb, Minute/Anstoß cyan, rechtsbündig
  function matchLine(m) {
    const l = new Line();
    const pre = m.status === 'pre' || m.status === 'cancelled';
    const s = pre ? '-:-' : scoreText(m.score);
    const st = stateText(m).slice(0, 5);
    const start = COLS - 1 - 5 - 1 - s.length; // Ergebnis endet vor der Steuerzelle der Minute
    const [h, a] = fitPair(teamName(m.home), teamName(m.away), start - 5);
    l.put(' ').text(`${h} - ${a}`);
    l.to(start - 1).color(Y).text(s).color(C).text(st.padStart(5));
    return l.done();
  }

  function groupLine(comp) {
    return infoLine(G, comp.name || comp.short || 'Weitere Spiele');
  }

  // Zeilen der Konferenz, auf Unterseiten zu höchstens bodyRows Zeilen verteilt. Geht eine Gruppe
  // auf der nächsten Seite weiter, steht ihre Überschrift dort noch einmal; eine Überschrift bleibt
  // nie allein unten stehen.
  function conferenceChunks(c, bodyRows) {
    const groups = groupMatches(c.matches);
    const multi = groups.length > 1;
    const chunks = [];
    let cur = [];
    for (const g of groups) {
      for (let i = -1; i < g.matches.length; i++) {
        if (i < 0 && !multi) continue;
        const head = i < 0;
        if (cur.length >= bodyRows || (head && cur.length >= bodyRows - 1)) {
          chunks.push(cur);
          cur = multi && !head ? [{ g }] : [];
        }
        cur.push(head ? { g } : { g, m: g.matches[i] });
      }
    }
    if (cur.length || !chunks.length) chunks.push(cur);
    return { groups, chunks };
  }

  // Wie viele Inhaltszeilen eine Konferenz-Seite braucht: alles auf einer Seite, wenn es passt –
  // sonst so wenige Unterseiten wie möglich, gleichmäßig gefüllt.
  function conferenceRows(c) {
    const all = conferenceChunks(c, 1000).chunks[0].length;
    if (all <= MAX_BODY) return Math.max(2, all || 1);
    const pages = conferenceChunks(c, MAX_BODY).chunks.length;
    for (let rows = Math.ceil(all / pages); rows < MAX_BODY; rows++) {
      if (conferenceChunks(c, rows).chunks.length <= pages) return rows;
    }
    return MAX_BODY;
  }

  function conferencePages(c, bodyRows) {
    const { groups, chunks } = conferenceChunks(c, bodyRows);
    const comp = groups.length === 1 ? groups[0].comp : null;
    const titles = comp ? [comp.name, comp.short, 'Alle Spiele'] : ['Alle Spiele'];
    return {
      pages: chunks.map((chunk, i) => {
        const body = chunk.map((r) => (r.m ? matchLine(r.m) : groupLine(r.g.comp)));
        if (!groups.length && i === 0) body.push(infoLine(W, 'Heute keine Spiele.'));
        while (body.length < bodyRows) body.push(emptyLine());
        const right = chunks.length > 1 ? { text: `${i + 1}/${chunks.length}`, small: true } : null;
        return { band: bandLine(titles, right, B), body: body.slice(0, bodyRows) };
      }),
      comp: groups.length ? groups[0].comp : null,
    };
  }

  // Wie viele Inhaltszeilen die Seite bekommt – fest ab mount(), denn danach steht die Fenstergröße.
  // Beim Tor sind immer zwei Zeilen für den Satz frei: Torschütze und Satz kommen oft erst nach.
  function bodyRowsFor(c, shownAt) {
    if (c.type === 'conference') return conferenceRows(c);
    const spec = singleSpec(c, shownAt);
    const fixed = 1 + spec.info.length + (spec.demo ? 1 : 0);
    if (c.type === 'goal' || !c.type) return fixed + 2;
    return Math.max(2, Math.min(6, fixed + sentenceLines(spec.sentence, TEXT_W, 3).length));
  }

  // Ganze Seite für einen Zeitpunkt: Kopfzeile, Band, Inhalt, Fastext
  function compose(c, { bodyRows, shownAt = new Date() }) {
    if (c.type === 'conference') {
      const r = conferencePages(c, bodyRows);
      const items = fastextItems(c, r.comp);
      return { pages: r.pages, items, fast: fastextLine(items), pageNo: pageNumber(c) };
    }
    const r = singlePages(c, bodyRows, shownAt);
    const items = fastextItems(c, c.competition);
    return { pages: r.pages, items, fast: fastextLine(items), pageNo: pageNumber(c) };
  }

  function linesAt(layout, now, sub) {
    const p = layout.pages[sub % layout.pages.length];
    return [headerLine(layout.pageNo, now), p.band, ...p.body, layout.fast];
  }

  // ---------------------------------------------------------------- Zeichnen

  let state = null;

  function elapsed() {
    const n = state.api && typeof state.api.now === 'function' ? Number(state.api.now()) : NaN;
    return Number.isFinite(n) ? n : performance.now() - state.t0;
  }

  // Die Seite wird in Bildschirmpunkten des Rasters gezeichnet (1 Einheit = 1 CSS-Pixel) und dann
  // ohne Weichzeichnen auf die echte Pixeldichte vergrößert – bei 125 % oder 150 % bleibt alles scharf.
  function paint(lines, flashOn) {
    const s = state;
    const tt = font();
    const g = s.off.getContext('2d');
    g.fillStyle = PALETTE[K];
    g.fillRect(0, 0, PAGE_W, s.height);
    let y = PAD;
    for (const line of lines) {
      const k = line.big ? 2 : 1;
      line.cells.forEach((cell, i) => {
        const x = PAD + i * CW;
        let { fg, bg } = cell;
        const link = cell.link && s.links[cell.link];
        if (link && s.hover === cell.link) {
          bg = link.color;
          fg = K;
        }
        if (bg !== K) {
          g.fillStyle = PALETTE[bg];
          g.fillRect(x, y, CW, CH * k);
        }
        if (cell.ch === ' ' || (cell.flash && !flashOn)) return;
        tt.draw(g, cell.ch, x, y, { color: PALETTE[fg], doubleHeight: cell.dh && line.big });
      });
      y += CH * k;
    }
    const ctx = s.canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
    ctx.drawImage(s.off, 0, 0, s.canvas.width, s.canvas.height);
  }

  function render(force) {
    if (!state) return;
    const s = state;
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== s.dpr) {
      s.dpr = dpr;
      s.canvas.width = Math.round(PAGE_W * dpr);
      s.canvas.height = Math.round(s.height * dpr);
      force = true;
    }
    const now = new Date();
    const flashOn = (performance.now() - s.t0) % FLASH_PERIOD < FLASH_ON;
    const sub = Math.floor(Math.max(0, elapsed()) / SUBPAGE_MS) % s.layout.pages.length;
    const key = `${Math.floor(now.getTime() / 1000)}|${flashOn}|${sub}|${s.hover}|${s.version}`;
    if (!force && key === s.key) return;
    s.key = key;
    s.lines = linesAt(s.layout, now, sub);
    paint(s.lines, flashOn);
  }

  // Nächstes Neuzeichnen genau dann, wenn sich etwas ändert: Sekunde der Uhr, Blinken, Unterseite.
  function tick() {
    if (!state) return;
    render(false);
    const s = state;
    let wait = 1000 - (Date.now() % 1000);
    if (s.layout.flashing) {
      const f = (performance.now() - s.t0) % FLASH_PERIOD;
      wait = Math.min(wait, f < FLASH_ON ? FLASH_ON - f : FLASH_PERIOD - f);
    }
    if (s.layout.pages.length > 1) wait = Math.min(wait, SUBPAGE_MS - (Math.max(0, elapsed()) % SUBPAGE_MS));
    clearTimeout(s.timer);
    s.timer = setTimeout(tick, Math.max(4, Math.ceil(wait) + 2));
  }

  const onResize = () => render(false); // Zoom geändert -> neue Pixeldichte

  function relayout() {
    const s = state;
    s.layout = compose(s.card, { bodyRows: s.bodyRows, shownAt: s.shownAt });
    s.layout.flashing = s.layout.pages.some((p) => [p.band, ...p.body].some((l) => l.cells.some((c) => c.flash)));
    s.links = {};
    for (const it of s.layout.items) s.links[it.id] = it;
    s.version++;
    // Für Screenreader: die Seite als Text
    const text = linesAt(s.layout, new Date(), 0)
      .slice(1)
      .map((l) => l.toString().trim())
      .filter(Boolean)
      .join('. ');
    s.canvas.setAttribute('aria-label', text);
  }

  // Welcher Link liegt unter der Maus? (nur die Fastext-Zeile hat welche)
  function linkAt(e) {
    const s = state;
    if (!s || !s.lines) return null;
    const r = s.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) * PAGE_W) / (r.width || PAGE_W) - PAD;
    const y = ((e.clientY - r.top) * s.height) / (r.height || s.height) - PAD;
    if (x < 0 || y < 0) return null;
    const col = Math.floor(x / CW);
    let top = 0;
    for (const line of s.lines) {
      const h = CH * (line.big ? 2 : 1);
      if (y < top + h) {
        const cell = line.cells[col];
        return cell && cell.link && s.links[cell.link] ? cell.link : null;
      }
      top += h;
    }
    return null;
  }

  function onMove(e) {
    if (!state) return;
    const id = linkAt(e);
    if (id === state.hover) return;
    state.hover = id;
    state.canvas.style.cursor = id || state.card.url ? 'pointer' : 'default';
    state.canvas.title = id ? state.links[id].hint || '' : '';
    render(true);
  }

  function onLeave() {
    if (!state || !state.hover) return;
    state.hover = null;
    state.canvas.title = '';
    render(true);
  }

  // Fastext-Klicks erledigt das Design selbst; alles andere geht an popup.js (Spiel öffnen).
  function onClick(e) {
    if (!state) return;
    const id = linkAt(e);
    if (!id) return;
    e.stopPropagation();
    const it = state.links[id];
    if (it.close) state.api.close();
    else if (it.url) state.api.open(it.url);
  }

  // ---------------------------------------------------------------- Schnittstelle

  function mount(root, card, api) {
    destroy();
    if (!font()) throw new Error('Videotext-Schrift (teletext-font.js) fehlt');
    const canvas = document.createElement('canvas');
    canvas.className = 'videotext';
    canvas.setAttribute('role', 'img');
    canvas.style.display = 'block';
    canvas.style.imageRendering = 'pixelated';
    canvas.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.35)';
    canvas.style.cursor = card && card.url ? 'pointer' : 'default';

    const shownAt = new Date();
    const bodyRows = bodyRowsFor(card || {}, shownAt);
    const height = (1 + 2 + bodyRows + 1) * CH + 2 * PAD;
    canvas.style.width = `${PAGE_W}px`;
    canvas.style.height = `${height}px`;
    const off = document.createElement('canvas');
    off.width = PAGE_W;
    off.height = height;

    state = { root, canvas, off, card: card || {}, api: api || {}, shownAt, t0: performance.now(), bodyRows,
      height, dpr: 0, key: '', hover: null, version: 0, layout: null, links: {}, lines: null, timer: null };
    relayout();
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    root.appendChild(canvas);
    window.addEventListener('resize', onResize);
    render(true);
    tick();
    return { width: WIDTH, height: height + 16 };
  }

  function update(card) {
    if (!state || !card) return;
    state.card = card;
    relayout();
    render(true);
    tick();
  }

  // Das Bild bleibt stehen (popup.js blendet es noch aus) – nur Uhr und Maus hören auf.
  function destroy() {
    if (!state) return;
    clearTimeout(state.timer);
    window.removeEventListener('resize', onResize);
    state.canvas.removeEventListener('click', onClick);
    state.canvas.removeEventListener('mousemove', onMove);
    state.canvas.removeEventListener('mouseleave', onLeave);
    state = null;
  }

  const design = { mount, update, destroy };
  if (typeof window !== 'undefined') {
    window.TA_DESIGNS = window.TA_DESIGNS || {};
    window.TA_DESIGNS.videotext = design;
  }
  // Für die Tests unter Node
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      design, Line, COLS, PALETTE, compose, linesAt, bodyRowsFor, headerLine, bandLine, resultLine, matchLine,
      fastextLine, fastextItems, minuteText, stateText, scorerText, redCardText, sentenceLines, wrapWords,
      abbr, fitPair, groupMatches, pageNumber,
    };
  }
})();
