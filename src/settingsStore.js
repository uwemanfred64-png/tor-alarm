// Einstellungen: Standardwerte, Umzug vom alten 1.0-Format und Prüfung aller Werte.
// Rein, ohne Electron – main.js liest und schreibt die Datei, hier wird nur geprüft und gemischt.
// Keine Funktion hier wirft: kaputte Werte werden durch den Standard (bzw. beim Mischen durch den
// bisherigen Wert) ersetzt.

const DESIGNS = ['tafel', 'videotext', 'ticker', 'windows'];
const LED_COLORS = ['amber', 'rot', 'gruen', 'weiss'];
const POSITIONS = ['unten-rechts', 'oben-rechts', 'unten-links', 'oben-links'];
const SIZES = [100, 125, 150];
const SOUNDS = ['pfiff', 'hupe', 'glocke', 'jubel', 'datei'];
const FAVORITE_SOUNDS = ['gleich', ...SOUNDS];
const CONCEDED = ['normal', 'leise', 'aus'];
const NESTED = ['events', 'forward', 'quiet'];
const BUNDESLIGA = 54; // 1.0 kannte nur die Bundesliga

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

const DEFAULTS = deepFreeze({
  version: 2,
  design: 'tafel',
  ledColor: 'amber',
  position: 'unten-rechts',
  size: 100,
  duration: 14,
  sound: true,
  soundName: 'pfiff',
  soundFile: '',
  volume: 70,
  favoriteSound: 'hupe',
  favoriteSoundFile: '',
  eventSounds: true,
  competitions: [54],
  germanOnly: true,
  teams: [],
  favorite: null,
  concededMode: 'normal',
  events: { disallowed: true, kickoff: false, halftime: false, fulltime: true, redcard: true },
  forward: { ntfyTopic: '', discordWebhook: '', onlyFavorite: false },
  discordStatus: true, // im Discord-Profil "Schaut Tor-Alarm" mit Spielstand zeigen
  hotkey: 'CommandOrControl+Alt+T',
  quiet: { enabled: false, from: '23:00', to: '08:00' },
  muteUntil: 0,
  autostartSet: false,
  knownTeams: [],
});

// ---------------------------------------------------------------- einzelne Werte
// Jede Prüffunktion gibt den bereinigten Wert zurück – oder undefined, wenn er nicht taugt.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const copy = (v) => (v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)));
const bool = (v) => (typeof v === 'boolean' ? v : undefined);

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function clamp(v, lo, hi) {
  const n = num(v);
  return n === undefined ? undefined : Math.min(hi, Math.max(lo, Math.round(n)));
}

function oneOf(v, list) {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  return list.includes(s) ? s : undefined;
}

// 110 % gibt es nicht – dann die nächstliegende erlaubte Größe
function nearest(v, list) {
  const n = num(v);
  if (n === undefined) return undefined;
  return list.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best));
}

