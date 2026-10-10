const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, powerMonitor, globalShortcut, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const feed = require('./feed');
const { GoalDetector, StatusTracker } = require('./detector');
const { trayIcon } = require('./icon');
const { norm, sameTeam } = require('./teams');
const store = require('./settingsStore');
const texts = require('./texts');
const forward = require('./forward');
const popups = require('./popups');
const sound = require('./soundPlayer');
const { showToast } = require('./toast');
const config = require('./config');
const { DiscordPresence, buildActivity } = require('./discordPresence');

const DEMO = process.argv.includes('--demo');
const AUTOSTARTED = process.argv.includes('--autostart');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId('de.toralarm.app');

// ---------------------------------------------------------------- Protokoll

let logFile = null;
function log(...a) {
  const line = `[${new Date().toLocaleString('de-DE')}] ${a.join(' ')}`;
  console.log(line);
  if (!logFile) return;
  try {
    // Klein halten: über 1 MB wird neu angefangen
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1024 * 1024) fs.renameSync(logFile, logFile + '.alt');
    fs.appendFileSync(logFile, line + '\n');
  } catch {
    /* Protokoll ist nicht wichtig genug, um daran zu scheitern */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COMP = new Map(feed.COMPETITIONS.map((c) => [c.id, c]));
const DOMESTIC_LEAGUES = [54, 146, 208, 9676]; // Ligen mit Tabelle, aus denen die Teamlisten kommen
const GERMAN_MEN = [54, 146, 208]; // für "Europapokal nur mit deutschen Teams"

// ---------------------------------------------------------------- Einstellungen

const settingsFile = () => path.join(app.getPath('userData'), 'einstellungen.json');
let settings = store.migrate(null);

const backupFile = () => settingsFile().replace(/\.json$/, '.bak.json');

// Rückgabe: false nur bei der allerersten Nutzung (keine Datei) – dann Begrüßung/Autostart
function loadSettings() {
  const file = settingsFile();
  let raw = null;
  let state = 'ok';
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e && e.code === 'ENOENT') state = 'neu';
    else {
      // Kaputte Datei (z. B. Stromausfall beim Speichern): aufheben und die letzte gute Fassung nehmen
      state = 'kaputt';
      try {
        fs.copyFileSync(file, file.replace(/\.json$/, `.kaputt-${Date.now()}.json`));
      } catch {
        /* nicht schlimm */
      }
      try {
        raw = JSON.parse(fs.readFileSync(backupFile(), 'utf8'));
        log('Einstellungsdatei war beschädigt – letzte Sicherung geladen.');
      } catch {
        log('Einstellungsdatei war beschädigt, keine Sicherung – Standardwerte.');
      }
    }
  }
  settings = store.migrate(raw);
  // Kein Erststart: Autostart nicht ungefragt wieder einschalten
  if (state === 'kaputt' && raw == null) settings.autostartSet = true;
  return state !== 'neu';
}

function saveSettings() {
  try {
    const file = settingsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(settings, null, 2));
      fs.fsyncSync(fd); // wirklich auf der Platte, bevor die alte Datei ersetzt wird
    } finally {
      fs.closeSync(fd);
    }
    // Die bisherige Datei als Sicherung behalten – aber nur, wenn sie selbst in Ordnung ist
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.copyFileSync(file, backupFile());
    } catch {
      /* keine oder kaputte alte Datei: keine Sicherung */
    }
    fs.renameSync(tmp, file);
  } catch (e) {
    log('Einstellungen konnten nicht gespeichert werden:', e.message);
  }
}

// Im Entwicklungsmodus ist process.execPath die nackte electron.exe – dann muss der App-Ordner
// als Argument mit. "--autostart" sagt beim Hochfahren: still starten, kein Fenster öffnen.
const loginOpts = () =>
  app.isPackaged ? { args: ['--autostart'] } : { path: process.execPath, args: [`"${app.getAppPath()}"`, '--autostart'] };

function autostartEnabled() {
  const s = app.getLoginItemSettings(loginOpts());
  return !!(s.openAtLogin || s.executableWillLaunchAtLogin);
}

function setAutostart(on) {
  app.setLoginItemSettings({ openAtLogin: !!on, ...loginOpts() });
}

function isMuted(now = Date.now()) {
  return settings.muteUntil > now || store.isQuietNow(settings, new Date(now));
}

// ---------------------------------------------------------------- Discord-Status

// Zeigt im Discord-Profil "Schaut Tor-Alarm" mit Spielstand und Knöpfen (Download, Live-Ergebnisse).
let presence = null;
let lastGoal = null; // { match, scorer, team, minute, at } – für "Letztes Tor: …"

function refreshPresence() {
  if (!presence) presence = new DiscordPresence({ clientId: config.DISCORD_CLIENT_ID, log });
  if (!config.DISCORD_CLIENT_ID || settings.discordStatus === false) {
    presence.stop();
    return;
  }
  presence.start();
  try {
    presence.setActivity(
      buildActivity({
        matches: matches.filter((m) => competitionWanted(m)),
        favorite: settings.favorite,
        lastGoal,
        siteUrl: config.SITE_URL,
        iconUrl: config.ICON_URL,
      })
    );
  } catch (e) {
    log('Discord-Status:', e.message);
  }
}

// ---------------------------------------------------------------- Teams & Filter

let germanTeamIds = new Set();

function rebuildGermanIds() {
  germanTeamIds = new Set(settings.knownTeams.filter((t) => GERMAN_MEN.includes(t.leagueId)).map((t) => t.id));
}

