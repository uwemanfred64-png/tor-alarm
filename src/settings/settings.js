// Einstellungsfenster. Spricht nur über window.taSettings (preload.js) mit dem Main-Prozess:
// beim Öffnen laden, Änderungen im Formular sammeln, bei OK/Übernehmen nur die Änderungen speichern.
(function () {
  'use strict';

  const api = window.taSettings;
  const $ = (id) => document.getElementById(id);
  const all = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const NESTED = ['events', 'forward', 'quiet'];
  // Felder, die der Dialog nicht bearbeitet ("Wieder einschalten" speichert muteUntil sofort)
  const NOT_EDITED = ['version', 'knownTeams', 'autostartSet', 'muteUntil'];
  const NTFY_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const WEBHOOK_RE = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/;
  const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

  let meta = null;
  let base = null; // zuletzt gespeicherter Stand, dazu autostart
  let state = null; // Formular
  let teamMode = 'alle';
  let teamSel = []; // bleibt erhalten, auch wenn gerade "allen Teams" gewählt ist
  let busy = false;
  let hotkeyDraft = false;

  // ---------------------------------------------------------------- Hilfen

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  const teamKey = (t) => (t.id != null ? `i${t.id}` : `n${norm(t.name)}`);
  const sameTeam = (a, b) => (a.id != null && b.id != null ? a.id === b.id : norm(a.name) === norm(b.name));
  const plainTeam = (t) => ({ id: t.id != null ? t.id : null, name: t.name });

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // "Error invoking remote method 'settings:save': Error: …" -> nur der Teil hinten
  function message(e) {
    return String((e && e.message) || e || 'Unbekannter Fehler').replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
  }

  function getPath(o, path) {
    return path.reduce((x, k) => (x == null ? undefined : x[k]), o);
  }
  function setPath(o, path, v) {
    let x = o;
    for (const k of path.slice(0, -1)) {
      if (x[k] == null || typeof x[k] !== 'object') x[k] = {};
      x = x[k];
    }
    x[path[path.length - 1]] = v;
  }

  // ---------------------------------------------------------------- Änderungen

  function equal(key, a, b) {
    if (key === 'teams') {
      const keys = (l) => (Array.isArray(l) ? l.map(teamKey).sort().join() : '');
      return keys(a) === keys(b);
    }
    if (key === 'competitions') {
      const ids = (l) => (Array.isArray(l) ? l.slice().sort((x, y) => x - y).join() : '');
      return ids(a) === ids(b);
    }
    return same(a, b);
  }

  // Nur was sich gegenüber dem gespeicherten Stand geändert hat; events/forward/quiet feldweise.
  function changes() {
    const out = {};
    if (!state || !base) return out;
    for (const k of Object.keys(state)) {
      if (NOT_EDITED.includes(k)) continue;
      if (NESTED.includes(k)) {
        const sub = {};
        for (const f of Object.keys(state[k] || {})) {
          if (!same(state[k][f], (base[k] || {})[f])) sub[f] = clone(state[k][f]);
        }
        if (Object.keys(sub).length) out[k] = sub;
      } else if (!equal(k, state[k], base[k])) {
        out[k] = clone(state[k]);
      }
    }
    return out;
  }

  function flatten(partial) {
    const list = [];
    for (const [k, v] of Object.entries(partial)) {
      if (NESTED.includes(k) && v && typeof v === 'object') for (const [f, x] of Object.entries(v)) list.push([[k, f], x]);
      else list.push([[k], v]);
    }
    return list;
  }

  function adoptBase(settings, autostart) {
    base = clone(settings) || {};
    base.autostart = !!autostart;
  }

  // Teamfilter: leere Liste heißt "allen Teams"
  function syncTeamMode() {
    teamMode = state.teams && state.teams.length ? 'auswahl' : 'alle';
    if (teamMode === 'auswahl') teamSel = clone(state.teams);
  }

  // Alte Einträge aus 1.0 haben nur den Namen – beim Bearbeiten die ID aus der Teamliste nachtragen
  function withId(t) {
    if (t.id != null) return plainTeam(t);
    const hit = meta.teams.find((x) => x.id != null && norm(x.name) === norm(t.name));
    return plainTeam(hit || t);
  }

  function setTeams() {
    state.teams = teamMode === 'auswahl' ? teamSel.map(withId) : [];
  }

  // ---------------------------------------------------------------- Laden

  function setMeta(m) {
    const x = m && typeof m === 'object' ? m : {};
    meta = {
      version: x.version || '',
      designs: Array.isArray(x.designs) ? x.designs : [],
      sounds: Array.isArray(x.sounds) ? x.sounds : [],
      ledColors: Array.isArray(x.ledColors) ? x.ledColors : [],
      competitions: Array.isArray(x.competitions) ? x.competitions : [],
      teams: (Array.isArray(x.teams) ? x.teams : []).filter((t) => t && typeof t.name === 'string' && t.name),
      autostart: !!x.autostart,
    };
  }

  async function load() {
    if (!api) {
      setStatus('Keine Verbindung zu Tor-Alarm.', true);
      return;
    }
    try {
      const [s, m] = await Promise.all([api.get(), api.meta()]);
      setMeta(m);
      adoptBase(s, meta.autostart);
      state = clone(base);
      teamSel = [];
      syncTeamMode();
      buildDesigns();
      buildSelects();
      buildCompetitions();
      buildFavorite();
      buildTeamList();
      $('version').textContent = meta.version ? `Tor-Alarm ${meta.version}` : 'Tor-Alarm';
      render();
      document.body.classList.remove('loading');
      api.onChanged(onChanged);
      if (!meta.teams.length) waitForTeams(0);
    } catch (e) {
      document.body.classList.remove('loading');
      setStatus(`Einstellungen konnten nicht geladen werden: ${message(e)}`, true);
      for (const b of all('button:not(.tab):not(#cancel)')) b.disabled = true;
    }
  }

  // Von außen geändert (z. B. Stummschaltung im Tray): eigene ungespeicherte Änderungen bleiben stehen.
  function onChanged(s) {
    if (!base || !s || typeof s !== 'object') return;
    const pending = flatten(changes());
    const knownBefore = JSON.stringify(base.knownTeams || []);
    adoptBase(s, base.autostart);
    state = clone(base);
    for (const [p, v] of pending) setPath(state, p, v);
    if (!pending.some(([p]) => p[0] === 'teams')) syncTeamMode();
    buildFavorite();
    buildTeamList(true);
    if (JSON.stringify(base.knownTeams || []) !== knownBefore) refreshTeams();
    render();
  }

  async function refreshTeams() {
    try {
      const m = await api.meta();
      const keepAutostart = meta.autostart;
      setMeta(m);
      meta.autostart = keepAutostart;
      buildFavorite();
      buildTeamList(true);
      render();
    } catch {
      /* dann eben beim nächsten Öffnen */
    }
  }

  // Teamlisten lädt Main erst nach dem Start aus dem Netz – solange ab und zu nachfragen
  function waitForTeams(n) {
    if (n >= 20 || meta.teams.length) return;
    setTimeout(async () => {
      await refreshTeams();
      waitForTeams(n + 1);
    }, 3000);
  }

  // ---------------------------------------------------------------- Aufbau aus meta

  function buildDesigns() {
    const box = $('designList');
    box.textContent = '';
    for (const d of meta.designs) {
      const label = el('label', 'opt');
      const input = el('input');
      input.type = 'radio';
      input.name = 'design';
      input.value = d.id;
      const text = el('span', 'opt-text');
      text.append(el('span', 'opt-name', d.name), el('span', 'opt-desc', d.desc || ''));
      label.append(input, text);
      box.append(label);
      if (d.id === 'tafel') box.append($('ledRow'));
    }
  }

  function fill(sel, items) {
    sel.textContent = '';
    for (const it of items) sel.append(new Option(it.name, it.id));
  }

  function buildSelects() {
    fill($('ledColor'), meta.ledColors);
    fill($('soundName'), meta.sounds);
    fill($('favoriteSound'), [{ id: 'gleich', name: 'Wie bei anderen Toren' }, ...meta.sounds]);
  }

  // Drei Spalten: nationale Wettbewerbe in den ersten beiden, Europapokal in der dritten
  function buildCompetitions() {
    const grid = $('compGrid');
    grid.textContent = '';
    const nat = meta.competitions.filter((c) => !c.intl);
    const intl = meta.competitions.filter((c) => c.intl);
    const rows = Math.max(Math.ceil(nat.length / 2), intl.length, 1);
    const place = (c, col, row) => {
      const label = el('label', 'check');
      const input = el('input');
      input.type = 'checkbox';
      input.dataset.comp = String(c.id);
      label.append(input, el('span', null, c.name));
      label.style.gridColumn = String(col);
      label.style.gridRow = String(row);
      grid.append(label);
    };
    nat.forEach((c, i) => place(c, 1 + Math.floor(i / rows), 1 + (i % rows)));
    intl.forEach((c, i) => place(c, 3, 1 + i));
  }

  // Ligen in der Reihenfolge der Wettbewerbe, Teams alphabetisch
  function leagueGroups(onlyIds) {
    const order = meta.competitions.map((c) => c.id);
    const groups = new Map();
    for (const t of meta.teams) {
      if (onlyIds && !onlyIds.includes(t.leagueId)) continue;
      if (!groups.has(t.leagueId)) groups.set(t.leagueId, { id: t.leagueId, name: t.leagueName || 'Weitere Teams', teams: [] });
      const g = groups.get(t.leagueId);
      if (!g.teams.some((x) => sameTeam(x, t))) g.teams.push(t);
    }
    const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
    return Array.from(groups.values())
      .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, 'de'))
      .map((g) => ({ ...g, teams: g.teams.sort((a, b) => a.name.localeCompare(b.name, 'de')) }));
  }

  function buildFavorite() {
    const sel = $('favorite');
    sel.textContent = '';
    sel.append(new Option('(kein Lieblingsverein)', ''));
    const seen = new Set();
    for (const g of leagueGroups(null)) {
      const og = document.createElement('optgroup');
      og.label = g.name;
      for (const t of g.teams) {
        const key = teamKey(t);
        if (seen.has(key)) continue;
        seen.add(key);
        // Frauenteams heißen wie die Männer – im geschlossenen Feld sonst nicht zu unterscheiden
        const o = new Option(t.leagueId === 9676 ? `${t.name} (Frauen)` : t.name, key);
        o.team = plainTeam(t);
        og.append(o);
      }
      if (og.children.length) sel.append(og);
    }
    // Gespeicherter Verein, der (noch) in keiner Liste steht, bleibt wählbar
    const f = state.favorite;
    if (f && !favoriteOption(f)) {
      const o = new Option(f.name, 'gespeichert');
      o.team = plainTeam(f);
      sel.options[0].after(o); // direkt unter "(kein Lieblingsverein)", vor den Liga-Gruppen
    }
  }

  function favoriteOption(f) {
    return Array.from($('favorite').options).find((o) => o.team && sameTeam(o.team, f)) || null;
  }

  let teamListKey = '';
  function buildTeamList(force) {
    const key = `${state.competitions.slice().sort().join()}|${meta.teams.length}`;
    if (!force && key === teamListKey) return;
    teamListKey = key;
    const box = $('teamList');
    const scroll = box.scrollTop;
    box.textContent = '';
    const shown = [];
    const group = (name, teams) => {
      box.append(el('div', 'lv-head', name));
      const items = el('div', 'lv-items');
      for (const t of teams) {
        const label = el('label', 'check');
        const input = el('input');
        input.type = 'checkbox';
        input.team = plainTeam(t);
        const span = el('span', null, t.name);
        span.title = t.name;
        label.append(input, span);
        items.append(label);
        shown.push(t);
      }
      box.append(items);
    };
    if (!meta.teams.length) {
      box.append(el('div', 'lv-empty', 'Teamliste wird geladen …'));
      if (teamSel.length) group('Ausgewählt', teamSel);
      return;
    }
    // Nur Ligen der gewählten Wettbewerbe. Sind nur Pokal/Europapokal gewählt (ohne eigene Teamliste),
    // alle Ligen zeigen – sonst könnte man dort gar kein Team auswählen.
    const leagues = state.competitions.filter((id) => meta.teams.some((t) => t.leagueId === id));
    if (leagues.length || state.competitions.length) {
      for (const g of leagueGroups(leagues.length ? leagues : null)) group(g.name, g.teams);
    }
    // Ausgewählt, aber in keiner der gezeigten Ligen (z. B. Wettbewerb abgewählt) – nicht stillschweigend verlieren
    const rest = teamSel.filter((t) => !shown.some((x) => sameTeam(x, t)));
    if (rest.length) group('Weitere ausgewählte Teams', rest);
    if (!box.children.length) box.append(el('div', 'lv-empty', 'Kein Wettbewerb ausgewählt.'));
    box.scrollTop = scroll;
  }

  // ---------------------------------------------------------------- Formular füllen

  function setValue(input, v) {
    const s = v == null ? '' : String(v);
    if (document.activeElement !== input && input.value !== s) input.value = s;
  }

  function render() {
    if (!state) return;
    const s = state;

    // Anzeige
    for (const r of all('input[name=design]')) r.checked = r.value === s.design;
    $('ledColor').value = s.ledColor;
    $('ledColor').disabled = s.design !== 'tafel';
    const ownWindow = s.design !== 'windows';
    $('position').value = s.position;
    $('size').value = String(s.size);
    $('duration').value = String(s.duration);
    setValue($('durationNum'), s.duration);
    for (const id of ['position', 'size', 'duration', 'durationNum']) $(id).disabled = !ownWindow;
    $('windowsNote').hidden = ownWindow;

    // Ton
    $('sound').checked = !!s.sound;
    $('volume').value = String(s.volume);
    $('volumeText').textContent = `${s.volume} %`;
    $('eventSounds').checked = !!s.eventSounds;
    $('soundName').value = s.soundName;
    $('soundFile').value = s.soundFile || '';
    $('soundFile').title = s.soundFile || '';
    $('favoriteSound').value = s.favoriteSound;
    $('favoriteSoundFile').value = s.favoriteSoundFile || '';
    $('favoriteSoundFile').title = s.favoriteSoundFile || '';
    const on = !!s.sound;
    for (const id of ['volume', 'eventSounds', 'soundName', 'soundFile', 'pickSound']) $(id).disabled = !on;
    $('testSound').disabled = !on || !playable(false);
    const fav = on && !!s.favorite;
    for (const id of ['favoriteSound', 'favoriteSoundFile', 'pickFavoriteSound']) $(id).disabled = !fav;
    $('testFavoriteSound').disabled = !fav || !playable(true);
    $('noFavorite').hidden = !!s.favorite;

    // Teams
    for (const c of all('input[data-comp]')) c.checked = s.competitions.includes(Number(c.dataset.comp));
    $('germanOnly').checked = !!s.germanOnly;
    $('germanOnly').disabled = !meta.competitions.some((c) => c.intl && s.competitions.includes(c.id));
    const opt = s.favorite ? favoriteOption(s.favorite) : null;
    $('favorite').value = opt ? opt.value : '';
    for (const r of all('input[name=concededMode]')) {
      r.checked = r.value === s.concededMode;
      r.disabled = !s.favorite;
    }
    $('concededRow').classList.toggle('off', !s.favorite);
    for (const r of all('input[name=teamMode]')) r.checked = r.value === teamMode;
    const listOff = teamMode !== 'auswahl';
    $('teamList').classList.toggle('off', listOff);
    for (const c of all('#teamList input[type=checkbox]')) {
      c.checked = teamSel.some((t) => sameTeam(t, c.team));
      c.disabled = listOff;
    }

    // Ereignisse
    for (const c of all('input[data-event]')) c.checked = !!(s.events || {})[c.dataset.event];

    // Handy & Discord
    setValue($('ntfyTopic'), s.forward.ntfyTopic);
    setValue($('discordWebhook'), s.forward.discordWebhook);
    $('testNtfy').disabled = !s.forward.ntfyTopic;
    $('testDiscord').disabled = !s.forward.discordWebhook;
    $('onlyFavorite').checked = !!s.forward.onlyFavorite;
    // Ohne Lieblingsverein würde "nur Lieblingsverein" alles blockieren
    $('onlyFavorite').disabled = !s.favorite;
    $('noFavoriteFwd').hidden = !!s.favorite;
    $('discordStatus').checked = s.discordStatus !== false;

    // Allgemein
    $('autostart').checked = !!s.autostart;
    if (!hotkeyDraft) $('hotkey').value = hotkeyLabel(s.hotkey);
    $('hotkeyClear').disabled = !s.hotkey;
    $('quietOn').checked = !!s.quiet.enabled;
    setValue($('quietFrom'), s.quiet.from);
    setValue($('quietTo'), s.quiet.to);
    $('quietFrom').disabled = $('quietTo').disabled = !s.quiet.enabled;
    renderMute();

    updateButtons();
  }

  function updateButtons() {
    const dirty = Object.keys(changes()).length > 0;
    $('apply').disabled = busy || !dirty;
    $('ok').disabled = busy;
  }

  function playable(fav) {
    const spec = soundSpec(fav);
    return spec.name !== 'datei' || !!spec.file;
  }

  // ---------------------------------------------------------------- Fehler und Status

  // Fehlerschlüssel aus Main bzw. aus der eigenen Prüfung -> Anzeigeplatz im Formular
  const ERROR_SLOTS = {
    'forward.ntfyTopic': 'ntfyTopic',
    ntfy: 'ntfyTopic',
    'forward.discordWebhook': 'discordWebhook',
    discord: 'discordWebhook',
    'quiet.from': 'quiet',
    'quiet.to': 'quiet',
    quietFrom: 'quiet',
    quietTo: 'quiet',
    from: 'quiet',
    to: 'quiet',
  };

  function errorSlot(key) {
    const name = ERROR_SLOTS[key] || String(key).replace(/^(?:forward|quiet|events)\./, '');
    return all('[data-err]').find((x) => x.dataset.err === name) || null;
  }

  // Wohin gehört ein Fehlerschlüssel im Datenmodell?
  function errorPath(key) {
    const k = String(key);
    if (k.includes('.')) return k.split('.');
    if (state && k in state) return [k];
    for (const n of NESTED) if (state && state[n] && k in state[n]) return [n, k];
    const slot = ERROR_SLOTS[k];
    if (slot === 'quiet') return ['quiet'];
    if (slot) return ['forward', slot];
    return null;
  }

  function showErrors(errs) {
    for (const x of all('[data-err]')) x.textContent = '';
    const loose = [];
    for (const [k, msg] of Object.entries(errs || {})) {
      const slot = errorSlot(k);
      if (slot) slot.textContent = slot.textContent ? `${slot.textContent} ${msg}` : String(msg);
      else loose.push(String(msg));
    }
    setStatus(loose.join(' '), loose.length > 0);
    // Zur ersten Registerkarte mit Fehler springen und dort ins Feld
    const first = all('[data-err]').find((x) => x.textContent);
    if (first) {
      const page = first.closest('.page');
      const tab = page && document.querySelector(`.tab[aria-controls="${page.id}"]`);
      if (tab && tab.getAttribute('aria-selected') !== 'true') selectTab(tab);
      const ctl = (first.closest('.row') || first.closest('fieldset')).querySelector('input:not(:disabled), select:not(:disabled)');
      if (ctl) ctl.focus();
    }
  }

  function clearError(name) {
    for (const x of all('[data-err]')) if (x.dataset.err === name) x.textContent = '';
  }

  function setStatus(text, bad) {
    const st = $('status');
    st.textContent = text || '';
    st.title = text || '';
    st.classList.toggle('bad', !!bad);
  }

  // Eigene Prüfung vor dem Speichern – nur für Felder, die geändert wurden
  function checkForm(partial) {
    const e = {};
    const f = partial.forward || {};
    if (f.ntfyTopic && !NTFY_RE.test(f.ntfyTopic)) e.ntfyTopic = 'Nur Buchstaben, Ziffern, - und _, ohne Leerzeichen.';
    if (f.discordWebhook && !WEBHOOK_RE.test(f.discordWebhook)) e.discordWebhook = 'Das ist keine Webhook-Adresse von Discord.';
    const q = partial.quiet || {};
    if ((q.from !== undefined && !TIME_RE.test(q.from)) || (q.to !== undefined && !TIME_RE.test(q.to))) {
      e.quiet = 'Uhrzeit bitte so: 23:00';
    }
    if (partial.competitions && !partial.competitions.length) e.competitions = 'Bitte mindestens einen Wettbewerb ankreuzen.';
    if (teamMode === 'auswahl' && !teamSel.length) e.teams = 'Bitte mindestens ein Team ankreuzen – oder „allen Teams“ wählen.';
    return e;
  }

  // ---------------------------------------------------------------- Speichern

  async function apply() {
    if (busy || !state) return false;
    const partial = changes();
    const own = checkForm(partial);
    if (Object.keys(own).length) {
      showErrors(own);
      return false;
    }
    if (!Object.keys(partial).length) return true;

    busy = true;
    updateButtons();
    let res;
    try {
      res = await api.save(partial);
    } catch (e) {
      busy = false;
      showErrors({});
      setStatus(`Speichern ging nicht: ${message(e)}`, true);
      updateButtons();
      return false;
    }
    busy = false;

    const errs = (res && res.errors && typeof res.errors === 'object' && res.errors) || {};
    const saved = res && res.settings && typeof res.settings === 'object' ? res.settings : null;
    const old = base;
    const failed = Object.keys(errs).map(errorPath).filter(Boolean);
    let autostart = old.autostart;
    if (saved && typeof saved.autostart === 'boolean') autostart = saved.autostart;
    else if ('autostart' in partial && !errs.autostart) autostart = partial.autostart;
    let assumed = null; // falls Main keinen Stand zurückgibt: Änderungen als übernommen ansehen
    if (!saved) {
      assumed = clone(old);
      for (const [path, value] of flatten(partial)) setPath(assumed, path, value);
    }
    adoptBase(saved || assumed, autostart);

    // Formular zeigt den gespeicherten Stand – außer bei Feldern mit Fehler oder die Main nicht übernommen hat
    const next = clone(base);
    for (const [path, value] of flatten(partial)) {
      const bad = failed.some((p) => p.every((k, i) => path[i] === k));
      const untouched = same(getPath(base, path), getPath(old, path)) && !same(value, getPath(base, path));
      if (bad || untouched) setPath(next, path, value);
    }
    state = next;
    if (!('teams' in partial) || !failed.some((p) => p[0] === 'teams')) syncTeamMode();
    buildTeamList();
    render();
    showErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onOk() {
    if (busy) return;
    if (await apply()) window.close();
  }

  async function onApply() {
    const hadFocus = document.activeElement === $('apply');
    await apply();
    if (hadFocus && $('apply').disabled) $('ok').focus();
  }

  // ---------------------------------------------------------------- Ton, Vorschau, Weiterleitung

  function soundSpec(fav) {
    let name = fav ? state.favoriteSound : state.soundName;
    let file = fav ? state.favoriteSoundFile : state.soundFile;
    if (fav && name === 'gleich') {
      name = state.soundName;
      file = state.soundFile;
    }
    return { name, file: name === 'datei' ? file || '' : '', volume: state.volume };
  }

  async function testSound(fav) {
    const slot = fav ? 'favoriteSoundFile' : 'soundFile';
    clearError(slot);
    try {
      const r = await api.testSound(soundSpec(fav));
      if (r && typeof r === 'object' && r.ok === false) showSlot(slot, r.error || 'Ton konnte nicht abgespielt werden.');
    } catch (e) {
      showSlot(slot, message(e));
    }
  }

  function showSlot(name, text) {
    for (const x of all('[data-err]')) if (x.dataset.err === name) x.textContent = text;
  }

  // Datei wählen. Gibt true zurück, wenn eine Datei gewählt wurde.
  async function pickFile(fav) {
    const slot = fav ? 'favoriteSoundFile' : 'soundFile';
    clearError(slot);
    let p = null;
    try {
      p = await api.pickSoundFile();
    } catch (e) {
      showSlot(slot, message(e));
    }
    if (typeof p !== 'string' || !p) {
      render();
      return false;
    }
    if (fav) {
      state.favoriteSoundFile = p;
      state.favoriteSound = 'datei';
    } else {
      state.soundFile = p;
      state.soundName = 'datei';
    }
    render();
    return true;
  }

  async function onSoundSelect(fav, value) {
    const file = fav ? state.favoriteSoundFile : state.soundFile;
    // "Eigene Datei" ohne Datei: gleich den Dateidialog öffnen, bei Abbruch bleibt der alte Ton
    if (value === 'datei' && !file) {
      await pickFile(fav);
      return;
    }
    if (fav) state.favoriteSound = value;
    else state.soundName = value;
    render();
  }

  // Für die Vorschau zählen auch noch nicht gespeicherte Werte
  function previewSettings() {
    const p = clone(state);
    for (const k of ['autostart', 'knownTeams', 'autostartSet', 'muteUntil', 'version']) delete p[k];
    return p;
  }

  async function onPreview() {
    if (!state) return;
    try {
      await api.preview(previewSettings());
      setStatus('', false);
    } catch (e) {
      setStatus(`Vorschau ging nicht: ${message(e)}`, true);
    }
  }

  async function testForward(kind) {
    const isNtfy = kind === 'ntfy';
    const value = isNtfy ? state.forward.ntfyTopic : state.forward.discordWebhook;
    const out = $(isNtfy ? 'ntfyResult' : 'discordResult');
    const btn = $(isNtfy ? 'testNtfy' : 'testDiscord');
    const slot = isNtfy ? 'ntfyTopic' : 'discordWebhook';
    clearError(slot);
    out.classList.remove('bad');
    out.textContent = '';
    if (isNtfy ? !NTFY_RE.test(value) : !WEBHOOK_RE.test(value)) {
      showSlot(slot, isNtfy ? 'Nur Buchstaben, Ziffern, - und _, ohne Leerzeichen.' : 'Das ist keine Webhook-Adresse von Discord.');
      return;
    }
    out.textContent = 'Wird gesendet …';
    btn.disabled = true;
    try {
      const r = await api.testForward(isNtfy ? { ntfyTopic: value } : { discordWebhook: value });
      const x = r && r[kind];
      if (x && x.ok) {
        out.textContent = 'Gesendet.';
      } else {
        out.textContent = (x && x.error) || 'Nicht gesendet.';
        out.classList.add('bad');
      }
    } catch (e) {
      out.textContent = message(e);
      out.classList.add('bad');
    }
    btn.disabled = false;
    render();
  }

  // ---------------------------------------------------------------- Stummschaltung (aus dem Tray)

  function untilText(ms) {
    const d = new Date(ms);
    const now = new Date();
    const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const day = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (day(d) === day(now)) return `${time} Uhr`;
    if (day(d) === day(tomorrow)) return `morgen ${time} Uhr`;
    return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${time} Uhr`;
  }

  function renderMute() {
    const until = (base && base.muteUntil) || 0;
    const muted = until > Date.now();
    $('muteRow').hidden = !muted;
    if (muted) $('muteText').textContent = `Gerade stumm bis ${untilText(until)}.`;
  }

  async function unmute() {
    try {
      const res = await api.save({ muteUntil: 0 });
      const v = res && res.settings ? res.settings.muteUntil : 0;
      base.muteUntil = v;
      state.muteUntil = v;
    } catch (e) {
      setStatus(`Ging nicht: ${message(e)}`, true);
    }
    renderMute();
  }

  // ---------------------------------------------------------------- Tastenkürzel

  const MOD_LABELS = {
    commandorcontrol: 'Strg', cmdorctrl: 'Strg', control: 'Strg', ctrl: 'Strg',
    alt: 'Alt', altgr: 'AltGr', shift: 'Umschalt', super: 'Win', meta: 'Win',
  };
  const KEY_LABELS = {
    plus: '+', space: 'Leertaste', return: 'Eingabe', enter: 'Eingabe', backspace: 'Rücktaste', delete: 'Entf',
    insert: 'Einfg', home: 'Pos1', end: 'Ende', pageup: 'Bild auf', pagedown: 'Bild ab', up: 'Pfeil oben',
    down: 'Pfeil unten', left: 'Pfeil links', right: 'Pfeil rechts', escape: 'Esc', esc: 'Esc', tab: 'Tab',
    printscreen: 'Druck', nummult: 'Num *', numadd: 'Num +', numsub: 'Num -', numdiv: 'Num /', numdec: 'Num ,',
  };

  // "CommandOrControl+Alt+T" -> "Strg+Alt+T"
  function hotkeyLabel(acc) {
    if (!acc) return '';
    const parts = String(acc).split('+');
    const key = parts.pop();
    const k = key.toLowerCase();
    const keyText = KEY_LABELS[k] || (/^num\d$/.test(k) ? `Num ${k.slice(3)}` : key.length === 1 ? key.toUpperCase() : key);
    return [...parts.map((p) => MOD_LABELS[p.toLowerCase()] || p), keyText].join('+');
  }

  // Windows-Tastencode -> Tastenname für Electron. Buchstaben über keyCode, damit Y/Z auf QWERTZ stimmen.
  function keyName(code) {
    if ((code >= 65 && code <= 90) || (code >= 48 && code <= 57)) return String.fromCharCode(code);
    if (code >= 112 && code <= 135) return `F${code - 111}`;
    if (code >= 96 && code <= 105) return `num${code - 96}`;
    const named = {
      106: 'nummult', 107: 'numadd', 109: 'numsub', 110: 'numdec', 111: 'numdiv', 32: 'Space', 13: 'Enter',
      9: 'Tab', 8: 'Backspace', 46: 'Delete', 45: 'Insert', 36: 'Home', 35: 'End', 33: 'PageUp', 34: 'PageDown',
      37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down', 44: 'PrintScreen', 187: 'Plus', 189: '-', 188: ',', 190: '.',
    };
    return named[code] || null;
  }

  function onHotkeyDown(e) {
    const mods = [];
    if (e.ctrlKey) mods.push('CommandOrControl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const code = e.keyCode;
    if (code === 229) return; // Eingabehilfe/IME

    // Nur Umschalt/Strg/Alt/Win gedrückt: Zwischenstand zeigen
    if ([16, 17, 18, 91, 92, 93, 225].includes(code)) {
      e.preventDefault();
      hotkeyDraft = true;
      $('hotkey').value = `${mods.map((m) => MOD_LABELS[m.toLowerCase()]).join('+')}+`;
      return;
    }
    if (!mods.length) {
      if (code === 9 || code === 13 || code === 27) return; // Tab, Eingabe, Esc: wie im übrigen Dialog
      e.preventDefault();
      e.stopPropagation();
      if (code === 8 || code === 46) return setHotkey(''); // Rücktaste/Entf = entfernen
      return hotkeyError('Bitte zusammen mit Strg oder Alt drücken.');
    }
    e.preventDefault();
    e.stopPropagation();
    const key = keyName(code);
    if (!key) return hotkeyError('Diese Taste geht leider nicht.');
    const acc = [...mods, key].join('+');
    if (mods.length === 1 && mods[0] === 'Shift' && !/^F\d+$/.test(key)) {
      return hotkeyError('Umschalt allein reicht nicht – bitte Strg oder Alt dazunehmen.');
    }
    // Strg+Alt ist auf deutschen Tastaturen AltGr: Strg+Alt+Q tippt "@" – so ein Kürzel würde das Zeichen blockieren
    const plain = key === 'Plus' ? '+' : key.length === 1 ? key : null;
    if (plain && e.ctrlKey && e.altKey && !e.shiftKey && typeof e.key === 'string' && e.key.length === 1 && e.key.toLowerCase() !== plain.toLowerCase()) {
      return hotkeyError(`${hotkeyLabel(acc)} tippt auf dieser Tastatur „${e.key}“ – bitte eine andere Taste.`);
    }
    setHotkey(acc);
  }

  function onHotkeyUp() {
    if (!hotkeyDraft) return;
    hotkeyDraft = false;
    $('hotkey').value = hotkeyLabel(state.hotkey);
  }

  function setHotkey(acc) {
    hotkeyDraft = false;
    clearError('hotkey');
    state.hotkey = acc;
    render();
  }

  function hotkeyError(text) {
    hotkeyDraft = false;
    showSlot('hotkey', text);
    $('hotkey').value = hotkeyLabel(state.hotkey);
  }

  // ---------------------------------------------------------------- Registerkarten und Tastatur

  function selectTab(tab, focus) {
    for (const t of all('.tab')) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
  }

  function stepTab(dir, focus) {
    const tabs = all('.tab');
    const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    selectTab(tabs[(i + dir + tabs.length) % tabs.length], focus);
  }

  function onTabsKey(e) {
    const tabs = all('.tab');
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      stepTab(e.key === 'ArrowRight' ? 1 : -1, true);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      selectTab(e.key === 'Home' ? tabs[0] : tabs[tabs.length - 1], true);
    }
  }

  function onKey(e) {
    if (e.defaultPrevented) return;
    const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
    if (e.key === 'Escape' && plain) {
      e.preventDefault();
      window.close();
    } else if (e.key === 'Enter' && plain) {
      // Eingabe = OK, außer eine Schaltfläche hat den Fokus (die reagiert selbst)
      if (e.target && e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      onOk();
    } else if (e.ctrlKey && !e.altKey && (e.key === 'Tab' || e.key === 'PageDown' || e.key === 'PageUp')) {
      // Strg+Tab wie in jedem Eigenschaftendialog; der Fokus geht auf die Registerkarte
      e.preventDefault();
      stepTab(e.key === 'PageUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1, true);
    }
  }

  // ---------------------------------------------------------------- Eingaben

  function edit(fn, errName) {
    if (!state) return;
    fn();
    if (errName) clearError(errName);
    render();
  }

  function normalizeTime(v) {
    const t = String(v || '').trim().replace('.', ':');
    let m = /^(\d{1,2})$/.exec(t);
    if (m && Number(m[1]) < 24) return `${m[1].padStart(2, '0')}:00`;
    m = /^(\d{1,2}):(\d{2})$/.exec(t) || /^(\d{1,2})(\d{2})$/.exec(t); // "7:30", "730", "0730"
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return `${m[1].padStart(2, '0')}:${m[2]}`;
    return String(v || '').trim();
  }

  function ntfyFromUrl(v) {
    const s = String(v || '').trim();
    const m = /^(?:https?:\/\/)?ntfy\.sh\/([^/?#\s]+)\/?$/i.exec(s);
    return m ? m[1] : s;
  }

  function wire() {
    for (const t of all('.tab')) t.addEventListener('click', () => selectTab(t));
    $('tabs').addEventListener('keydown', onTabsKey);
    document.addEventListener('keydown', onKey);

    // Anzeige
    $('designList').addEventListener('change', (e) => {
      if (e.target.name === 'design') edit(() => (state.design = e.target.value));
    });
    $('ledColor').addEventListener('change', (e) => edit(() => (state.ledColor = e.target.value)));
    $('position').addEventListener('change', (e) => edit(() => (state.position = e.target.value)));
    $('size').addEventListener('change', (e) => edit(() => (state.size = Number(e.target.value))));
    $('duration').addEventListener('input', (e) => edit(() => (state.duration = Number(e.target.value))));
    $('durationNum').addEventListener('input', (e) => {
      const n = Number(e.target.value);
      if (Number.isInteger(n) && n >= 5 && n <= 60) edit(() => (state.duration = n));
    });
    $('durationNum').addEventListener('change', (e) => {
      let n = Math.round(Number(e.target.value));
      if (!Number.isFinite(n) || e.target.value === '') n = state.duration;
      n = Math.min(60, Math.max(5, n));
      e.target.value = String(n);
      edit(() => (state.duration = n));
    });

    // Ton
    $('sound').addEventListener('change', (e) => edit(() => (state.sound = e.target.checked)));
    $('volume').addEventListener('input', (e) => edit(() => (state.volume = Number(e.target.value))));
    $('eventSounds').addEventListener('change', (e) => edit(() => (state.eventSounds = e.target.checked)));
    $('soundName').addEventListener('change', (e) => onSoundSelect(false, e.target.value));
    $('favoriteSound').addEventListener('change', (e) => onSoundSelect(true, e.target.value));
    $('testSound').addEventListener('click', () => testSound(false));
    $('testFavoriteSound').addEventListener('click', () => testSound(true));
    $('pickSound').addEventListener('click', () => pickFile(false));
    $('pickFavoriteSound').addEventListener('click', () => pickFile(true));

    // Teams
    $('compGrid').addEventListener('change', (e) => {
      const ids = all('input[data-comp]').filter((c) => c.checked).map((c) => Number(c.dataset.comp));
      const known = meta.competitions.map((c) => c.id);
      edit(() => {
        state.competitions = [...ids, ...state.competitions.filter((id) => !known.includes(id))];
        buildTeamList();
      }, 'competitions');
    });
    $('germanOnly').addEventListener('change', (e) => edit(() => (state.germanOnly = e.target.checked)));
    $('favorite').addEventListener('change', (e) => {
      const o = e.target.selectedOptions[0];
      edit(() => (state.favorite = o && o.team ? plainTeam(o.team) : null));
    });
    for (const r of all('input[name=concededMode]')) r.addEventListener('change', () => edit(() => (state.concededMode = r.value)));
    for (const r of all('input[name=teamMode]')) {
      r.addEventListener('change', () =>
        edit(() => {
          teamMode = r.value;
          setTeams();
        }, 'teams')
      );
    }
    $('teamList').addEventListener('change', (e) => {
      const t = e.target.team;
      if (!t) return;
      edit(() => {
        teamSel = teamSel.filter((x) => !sameTeam(x, t));
        if (e.target.checked) teamSel.push(plainTeam(t));
        setTeams();
      }, 'teams');
    });

    // Ereignisse
    for (const c of all('input[data-event]')) c.addEventListener('change', () => edit(() => (state.events[c.dataset.event] = c.checked)));

    // Handy & Discord
    $('ntfyTopic').addEventListener('input', (e) => {
      $('ntfyResult').textContent = '';
      edit(() => (state.forward.ntfyTopic = e.target.value.trim()), 'ntfyTopic');
    });
    $('ntfyTopic').addEventListener('change', (e) => {
      e.target.value = ntfyFromUrl(e.target.value);
      edit(() => (state.forward.ntfyTopic = e.target.value));
    });
    $('discordWebhook').addEventListener('input', (e) => {
      $('discordResult').textContent = '';
      edit(() => (state.forward.discordWebhook = e.target.value.replace(/\s/g, '')), 'discordWebhook');
    });
    $('testNtfy').addEventListener('click', () => testForward('ntfy'));
    $('testDiscord').addEventListener('click', () => testForward('discord'));
    $('onlyFavorite').addEventListener('change', (e) => edit(() => (state.forward.onlyFavorite = e.target.checked)));
    $('discordStatus').addEventListener('change', (e) => edit(() => (state.discordStatus = e.target.checked)));

    // Allgemein
    $('autostart').addEventListener('change', (e) => edit(() => (state.autostart = e.target.checked), 'autostart'));
    $('hotkey').addEventListener('keydown', onHotkeyDown);
    $('hotkey').addEventListener('keyup', onHotkeyUp);
    $('hotkey').addEventListener('blur', onHotkeyUp);
    $('hotkeyClear').addEventListener('click', () => {
      setHotkey('');
      $('hotkey').focus();
    });
    $('quietOn').addEventListener('change', (e) => edit(() => (state.quiet.enabled = e.target.checked), 'quiet'));
    for (const id of ['quietFrom', 'quietTo']) {
      const key = id === 'quietFrom' ? 'from' : 'to';
      $(id).addEventListener('input', (e) => edit(() => (state.quiet[key] = e.target.value.trim()), 'quiet'));
      $(id).addEventListener('change', (e) => {
        e.target.value = normalizeTime(e.target.value);
        edit(() => (state.quiet[key] = e.target.value));
      });
    }
    $('unmute').addEventListener('click', unmute);
    setInterval(renderMute, 30000);

    // Unten
    $('preview').addEventListener('click', onPreview);
    $('ok').addEventListener('click', onOk);
    $('cancel').addEventListener('click', () => window.close());
    $('apply').addEventListener('click', onApply);
  }

  wire();
  load();
})();