function posInt(v) {
  const n = num(v);
  return n !== undefined && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

// Freitext ohne Steuerzeichen, auf eine Zeile gebracht
function text(v, max) {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : undefined;
}

function teamName(v) {
  const s = text(v, 100);
  return s ? s : undefined;
}

function team(v) {
  if (typeof v === 'string') {
    const name = teamName(v);
    return name ? { id: null, name } : undefined;
  }
  if (!isObj(v)) return undefined;
  const name = teamName(v.name);
  return name ? { id: posInt(v.id) ?? null, name } : undefined;
}

// Doppelte raus: gleiche ID, oder gleicher Name, wenn bei einem die ID fehlt (alte 1.0-Einträge).
function teamList(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  for (const raw of v.slice(0, 1000)) {
    const t = team(raw);
    if (!t) continue;
    const lower = t.name.toLowerCase();
    const dup = out.find(
      (x) => (t.id !== null && x.id === t.id) || ((t.id === null || x.id === null) && x.name.toLowerCase() === lower)
    );
    if (!dup) out.push(t);
    else if (dup.id === null && t.id !== null) Object.assign(dup, t);
  }
  return out;
}

function knownList(v, leagueFallback) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  const seen = new Set();
  for (const raw of v.slice(0, 3000)) {
    const t = team(raw);
    if (!t) continue;
    const leagueId = isObj(raw) ? posInt(raw.leagueId) ?? null : leagueFallback;
    const key = `${t.id ?? t.name.toLowerCase()}|${leagueId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: t.id, name: t.name, leagueId });
  }
  return out;
}

function idList(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  for (const x of v.slice(0, 100)) {
    const id = posInt(x);
    if (id !== undefined && !out.includes(id)) out.push(id);
  }
  return out;
}

// Absoluter Windows-Pfad (C:\… oder \\server\freigabe\…). "Als Pfad kopieren" liefert ihn in Anführungszeichen.
function filePath(v) {
  if (typeof v !== 'string') return undefined;
  let s = v.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  if (s === '') return '';
  if (s.length > 1000 || /[\u0000-\u001f<>|"*]/.test(s)) return undefined;
  return /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(s) ? s : undefined;
}

// Das Thema wird erst beim Senden streng geprüft (forward.js) – hier nur aufräumen.
// Wer die Adresse aus der App kopiert ("https://ntfy.sh/mein-thema"), bekommt nur das Thema.
function ntfyTopic(v) {
  const s = text(v, 300);
  if (s === undefined) return undefined;
  const m = /^(?:https?:\/\/)?ntfy\.sh\/([^/?#\s]+)\/?$/i.exec(s);
  return m ? m[1] : s;
}

const webhookText = (v) => {
  const s = text(v, 500);
  return s === undefined ? undefined : s.replace(/\s/g, '');
};

const NTFY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const WEBHOOK_RE = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/;

function time(v) {
  if (typeof v !== 'string') return undefined;
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(v.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return undefined;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

// Electron-Accelerator, z. B. "CommandOrControl+Alt+T". Mindestens ein Modifier, genau eine Taste.
const MODIFIERS = {
  commandorcontrol: 'ctrl',
  cmdorctrl: 'ctrl',
  control: 'ctrl',
  ctrl: 'ctrl',
  alt: 'alt',
  altgr: 'altgr',
  shift: 'shift',
  super: 'super',
  meta: 'super',
};
const NAMED_KEYS = [
  'plus', 'space', 'tab', 'capslock', 'numlock', 'scrolllock', 'backspace', 'delete', 'insert', 'return',
  'enter', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'escape', 'esc', 'volumeup',
  'volumedown', 'volumemute', 'medianexttrack', 'mediaprevioustrack', 'mediastop', 'mediaplaypause',
  'printscreen', 'numdec', 'numadd', 'numsub', 'nummult', 'numdiv',
];

function acceleratorKey(k) {
  if (/^[A-Za-z0-9]$/.test(k)) return true;
  if (/^F(?:[1-9]|1\d|2[0-4])$/i.test(k)) return true;
  if (/^num[0-9]$/i.test(k)) return true;
  if (NAMED_KEYS.includes(k.toLowerCase())) return true;
  return k.length === 1 && ')!@#$%^&*(:;<=,_->.?/~`{][|\\}"\''.includes(k);
}

function accelerator(v) {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (s === '') return '';
  if (s.length > 80) return undefined;
  const parts = s.split('+');
  const key = parts.pop();
  if (!parts.length || !acceleratorKey(key)) return undefined;
  const seen = new Set();
  for (const p of parts) {
    const mod = MODIFIERS[p.toLowerCase()];
    if (!mod || seen.has(mod)) return undefined;
    seen.add(mod);
  }
  return s;
}

function muteUntil(v) {
  const n = num(v);
  return n === undefined || n < 0 ? undefined : Math.round(n);
}

// Unterobjekte feldweise: kaputte Felder fallen auf den Rückfallwert zurück
function sub(v, fb, fields) {
  if (!isObj(v)) return undefined;
  const out = {};
  for (const [k, check] of Object.entries(fields)) {
    const x = check(v[k]);
    out[k] = x === undefined ? fb[k] : x;
  }
  return out;
}

const FIELDS = {
  design: (v) => oneOf(v, DESIGNS),
  ledColor: (v) => oneOf(v, LED_COLORS),
  position: (v) => oneOf(v, POSITIONS),
  size: (v) => nearest(v, SIZES),
  duration: (v) => clamp(v, 5, 60),
  sound: bool,
  soundName: (v) => oneOf(v, SOUNDS),
  soundFile: filePath,
  volume: (v) => clamp(v, 0, 100),
  favoriteSound: (v) => oneOf(v, FAVORITE_SOUNDS),
  favoriteSoundFile: filePath,
  eventSounds: bool,
  competitions: idList,
  germanOnly: bool,
  teams: teamList,
  favorite: (v) => (v === null ? null : team(v)),
  concededMode: (v) => oneOf(v, CONCEDED),
  events: (v, fb) =>
    sub(v, fb, { disallowed: bool, kickoff: bool, halftime: bool, fulltime: bool, redcard: bool }),
  forward: (v, fb) => sub(v, fb, { ntfyTopic, discordWebhook: webhookText, onlyFavorite: bool }),
  discordStatus: bool,
  hotkey: accelerator,
  quiet: (v, fb) => sub(v, fb, { enabled: bool, from: time, to: time }),
  muteUntil,
  autostartSet: bool,
  knownTeams: (v) => knownList(v, null),
};

// Baut ein vollständiges Objekt; was in src nicht taugt, kommt aus fb (Standard oder bisheriger Stand).
function build(src, fb) {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (k === 'version') {
      out.version = 2;
      continue;
    }
    let v;
    try {
      v = FIELDS[k](src[k], fb[k]);
    } catch {
      v = undefined;
    }
    out[k] = v === undefined ? copy(fb[k]) : v;
  }
  // "Eigene Datei" ohne Pfad spielt nichts – dann den bisherigen bzw. Standard-Ton nehmen
  if (out.soundName === 'datei' && !out.soundFile) {
    out.soundName = fb.soundName !== 'datei' ? fb.soundName : DEFAULTS.soundName;
  }
  if (out.favoriteSound === 'datei' && !out.favoriteSoundFile) {
    out.favoriteSound = fb.favoriteSound !== 'datei' ? fb.favoriteSound : DEFAULTS.favoriteSound;
  }
  return out;
}