async function loadTeams() {
  const all = [];
  await Promise.all(
    DOMESTIC_LEAGUES.map(async (leagueId) => {
      try {
        const teams = await feed.fotmobTeams(leagueId);
        for (const t of teams) all.push({ id: t.id, name: t.name, leagueId });
      } catch (e) {
        log(`Teamliste ${leagueId} nicht geladen:`, e.message);
      }
    })
  );
  if (!all.length) return;
  // Teams aus Ligen, die diesmal nicht geladen werden konnten, aus dem alten Stand behalten
  const loaded = new Set(all.map((t) => t.leagueId));
  const keep = settings.knownTeams.filter((t) => !loaded.has(t.leagueId));
  settings.knownTeams = [...all, ...keep];
  rebuildGermanIds();
  saveSettings();
  refreshTray();
  broadcastSettings(); // offenes Einstellungsfenster bekommt die Teamliste sofort
}

// Auswahl { id, name } gegen ein Team prüfen: FotMob-IDs, sonst über den Namen (OpenLigaDB hat andere IDs)
function sameSel(sel, team, source) {
  if (!sel || !team) return false;
  if (source === 'fotmob' && sel.id != null && team.id != null) return sel.id === team.id;
  return sameTeam(sel.name, team.full || team.name);
}

function competitionWanted(m) {
  const comp = m.competition || COMP.get(54);
  if (!settings.competitions.includes(comp.id)) return false;
  if (comp.intl && settings.germanOnly && germanTeamIds.size) {
    return germanTeamIds.has(m.home.id) || germanTeamIds.has(m.away.id);
  }
  return true;
}

function teamWanted(m) {
  if (!settings.teams.length) return true;
  return settings.teams.some((sel) => sameSel(sel, m.home, m.source) || sameSel(sel, m.away, m.source));
}

const matchWanted = (m) => competitionWanted(m) && teamWanted(m);

function favoriteSide(m) {
  const fav = settings.favorite;
  if (!fav) return null;
  if (sameSel(fav, m.home, m.source)) return 'home';
  if (sameSel(fav, m.away, m.source)) return 'away';
  return null;
}

// ---------------------------------------------------------------- Abfrage

const detectors = { fotmob: new GoalDetector(), openligadb: new GoalDetector() };
const trackers = { fotmob: new StatusTracker(), openligadb: new StatusTracker() };
const trackerSeen = { fotmob: 0, openligadb: 0 };
let matches = [];
let source = 'fotmob';
let fotmobDownSince = null;
let lastOk = 0;
let lastError = null;
let pollTimer = null;
let polling = false;
let catchUp = false; // nächster Abruf nach Standby: verpasste Tore gesammelt melden
let currentDay = feed.ymd(new Date());

// Pro Spiel und Seite: welche Tore schon gemeldet wurden – über beide Quellen hinweg.
const announced = new Set();
// Kürzlich aberkannte Tore, damit "zählt doch" erkannt wird.
const recentlyDisallowed = new Map();
// Anpfiff/Halbzeit/Abpfiff/Rote Karten schon gemeldet – auch über einen Quellenwechsel hinweg
const statusAnnounced = new Set();

const fixtureKey = (m) =>
  `${(m.competition && m.competition.id) || 54}|${m.startUtc ? new Date(m.startUtc).getTime() : '?'}|${norm(m.home.full || m.home.name)}`;

async function fetchMatches(now) {
  const competitions = settings.competitions;
  let fmError = null;
  try {
    const list = await feed.fotmobToday(now, { competitions });
    if (source !== 'fotmob') log('FotMob wieder erreichbar – zurück zur Hauptquelle.');
    source = 'fotmob';
    fotmobDownSince = null;
    return list;
  } catch (e) {
    fmError = e;
    log('FotMob-Fehler:', e.message);
    if (!fotmobDownSince) fotmobDownSince = Date.now();
    // Kurze Aussetzer (WLAN nach dem Aufwachen, Rate-Limit) aussitzen.
    if (source === 'fotmob' && Date.now() - fotmobDownSince < 2 * 60_000) throw e;
  }
  const list = await feed.openLigaToday(now, { competitions }); // wirft, wenn auch das nicht geht
  // OpenLigaDB kennt nur die drei Männer-Ligen. Laufen gerade nur Spiele, die es nicht kennt
  // (Europapokal, Pokal, Frauen-BL), lieber beim alten FotMob-Stand bleiben und es weiter versuchen.
  if (
    source === 'fotmob' &&
    !list.some((x) => x.status === 'live') &&
    matches.some((x) => x.source === 'fotmob' && x.status === 'live')
  ) {
    throw fmError || new Error('FotMob nicht erreichbar');
  }
  if (source !== 'openligadb') {
    log('FotMob seit über 2 Minuten nicht erreichbar – nutze OpenLigaDB.');
    source = 'openligadb';
    // Alter Stand aus einem früheren Ausfall ist wertlos. Stattdessen mit dem letzten
    // FotMob-Stand starten – so gehen Tore aus der Zwischenzeit nicht verloren.
    const ol = detectors.openligadb;
    if (Date.now() - ol.lastUpdate > 5 * 60_000) {
      ol.reset();
      const fm = new Map(matches.filter((x) => x.source === 'fotmob').map((x) => [fixtureKey(x), x]));
      for (const x of list) {
        const prev = fm.get(fixtureKey(x));
        if (prev) ol.seed(x.id, [prev.homeScore, prev.awayScore]);
      }
      // Der Stand ist so frisch wie der letzte FotMob-Abruf – Tore aus der kurzen Lücke normal melden
      if (ol.primed) ol.lastUpdate = detectors.fotmob.lastUpdate;
    }
  }
  return list;
}

// Wettbewerbe, die gerade (wieder) angewählt wurden: deren alter Stand ist veraltet
const justAdded = new Set();
function forgetJustAdded(list) {
  if (!justAdded.size) return;
  for (const m of list) {
    if (!justAdded.has((m.competition || {}).id)) continue;
    for (const x of [...Object.values(detectors), ...Object.values(trackers)]) x.state.delete(m.id);
  }
  justAdded.clear();
}

