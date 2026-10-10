// Die Anzeigetafel oben auf der Seite. board.js (Punktschrift) und tafel.js (die Tafel) sind
// unverändert aus dem Programm übernommen (src/popup/). Hier läuft nur eine kleine Schleife:
// Tor, Konferenz, Lieblingsverein, Rote Karte – anhalten und durchklicken geht auch.
// Bei "Bewegung reduzieren" (prefers-reduced-motion) steht jede Szene still; weiter nur per Klick.
// Ganz unten: der Hinweis für alle, die die Seite nicht an einem Windows-PC öffnen.

(() => {
  'use strict';

  const LED = window.LED;
  const tafel = window.TA_DESIGNS && window.TA_DESIGNS.tafel;
  const halter = document.getElementById('tafel');
  const pauseKnopf = document.getElementById('pause');
  const szenenKnoepfe = Array.from(document.querySelectorAll('.szene[data-szene]'));
  if (!LED || !tafel || !halter) return;

  // ------------------------------------------------------------ Szenen

  const BL = { id: 54, name: 'Bundesliga', short: 'Bundesliga' };
  const verein = (name, code) => ({ id: null, name, code, full: name, logo: null });
  const FCA = verein('Augsburg', 'FCA');
  const FCB = verein('Bayern', 'FCB');

  // Anstoß heute um hh:mm Ortszeit – die Konferenz zeigt dann "ANSTOSS 18:30"
  function heuteUm(h, m) {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }

  // Eine Karte, wie main.js sie ans Popup schickt
  const spiel = {
    design: 'tafel',
    ledColor: 'amber',
    duration: 14000,
    competition: BL,
    round: '5',
    url: null,
    home: FCA,
    away: FCB,
    score: [2, 1],
    minute: '78',
    side: 'home',
    team: 'Augsburg',
    favorite: false,
    conceded: false,
    demo: false,
    pending: false,
    varPending: false,
    reinstated: false,
    goal: null,
  };
  const elfmeter = { scorer: 'Robin Fellhauer', minute: '78', penalty: true, ownGoal: false, assist: null };

  // dauer: so lange läuft die Szene
  // still: dieser Moment steht auf der Tafel, wenn nichts laufen soll (Bewegung reduzieren,
  //        oder angehalten und dann eine andere Szene angeklickt)
  // fertig: ab hier ist nichts mehr halb aufgebaut oder gerade dunkel – "Anhalten" springt
  //        notfalls bis hierhin vor (ohne Angabe: still)
  const SZENEN = {
    tor: {
      karte: { ...spiel, type: 'goal', goal: elfmeter },
      dauer: 2300 + 2 * 3500, // "TOR!", dann Torschütze und "ELFMETER" je 3,5 s
      still: 4300,
      text: 'Tor: FCA 2:1 FCB – Tor für Augsburg, 78. Minute Robin Fellhauer, Elfmeter',
    },
    konferenz: {
      karte: {
        ...spiel,
        type: 'conference',
        minute: null,
        side: null,
        team: null,
        matches: [
          { home: FCA, away: FCB, score: [2, 1], minute: '78', status: 'live', competition: BL },
          { home: verein('Hoffenheim', 'TSG'), away: verein('HSV', 'HSV'), score: [1, 1], minute: 'Halbzeit', status: 'live', competition: BL },
          { home: verein('Leverkusen', 'B04'), away: verein('Dortmund', 'BVB'), score: [0, 3], minute: '90+4', status: 'live', competition: BL },
          { home: verein('Leipzig', 'RBL'), away: verein('Frankfurt', 'SGE'), score: [null, null], minute: null, status: 'pre', startUtc: heuteUm(18, 30), competition: BL },
          { home: verein('Gladbach', 'BMG'), away: verein('Heidenheim', 'FCH'), score: [4, 0], minute: 'Ende', status: 'done', competition: BL },
        ],
      },
      dauer: 5 * 3000, // alle 3 s das nächste Spiel
      still: 0,
      text: 'Konferenz: FCA 2:1 FCB, 78. Minute – TSG 1:1 HSV, Halbzeit – B04 0:3 BVB, 90.+4 – RBL gegen SGE, Anstoß 18:30 – BMG 4:0 FCH, Ende',
    },
    verein: {
      karte: { ...spiel, type: 'goal', goal: elfmeter, favorite: true },
      dauer: 3500 + 2 * 3500,
      // Stillstand zeigt das ganze "TOOOR!" – sonst sähe die Szene genauso aus wie "Tor"
      still: 700,
      fertig: 6700,
      text: 'Tor des Lieblingsvereins: TOOOR! – FCA 2:1 FCB – Tor für Augsburg, 78. Minute Robin Fellhauer, Elfmeter',
    },
    rot: {
      karte: { ...spiel, type: 'redcard', minute: '67', side: 'away', team: 'Bayern', player: 'Dayot Upamecano' },
      dauer: 1800 + 4700,
      still: 1900,
      text: 'Rote Karte: FCA 2:1 FCB – Rote Karte Bayern, 67. Minute Dayot Upamecano',
    },
  };
  const FOLGE = ['tor', 'konferenz', 'verein', 'rot'];

  // ------------------------------------------------------------ Punktabstand

  // Im Programm hat die Tafel 3 px Punktabstand. Hier richtet er sich nach dem Platz (2 bis 5 px).
  // tafel.js baut seine Tafel mit new LED.Board(…) – diese Unterklasse ändert nur den Abstand.
  const Basis = LED.Board;
  let pitch = 3;
  LED.Board = class extends Basis {
    constructor(canvas, opts) {
      super(canvas, { ...opts, pitch });
    }
  };

  // Gehäuse = 128 Punkte + 2 x 3 Punkte Rand + 2 px Rahmen
  function passenderAbstand() {
    const p = (halter.clientWidth - 2) / 134;
    return Math.max(2, Math.min(5, Math.floor(p * 20) / 20));
  }

  // ------------------------------------------------------------ Ablauf

  const leise = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  let name = FOLGE[0];
  let start = performance.now(); // Beginn der Szene
  let halt = leise.matches ? SZENEN[name].still : null; // angehalten bei t (ms), sonst null
  let ruht = false; // Tafel nicht zu sehen (weggescrollt, Tab im Hintergrund)
  let geparkt = 0;
  let naechste = null;

  const api = {
    now: () => (halt !== null ? halt : ruht ? geparkt : performance.now() - start),
    close() {},
    open() {},
  };

  const laeuft = () => halt === null && !ruht;

  // Tafel neu einhängen (neue Szene, neue Größe). Läuft nichts, bleibt das erste Bild einfach stehen.
  function einhaengen() {
    tafel.destroy();
    halter.textContent = '';
    halter.style.setProperty('--p', String(pitch));
    tafel.mount(halter, { ...SZENEN[name].karte }, api);
    if (!laeuft()) tafel.destroy();
    halter.setAttribute('aria-label', `Anzeigetafel – ${SZENEN[name].text}`);
  }

  function planen() {
    clearTimeout(naechste);
    if (!laeuft()) return;
    const rest = SZENEN[name].dauer - api.now();
    naechste = setTimeout(() => zeige(FOLGE[(FOLGE.indexOf(name) + 1) % FOLGE.length]), Math.max(0, rest));
  }

  function markieren() {
    for (const k of szenenKnoepfe) k.setAttribute('aria-pressed', String(k.dataset.szene === name));
    if (pauseKnopf) pauseKnopf.textContent = halt === null ? 'Anhalten' : 'Abspielen';
  }

  function zeige(n) {
    if (!SZENEN[n]) return;
    if (n === name && halt !== null && n === 'konferenz') {
      // Angehalten: nochmal "Konferenz" blättert zum nächsten Spiel
      halt = ((Math.floor(halt / 3000) + 1) % 5) * 3000;
    } else {
      name = n;
      start = performance.now();
      if (ruht) geparkt = 0;
      if (halt !== null) halt = SZENEN[n].still;
    }
    einhaengen();
    markieren();
    planen();
  }

  function anhalten() {
    if (halt !== null) return;
    // Mitten im Blinken anhalten hieße womöglich eine leere Tafel – dann lieber das fertige Bild.
    const s = SZENEN[name];
    halt = Math.max(api.now(), s.fertig !== undefined ? s.fertig : s.still);
    clearTimeout(naechste);
    einhaengen();
    markieren();
  }

  function abspielen() {
    if (halt === null) return;
    const t = halt >= SZENEN[name].dauer ? 0 : halt;
    halt = null;
    if (ruht) geparkt = t;
    else start = performance.now() - t;
    einhaengen();
    markieren();
    planen();
  }

  function sichtbar(ja) {
    if (ja === !ruht) return;
    if (!ja) {
      geparkt = api.now();
      ruht = true;
      clearTimeout(naechste);
      tafel.destroy();
    } else {
      ruht = false;
      start = performance.now() - geparkt;
      if (halt === null) {
        einhaengen();
        planen();
      }
    }
  }

  // ------------------------------------------------------------ Los

  // Im Hintergrund-Tab geöffnet (z. B. Mittelklick bei Reddit)? Dann geht's erst beim Hinschauen los.
  if (document.hidden) ruht = true;

  pitch = passenderAbstand();
  einhaengen();
  markieren();
  planen();

  for (const k of szenenKnoepfe) k.addEventListener('click', () => zeige(k.dataset.szene));
  if (pauseKnopf) pauseKnopf.addEventListener('click', () => (halt === null ? anhalten() : abspielen()));

  if (typeof leise.addEventListener === 'function') {
    leise.addEventListener('change', () => (leise.matches ? anhalten() : abspielen()));
  }

  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      const p = passenderAbstand();
      if (p !== pitch) {
        pitch = p;
        einhaengen();
      }
    }).observe(halter);
  }

  let imBild = true;
  const pruefen = () => sichtbar(imBild && !document.hidden);
  document.addEventListener('visibilitychange', pruefen);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((eintraege) => {
      imBild = eintraege[eintraege.length - 1].isIntersecting;
      pruefen();
    }).observe(halter);
  }
})();

// Viele kommen vom Handy (Reddit, Discord). Wer nicht an einem Windows-PC sitzt, bekommt unter dem
// Download-Knopf einen Hinweis, statt sich 90 MB aufs Telefon zu laden, die dort nichts nützen.
(() => {
  'use strict';
  const hinweis = document.getElementById('kein-windows');
  if (!hinweis) return;
  const uad = navigator.userAgentData;
  const plattform = (uad && uad.platform) || navigator.platform || '';
  const windows = /^win/i.test(plattform) || /Windows NT/i.test(navigator.userAgent || '');
  if (!windows) hinweis.hidden = false;
})();