// ---------------------------------------------------------------- Schnittstelle

function sanitize(s) {
  try {
    return build(isObj(s) ? s : {}, DEFAULTS);
  } catch {
    return copy(DEFAULTS);
  }
}

// Liest auch das alte Format 1.0: { sound, teams: [Namen], disallowed, knownTeams: [Namen], autostartSet }
function migrate(raw) {
  try {
    let src = raw;
    if (typeof src === 'string') {
      try {
        src = JSON.parse(src);
      } catch {
        src = null;
      }
    }
    if (!isObj(src)) return sanitize(null);
    if (num(src.version) >= 2) return sanitize(src);

    const v2 = { ...src };
    // 1.0 hatte nur einen Schalter für aberkannte Tore, alles andere bleibt beim Standard
    v2.events = typeof src.disallowed === 'boolean' ? { disallowed: src.disallowed } : undefined;
    if (Array.isArray(src.knownTeams)) v2.knownTeams = knownList(src.knownTeams, BUNDESLIGA);
    return sanitize(v2);
  } catch {
    return sanitize(null);
  }
}

// Tiefes Mischen: events, forward und quiet feldweise, alles andere (auch Arrays) wird ersetzt.
// Unbekannte Schlüssel (z. B. autostart) und undefined werden ignoriert, kaputte Werte behalten den alten Stand.
function merge(current, partial) {
  const base = sanitize(current);
  try {
    if (!isObj(partial)) return base;
    const cand = { ...base };
    for (const k of Object.keys(DEFAULTS)) {
      if (k === 'version' || !Object.prototype.hasOwnProperty.call(partial, k)) continue;
      const v = partial[k];
      if (v === undefined) continue;
      if (NESTED.includes(k)) {
        if (!isObj(v)) continue;
        cand[k] = { ...base[k] };
        for (const f of Object.keys(base[k])) if (v[f] !== undefined) cand[k][f] = v[f];
      } else {
        cand[k] = v;
      }
    }
    return build(cand, base);
  } catch {
    return base;
  }
}

function minutes(hhmm) {
  const t = time(hhmm);
  if (!t) return null;
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
}

// Ruhezeit jetzt? Über Mitternacht (23:00–08:00) und am selben Tag (13:00–15:00). Ende zählt nicht mehr dazu.
function isQuietNow(settings, date) {
  try {
    const q = settings && settings.quiet;
    if (!isObj(q) || q.enabled !== true) return false;
    const from = minutes(q.from);
    const to = minutes(q.to);
    if (from === null || to === null || from === to) return false;
    const d = date === undefined || date === null ? new Date() : date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return false;
    const now = d.getHours() * 60 + d.getMinutes();
    return from < to ? now >= from && now < to : now >= from || now < to;
  } catch {
    return false;
  }
}

// Zusatz für settings:save: Meldungen für Eingaben, die so nicht funktionieren würden.
// Schlüssel wie im Einstellungsfenster: hotkey, ntfyTopic, discordWebhook, quiet, soundFile,
// favoriteSoundFile, competitions.
function validate(partial) {
  const errors = {};
  try {
    if (!isObj(partial)) return errors;
    if (partial.hotkey !== undefined && accelerator(partial.hotkey) === undefined) {
      errors.hotkey = 'Ungültiges Tastenkürzel.';
    }
    const f = isObj(partial.forward) ? partial.forward : {};
    if (f.ntfyTopic !== undefined) {
      const t = ntfyTopic(f.ntfyTopic);
      if (t === undefined || (t !== '' && !NTFY_RE.test(t))) {
        errors.ntfyTopic = 'Nur Buchstaben, Ziffern, - und _ (höchstens 64 Zeichen).';
      }
    }
    if (f.discordWebhook !== undefined) {
      const w = webhookText(f.discordWebhook);
      if (w === undefined || (w !== '' && !WEBHOOK_RE.test(w))) {
        errors.discordWebhook = 'Das ist keine Discord-Webhook-Adresse.';
      }
    }
    const q = isObj(partial.quiet) ? partial.quiet : {};
    if ((q.from !== undefined && !time(q.from)) || (q.to !== undefined && !time(q.to))) {
      errors.quiet = 'Uhrzeit bitte als Stunde:Minute, z. B. 23:00.';
    }
    for (const k of ['soundFile', 'favoriteSoundFile']) {
      if (partial[k] !== undefined && filePath(partial[k]) === undefined) errors[k] = 'Die Datei geht so nicht.';
    }
    if (partial.competitions !== undefined && !(idList(partial.competitions) || []).length) {
      errors.competitions = 'Mindestens einen Wettbewerb auswählen.';
    }
  } catch {
    /* lieber keine Meldung als ein Absturz */
  }
  return errors;
}

module.exports = { DEFAULTS, migrate, sanitize, merge, isQuietNow, validate };