async function poll() {
  if (polling) return;
  polling = true;
  clearTimeout(pollTimer);
  try {
    const now = new Date();
    const day = feed.ymd(now);
    if (day !== currentDay) {
      currentDay = day;
      for (const d of Object.values(detectors)) d.reset();
      for (const t of Object.values(trackers)) t.reset();
      announced.clear();
      statusAnnounced.clear();
      recentlyDisallowed.clear();
      loadTeams();
    }
    const gap = lastOk ? Date.now() - lastOk : 0;
    matches = await fetchMatches(now);
    lastOk = Date.now();
    lastError = null;
    forgetJustAdded(matches);

    // Veraltet ist, was diese Quelle zuletzt vor über 3 Minuten gesehen hat (Standby, Netz weg,
    // oder die Quelle war eine Weile nicht aktiv) – dann gesammelt melden statt Pfiff-Lawine.
    const det = detectors[source];
    const stale = det.primed && Date.now() - det.lastUpdate > 3 * 60_000;
    const events =
      source === 'fotmob'
        ? det.update(matches, { dropConfirm: 2 })
        : det.update(matches, { dropConfirm: 4, silentDrops: true });
    const quietCatchUp = catchUp || stale || gap > 3 * 60_000;
    // Nach Standby nicht nachträglich aufs Handy funken; nach einem Netz-Aussetzer schon
    if (quietCatchUp) reportMissed(events, { forward: !catchUp });
    else for (const ev of events) onScoreEvent(ev);

    // Anpfiff, Halbzeit, Abpfiff, Rote Karten – nach einer Lücke nicht nachträglich melden
    const tracker = trackers[source];
    const trackerStale = trackerSeen[source] && Date.now() - trackerSeen[source] > 3 * 60_000;
    const statusEvents = tracker.update(matches, { now: Date.now() });
    trackerSeen[source] = Date.now();
    if (!quietCatchUp && !trackerStale) for (const ev of statusEvents) onStatusEvent(ev);
    catchUp = false;
  } catch (e) {
    lastError = e.message;
  } finally {
    polling = false;
    schedule();
    try {
      refreshTray();
    } catch (e) {
      log('Tray-Fehler:', e.message);
    }
    refreshPresence();
  }
}

function nextDelay() {
  const d = baseDelay();
  // Im Ersatzbetrieb oft nachsehen, ob FotMob wieder da ist
  return source === 'openligadb' ? Math.min(d, 30_000) : d;
}

function baseDelay() {
  const now = Date.now();
  if (lastError) return 30_000;
  if (matches.some((m) => m.status === 'live')) return 12_000;
  const pre = matches.filter((m) => m.status === 'pre' && m.startUtc).map((m) => new Date(m.startUtc).getTime() - now);
  if (pre.some((d) => d < 15 * 60_000)) return 20_000;
  // Bis kurz vor den nächsten Anpfiff schlafen, höchstens 10 Minuten am Stück.
  const next = pre.map((d) => d - 15 * 60_000).filter((d) => d > 0).sort((a, b) => a - b)[0];
  return Math.min(next ?? Infinity, 10 * 60_000);
}

function schedule() {
  clearTimeout(pollTimer);
  const d = nextDelay();
  pollTimer = setTimeout(poll, Number.isFinite(d) ? Math.max(5_000, d) : 60_000);
}

// ---------------------------------------------------------------- Karten

function designNow(s = settings) {
  return s.design;
}

