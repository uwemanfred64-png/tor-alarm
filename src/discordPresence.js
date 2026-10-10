// Discord-Status ("Rich Presence"): zeigt im Discord-Profil, dass Tor-Alarm läuft – mit Spielstand
// und zwei Knöpfen (Download, Live-Ergebnisse), die andere anklicken können.
// Spricht direkt mit dem Discord-Programm auf diesem PC über dessen lokale Schnittstelle (Named Pipe
// \\?\pipe\discord-ipc-N). Kein Zusatzpaket, kein Konto-Zugriff: Discord zeigt nur, was wir schicken.

const net = require('net');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const MIN_INTERVAL = 15_000; // Discord drosselt häufigere Updates ohnehin
const RETRY = [10_000, 30_000, 60_000]; // Discord nicht offen? Später nochmal versuchen

const defaultPipe = (i) =>
  process.platform === 'win32'
    ? `\\\\?\\pipe\\discord-ipc-${i}`
    : `${process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp'}/discord-ipc-${i}`;

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

// Setzt aus beliebig zerstückelten Daten wieder ganze Frames zusammen
class FrameReader {
  constructor(onFrame) {
    this.buf = Buffer.alloc(0);
    this.onFrame = onFrame;
  }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0);
      const len = this.buf.readInt32LE(4);
      if (len < 0 || len > 1024 * 1024) {
        this.buf = Buffer.alloc(0); // Unsinn – lieber alles verwerfen
        return;
      }
      if (this.buf.length < 8 + len) return;
      const body = this.buf.subarray(8, 8 + len).toString('utf8');
      this.buf = this.buf.subarray(8 + len);
      let data = null;
      try {
        data = JSON.parse(body);
      } catch {
        /* kaputter Frame */
      }
      this.onFrame(op, data);
    }
  }
}

// ---------------------------------------------------------------- Was angezeigt wird

const clip = (s, max) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

function minuteLabel(min) {
  const s = String(min || '').trim();
  if (!s) return '';
  if (/^\d/.test(s)) return `${s.replace('+', '.+')}.`;
  return s; // Halbzeit, Ende, Verlängerung …
}

const scoreLine = (m) => `${m.home.name} ${m.homeScore}:${m.awayScore} ${m.away.name}`;
const clock = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

function isFav(team, fav) {
  if (!fav || !team) return false;
  if (fav.id != null && team.id != null) return fav.id === team.id;
  return String(fav.name || '').toLowerCase() === String(team.full || team.name || '').toLowerCase();
}

// Liga-Logos (Variante für dunkle Hintergründe – Discord ist meist dunkel) und Links zu FotMob
const leagueLogo = (id) => `https://images.fotmob.com/image_resources/logo/leaguelogo/dark/${id}.png`;
const leagueUrl = (id) => `https://www.fotmob.com/de/leagues/${id}/overview`;
const tableUrl = (id) => `https://www.fotmob.com/de/leagues/${id}/table`;
const teamUrl = (id) => `https://www.fotmob.com/de/teams/${id}/overview`;

// "Bundesliga, 5. Spieltag", "DFB-Pokal, 2. Runde", "Champions League, Achtelfinale"
const KO_ROUNDS = { '1/16': 'Sechzehntelfinale', '1/8': 'Achtelfinale', '1/4': 'Viertelfinale', '1/2': 'Halbfinale', final: 'Finale' };
function compLabel(m) {
  const c = m.competition || { name: 'Bundesliga' };
  const r = String(m.round || '').trim().toLowerCase();
  if (KO_ROUNDS[r]) return `${c.name}, ${KO_ROUNDS[r]}`;
  if (/^\d+$/.test(r)) return `${c.name}, ${r}. ${c.id === 209 ? 'Runde' : 'Spieltag'}`;
  return c.name;
}

