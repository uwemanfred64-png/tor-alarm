// Design "ticker": ein einzelner Eintrag aus dem Liveticker einer Sportseite.
// Links die Minute und was passiert ist, rechts Überschrift, Spielstand mit Wappen, ein Satz und
// klein der Wettbewerb. Reines DOM – außer den Vereinswappen und der roten Karte keine Bilder.

(() => {
  const WIDTH = 400; // Fensterbreite inkl. 8 px Rand rundum – die Box selbst ist 384 px breit
  const MARGIN = 16;
  const MAX_HEIGHT = 420;
  const MAX_ROWS = 9; // Konferenz: weitere Spiele werden nur noch gezählt
  const WAIT_TEXT = 'Torschütze wird gerade eingetragen …';

  // Reihenfolge der Wettbewerbe in der Konferenz (wie COMPETITIONS in feed.js)
  const COMP_ORDER = [54, 146, 208, 9676, 209, 42, 73, 10216];
  const CUP_IDS = [209]; // im Pokal heißt es "Runde" statt "Spieltag"

  // FotMob schreibt K.-o.-Runden teils englisch
  const ROUNDS = {
    final: 'Finale',
    'semi-final': 'Halbfinale',
    semifinal: 'Halbfinale',
    '1/2': 'Halbfinale',
    'quarter-final': 'Viertelfinale',
    quarterfinal: 'Viertelfinale',
    '1/4': 'Viertelfinale',
    'round of 16': 'Achtelfinale',
    '1/8': 'Achtelfinale',
    'play-off': 'Play-offs',
    playoff: 'Play-offs',
  };

  // Spielstand-Wörter für die Konferenz-Liste (schmale Spalte)
  const STATE_WORDS = {
    halbzeit: 'Halbzeit',
    pause: 'Pause',
    ende: 'Ende',
    'verlängerung': 'Verl.',
    'elfmeterschießen': 'Elfm.',
    'n. v.': 'n. V.',
    unterbrochen: 'unterbr.',
  };

  const RANK = { live: 0, pre: 1, done: 2, cancelled: 3 };

  // ---------------------------------------------------------------- Texte

  const pad = (n) => String(n).padStart(2, '0');
  const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const teamName = (t) => (t && (t.name || t.full)) || '?';
  const scoreStr = (s) => (Array.isArray(s) ? `${s[0]}:${s[1]}` : '');
  const goalsText = (n) => (n === 1 ? '1 Tor' : `${n} Tore`);

  // "78" -> "78'", "45+2" -> "45.+2'"; Wörter wie "Halbzeit" -> ''
  function minuteText(min) {
    const s = String(min == null ? '' : min).replace(/['’‎‏]/g, '').replace(/\s+/g, '');
    const m = /^(\d{1,3})(?:\+(\d{1,2}))?$/.exec(s);
    if (!m) return '';
    return m[2] ? `${m[1]}.+${m[2]}'` : `${m[1]}'`;
  }

  function kickoffText(utc) {
    const t = Date.parse(utc);
    return Number.isFinite(t) ? clock(new Date(t)) : '';
  }

  // Rechte Spalte der Konferenz: Minute, Halbzeit, Ende oder Anstoßzeit
  function stateText(m) {
    const min = String(m.minute || '').trim();
    if (m.status === 'pre') return kickoffText(m.startUtc);
    if (m.status === 'cancelled') return 'abgesagt';
    if (m.status === 'done') return min.toLowerCase() === 'n. v.' ? 'n. V.' : 'Ende';
    return minuteText(min) || STATE_WORDS[min.toLowerCase()] || '';
  }

  // "Bundesliga, 5. Spieltag" / "DFB-Pokal, 2. Runde"
  function roundText(c) {
    const comp = c.competition || {};
    const r = c.round == null ? '' : String(c.round).trim();
    let round = '';
    if (/^\d+$/.test(r)) round = `${r}. ${CUP_IDS.includes(comp.id) ? 'Runde' : 'Spieltag'}`;
    else if (r) round = ROUNDS[r.toLowerCase()] || r;
    return [comp.name || comp.short, round].filter(Boolean).join(', ');
  }

  // Zeit oben links: Spielminute bei Toren und Karten, sonst die Uhrzeit des Eintrags
  // (wie im Ticker: "17:22 Abpfiff"). Verpasste Tore zeigen, wie weit das Spiel ist.
  function sideTime(c, at) {
    const inGame = c.type === 'goal' || c.type === 'disallowed' || c.type === 'redcard' || c.type === 'missed';
    const m = minuteText((c.type === 'goal' && c.goal && c.goal.minute) || c.minute);
    if (inGame && m) return m;
    if (c.type === 'missed') {
      const w = String(c.minute || '').toLowerCase();
      if (w === 'ende' || w === 'n. v.') return 'Ende';
      if (w === 'halbzeit' || w === 'pause') return 'Pause';
    }
    return clock(at);
  }

  // Kurzname der Mannschaft, um die es geht
  function sideName(c) {
    if (c.team) return c.team;
    if (c.side === 'home' || c.side === 'away') return teamName(c[c.side]);
    return '';
  }

  // Überschrift und Satz kommen aus texts.js (card.text) – hier nur ein schlichter Ersatz,
  // falls sie einmal fehlen.
  function headlineOf(c) {
    const h = c.text && c.text.headline;
    const t = sideName(c);
    const fuer = (word) => (t ? `${word} für ${t}` : word);
    if (c.type === 'goal' && c.favorite && !c.reinstated && !/tooo+r/i.test(h || '')) return t ? `TOOOR für ${t}!` : 'TOOOR!';
    if (h) return h;
    switch (c.type) {
      case 'goal':
        return c.conceded ? 'Gegentor' : c.reinstated ? 'Tor zählt doch' : fuer('Tor');
      case 'disallowed':
        return fuer('Kein Tor');
      case 'missed':
        return 'Verpasste Tore';
      case 'kickoff':
        return 'Anpfiff';
      case 'halftime':
        return 'Halbzeit';
      case 'fulltime':
        return 'Abpfiff';
      case 'redcard':
        return fuer('Rote Karte');
      case 'conference':
        return 'Alle Spiele';
      default:
        return '';
    }
  }

  function sentenceOf(c) {
    const s = c.text && c.text.sentence;
    if (s) return s;
    const sc = scoreStr(c.score);
    const g = c.goal || {};
    switch (c.type) {
      case 'goal':
        if (g.scorer && g.ownGoal) return `Eigentor von ${g.scorer} – ${sc}.`;
        if (g.scorer && g.penalty) return `${g.scorer} verwandelt den Elfmeter zum ${sc}.`;
        if (g.scorer) return `${g.scorer} trifft zum ${sc}.`;
        return sideName(c) ? `${sideName(c)} trifft zum ${sc}.` : '';
      case 'disallowed':
        return Array.isArray(c.prev) ? `Das ${scoreStr(c.prev)} zählt nicht.` : '';
      case 'halftime':
        return sc ? `Pausenstand ${sc}.` : '';
      case 'fulltime':
        return sc ? `Endstand ${sc}.` : '';
      case 'redcard':
        return c.player ? `${c.player} muss vom Platz.` : '';
      case 'conference':
        return 'Heute kein Spiel.';
      default:
        return '';
    }
  }

  // Ereignis-Kennzeichnung unter der Minute. Farbig ist nur das Tor (bzw. die rote Karte).
  function kindOf(c, headline) {
    switch (c.type) {
      case 'goal':
        return { text: 'Tor', red: !c.conceded };
      case 'disallowed':
        return { text: 'VAR' };
      case 'missed':
        return null; // Überschrift und Liste sagen es schon, links steht nur der Spielstand-Zeitpunkt
      case 'redcard':
        return { card: true };
      default: {
        // Anpfiff/Halbzeit/Abpfiff: steht schon als Überschrift da – nicht doppelt
        const word = { kickoff: 'Anpfiff', halftime: 'Halbzeit', fulltime: 'Abpfiff' }[c.type];
        return word && word.toLowerCase() !== String(headline).toLowerCase() ? { text: word } : null;
      }
    }
  }

  // Verpasste Tore: wer wie oft getroffen hat
  function missedLines(c) {
    const m = c.missed || {};
    const out = [];
    if (m.home > 0) out.push(`${goalsText(m.home)} für ${teamName(c.home)}`);
    if (m.away > 0) out.push(`${goalsText(m.away)} für ${teamName(c.away)}`);
    return out;
  }

  // Konferenz: nach Wettbewerb gruppiert (Gruppen mit Live-Spielen zuerst), darin
  // live – noch nicht angepfiffen – beendet, jeweils nach Anstoßzeit.
  function sortMatches(list) {
    const t = (m) => {
      const v = Date.parse(m.startUtc);
      return Number.isFinite(v) ? v : Infinity;
    };
    const r = (m) => (m.status in RANK ? RANK[m.status] : 4);
    return list.slice().sort((a, b) => r(a) - r(b) || t(a) - t(b));
  }

  function groupMatches(list) {
    const groups = new Map();
    for (const m of sortMatches(list || [])) {
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

  // ---------------------------------------------------------------- DOM

  let state = null; // { root, box, card, api, at }

  // api.open(url) / api.close() – nach destroy() oder ohne api passiert einfach nichts
  function callApi(name, arg) {
    const api = state && state.api;
    if (api && typeof api[name] === 'function') api[name](arg);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = text;
    return e;
  }

  // Wappen, 16 px. Lädt es nicht, verschwindet es – in Listen bleibt der Platz frei,
  // damit die Namen untereinander stehen.
  function crest(team, keepSpace) {
    if (!team || !team.logo) return keepSpace ? el('span', 'tk-crest tk-crest-none') : null;
    const img = el('img', 'tk-crest');
    img.alt = '';
    img.width = 16;
    img.height = 16;
    img.draggable = false;
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.classList.add(keepSpace ? 'tk-crest-blank' : 'tk-crest-gone'));
    img.src = team.logo;
    return img;
  }

  // Ergebnis am Doppelpunkt ausgerichtet: "2:1", "10:2", "-:-"
  function result(home, away) {
    const r = el('span', 'tk-res');
    r.append(el('span', 'tk-rh', String(home)), ':', el('span', 'tk-ra', String(away)));
    return r;
  }

  // "[Wappen] Augsburg – [Wappen] Bayern  2:1" – umbrochen wird nur zwischen den Mannschaften
  function scoreLine(c) {
    const line = el('div', 'tk-score');
    const home = el('span', 'tk-team');
    const away = el('span', 'tk-team');
    const hc = crest(c.home);
    const ac = crest(c.away);
    if (hc) home.appendChild(hc);
    home.append(el('span', 'tk-name', teamName(c.home)), ' –');
    if (ac) away.appendChild(ac);
    away.appendChild(el('span', 'tk-name', teamName(c.away)));
    if (c.type === 'disallowed' && Array.isArray(c.prev)) away.appendChild(el('s', 'tk-prev', scoreStr(c.prev)));
    if (Array.isArray(c.score)) away.appendChild(el('b', 'tk-final', scoreStr(c.score)));
    line.append(home, ' ', away);
    return line;
  }

  function renderEntry(box, c) {
    const body = el('div', 'tk-body');
    const side = el('div', 'tk-side');
    const main = el('div', 'tk-main');
    const headline = headlineOf(c);

    const min = el('div', 'tk-min', sideTime(c, state.at));
    side.appendChild(min);
    const kind = kindOf(c, headline);
    if (kind && kind.card) side.appendChild(el('span', 'tk-redcard'));
    else if (kind) side.appendChild(el('div', kind.red ? 'tk-kind tk-kind-red' : 'tk-kind', kind.text));
    if (c.varPending) side.appendChild(el('div', 'tk-var', 'VAR prüft'));

    main.appendChild(el('div', 'tk-head', headline));
    main.appendChild(scoreLine(c));
    const lines = c.type === 'missed' ? missedLines(c) : [];
    if (lines.length) {
      for (const l of lines) main.appendChild(el('div', 'tk-mline', l));
    } else {
      const pending = c.type === 'goal' && c.pending && !(c.goal && c.goal.scorer);
      const text = pending ? WAIT_TEXT : sentenceOf(c);
      if (text) main.appendChild(el('div', pending ? 'tk-text tk-wait' : 'tk-text', text));
    }

    body.append(side, main);
    box.appendChild(body);
    fitMinute(min);
  }

  // Lange Minuten ("90.+4'", "120.+2'") und Uhrzeiten werden kleiner, bis sie in die Spalte passen.
  function fitMinute(min) {
    for (const px of [18, 17, 16, 15, 14, 13]) {
      min.style.fontSize = `${px}px`;
      if (min.scrollWidth <= min.clientWidth) return;
    }
  }

  function teamCell(team, reds) {
    const t = el('span', 'tk-t');
    t.append(crest(team, true), el('span', 'tk-name', teamName(team)));
    for (let i = 0; i < Math.min(Number(reds) || 0, 3); i++) t.appendChild(el('span', 'tk-rc'));
    return t;
  }

  function matchRow(m, c) {
    const row = el('div', 'tk-row');
    const notYet = m.status === 'pre' || m.status === 'cancelled';
    if (notYet) row.classList.add('tk-row-pre');
    const reds = m.redCards || [];
    const teams = el('span', 'tk-teams');
    teams.append(teamCell(m.home, reds[0]), el('span', 'tk-dash', '–'), teamCell(m.away, reds[1]));
    const s = Array.isArray(m.score) ? m.score : ['-', '-'];
    const st = stateText(m);
    // laufende Minute rot wie auf den Ergebnisseiten, "Halbzeit" & Co. grau
    const stEl = el('span', m.status === 'live' && /^\d/.test(st) ? 'tk-state tk-state-live' : 'tk-state', st);
    row.append(teams, notYet ? result('-', '-') : result(s[0], s[1]), stEl);
    const url = m.url || c.url;
    if (url) {
      row.classList.add('tk-row-link');
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        callApi('open', url);
      });
    }
    return row;
  }

  function renderConference(box, c) {
    const head = el('div', 'tk-chead');
    head.appendChild(el('div', 'tk-head', headlineOf(c)));
    box.appendChild(head);

    const list = el('div', 'tk-list');
    const all = Array.isArray(c.matches) ? c.matches : [];
    const groups = groupMatches(all);
    let shown = 0;
    for (const g of groups) {
      if (shown >= MAX_ROWS) break;
      if (groups.length > 1) list.appendChild(el('div', 'tk-group', g.comp.name || g.comp.short || 'Weitere Spiele'));
      for (const m of g.matches) {
        if (shown >= MAX_ROWS) break;
        list.appendChild(matchRow(m, c));
        shown++;
      }
    }
    if (!all.length) list.appendChild(el('div', 'tk-empty', sentenceOf(c)));
    else if (all.length > shown) {
      const n = all.length - shown;
      list.appendChild(el('div', 'tk-more', `und ${n} ${n === 1 ? 'weiteres Spiel' : 'weitere Spiele'}`));
    }
    box.appendChild(list);
  }

  // Konferenz: der Wettbewerb steht nur unten, wenn es keine Zwischenüberschriften gibt
  function confMeta(c) {
    const groups = groupMatches(c.matches);
    const comp = groups.length === 1 ? groups[0].comp.name || groups[0].comp.short : '';
    const stand = `Stand: ${clock(state.at)} Uhr`;
    return comp ? `${comp}, ${stand}` : stand;
  }

  function renderFoot(box, c) {
    const foot = el('div', 'tk-foot');
    let meta = c.type === 'conference' ? confMeta(c) : roundText(c);
    if (c.demo) meta = meta ? `Test – ${meta}` : 'Test';
    foot.appendChild(el('span', 'tk-meta', meta));
    const x = el('button', 'tk-x', '×');
    x.type = 'button';
    x.title = 'Schließen';
    x.setAttribute('aria-label', 'Schließen');
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      callApi('close');
    });
    foot.appendChild(x);
    box.appendChild(foot);
  }

  function render() {
    const { box, card: c } = state;
    box.textContent = '';
    box.className = 'tk';
    if (c.type === 'conference') box.classList.add('tk-conf');
    else if (c.url) box.classList.add('tk-link');
    if (c.favorite) box.classList.add('tk-fav');
    if (c.conceded) box.classList.add('tk-muted');
    if (c.type === 'conference') renderConference(box, c);
    else renderEntry(box, c);
    renderFoot(box, c);
  }

  // Die Höhe steht nach dem ersten Zeichnen fest (das Fenster wächst nicht mit). Wird der Satz
  // nach dem Nachladen länger als geplant, wird er gekürzt statt abgeschnitten.
  function fit() {
    const body = state.box.querySelector('.tk-body');
    const text = state.box.querySelector('.tk-text');
    if (!body || !text) return;
    text.style.webkitLineClamp = '';
    for (let n = 3; n >= 1 && body.scrollHeight > body.clientHeight + 1; n--) text.style.webkitLineClamp = String(n);
  }

  function onClick() {
    if (state && state.card.url) callApi('open', state.card.url);
  }

  function mount(root, card, api) {
    destroy();
    const box = el('div', 'tk');
    state = { root, box, card, api, at: new Date() };
    root.textContent = '';
    // Ist die Hülle beim Aufbau noch versteckt, wird unsichtbar außerhalb gemessen und dann umgehängt.
    const hidden = !root.getClientRects().length;
    const holder = hidden ? document.body.appendChild(el('div', 'tk-measure')) : root;
    holder.appendChild(box);
    render();
    const h = Math.min(Math.ceil(box.getBoundingClientRect().height), MAX_HEIGHT - MARGIN);
    box.style.height = `${h}px`;
    fit();
    if (hidden) {
      root.appendChild(box);
      holder.remove();
    }
    box.addEventListener('click', onClick);
    return { width: WIDTH, height: h + MARGIN };
  }

  function update(card) {
    if (!state) return;
    state.card = card;
    render();
    fit();
  }

  // Das DOM bleibt stehen (popup.js blendet es noch aus) – nur die Klicks hören auf.
  function destroy() {
    if (!state) return;
    state.box.removeEventListener('click', onClick);
    state = null;
  }

  const design = { mount, update, destroy };
  if (typeof window !== 'undefined') {
    window.TA_DESIGNS = window.TA_DESIGNS || {};
    window.TA_DESIGNS.ticker = design;
  }
  // Für die Tests unter Node
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      design, minuteText, stateText, roundText, sideTime, headlineOf, sentenceOf, kindOf, missedLines, sortMatches, groupMatches,
    };
  }
})();