function makeCard(m, extra) {
  const card = {
    design: designNow(),
    ledColor: settings.ledColor,
    duration: settings.duration * 1000,
    competition: m.competition || COMP.get(54),
    round: m.round || null,
    url: m.url,
    home: m.home,
    away: m.away,
    score: [m.homeScore, m.awayScore],
    minute: m.status === 'done' ? 'Ende' : m.minute,
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
  card.text = texts.describe(card);
  return card;
}

function soundFor(name, file) {
  if (name === 'datei' && !file) return { name: 'pfiff', volume: settings.volume };
  return { name, file: name === 'datei' ? file : undefined, volume: settings.volume };
}

function goalSound(card) {
  if (!settings.sound || card.conceded) return null;
  if (card.favorite && settings.favoriteSound !== 'gleich') return soundFor(settings.favoriteSound, settings.favoriteSoundFile);
  return soundFor(settings.soundName, settings.soundFile);
}

function eventSound(type) {
  if (!settings.sound || !settings.eventSounds) return null;
  // Rote Karte: eigenes kurzes Dreifach-Pfeifen, damit sie nicht wie ein Tor klingt
  const name = { kickoff: 'anpfiff', halftime: 'halbzeitpfiff', fulltime: 'abpfiff', redcard: 'rotpfiff' }[type];
  return name ? { name, volume: settings.volume } : null;
}

// Zeigt eine Karte im gewählten Design. Rückgabe: Popup-Handle (für spätere Updates) oder null.
function present(card, { soundSpec = null, force = false } = {}) {
  if (!force && !card.demo && isMuted()) return null;
  if (soundSpec) sound.play(soundSpec);
  if (card.design === 'windows') {
    showToast(card).catch((e) => log('Windows-Meldung fehlgeschlagen:', e.message));
    return null;
  }
  return popups.showPopup(card);
}

function update(handle, card, upd) {
  Object.assign(card, upd);
  card.text = texts.describe(card);
  if (handle) popups.updatePopup(handle, { ...upd, text: card.text });
}

function forwardCard(card) {
  const f = settings.forward;
  if (card.demo || (!f.ntfyTopic && !f.discordWebhook)) return;
  // "Nur Lieblingsverein" greift nur, wenn auch einer gewählt ist – sonst würde gar nichts mehr ankommen
  if (f.onlyFavorite && settings.favorite && !card.favoriteSide) return;
  // Ruhezeit (z. B. nachts) gilt auch fürs Handy. "Stumm schalten" betrifft dagegen nur den PC –
  // wer unterwegs ist, will die Tore ja gerade aufs Handy bekommen.
  if (store.isQuietNow(settings, new Date())) return;
  let msg;
  try {
    msg = texts.forwardMessage(card);
  } catch (e) {
    log('Weiterleitung – Text fehlgeschlagen:', e.message);
    return;
  }
  if (f.ntfyTopic)
    forward.sendNtfy(f.ntfyTopic, msg).then((r) => r && !r.ok && log('ntfy:', r.error), (e) => log('ntfy:', e.message));
  if (f.discordWebhook)
    forward
      .sendDiscord(f.discordWebhook, msg)
      .then((r) => r && !r.ok && log('Discord:', r.error), (e) => log('Discord:', e.message));
}

// ---------------------------------------------------------------- Tore

function onScoreEvent(ev) {
  const run = ev.type === 'disallowed' ? onDisallowed(ev) : ev.type === 'jump' ? onJump(ev) : onGoal(ev);
  Promise.resolve(run).catch((e) => log('Fehler bei Ereignis:', e.stack || e.message));
}

// Bestätigter Riesensprung im Spielstand (> 3 Tore auf einmal): als Tore verbuchen, aber nur eine
// ruhige Sammelkarte zeigen. Liefert die Zahl der noch nicht gemeldeten Tore je Seite.
function bookJump(ev) {
  const fx = fixtureKey(ev.match);
  const missed = { home: 0, away: 0 };
  ['home', 'away'].forEach((side, i) => {
    for (let n = ev.prev[i] + 1; n <= ev.score[i]; n++) {
      const key = `${fx}|${side}|${n}`;
      if (announced.has(key)) continue;
      announced.add(key);
      missed[side] += 1;
    }
  });
  return missed;
}

function onJump(ev) {
  const m = ev.match;
  const missed = bookJump(ev);
  log('SPRUNG', `${m.home.name} ${ev.prev[0]}:${ev.prev[1]} → ${ev.score[0]}:${ev.score[1]} ${m.away.name}`);
  if (!(missed.home || missed.away) || !matchWanted(m)) return;
  present(makeCard(m, { type: 'missed', missed, favoriteSide: favoriteSide(m) }));
}

// Nach Standby oder längerem Netzausfall: keine Pfiff-Lawine, sondern pro Spiel eine ruhige Karte.
function reportMissed(events, { forward: sendOn = false } = {}) {
  // Aberkannte Tore zuerst verbuchen, sonst würde ein späteres echtes Tor als "schon gemeldet" gelten.
  for (const ev of events) if (ev.type === 'disallowed') forgetDisallowed(ev);
  const byMatch = new Map();
  for (const ev of events) {
    if (ev.type === 'jump') {
      const j = bookJump(ev);
      if (!matchWanted(ev.match) || !(j.home || j.away)) continue;
      const e = byMatch.get(ev.match.id) || { m: ev.match, home: 0, away: 0 };
      e.home += j.home;
      e.away += j.away;
      byMatch.set(ev.match.id, e);
      continue;
    }
    if (ev.type !== 'goal') continue;
    const key = `${fixtureKey(ev.match)}|${ev.side}|${ev.nth}`;
    if (announced.has(key)) continue;
    announced.add(key);
    if (!matchWanted(ev.match)) continue;
    const e = byMatch.get(ev.match.id) || { m: ev.match, home: 0, away: 0 };
    e[ev.side] += 1;
    byMatch.set(ev.match.id, e);
  }
  for (const { m, home, away } of byMatch.values()) {
    log('VERPASST', `${m.home.name} ${m.homeScore}:${m.awayScore} ${m.away.name}`, `(+${home}/+${away})`);
    const card = makeCard(m, { type: 'missed', missed: { home, away }, favoriteSide: favoriteSide(m) });
    present(card);
    if (sendOn) forwardCard(card);
  }
}

// Zurückgenommene Tore dürfen später wieder gemeldet werden.
function forgetDisallowed(ev) {
  const m = ev.match;
  const sideKey = `${fixtureKey(m)}|${ev.side}`;
  const idx = ev.side === 'home' ? 0 : 1;
  for (let n = ev.score[idx] + 1; n <= ev.prev[idx]; n++) announced.delete(`${sideKey}|${n}`);
  recentlyDisallowed.set(sideKey, { prev: ev.prev, at: Date.now() });
  const team = ev.side === 'home' ? m.home : m.away;
  log('ABERKANNT', team.name, `${m.home.name} ${ev.score[0]}:${ev.score[1]} ${m.away.name}`);
}

function onDisallowed(ev) {
  forgetDisallowed(ev);
  const m = ev.match;
  if (!settings.events.disallowed || !matchWanted(m)) return;
  const team = ev.side === 'home' ? m.home : m.away;
  const card = makeCard(m, {
    type: 'disallowed',
    side: ev.side,
    team: team.name,
    score: ev.score,
    prev: ev.prev,
    favoriteSide: favoriteSide(m),
  });
  present(card);
  forwardCard(card);
}

async function onGoal(ev) {
  const m = ev.match;
  const sideKey = `${fixtureKey(m)}|${ev.side}`;
  const key = `${sideKey}|${ev.nth}`;
  if (announced.has(key)) return; // schon über die andere Quelle gemeldet
  announced.add(key);

  const dis = recentlyDisallowed.get(sideKey);
  // Nur kurz nach der Rücknahme – sonst ist es einfach ein neues Tor zum gleichen Spielstand.
  const reinstated = !!dis && Date.now() - dis.at < 4 * 60_000 && dis.prev[0] === ev.score[0] && dis.prev[1] === ev.score[1];
  if (reinstated) recentlyDisallowed.delete(sideKey);

  const team = ev.side === 'home' ? m.home : m.away;
  log(reinstated ? 'ZÄHLT DOCH' : 'TOR', team.name, `${m.home.name} ${ev.score[0]}:${ev.score[1]} ${m.away.name}`);
  if (!matchWanted(m)) return;

  const fav = favoriteSide(m);
  const conceded = !!fav && fav !== ev.side;
  const showIt = !(conceded && settings.concededMode === 'aus');
  const card = makeCard(m, {
    type: 'goal',
    side: ev.side,
    team: team.name,
    score: ev.score,
    reinstated,
    favorite: fav === ev.side,
    conceded: conceded && settings.concededMode === 'leise',
    favoriteSide: fav,
    pending: true,
  });

  let handle = null;
  let shown = false;
  const show = () => {
    if (shown || !showIt) return;
    shown = true;
    handle = present(card, { soundSpec: goalSound(card) });
  };
  // Discord-Status: "Letztes Tor: …"
  const myGoal = { match: m, scorer: null, team: team.name, minute: m.minute, at: Date.now() };
  lastGoal = myGoal;
  refreshPresence();
  // Eigene Popups sofort zeigen (der Torschütze kommt per Update nach). Die Windows-Meldung lässt sich
  // nicht mehr ändern – dort kurz auf den Torschützen warten.
  if (card.design !== 'windows') show();

  // "Gegentore: aus" heißt: auch nicht aufs Handy/in Discord
  let forwarded = !showIt;
  const fwd = () => {
    if (forwarded) return;
    forwarded = true;
    forwardCard(card);
  };

  // Torschütze nachladen – FotMob trägt ihn oft erst ein paar Sekunden später ein.
  const t0 = Date.now();
  for (const wait of [0, 3_000, 4_000, 5_000, 6_000, 8_000, 9_000]) {
    if (wait) await sleep(wait);
    if (shown && (!handle || handle.closed) && forwarded) return;
    try {
      const info = await feed.goalInfo(m, ev.side, ev.score, ev.nth);
      const upd = { varPending: !!info.varPending };
      if (info.goal && info.goal.scorer) {
        upd.goal = info.goal;
        upd.pending = false;
      }
      update(handle, card, upd);
      if (upd.goal) {
        show();
        fwd();
        if (lastGoal === myGoal) {
          myGoal.scorer = upd.goal.scorer;
          myGoal.minute = upd.goal.minute || myGoal.minute;
          refreshPresence();
        }
        if (!info.varPending) break;
      }
    } catch (e) {
      log('Details-Fehler:', e.message);
    }
    if (!shown && Date.now() - t0 > 3_500) {
      update(null, card, { pending: false });
      show();
    }
    if (Date.now() - t0 > 12_000) fwd();
  }
  if (card.pending || card.varPending) update(handle, card, { pending: false, varPending: false });
  show();
  fwd();
}

// ---------------------------------------------------------------- Anpfiff, Halbzeit, Abpfiff, Rote Karte

async function onStatusEvent(ev) {
  try {
    const m = ev.match;
    const type = ev.type;
    // Nach einem Quellenwechsel könnte die andere Quelle dasselbe Ereignis nochmal melden
    const key = `${fixtureKey(m)}|${type}|${ev.side || ''}|${ev.nth || ''}`;
    if (statusAnnounced.has(key)) return;
    statusAnnounced.add(key);
    if (!settings.events[type] || !matchWanted(m)) return;
    const fav = favoriteSide(m);
    log(type.toUpperCase(), `${m.home.name} ${m.homeScore}:${m.awayScore} ${m.away.name}`);

    if (type !== 'redcard') {
      const extra = { type, favoriteSide: fav };
      if (type === 'halftime') extra.minute = 'Halbzeit';
      if (type === 'fulltime') extra.minute = 'Ende';
      const card = makeCard(m, extra);
      present(card, { soundSpec: eventSound(type) });
      forwardCard(card);
      return;
    }

    const team = ev.side === 'home' ? m.home : m.away;
    const card = makeCard(m, { type, side: ev.side, team: team.name, player: null, pending: true, favoriteSide: fav });
    let handle = null;
    if (card.design !== 'windows') handle = present(card, { soundSpec: eventSound(type) });
    for (const wait of [0, 3_000, 6_000]) {
      if (wait) await sleep(wait);
      try {
        const info = await feed.redCardInfo(m, ev.side, ev.nth);
        if (info && info.player) {
          update(handle, card, {
            player: info.player,
            minute: info.minute || card.minute,
            yellowRed: !!info.yellowRed,
            pending: false,
          });
          break;
        }
        // Spieler noch "<TBD>", aber ob Rot oder Gelb-Rot, steht schon fest
        if (info && info.yellowRed && !card.yellowRed) update(handle, card, { yellowRed: true });
      } catch (e) {
        log('Karten-Details:', e.message);
      }
    }
    if (card.pending) update(handle, card, { pending: false });
    if (card.design === 'windows') present(card, { soundSpec: eventSound(type) });
    forwardCard(card);
  } catch (e) {
    log('Fehler bei Status-Ereignis:', e.stack || e.message);
  }
}

// ---------------------------------------------------------------- Konferenz (alle Spielstände)

function conferenceMatches() {
  const order = { live: 0, pre: 1, done: 2 };
  return matches
    .filter((m) => m.status !== 'cancelled' && competitionWanted(m))
    .sort(
      (a, b) =>
        (order[a.status] ?? 3) - (order[b.status] ?? 3) || String(a.startUtc).localeCompare(String(b.startUtc))
    )
    .map((m) => ({
      home: m.home,
      away: m.away,
      score: [m.homeScore, m.awayScore],
      minute: m.status === 'done' ? 'Ende' : m.minute,
      status: m.status,
      startUtc: m.startUtc,
      competition: m.competition || COMP.get(54),
      redCards: m.redCards || [0, 0],
      url: m.url,
    }));
}

function showConference() {
  const list = conferenceMatches();
  const first = list[0];
  const blank = { id: null, name: '', code: '', full: '', logo: null };
  const card = {
    design: designNow(),
    ledColor: settings.ledColor,
    type: 'conference',
    // Durchblättern braucht Zeit: 3 s pro Spiel, mindestens die eingestellte Dauer
    duration: Math.min(60, Math.max(settings.duration, 3 * list.length + 2)) * 1000,
    competition: first ? first.competition : COMP.get(settings.competitions[0]) || COMP.get(54),
    round: null,
    url: 'https://www.fotmob.com/de',
    home: first ? first.home : blank,
    away: first ? first.away : blank,
    score: first ? first.score : [0, 0],
    minute: null,
    side: null,
    team: null,
    favorite: false,
    conceded: false,
    demo: false,
    pending: false,
    matches: list,
  };
  card.text = texts.describe(card);
  return present(card, { force: true });
}

// Tastenkürzel: Gedrückthalten schickt Wiederholungen – die zählen nicht. Ein neuer Druck schließt
// eine noch offene Konferenz wieder (umschalten statt stapeln).
let conferenceHandle = null;
let lastConferenceKey = 0;
function onConferenceHotkey() {
  const now = Date.now();
  const gap = now - lastConferenceKey;
  lastConferenceKey = now; // gleitend: jede Wiederholung verlängert die Sperre
  if (gap < 1000) return;
  if (conferenceHandle && !conferenceHandle.closed) {
    popups.closePopup(conferenceHandle);
    conferenceHandle = null;
    return;
  }
  conferenceHandle = showConference();
}

// ---------------------------------------------------------------- Test-Tor / Vorschau

let demoFlip = 0;
function demoGoal(s = settings) {
  const home = {
    id: 8406,
    name: 'Augsburg',
    code: 'FCA',
    full: 'Augsburg',
    logo: 'https://images.fotmob.com/image_resources/logo/teamlogo/8406.png',
  };
  const away = {
    id: 9823,
    name: 'Bayern',
    code: 'FCB',
    full: 'Bayern München',
    logo: 'https://images.fotmob.com/image_resources/logo/teamlogo/9823.png',
  };
  const side = demoFlip++ % 2 === 0 ? 'home' : 'away';
  const card = {
    design: s.design,
    ledColor: s.ledColor,
    duration: s.duration * 1000,
    type: 'goal',
    demo: true,
    side,
    team: side === 'home' ? home.name : away.name,
    home,
    away,
    score: side === 'home' ? [2, 1] : [1, 2],
    minute: '63',
    round: '5',
    competition: COMP.get(54),
    url: 'https://www.fotmob.com/de/leagues/54/overview/bundesliga',
    favorite: false,
    conceded: false,
    favoriteSide: null,
    goal: null,
    pending: true,
    varPending: false,
    reinstated: false,
  };
  const scorer = { scorer: 'Max Mustermann', minute: '63', penalty: false, ownGoal: false, assist: 'Erika Musterfrau' };
  if (s.sound) {
    const name = s.soundName === 'datei' && !s.soundFile ? 'pfiff' : s.soundName;
    sound.play({ name, file: name === 'datei' ? s.soundFile : undefined, volume: s.volume });
  }
  if (card.design === 'windows') {
    Object.assign(card, { pending: false, goal: scorer });
    card.text = texts.describe(card);
    showToast(card).catch((e) => log('Windows-Meldung fehlgeschlagen:', e.message));
    return;
  }
  card.text = texts.describe(card);
  const handle = popups.showPopup(card, { position: s.position, size: s.size });
  setTimeout(() => {
    Object.assign(card, { pending: false, goal: scorer });
    card.text = texts.describe(card);
    popups.updatePopup(handle, { pending: false, goal: scorer, text: card.text });
  }, 2200);
}

// ---------------------------------------------------------------- Tastenkürzel

let hotkeyActive = '';

function registerHotkey(acc) {
  if (hotkeyActive) {
    try {
      globalShortcut.unregister(hotkeyActive);
    } catch {
      /* egal */
    }
    hotkeyActive = '';
  }
  if (!acc) return true;
  try {
    if (globalShortcut.register(acc, () => onConferenceHotkey())) {
      hotkeyActive = acc;
      return true;
    }
  } catch {
    /* ungültige Tastenkombination */
  }
  return false;
}

const hotkeyLabel = (acc) =>
  String(acc || '')
    .replace(/CommandOrControl|CmdOrCtrl|Control|Ctrl/g, 'Strg')
    .replace(/Shift/g, 'Umschalt');

// ---------------------------------------------------------------- Einstellungsfenster

let settingsWin = null;
let appIcon = null;

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 560,
    height: 600,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Tor-Alarm – Einstellungen',
    icon: appIcon || undefined,
    show: false,
    backgroundColor: '#f0f0f0',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWin.removeMenu();
  settingsWin.loadFile(path.join(__dirname, 'settings', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin && !settingsWin.isDestroyed() && settingsWin.show());
  // Links nicht im Einstellungsfenster öffnen, sondern im Browser
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  settingsWin.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

function broadcastSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:changed', settings);
}

// Nur das Einstellungsfenster darf diese Kanäle benutzen
function fromSettings(e) {
  return settingsWin && !settingsWin.isDestroyed() && e.sender === settingsWin.webContents;
}

function guard(handler) {
  return async (e, ...args) => {
    if (!fromSettings(e)) throw new Error('nicht erlaubt');
    return handler(...args);
  };
}

const DESIGNS = [
  { id: 'tafel', name: 'Anzeigetafel', desc: 'Leuchtpunkte wie die Tafel im Stadion.' },
  { id: 'videotext', name: 'Videotext', desc: 'Wie Seite 250 im Fernsehen, mit laufender Uhr.' },
  { id: 'ticker', name: 'Liveticker', desc: 'Ein Eintrag wie im Liveticker einer Sportseite.' },
  { id: 'windows', name: 'Windows-Benachrichtigung', desc: 'Die normale Windows-Meldung, landet auch im Info-Center.' },
];
const SOUNDS = [
  { id: 'pfiff', name: 'Schiri-Pfiff' },
  { id: 'hupe', name: 'Stadionhupe' },
  { id: 'glocke', name: 'Torglocke' },
  { id: 'jubel', name: 'Stadionjubel' },
  { id: 'datei', name: 'Eigene Datei …' },
];
const LED_COLORS = [
  { id: 'amber', name: 'Bernstein' },
  { id: 'rot', name: 'Rot' },
  { id: 'gruen', name: 'Grün' },
  { id: 'weiss', name: 'Weiß' },
];

ipcMain.handle(
  'settings:get',
  guard(() => settings)
);

ipcMain.handle(
  'settings:meta',
  guard(() => ({
    version: app.getVersion(),
    designs: DESIGNS,
    sounds: SOUNDS,
    ledColors: LED_COLORS,
    competitions: feed.COMPETITIONS.map((c) => ({ id: c.id, name: c.name, short: c.short, intl: !!c.intl })),
    teams: settings.knownTeams.map((t) => ({
      id: t.id,
      name: t.name,
      leagueId: t.leagueId,
      leagueName: (COMP.get(t.leagueId) || {}).name || '',
    })),
    autostart: autostartEnabled(),
  }))
);

ipcMain.handle(
  'settings:save',
  guard((partial) => {
    const p = { ...(partial || {}) };
    if ('autostart' in p) {
      setAutostart(!!p.autostart);
      delete p.autostart;
    }
    // Ungültige Eingaben melden und für diese Felder den bisherigen Wert behalten
    const errors = store.validate(p);
    const before = settings;
    const next = store.merge(settings, p);
    if (errors.ntfyTopic) next.forward.ntfyTopic = before.forward.ntfyTopic;
    if (errors.discordWebhook) next.forward.discordWebhook = before.forward.discordWebhook;
    if (errors.quiet) next.quiet = { ...before.quiet };
    if (errors.competitions) next.competitions = before.competitions.slice();
    if (errors.soundFile) next.soundFile = before.soundFile;
    if (errors.favoriteSoundFile) next.favoriteSoundFile = before.favoriteSoundFile;

    if (errors.hotkey) next.hotkey = before.hotkey;
    else if (next.hotkey !== before.hotkey && !registerHotkey(next.hotkey)) {
      errors.hotkey = 'Dieses Tastenkürzel ist schon belegt.';
      next.hotkey = before.hotkey;
      registerHotkey(before.hotkey);
    }

    // Neu (wieder) angewählte Wettbewerbe: deren alten Stand vergessen, sonst käme alles aus der
    // Zwischenzeit als frische Meldung
    for (const id of next.competitions) if (!before.competitions.includes(id)) justAdded.add(id);

    settings = next;
    saveSettings();
    popups.configure({ position: settings.position, size: settings.size });
    if (String(before.competitions) !== String(settings.competitions)) poll();
    refreshTray();
    refreshPresence();
    return { settings, errors };
  })
);

ipcMain.handle(
  'settings:preview',
  guard((partial) => {
    demoGoal(store.merge(settings, partial || {}));
    return true;
  })
);

ipcMain.handle(
  'settings:test-sound',
  guard((spec) => {
    const s = spec || {};
    sound.play({ name: s.name || 'pfiff', file: s.file, volume: s.volume == null ? settings.volume : s.volume });
    return true;
  })
);

ipcMain.handle(
  'settings:pick-file',
  guard(async () => {
    const res = await dialog.showOpenDialog(settingsWin, {
      title: 'Eigenen Torsound wählen',
      properties: ['openFile'],
      filters: [{ name: 'Audiodateien', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }],
    });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  })
);

ipcMain.handle(
  'settings:test-forward',
  guard(async (cfg) => {
    const c = cfg || {};
    const sample = makeCard(
      {
        competition: COMP.get(54),
        round: '5',
        url: 'https://www.fotmob.com/de',
        home: { id: 8406, name: 'Augsburg', code: 'FCA', full: 'Augsburg', logo: null },
        away: { id: 9823, name: 'Bayern', code: 'FCB', full: 'Bayern München', logo: null },
        homeScore: 2,
        awayScore: 1,
        minute: '63',
        status: 'live',
      },
      {
        type: 'goal',
        side: 'home',
        team: 'Augsburg',
        demo: false,
        goal: { scorer: 'Max Mustermann', minute: '63', penalty: false, ownGoal: false, assist: null },
      }
    );
    const msg = texts.forwardMessage(sample);
    msg.title = `Test: ${msg.title}`;
    const out = {};
    if (c.ntfyTopic) out.ntfy = await forward.sendNtfy(c.ntfyTopic, msg);
    if (c.discordWebhook) out.discord = await forward.sendDiscord(c.discordWebhook, msg);
    return out;
  })
);

// ---------------------------------------------------------------- Tray

let tray = null;

function minuteLabel(min) {
  if (!min) return '';
  return /^\d/.test(min) ? `${min.replace('+', '.+')}'` : min;
}

function scoreLine(m) {
  const home = m.home.full || m.home.name;
  const away = m.away.full || m.away.name;
  if (m.status === 'pre') {
    const t = m.startUtc ? new Date(m.startUtc).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
    return `${home} – ${away}   ${t} Uhr`;
  }
  const extra = m.status === 'live' && m.minute ? `   (${minuteLabel(m.minute)})` : m.status === 'done' ? '   (Ende)' : '';
  return `${home} ${m.homeScore}:${m.awayScore} ${away}${extra}`;
}

function statusText() {
  if (settings.muteUntil > Date.now()) {
    const t = new Date(settings.muteUntil).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `Stumm bis ${t} Uhr`;
  }
  if (store.isQuietNow(settings, new Date())) return 'Ruhezeit – keine Meldungen';
  if (lastError && !lastOk) return 'Keine Verbindung – versuche es weiter …';
  const live = matches.filter((m) => m.status === 'live' && competitionWanted(m)).length;
  if (live) return live === 1 ? 'Gerade läuft 1 Spiel' : `Gerade laufen ${live} Spiele`;
  if (matches.some((m) => m.status === 'pre')) return 'Heute wird noch gespielt';
  if (matches.length) return 'Für heute ist Schluss';
  return 'Heute kein Spiel';
}

function gameMenuItems() {
  const list = matches.filter((m) => m.status !== 'cancelled' && competitionWanted(m));
  if (!list.length) return [{ label: 'Keine Spiele heute', enabled: false }];
  const order = { live: 0, pre: 1, done: 2 };
  list.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || String(a.startUtc).localeCompare(String(b.startUtc)));
  const item = (m) => ({ label: scoreLine(m), click: () => shell.openExternal(m.url) });
  const groups = new Map();
  for (const m of list) {
    const c = m.competition || COMP.get(54);
    if (!groups.has(c.id)) groups.set(c.id, { comp: c, items: [] });
    groups.get(c.id).items.push(item(m));
  }
  if (groups.size === 1) return [...groups.values()][0].items;
  // Mehrere Wettbewerbe: je ein Untermenü, damit die Liste nicht endlos wird
  return [...groups.values()].map((g) => ({ label: `${g.comp.name} (${g.items.length})`, submenu: g.items }));
}

