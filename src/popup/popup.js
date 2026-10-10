// Lebenszyklus eines Popups, unabhängig vom Design: Karte annehmen, Design einhängen, Größe melden,
// Anzeigedauer (Maus drüber = Uhr hält an), Klick = Spiel bei FotMob öffnen, kurz ausblenden, schließen.
// Die Designs liegen in designs/*.js und tragen sich in window.TA_DESIGNS ein. Kein Ton hier –
// den spielt der Main-Prozess.

(() => {
  const bridge = window.toralarm;
  const root = document.getElementById('root');

  const DEFAULT_DURATION = 14000;
  const MAX_DURATION = 10 * 60000;
  const MAX_WAIT = 30000; // länger wird auf den Torschützen nicht gewartet
  const FADE = 170; // Ausblenden, passend zur Animation in popup.css

  let card = null;
  let design = null;
  let shownAt = 0;
  let running = false; // Uhr läuft (nichts mehr ausstehend)
  let remaining = 0;
  let startedAt = 0;
  let hovering = false;
  let closing = false;
  let waitTimer = null;
  let endTimer = null;

  const api = {
    close: () => leave(() => bridge.close()),
    open: (url) => leave(() => bridge.open(url)),
    now: () => performance.now() - shownAt,
  };

  // ------------------------------------------------------------ Design einhängen

  function tryMount(id, c) {
    const d = (window.TA_DESIGNS || {})[id];
    if (!d || typeof d.mount !== 'function') return null;
    root.textContent = '';
    root.dataset.design = id;
    try {
      return { d, size: d.mount(root, c, api) };
    } catch (e) {
      console.error(`Design "${id}" ließ sich nicht anzeigen:`, e);
      destroy(d);
      root.textContent = '';
      return null;
    }
  }

  function destroy(d) {
    try {
      if (d && typeof d.destroy === 'function') d.destroy();
    } catch (e) {
      console.error('Design ließ sich nicht abbauen:', e);
    }
  }

  // Größe vom Design (inkl. 8 px Rand rundum) – meldet es nichts Brauchbares, selbst nachmessen.
  function sizeOf(size) {
    const w = Number(size && size.width);
    const h = Number(size && size.height);
    if (w > 0 && h > 0) return { width: Math.ceil(w), height: Math.ceil(h) };
    const r = (root.firstElementChild || root).getBoundingClientRect();
    return { width: Math.ceil(r.width) + 16, height: Math.ceil(r.height) + 16 };
  }

  // ------------------------------------------------------------ Anzeigedauer
  // Solange noch etwas nachgeladen wird (pending), bleibt das Popup stehen – höchstens 30 s.
  // Danach läuft card.duration; solange die Maus drauf ist, hält die Uhr an.

  function duration() {
    const d = Number(card && card.duration);
    return Number.isFinite(d) && d >= 0 ? Math.min(d, MAX_DURATION) : DEFAULT_DURATION;
  }

  function startCountdown() {
    if (running || closing) return;
    clearTimeout(waitTimer);
    running = true;
    remaining = duration();
    startedAt = performance.now();
    scheduleEnd();
  }

  function scheduleEnd() {
    clearTimeout(endTimer);
    if (!running || hovering || closing) return;
    endTimer = setTimeout(() => api.close(), Math.max(0, remaining));
  }

  root.addEventListener('mouseenter', () => {
    if (hovering) return;
    hovering = true;
    if (running) remaining -= performance.now() - startedAt;
    clearTimeout(endTimer);
  });
  root.addEventListener('mouseleave', () => {
    if (!hovering) return;
    hovering = false;
    startedAt = performance.now();
    scheduleEnd();
  });

  // Klick irgendwo aufs Popup = Spiel öffnen. Eigene Knöpfe (×, Fastext …) stoppen den Klick selbst.
  root.addEventListener('click', () => {
    if (card && card.url && !closing) api.open(card.url);
  });

  // Kurz ausblenden, Design abbauen, dann schließen bzw. Link öffnen.
  function leave(after) {
    if (closing) return;
    closing = true;
    clearTimeout(waitTimer);
    clearTimeout(endTimer);
    root.classList.add('leaving');
    setTimeout(() => {
      destroy(design);
      design = null;
      after();
    }, FADE);
  }

  // ------------------------------------------------------------ IPC

  bridge.onShow((c) => {
    if (!c || typeof c !== 'object' || closing) return;
    // Eigentlich kommt pro Fenster nur eine Karte – falls doch eine zweite, die alte sauber abräumen.
    clearTimeout(waitTimer);
    clearTimeout(endTimer);
    destroy(design);
    design = null;
    running = false;

    card = c;
    shownAt = performance.now();
    const wanted = String(c.design || 'tafel');
    const m = tryMount(wanted, card) || (wanted !== 'tafel' ? tryMount('tafel', card) : null);
    if (!m) {
      bridge.close();
      return;
    }
    design = m.d;
    root.classList.add('in');
    bridge.ready(sizeOf(m.size));

    if (card.pending) waitTimer = setTimeout(startCountdown, MAX_WAIT);
    else startCountdown();
  });

  bridge.onUpdate((u) => {
    if (!card || closing || !u || typeof u !== 'object') return;
    Object.assign(card, u);
    if (design && typeof design.update === 'function') {
      try {
        design.update(card);
      } catch (e) {
        console.error('Design-Update fehlgeschlagen:', e);
      }
    }
    if (!card.pending) startCountdown();
  });
})();