// Fortschrittsbalken wie bei Spotify ("Schaut …" mit Start und Ende): aus der Spielminute geschätzt
function matchBar(m, now) {
  const mm = /^(\d+)(?:\+(\d+))?$/.exec(String(m.minute || '').trim());
  if (!mm) return null; // Halbzeit, Pause, Elfmeterschießen: kein laufender Balken
  const base = Number(mm[1]);
  const played = Math.min(base + (mm[2] ? Number(mm[2]) : 0), 130);
  const start = now - played * 60_000;
  let end = start + (base > 90 ? 120 : 90) * 60_000;
  if (end < now + 60_000) end = now + 3 * 60_000; // Nachspielzeit: Balken fast voll, nie "abgelaufen"
  return { start: Math.round(start), end: Math.round(end) };
}

// state: { matches, favorite, lastGoal: { match, scorer, team, minute, at }, siteUrl, iconUrl, now }
// Rückgabe: Activity-Objekt für SET_ACTIVITY
function buildActivity(state) {
  const now = state.now || Date.now();
  const site = state.siteUrl || state.downloadUrl || null;
  const matches = (state.matches || []).filter((m) => m && m.home && m.away && m.status !== 'cancelled');
  const fav = state.favorite || null;
  const live = matches.filter((m) => m.status === 'live');
  const pre = matches
    .filter((m) => m.status === 'pre' && m.startUtc && Date.parse(m.startUtc) > now - 10 * 60_000)
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  const favMatch = fav ? matches.find((m) => isFav(m.home, fav) || isFav(m.away, fav)) : null;
  const goal = state.lastGoal && now - state.lastGoal.at < 10 * 60_000 ? state.lastGoal : null;
  // Das Spiel des letzten Tores im aktuellen Stand (nicht im Stand von damals)
  const goalMatch = goal && goal.match ? matches.find((m) => m.id === goal.match.id) || null : null;

  // Welches Spiel steht oben? Lieblingsverein vor letztem Tor vor erstem laufenden Spiel.
  let head = null;
  if (favMatch && favMatch.status === 'live') head = favMatch;
  else if (goalMatch && goalMatch.status === 'live') head = goalMatch;
  else if (live.length) head = live[0];

  // Spiel, dessen Liga-Logo gezeigt wird (auch vor dem Anpfiff oder nach dem Abpfiff)
  let focus = head;
  let details;
  let stateLine;
  if (head) {
    const min = minuteLabel(head.minute);
    details = `${scoreLine(head)}${min ? ` (${min})` : ''}`;
    if (goalMatch && goalMatch.id === head.id) {
      stateLine = `Letztes Tor: ${goal.scorer || goal.team}${goal.minute ? ` (${minuteLabel(goal.minute)})` : ''}`;
    } else if (live.length > 1) {
      stateLine = `${live.length} Spiele laufen gerade`;
    } else {
      stateLine = compLabel(head);
    }
  } else if (favMatch && favMatch.status === 'pre') {
    focus = favMatch;
    details = `Heute: ${favMatch.home.name} – ${favMatch.away.name}`;
    stateLine = `Anpfiff ${clock(favMatch.startUtc)} Uhr`;
  } else if (favMatch && favMatch.status === 'done') {
    focus = favMatch;
    details = `Endstand: ${scoreLine(favMatch)}`;
    stateLine = 'Wartet aufs nächste Spiel';
  } else if (pre.length) {
    focus = pre[0];
    details = 'Wartet auf den Anpfiff';
    stateLine = `${pre[0].home.name} – ${pre[0].away.name}, ${clock(pre[0].startUtc)} Uhr`;
  } else {
    details = 'Wartet aufs nächste Tor';
    stateLine = matches.length ? 'Für heute ist Schluss' : 'Heute kein Spiel';
  }

  const comp = focus && focus.competition ? focus.competition : null;
  const activity = {
    type: 3, // "Schaut …"
    // In der Mitgliederliste den Spielstand zeigen statt nur "Tor-Alarm"
    status_display_type: head ? 2 : 0,
    details: clip(details, 128),
    state: clip(stateLine, 128),
    assets: {},
    buttons: [],
    instance: false,
  };
  if (focus && focus.url) activity.details_url = focus.url;
  if (comp) activity.state_url = tableUrl(comp.id);
  const bar = head ? matchBar(head, now) : null;
  if (bar) activity.timestamps = bar;

  // Großes Bild: Liga-Logo (Klick → Liga-Seite); ohne Spiel das Tor-Alarm-Symbol (Klick → Webseite)
  if (comp) {
    activity.assets.large_image = leagueLogo(comp.id);
    activity.assets.large_text = clip(compLabel(focus), 128);
    activity.assets.large_url = leagueUrl(comp.id);
  } else if (state.iconUrl) {
    activity.assets.large_image = state.iconUrl;
    activity.assets.large_text = 'Tor-Alarm – jedes Tor sofort auf dem Desktop';
    if (site) activity.assets.large_url = site;
  }
  // Kleines Bild: Wappen des Lieblingsvereins, sonst das Tor-Alarm-Symbol
  const favTeam = fav && favMatch ? (isFav(favMatch.home, fav) ? favMatch.home : favMatch.away) : null;
  if (favTeam && favTeam.logo) {
    activity.assets.small_image = favTeam.logo;
    activity.assets.small_text = clip(`Fan von ${favTeam.name}`, 128);
    if (favMatch.source !== 'openligadb' && favTeam.id != null) activity.assets.small_url = teamUrl(favTeam.id);
  } else if (comp && state.iconUrl) {
    activity.assets.small_image = state.iconUrl;
    activity.assets.small_text = 'Tor-Alarm – jedes Tor sofort auf dem Desktop';
    if (site) activity.assets.small_url = site;
  }

  if (site) activity.buttons.push({ label: 'Tor-Alarm holen', url: site });
  activity.buttons.push({
    label: head ? 'Spiel live verfolgen' : 'Live-Ergebnisse',
    url: head && head.url ? head.url : comp ? leagueUrl(comp.id) : 'https://www.fotmob.com/de/leagues/54/overview/bundesliga',
  });
  return activity;
}