function muteFor(ms) {
  settings.muteUntil = ms ? Date.now() + ms : 0;
  saveSettings();
  refreshTray();
  broadcastSettings();
}

function muteUntilMorning() {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  muteFor(d.getTime() - Date.now());
}

function refreshTray() {
  if (!tray) return;
  const muted = settings.muteUntil > Date.now();
  const menu = Menu.buildFromTemplate([
    { label: 'Tor-Alarm', enabled: false },
    { label: statusText(), enabled: false },
    { type: 'separator' },
    ...gameMenuItems(),
    { type: 'separator' },
    { label: 'Einstellungen …', click: () => openSettings() },
    {
      label: settings.hotkey ? `Alle Spielstände zeigen\t${hotkeyLabel(settings.hotkey)}` : 'Alle Spielstände zeigen',
      click: () => showConference(),
    },
    {
      label: 'Stumm schalten',
      submenu: [
        { label: 'Für 1 Stunde', click: () => muteFor(60 * 60_000) },
        { label: 'Für 3 Stunden', click: () => muteFor(3 * 60 * 60_000) },
        { label: 'Bis morgen 8 Uhr', click: () => muteUntilMorning() },
        { type: 'separator' },
        { label: 'Wieder einschalten', enabled: muted, click: () => muteFor(0) },
      ],
    },
    { label: 'Test-Tor zeigen', click: () => demoGoal() },
    { label: 'Jetzt aktualisieren', click: () => poll() },
    { type: 'separator' },
    { label: `Daten: ${source === 'fotmob' ? 'FotMob' : 'OpenLigaDB (Ersatz, etwas langsamer)'}`, enabled: false },
    { label: 'Beenden', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);

  const liveLines = matches
    .filter((m) => m.status === 'live' && competitionWanted(m))
    .map((m) => `${m.home.name} ${m.homeScore}:${m.awayScore} ${m.away.name}`);
  const head = isMuted() ? 'Tor-Alarm (stumm)' : 'Tor-Alarm';
  const tip = [head, ...(liveLines.length ? liveLines : [statusText()])].join('\n');
  tray.setToolTip(tip.length > 127 ? tip.slice(0, 124) + '…' : tip);
}

// ---------------------------------------------------------------- Start

app.on('second-instance', () => openSettings());
app.on('window-all-closed', () => {}); // im Tray weiterlaufen
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  sound.dispose();
  if (presence) presence.stop();
});

