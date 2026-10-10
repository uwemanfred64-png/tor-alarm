// Design "tafel": LED-Anzeigetafel wie im Stadion – 128x36 Leuchtpunkte in einem mattschwarzen
// Gehäuse, darunter eine schmale Fußleiste (links Wettbewerb und Spieltag, rechts das ×).
// Zeile 1: Spielstand groß. Zeile 2: was passiert ist. Zeile 3: Details, bei Bedarf im Wechsel.

(() => {
  const COLS = 128;
  const ROWS = 36;
  const PITCH = 3;
  const SIZE = { width: 420, height: 158 }; // Gehäuse 404x142 + 8 px Rand rundum

  const Y1 = 1; // Zeile 1, doppelt hoch
  const Y2 = 19;
  const Y3 = 28;

  const TICK = 50; // 20 Bilder pro Sekunde reichen für eine Punkttafel
  const SCROLL_SPEED = 22; // Punkte pro Sekunde
  const SCROLL_GAP = 30;
  const PAGE = 3000; // Konferenz: so lange steht ein Spiel
  const FULLTIME_SWITCH = 4000; // Abpfiff: so lange steht "ABPFIFF", danach "ENDSTAND"

  const measure = (s, scale) => window.LED.measure(s, scale);

  // ------------------------------------------------------------ Texte

  const str = (v) => (v == null ? '' : String(v).trim());
  const two = (n) => String(n).padStart(2, '0');
  const clock = (d = new Date()) => `${two(d.getHours())}:${two(d.getMinutes())}`;

  // Kürzel für die große Zeile, wie auf der Tafel: drei Zeichen. Ohne Kürzel die ersten drei
  // Buchstaben des Namens – Akzente vorher weg, sonst fiele aus "Śląsk" das Ś heraus.
  function code(t) {
    const own = str(t && t.code);
    const c = own || window.LED.clean(str(t && (t.name || t.full))).replace(/[^A-Z0-9ÄÖÜ]/g, '');
    return c ? c.slice(0, 3) : '???';
  }

  function teamName(c) {
    if (str(c.team)) return str(c.team);
    const t = c.side === 'home' ? c.home : c.side === 'away' ? c.away : null;
    return str(t && (t.name || t.full));
  }

  const goals = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '-' : String(Number(v)));

  function minuteText(min) {
    const s = str(min).replace(/['’‎]/g, '');
    return /^\d/.test(s) ? `${s}'` : '';
  }

  function kickoff(utc) {
    const d = utc ? new Date(utc) : null;
    return d && !Number.isNaN(d.getTime()) ? clock(d) : '';
  }

  // Zeile 2 in der Konferenz: Minute, Halbzeit, Ende oder Anstoßzeit
  function statusText(m) {
    const min = str(m.minute);
    if (m.status === 'cancelled') return 'ABGESAGT';
    if (m.status === 'pre') {
      const t = kickoff(m.startUtc);
      return t ? `ANSTOSS ${t}` : 'NOCH NICHT ANGEPFIFFEN';
    }
    if (m.status === 'done' || /^ende$/i.test(min)) return 'ENDE';
    if (/halbzeit/i.test(min)) return 'HALBZEIT';
    return minuteText(min) || min || 'LÄUFT';
  }

  function competition(c) {
    const comp = c && c.competition;
    return str(comp && (comp.short || comp.name));
  }

  function roundText(c) {
    const r = str(c.round);
    if (!r) return '';
    if (/^\d+$/.test(r)) return c.competition && c.competition.id === 209 ? `${r}. Runde` : `${r}. Spieltag`;
    return { '1/8': 'Achtelfinale', '1/4': 'Viertelfinale', '1/2': 'Halbfinale', final: 'Finale' }[r.toLowerCase()] || r;
  }

  // Fußleiste links
  function footText(c) {
    if (c.type === 'conference') return 'Konferenz';
    if (c.demo) {
      if (c.type !== 'goal') return 'Test';
      return c.favorite ? 'Test – so sieht ein Tor deines Vereins aus' : 'Test – so sieht ein Tor aus';
    }
    const comp = c.competition && str(c.competition.name || c.competition.short);
    return [comp, roundText(c)].filter(Boolean).join(', ');
  }

  // ------------------------------------------------------------ Was auf der Tafel steht

  // Großes Wort am Anfang. Lieblingsverein: "TOOOR!" Buchstabe für Buchstabe, länger.
  function introOf(c) {
    if (c.type === 'goal') {
      if (c.conceded) return null;
      return c.favorite ? { word: 'TOOOR!', len: 3500, reveal: true } : { word: 'TOR!', len: 2300 };
    }
    // Aberkannt: kein Intro – warum (VAR, Abseits, Korrektur) steht nicht in den Daten
    if (c.type === 'redcard') return { word: c.yellowRed ? 'GELB-ROT' : 'ROT', len: 1800, fast: true };
    return null;
  }

  function line2(c, t) {
    const team = teamName(c);
    switch (c.type) {
      case 'goal':
        if (c.reinstated) return 'TOR ZÄHLT DOCH';
        if (c.conceded) return 'GEGENTOR';
        return team ? `TOR FÜR ${team}` : 'TOR';
      case 'disallowed':
        return team ? `KEIN TOR FÜR ${team}` : 'KEIN TOR';
      case 'missed':
        if (str(c.minute) === 'Ende') return 'ENDSTAND';
        if (/halbzeit/i.test(str(c.minute))) return 'HALBZEIT';
        return 'ZWISCHENSTAND';
      case 'kickoff':
        return 'ANPFIFF';
      case 'halftime':
        return 'HALBZEIT';
      case 'fulltime':
        return t < FULLTIME_SWITCH ? 'ABPFIFF' : 'ENDSTAND';
      case 'redcard': {
        const w = c.yellowRed ? 'GELB-ROT' : 'ROTE KARTE';
        return team ? `${w} ${team}` : w;
      }
      default:
        return str(c.text && c.text.headline);
    }
  }

  // Zeile 3 wechselt bei Bedarf zwischen mehreren Texten, wie auf einer echten Tafel.
  // key: bleibt gleich, auch wenn sich der Text ändert (Uhr) – sonst fängt der Wechsel von vorn an.
  function line3(c) {
    const min = minuteText((c.goal && c.goal.minute) || c.minute);
    switch (c.type) {
      case 'disallowed': {
        const s = Array.isArray(c.score) ? c.score : [0, 0];
        const p = Array.isArray(c.prev) ? c.prev : s.map((v, i) => Number(v) + ((c.side === 'home') === (i === 0) ? 1 : 0));
        return [{ text: `DAS ${goals(p[0])}:${goals(p[1])} ZÄHLT NICHT` }];
      }
      case 'missed': {
        const ms = c.missed || {};
        const n = (Number(ms.home) || 0) + (Number(ms.away) || 0);
        const out = [{ text: n === 1 ? '1 TOR VERPASST' : `${n} TORE VERPASST` }];
        if (ms.home) out.push({ text: `+${ms.home} ${str(c.home && c.home.name)}` });
        if (ms.away) out.push({ text: `+${ms.away} ${str(c.away && c.away.name)}` });
        return out;
      }
      case 'kickoff':
      case 'halftime':
      case 'fulltime': {
        const out = [];
        if (competition(c)) out.push({ text: competition(c), key: 'wettbewerb' });
        out.push({ text: `${clock()} UHR`, key: 'uhr' });
        return out;
      }
      case 'redcard': {
        const m = minuteText(c.minute);
        if (str(c.player)) return [{ text: `${m} ${str(c.player)}`.trim() }];
        if (m) return [{ text: m }];
        return competition(c) ? [{ text: competition(c) }] : [];
      }
      default: {
        const out = [];
        const g = c.goal;
        if (g && str(g.scorer)) {
          out.push({ text: `${min} ${str(g.scorer)}`.trim() });
          if (g.ownGoal) out.push({ text: 'EIGENTOR' });
          else if (g.penalty) out.push({ text: 'ELFMETER' });
          if (str(g.assist) && !g.ownGoal) out.push({ text: `VORLAGE ${str(g.assist)}` });
        } else if (min) {
          out.push({ text: min });
        }
        if (c.varPending) out.push({ text: 'VAR-CHECK', blink: true });
        return out;
      }
    }
  }

  function conferenceScene(c, t) {
    const list = Array.isArray(c.matches) ? c.matches.filter((m) => m && typeof m === 'object') : [];
    // Kein Spiel: die Tafel zeigt, wie im Stadion vor dem Spiel, einfach die Uhrzeit.
    if (!list.length) return { score: { big: clock() }, line2: 'HEUTE KEIN SPIEL', line3: [], page: '', url: null, t };
    const idx = Math.floor(Math.max(0, t) / PAGE) % list.length;
    const m = list[idx];
    const open = m.status === 'pre' || m.status === 'cancelled';
    const sc = Array.isArray(m.score) ? m.score : [];
    return {
      score: { left: code(m.home), right: code(m.away), hs: open ? '-' : goals(sc[0]), as: open ? '-' : goals(sc[1]) },
      line2: statusText(m),
      line3: competition(m) ? [{ text: competition(m), key: `seite-${idx}` }] : [],
      page: list.length > 1 ? `${idx + 1}/${list.length}` : '',
      url: typeof m.url === 'string' && m.url ? m.url : null,
      t: Math.max(0, t) % PAGE,
    };
  }

  // Alles, was zur Zeit t (ms seit Anzeige) auf der Tafel steht – ohne zu zeichnen.
  function scene(c, t) {
    if (c.type === 'conference') return conferenceScene(c, t);
    const intro = introOf(c);
    if (intro && t < intro.len) return { intro, t };
    const tl = t - (intro ? intro.len : 0);
    const sc = Array.isArray(c.score) ? c.score : [];
    const score = { left: code(c.home), right: code(c.away), hs: goals(sc[0]), as: goals(sc[1]) };
    // Die Zahl der Mannschaft, die gerade getroffen hat, blinkt kurz nach.
    const blinkFor = c.type === 'goal' && !c.conceded ? (c.favorite ? 3000 : 1800) : 0;
    if (tl < blinkFor && Math.floor(tl / 300) % 2 === 1) score.off = c.side;
    return { score, line2: line2(c, tl), line3: line3(c), page: '', url: c.url || null, t: tl };
  }

  // ------------------------------------------------------------ Zeichnen

  let board = null;
  let card = null;
  let api = null;
  let timer = null;
  let el = null;
  let shown = {};
  let current = null; // zuletzt gezeichnete Szene
  let optsKey = '';
  let optsSince = 0;

  function drawIntro(intro, t) {
    // So groß wie möglich (höchstens 4), aber nie breiter als die Tafel – "GELB-ROT" braucht kleiner
    let scale = 4;
    while (scale > 1 && measure(intro.word, scale) > COLS - 2) scale -= 1;
    const x = Math.round((COLS - measure(intro.word, scale)) / 2);
    const y = Math.round((ROWS - 7 * scale) / 2);
    if (intro.reveal) {
      // "TOOOR!" baut sich Buchstabe für Buchstabe auf und blinkt dann
      const step = 110;
      const n = Math.min(intro.word.length, 1 + Math.floor(t / step));
      if (n < intro.word.length) {
        board.text(intro.word.slice(0, n), x, y, { scale });
        return;
      }
      if ((t - step * (intro.word.length - 1)) % 560 < 380) board.text(intro.word, x, y, { scale });
      return;
    }
    const [period, on] = intro.fast ? [400, 260] : [560, 380];
    if (t % period < on) board.text(intro.word, x, y, { scale });
  }

  // Spielstand mittig, Kürzel links und rechts davon. Bei zweistelligen Ergebnissen rückt alles enger.
  function drawScore(s) {
    if (s.big) {
      board.text(s.big, Math.round((COLS - measure(s.big, 2)) / 2), Y1, { scale: 2 });
      return;
    }
    const w = { l: measure(s.left, 2), h: measure(s.hs, 2), c: measure(':', 2), a: measure(s.as, 2), r: measure(s.right, 2) };
    let lay = null;
    for (const [gap, cg] of [[7, 4], [6, 3], [5, 3], [5, 2], [4, 2], [3, 2], [2, 1]]) {
      const scoreW = w.h + cg + w.c + cg + w.a;
      const sx = Math.round((COLS - scoreW) / 2);
      lay = { gap, cg, scoreW, sx };
      if (sx - gap - w.l >= 0 && sx + scoreW + gap + w.r <= COLS) break;
    }
    const { gap, cg, scoreW, sx } = lay;
    board.text(s.left, sx - gap - w.l, Y1, { scale: 2 });
    if (s.off !== 'home') board.text(s.hs, sx, Y1, { scale: 2 });
    board.text(':', sx + w.h + cg, Y1, { scale: 2 });
    if (s.off !== 'away') board.text(s.as, sx + w.h + cg + w.c + cg, Y1, { scale: 2 });
    board.text(s.right, sx + scoreW + gap, Y1, { scale: 2 });
  }

  // Text in einer Zeile: passt er, steht er mittig still – sonst läuft er durch.
  function drawLine(text, y, t) {
    const w = measure(text);
    if (w <= COLS) {
      board.text(text, Math.floor((COLS - w) / 2), y);
      return;
    }
    const period = w + SCROLL_GAP;
    const s = Math.floor(Math.max(0, (t / 1000) * SCROLL_SPEED - 18) % period); // erst kurz stehen, dann laufen
    board.text(text, 1 - s, y, { clip: [0, COLS] });
    board.text(text, 1 - s + period, y, { clip: [0, COLS] });
  }

  // Wie lange ein Text in Zeile 3 stehen bleibt: kurze 3,5 s, lange einen ganzen Durchlauf.
  function dwell(text) {
    const w = measure(text);
    return w <= COLS ? 3500 : Math.round(800 + ((w + SCROLL_GAP) / SCROLL_SPEED) * 1000);
  }

  function drawOptions(opts, y, t, now) {
    if (!opts.length) return;
    // Neue Texte (z. B. Torschütze gerade eingetroffen) fangen wieder beim ersten an.
    const key = opts.map((o) => o.key || o.text).join('|');
    if (key !== optsKey) {
      optsKey = key;
      optsSince = t;
    }
    const times = opts.map((o) => dwell(o.text));
    let e = (t - optsSince) % times.reduce((a, b) => a + b, 0);
    let i = 0;
    while (e >= times[i]) e -= times[i++];
    const o = opts[i];
    if (!(o.blink && now % 900 > 600)) drawLine(o.text, y, e);
  }

  function frame() {
    if (!board || !card) return;
    const now = api.now();
    const s = scene(card, now);
    current = s;
    board.clear();
    if (s.intro) {
      drawIntro(s.intro, s.t);
    } else {
      drawScore(s.score);
      if (s.line2) drawLine(s.line2, Y2, s.t);
      drawOptions(s.line3, Y3, s.t, now);
    }
    board.render();
    plate(s);
  }

  // Fußleiste nur anfassen, wenn sich wirklich etwas ändert
  function plate(s) {
    const foot = footText(card);
    if (foot !== shown.foot) {
      shown.foot = foot;
      el.foot.textContent = foot;
    }
    const page = s.page || '';
    if (page !== shown.page) {
      shown.page = page;
      el.page.textContent = page;
      el.page.hidden = !page;
    }
    const link = !!(s.url || card.url);
    if (link !== shown.link) {
      shown.link = link;
      el.box.classList.toggle('no-link', !link);
    }
  }

  // ------------------------------------------------------------ Schnittstelle für popup.js

  const design = {
    mount(root, c, a) {
      clearInterval(timer);
      card = c;
      api = a;
      shown = {};
      current = null;
      optsKey = '';
      optsSince = 0;

      const box = document.createElement('article');
      box.className = 'tafel';
      box.innerHTML =
        '<canvas class="tafel-board"></canvas>' +
        '<footer class="tafel-plate">' +
        '<span class="tafel-foot"></span>' +
        '<span class="tafel-actions">' +
        '<span class="tafel-hint">bei FotMob ansehen</span>' +
        '<span class="tafel-page" hidden></span>' +
        '<button type="button" class="tafel-x" title="Schließen" aria-label="Schließen">×</button>' +
        '</span></footer>';
      root.appendChild(box);
      el = {
        box,
        foot: box.querySelector('.tafel-foot'),
        page: box.querySelector('.tafel-page'),
        x: box.querySelector('.tafel-x'),
      };

      board = new window.LED.Board(box.querySelector('canvas'), { cols: COLS, rows: ROWS, pitch: PITCH, color: c.ledColor });

      el.x.addEventListener('click', (e) => {
        e.stopPropagation();
        api.close();
      });
      // Konferenz: Klick öffnet das Spiel, das gerade auf der Tafel steht.
      box.addEventListener('click', (e) => {
        const url = current && current.url;
        if (card && card.type === 'conference' && url && url !== card.url) {
          e.stopPropagation();
          api.open(url);
        }
      });

      frame();
      timer = setInterval(frame, TICK);
      return { width: SIZE.width, height: SIZE.height };
    },

    update(c) {
      card = c;
      if (!board) return;
      board.setColor(c.ledColor);
      frame();
    },

    destroy() {
      clearInterval(timer);
      timer = null;
      board = null;
      card = null;
    },

    // Für Tests: was zur Zeit t auf der Tafel steht
    scene,
  };

  window.TA_DESIGNS = window.TA_DESIGNS || {};
  window.TA_DESIGNS.tafel = design;
})();