// Was ältere Discord-Versionen evtl. noch nicht kennen – wird bei einer Fehlermeldung schrittweise weggelassen
function degrade(activity, level) {
  const a = JSON.parse(JSON.stringify(activity));
  if (level >= 1) {
    delete a.status_display_type;
    delete a.details_url;
    delete a.state_url;
    if (a.assets) {
      delete a.assets.large_url;
      delete a.assets.small_url;
    }
  }
  if (level >= 2) delete a.type;
  return a;
}

// ---------------------------------------------------------------- Verbindung

class DiscordPresence {
  constructor({ clientId, log = () => {}, pipe = defaultPipe, connectTimeout = 3000 } = {}) {
    this.clientId = clientId;
    this.log = log;
    this.pipe = pipe;
    this.connectTimeout = connectTimeout;
    this.enabled = false;
    this.socket = null;
    this.ready = false;
    this.wanted = null; // gewünschte Aktivität
    this.sentJson = null; // zuletzt gesendet (gleiche nicht nochmal schicken)
    this.lastSend = 0;
    this.sendTimer = null;
    this.retryTimer = null;
    this.retryStep = 0;
    this.level = 0; // 0 = alles, 1 = ohne neuere Felder (Links, Anzeige-Art), 2 = zusätzlich ohne "type"
    this.nonce = 0;
  }

  start() {
    if (!this.clientId || this.enabled) return;
    this.enabled = true;
    this.connect();
  }

  stop() {
    this.enabled = false;
    clearTimeout(this.retryTimer);
    clearTimeout(this.sendTimer);
    if (this.socket && this.ready) {
      try {
        this.socket.write(encode(OP.FRAME, this.command(null)));
      } catch {
        /* egal */
      }
    }
    this.close();
    this.sentJson = null;
  }