app.whenReady().then(() => {
  logFile = path.join(app.getPath('userData'), 'tor-alarm.log');
  const hadSettings = loadSettings();
  log(`Start ${app.getVersion()}${AUTOSTARTED ? ' (Autostart)' : ''}`);
  rebuildGermanIds();
  sound.setErrorHandler((msg) => log('Sound:', msg));

  // Abrufe über Chromiums Netz statt Node: nimmt Windows-Zertifikate (Virenscanner mit HTTPS-Prüfung,
  // Firmennetz) und den System-Proxy mit. no-store, sonst kämen Spielstände aus dem Cache.
  const netFetch = (url, opts = {}) => net.fetch(url, { ...opts, cache: 'no-store' });
  feed.setFetch(netFetch);
  forward.setFetch(netFetch);

  if (app.isPackaged) {
    if (!settings.autostartSet) {
      // Installierte Version: beim allerersten Start Autostart einschalten (abschaltbar).
      setAutostart(true);
      settings.autostartSet = true;
      saveSettings();
    } else if (app.getLoginItemSettings().executableWillLaunchAtLogin) {
      // Eintrag aus Version 1.0 (ohne "--autostart") auf das neue Format bringen
      setAutostart(true);
    }
  }

  const icon = trayIcon(nativeImage);
  appIcon = icon;
  tray = new Tray(icon);
  tray.on('click', () => tray.popUpContextMenu());
  tray.on('double-click', () => openSettings());
  popups.configure({ position: settings.position, size: settings.size });
  if (settings.hotkey && !registerHotkey(settings.hotkey)) log('Tastenkürzel nicht verfügbar:', settings.hotkey);
  refreshTray();
  loadTeams();
  poll();

  powerMonitor.on('suspend', () => {
    catchUp = true;
  });
  powerMonitor.on('resume', () => {
    log('PC aufgewacht – aktualisiere.');
    catchUp = true;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, 3000);
  });

  // Von Hand gestartet (Desktop-Symbol, Startmenü) → Einstellungen zeigen; beim Hochfahren still bleiben.
  if (!AUTOSTARTED && !DEMO) openSettings();
  if (!hadSettings && !AUTOSTARTED) setTimeout(() => demoGoal(), 1200);
  if (DEMO) setTimeout(() => demoGoal(), 1500);
});

// Nur für automatische Tests (Umgebungsvariable TORALARM_TEST): Zugriff auf die Abläufe von außen
if (process.env.TORALARM_TEST) {
  global.__toralarm = {
    showConference,
    demoGoal,
    onScoreEvent,
    onStatusEvent,
    openSettings,
    getSettings: () => settings,
    setMatches: (list) => {
      matches = list;
    },
  };
}
