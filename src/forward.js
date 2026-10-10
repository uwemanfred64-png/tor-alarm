// Weiterleitung aufs Handy (ntfy.sh – kostenlose Push-App, kein Konto) und in einen Discord-Kanal (Webhook).
// Senden wirft nie: Rückgabe ist { ok: true } oder { ok: false, error: 'Meldung auf Deutsch' }.
// Die Nachricht (msg) kommt aus texts.forwardMessage(): { title, message, click, tags }.

const NTFY_URL = 'https://ntfy.sh/'; // JSON muss an die Wurzel-Adresse, nicht an /<thema>
const TIMEOUT = 8000;
const DISCORD_MAX_WAIT = 5000; // so lange warten wir höchstens, wenn Discord bremst (429)

let fetchImpl = (...a) => fetch(...a);
function setFetch(fn) {
  fetchImpl = typeof fn === 'function' ? fn : (...a) => fetch(...a);
}

const fail = (error) => ({ ok: false, error });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Eingaben prüfen

// ntfy-Thema: nur [A-Za-z0-9_-], 1–64 Zeichen (wie ntfy selbst). Die aus der App kopierte Adresse
// "https://ntfy.sh/mein-thema" wird akzeptiert – übrig bleibt das Thema. Sonst null.
function normalizeNtfyTopic(input) {
  if (typeof input !== 'string') return null;
  const s = input
    .trim()
    .replace(/^(https?:\/\/)?ntfy\.sh\//i, '')
    .replace(/\/+$/, '');
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

// Discord-Webhook: nur https://discord.com/api/webhooks/<id>/<token> (oder discordapp.com; die
// Adressen aus Discord PTB/Canary gehen auch). Ergebnis ist die Adresse, an die gesendet wird – sonst null.
const DISCORD_HOSTS = ['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com', 'ptb.discordapp.com', 'canary.discordapp.com'];

function normalizeDiscordWebhook(input) {
  if (typeof input !== 'string') return null;
  let u;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (!DISCORD_HOSTS.includes(u.hostname)) return null;
  const m = /^\/api(?:\/v\d{1,2})?\/webhooks\/(\d{15,25})\/([A-Za-z0-9_-]{20,128})\/?$/.exec(u.pathname);
  if (!m) return null;
  // Webhooks in Forum-Threads haben ?thread_id=…; alles andere aus der Adresse fällt weg.
  const thread = u.searchParams.get('thread_id');
  if (thread != null && !/^\d{15,25}$/.test(thread)) return null;
  // API-Version fest, damit retry_after bei 429 sicher in Sekunden kommt
  return `https://discord.com/api/v10/webhooks/${m[1]}/${m[2]}${thread ? `?thread_id=${thread}` : ''}`;
}

// Für main.js: true, wenn die Eingabe brauchbar ist (leer = nicht brauchbar; "aus" prüft der Aufrufer).
const validateNtfyTopic = (input) => normalizeNtfyTopic(input) !== null;
const validateDiscordWebhook = (input) => normalizeDiscordWebhook(input) !== null;

// ---------------------------------------------------------------- Nachricht

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();

// Kürzt auf höchstens max Bytes (UTF-8). ntfy macht aus längeren Nachrichten sonst einen Dateianhang.
function capBytes(s, max) {
  if (Buffer.byteLength(s) <= max) return s;
  let out = s.slice(0, max); // jedes Zeichen hat mindestens 1 Byte
  let over;
  // "…" braucht 3 Bytes; pro Runde so viele Zeichen weg, wie es mindestens sein müssen (max. 4 Byte/Zeichen)
  while (out && (over = Buffer.byteLength(out) - (max - 3)) > 0) out = out.slice(0, -Math.max(1, Math.floor(over / 4)));
  return `${out.trimEnd()}…`;
}

function prepare(msg) {
  const m = msg && typeof msg === 'object' ? msg : {};
  const title = capBytes(str(m.title).replace(/\s+/g, ' '), 900);
  const message = capBytes(str(m.message), 3500);
  if (!title && !message) return null;
  const tags = (Array.isArray(m.tags) ? m.tags : ['soccer']).filter((t) => typeof t === 'string' && /^[\w+-]{1,40}$/.test(t)).slice(0, 5);
  const click = typeof m.click === 'string' && /^https:\/\/\S+$/.test(m.click.trim()) ? m.click.trim() : null;
  return { title, message, tags, click };
}

// Discord rendert Markdown: Sonderzeichen aus Namen entschärfen, nur der Titel wird fett.
function md(s) {
  return s
    .replace(/([\\*_~`|])/g, '\\$1')
    .replace(/^([#>-])/gm, '\\$1')
    .replace(/^(\d+)\. /gm, '$1\\. ');
}

function discordContent(m) {
  const head = m.title ? `**${md(m.title)}**` : '';
  const link = m.click ? `<${m.click}>` : ''; // <…> verhindert die große Link-Vorschau
  const fixed = [head, link].filter(Boolean).join('\n').length;
  let body = md(m.message);
  const room = 2000 - fixed - 2; // Discord nimmt höchstens 2000 Zeichen
  if (body.length > room) body = `${body.slice(0, Math.max(0, room - 1)).trimEnd()}…`;
  return [head, body, link].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- HTTP

// POST mit JSON und 8 s Zeitlimit. Wirft nie; Netzfehler kommen als { failed, timeout } zurück.
async function post(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Tor-Alarm' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const status = Number(res.status) || 0;
    let text = '';
    try {
      text = typeof res.text === 'function' ? String(await res.text()) : '';
    } catch {
      /* Antwort ohne lesbaren Inhalt */
    }
    const ok = typeof res.ok === 'boolean' ? res.ok : status >= 200 && status < 300;
    return { ok, status, text, headers: res.headers };
  } catch (e) {
    return { failed: true, timeout: ctrl.signal.aborted || (e && e.name === 'AbortError') };
  } finally {
    clearTimeout(timer);
  }
}

function header(r, name) {
  try {
    return r.headers && typeof r.headers.get === 'function' ? r.headers.get(name) : null;
  } catch {
    return null;
  }
}

// Wartezeit bei Discord-429 in ms: retry_after aus der Antwort (Sekunden, API v10), sonst die
// Kopfzeilen X-RateLimit-Reset-After / Retry-After (ebenfalls Sekunden). Höchstens 5 s.
function retryAfter(r) {
  let sec = NaN;
  try {
    sec = parseFloat(JSON.parse(r.text).retry_after);
  } catch {
    /* kein JSON, z. B. Sperrseite von Cloudflare */
  }
  if (!Number.isFinite(sec)) sec = parseFloat(header(r, 'x-ratelimit-reset-after'));
  if (!Number.isFinite(sec)) sec = parseFloat(header(r, 'retry-after'));
  if (!Number.isFinite(sec) || sec < 0) sec = 1;
  return Math.min(DISCORD_MAX_WAIT, Math.ceil(sec * 1000));
}

// ---------------------------------------------------------------- ntfy

function ntfyError(status) {
  if (status === 400) return 'ntfy.sh lehnt die Nachricht ab (Fehler 400).';
  if (status === 401 || status === 403) return 'ntfy.sh lässt dieses Thema nicht zu (geschützt?) – bitte ein anderes Thema wählen.';
  if (status === 413) return 'Die Nachricht ist zu groß für ntfy.sh.';
  if (status === 429) return 'ntfy.sh nimmt gerade nichts an: zu viele Nachrichten in kurzer Zeit oder Tageslimit erreicht.';
  if (status >= 500) return `ntfy.sh ist gerade gestört (Fehler ${status}) – später noch einmal versuchen.`;
  return `ntfy.sh antwortet mit Fehler ${status}.`;
}

async function sendNtfy(topic, msg) {
  try {
    const t = normalizeNtfyTopic(topic);
    if (!t) {
      return fail(str(topic) ? 'ntfy-Thema ungültig – nur Buchstaben, Ziffern, - und _ (max. 64 Zeichen).' : 'Kein ntfy-Thema eingetragen.');
    }
    const m = prepare(msg);
    if (!m) return fail('Keine Nachricht zum Senden.');
    const body = { topic: t, title: m.title, message: m.message, tags: m.tags };
    if (m.click) body.click = m.click;
    const r = await post(NTFY_URL, body);
    if (r.failed) return fail(r.timeout ? 'ntfy.sh antwortet nicht (nach 8 Sekunden abgebrochen).' : 'Keine Verbindung zu ntfy.sh – Internet prüfen.');
    return r.ok ? { ok: true } : fail(ntfyError(r.status));
  } catch {
    return fail('Unerwarteter Fehler beim Senden an ntfy.sh.');
  }
}

// ---------------------------------------------------------------- Discord

function discordError(status) {
  if (status === 400) return 'Discord lehnt die Nachricht ab (Fehler 400).';
  if (status === 401) return 'Discord antwortet mit 401 – Webhook-Adresse unvollständig oder falsch?';
  if (status === 403) return 'Discord antwortet mit 403 – keine Berechtigung für diesen Kanal.';
  if (status === 404) return 'Discord antwortet mit 404 – Webhook gelöscht?';
  if (status === 429) return 'Discord bremst gerade (zu viele Nachrichten) – später noch einmal versuchen.';
  if (status >= 500) return `Discord ist gerade gestört (Fehler ${status}) – später noch einmal versuchen.`;
  return `Discord antwortet mit Fehler ${status}.`;
}

async function sendDiscord(webhookUrl, msg) {
  try {
    const url = normalizeDiscordWebhook(webhookUrl);
    if (!url) return fail(str(webhookUrl) ? 'Webhook-Adresse ungültig.' : 'Keine Discord-Webhook-Adresse eingetragen.');
    const m = prepare(msg);
    if (!m) return fail('Keine Nachricht zum Senden.');
    // allowed_mentions leer: niemand wird je angepingt, auch nicht durch @everyone im Text
    const body = { username: 'Tor-Alarm', content: discordContent(m), allowed_mentions: { parse: [] } };
    let r = await post(url, body);
    if (!r.failed && r.status === 429) {
      // Einmal nach der verlangten Pause erneut versuchen
      await sleep(retryAfter(r));
      r = await post(url, body);
    }
    if (r.failed) return fail(r.timeout ? 'Discord antwortet nicht (nach 8 Sekunden abgebrochen).' : 'Keine Verbindung zu Discord – Internet prüfen.');
    return r.ok ? { ok: true } : fail(discordError(r.status));
  } catch {
    return fail('Unerwarteter Fehler beim Senden an Discord.');
  }
}

module.exports = {
  sendNtfy,
  sendDiscord,
  validateNtfyTopic,
  validateDiscordWebhook,
  normalizeNtfyTopic,
  normalizeDiscordWebhook,
  setFetch,
};