  setActivity(activity) {
    this.wanted = activity;
    this.schedule();
  }

  command(activity) {
    return { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: `ta-${++this.nonce}` };
  }

  schedule() {
    if (!this.enabled || !this.ready) return;
    clearTimeout(this.sendTimer);
    const wait = Math.max(0, this.lastSend + MIN_INTERVAL - Date.now());
    this.sendTimer = setTimeout(() => this.flush(), wait);
  }

  flush() {
    if (!this.socket || !this.ready || !this.wanted) return;
    const act = degrade(this.wanted, this.level);
    const json = JSON.stringify(act);
    if (json === this.sentJson) return;
    try {
      this.socket.write(encode(OP.FRAME, this.command(act)));
      this.sentJson = json;
      this.lastSend = Date.now();
    } catch (e) {
      this.log('Discord: Senden fehlgeschlagen –', e.message);
    }
  }

  connect(i = 0) {
    if (!this.enabled || this.socket) return;
    if (i > 9) return this.retryLater();
    const sock = net.createConnection(this.pipe(i));
    let opened = false;
    const timer = setTimeout(() => sock.destroy(new Error('Zeitüberschreitung')), this.connectTimeout);
    sock.once('connect', () => {
      opened = true;
      clearTimeout(timer);
      this.socket = sock;
      this.ready = false;
      const reader = new FrameReader((op, data) => this.onFrame(op, data));
      sock.on('data', (c) => reader.push(c));
      sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: String(this.clientId) }));
    });
    sock.on('error', () => {
      /* Ende wird über 'close' behandelt */
    });
    sock.once('close', () => {
      clearTimeout(timer);
      if (!opened) return this.connect(i + 1); // nächste Pipe-Nummer probieren
      if (this.socket === sock) this.close();
      this.retryLater();
    });
  }

  onFrame(op, data) {
    if (op === OP.PING) {
      try {
        this.socket.write(encode(OP.PONG, data));
      } catch {
        /* egal */
      }
      return;
    }
    if (op === OP.CLOSE) {
      this.log('Discord: Verbindung abgelehnt –', data && data.message ? data.message : 'unbekannt');
      this.close();
      return;
    }
    if (op !== OP.FRAME || !data) return;
    if (data.cmd === 'DISPATCH' && data.evt === 'READY') {
      this.ready = true;
      this.retryStep = 0;
      this.sentJson = null;
      this.log('Discord: verbunden');
      this.schedule();
      return;
    }
    if (data.evt === 'ERROR' && data.cmd === 'SET_ACTIVITY') {
      const msg = (data.data && data.data.message) || 'Fehler';
      // Kennt diese Discord-Version etwas nicht? Mit weniger Feldern sofort nochmal versuchen.
      if (this.level < 2) {
        this.level += 1;
        this.log(`Discord: ${msg} – versuche es einfacher (Stufe ${this.level})`);
        this.sentJson = null;
        this.lastSend = 0;
        this.schedule();
        return;
      }
      this.log('Discord:', msg);
    } else if (data.evt === 'ERROR') {
      this.log('Discord:', (data.data && data.data.message) || 'Fehler');
    }
  }

  close() {
    this.ready = false;
    clearTimeout(this.sendTimer);
    const s = this.socket;
    this.socket = null;
    if (s) {
      try {
        s.destroy();
      } catch {
        /* egal */
      }
    }
  }

  retryLater() {
    if (!this.enabled) return;
    clearTimeout(this.retryTimer);
    const wait = RETRY[Math.min(this.retryStep, RETRY.length - 1)];
    this.retryStep += 1;
    this.retryTimer = setTimeout(() => this.connect(), wait);
  }
}

module.exports = { DiscordPresence, buildActivity, degrade, matchBar, encode, FrameReader, OP };
