// Design "windows": die ganz normale Windows-Benachrichtigung (Info-Center) statt eines eigenen Fensters.
// Als Bild dient das Vereinswappen der Mannschaft, um die es geht.

const { Notification, nativeImage, shell, net } = require('electron');

const crestCache = new Map();
const alive = new Set(); // Referenzen halten, sonst sammelt der GC die Meldung samt Klick-Handler ein

async function crest(url) {
  if (!url) return null;
  if (crestCache.has(url)) return crestCache.get(url);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await net.fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
    const out = img.isEmpty() ? null : img.resize({ width: 64, height: 64, quality: 'good' });
    crestCache.set(url, out);
    return out;
  } catch {
    return null;
  }
}

const scoreLine = (c) => `${c.home.name} ${c.score[0]}:${c.score[1]} ${c.away.name}`;

function minuteLabel(min) {
  if (!min) return '';
  return /^\d/.test(min) ? `${String(min).replace('+', '.+')}.` : min;
}

function body(card) {
  const t = card.text || {};
  if (card.type === 'conference') {
    const lines = (card.matches || []).slice(0, 6).map((m) => {
      const s = m.status === 'pre' ? '–:–' : `${m.score[0]}:${m.score[1]}`;
      const extra =
        m.status === 'live' && m.minute
          ? ` (${minuteLabel(m.minute)})`
          : m.status === 'pre' && m.startUtc
            ? ` (${new Date(m.startUtc).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })})`
            : m.status === 'done'
              ? ' (Ende)'
              : '';
      return `${m.home.name} ${s} ${m.away.name}${extra}`;
    });
    if ((card.matches || []).length > 6) lines.push(`… und ${card.matches.length - 6} weitere`);
    return lines.length ? lines.join('\n') : 'Heute kein Spiel.';
  }
  const parts = [scoreLine(card)];
  if (t.sentence) parts.push(t.sentence);
  return parts.join('\n');
}

async function showToast(card) {
  if (!Notification.isSupported()) return false;
  const t = card.text || {};
  const team = card.side === 'home' ? card.home : card.side === 'away' ? card.away : null;
  const icon = await crest(team ? team.logo : card.home && card.home.logo);
  const n = new Notification({
    title: (card.demo ? 'Test: ' : '') + (t.headline || 'Tor-Alarm'),
    body: body(card),
    silent: true, // den Ton spielt Tor-Alarm selbst (eigener Sound / Lautstärke)
    icon: icon || undefined,
  });
  alive.add(n);
  const drop = () => alive.delete(n);
  n.on('click', () => {
    if (card.url && card.url.startsWith('https://www.fotmob.com/')) shell.openExternal(card.url);
    drop();
  });
  n.on('close', drop);
  n.on('failed', drop);
  setTimeout(drop, 10 * 60_000);
  n.show();
  return true;
}

module.exports = { showToast };
