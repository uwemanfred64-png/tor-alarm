const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { DiscordPresence, buildActivity, encode, FrameReader, OP } = require('../src/discordPresence');

const T = (id, name) => ({ id, name, full: name, logo: `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png` });
const BL = { id: 54, name: 'Bundesliga', short: 'Bundesliga' };
const m = (id, home, away, h, a, status, minute, startUtc = '2026-10-10T13:30:00.000Z') => ({
  id,
  home,
  away,
  homeScore: h,
  awayScore: a,
  status,
  minute,
  startUtc,
  competition: BL,
  url: `https://www.fotmob.com/de/match/${id}`,
});
const FCA = T(8406, 'Augsburg');
const FCB = T(9823, 'Bayern');
const BVB = T(9789, 'Dortmund');
const B04 = T(8178, 'Leverkusen');
const NOW = Date.parse('2026-10-10T15:00:00.000Z');
const BASE = { downloadUrl: 'https://github.com/x/tor-alarm/releases/latest', iconUrl: 'https://example.org/icon.png', now: NOW };

test('Frames: zerstückelt und mehrere hintereinander werden richtig zusammengesetzt', () => {
  const got = [];
  const r = new FrameReader((op, data) => got.push([op, data]));
  const buf = Buffer.concat([encode(OP.FRAME, { a: 'Tor für Köln' }), encode(OP.PING, { b: 2 })]);
  for (let i = 0; i < buf.length; i += 3) r.push(buf.subarray(i, i + 3));
  assert.deepStrictEqual(got, [
    [OP.FRAME, { a: 'Tor für Köln' }],
    [OP.PING, { b: 2 }],
  ]);
});

test('Anzeige: Lieblingsverein spielt – sein Spiel steht oben, mit Wappen', () => {
  const a = buildActivity({
    ...BASE,
    favorite: { id: 9823, name: 'Bayern München' },
    matches: [m(1, BVB, B04, 1, 0, 'live', '30'), m(2, FCA, FCB, 2, 1, 'live', '90+4')],
  });
  assert.strictEqual(a.details, 'Augsburg 2:1 Bayern (90.+4.)');
  assert.strictEqual(a.state, '2 Spiele laufen gerade');
  assert.strictEqual(a.assets.small_image, FCB.logo);
  assert.strictEqual(a.assets.small_text, 'Fan von Bayern');
  assert.deepStrictEqual(a.buttons.map((b) => b.label), ['Tor-Alarm holen', 'Spiel live verfolgen']);
  assert.strictEqual(a.buttons[1].url, 'https://www.fotmob.com/de/match/2');
  assert.ok(a.buttons.every((b) => b.label.length <= 32));
  // Liga-Logo groß, Klick führt zur Liga; Spielstand anklickbar; Mitgliederliste zeigt den Spielstand
  assert.strictEqual(a.assets.large_image, 'https://images.fotmob.com/image_resources/logo/leaguelogo/dark/54.png');
  assert.strictEqual(a.assets.large_url, 'https://www.fotmob.com/de/leagues/54/overview');
  assert.strictEqual(a.assets.large_text, 'Bundesliga');
  assert.strictEqual(a.assets.small_url, 'https://www.fotmob.com/de/teams/9823/overview');
  assert.strictEqual(a.details_url, 'https://www.fotmob.com/de/match/2');
  assert.strictEqual(a.state_url, 'https://www.fotmob.com/de/leagues/54/table');
  assert.strictEqual(a.status_display_type, 2);
});

test('Anzeige: jede Liga bekommt ihr eigenes Logo, Spieltag im Hover-Text', () => {
  const L3 = { id: 208, name: '3. Liga', short: '3. Liga' };
  const g = { ...m(9, T(1, 'Duisburg'), T(2, 'Hoffenheim II'), 0, 2, 'live', '60'), competition: L3, round: '9' };
  const a = buildActivity({ ...BASE, matches: [g] });
  assert.strictEqual(a.assets.large_image, 'https://images.fotmob.com/image_resources/logo/leaguelogo/dark/208.png');
  assert.strictEqual(a.assets.large_text, '3. Liga, 9. Spieltag');
  assert.strictEqual(a.assets.large_url, 'https://www.fotmob.com/de/leagues/208/overview');
  // ohne Lieblingsverein: kleines Tor-Alarm-Symbol, Klick → Webseite
  assert.strictEqual(a.assets.small_image, BASE.iconUrl);
  assert.strictEqual(a.assets.small_url, BASE.downloadUrl);
});

test('Anzeige: Fortschrittsbalken aus der Spielminute', () => {
  const a = buildActivity({ ...BASE, matches: [m(1, FCA, FCB, 1, 0, 'live', '30')] });
  assert.strictEqual(a.timestamps.start, NOW - 30 * 60_000);
  assert.strictEqual(a.timestamps.end, NOW - 30 * 60_000 + 90 * 60_000);
  const late = buildActivity({ ...BASE, matches: [m(1, FCA, FCB, 1, 0, 'live', '90+4')] });
  assert.ok(late.timestamps.end > NOW, 'Balken darf in der Nachspielzeit nicht "abgelaufen" sein');
  const ht = buildActivity({ ...BASE, matches: [m(1, FCA, FCB, 1, 0, 'live', 'Halbzeit')] });
  assert.strictEqual(ht.timestamps, undefined);
});

test('Anzeige: nichts los – Tor-Alarm-Symbol groß, Klick zur Webseite', () => {
  const a = buildActivity({ ...BASE, matches: [] });
  assert.strictEqual(a.assets.large_image, BASE.iconUrl);
  assert.strictEqual(a.assets.large_url, BASE.downloadUrl);
  assert.strictEqual(a.status_display_type, 0);
});

test('degrade: Stufe 1 ohne neuere Felder, Stufe 2 zusätzlich ohne type', () => {
  const a = buildActivity({ ...BASE, matches: [m(1, FCA, FCB, 1, 0, 'live', '30')] });
  const d1 = require('../src/discordPresence').degrade(a, 1);
  assert.ok(!('details_url' in d1) && !('status_display_type' in d1) && !('large_url' in d1.assets));
  assert.strictEqual(d1.type, 3);
  const d2 = require('../src/discordPresence').degrade(a, 2);
  assert.ok(!('type' in d2));
  assert.strictEqual(d2.details, a.details);
});

test('Anzeige: frisches Tor – Torschütze in der zweiten Zeile', () => {
  const game = m(3, BVB, B04, 2, 0, 'live', '78');
  const a = buildActivity({
    ...BASE,
    matches: [m(1, FCA, FCB, 0, 0, 'live', '70'), game],
    lastGoal: { match: game, scorer: 'Serhou Guirassy', team: 'Dortmund', minute: '77', at: NOW - 60_000 },
  });
  assert.strictEqual(a.details, 'Dortmund 2:0 Leverkusen (78.)');
  assert.strictEqual(a.state, 'Letztes Tor: Serhou Guirassy (77.)');
});

test('Anzeige: altes Tor (> 10 min) zählt nicht mehr, Halbzeit als Wort', () => {
  const game = m(3, BVB, B04, 2, 0, 'live', 'Halbzeit');
  const a = buildActivity({ ...BASE, matches: [game], lastGoal: { match: game, scorer: 'X', at: NOW - 11 * 60_000 } });
  assert.strictEqual(a.details, 'Dortmund 2:0 Leverkusen (Halbzeit)');
  assert.strictEqual(a.state, 'Bundesliga');
});

test('Anzeige: noch kein Spiel live, Lieblingsverein spielt später', () => {
  const a = buildActivity({
    ...BASE,
    favorite: { id: 8406, name: 'Augsburg' },
    matches: [m(2, FCA, FCB, 0, 0, 'pre', null, '2026-10-10T16:30:00.000Z')],
  });
  assert.strictEqual(a.details, 'Heute: Augsburg – Bayern');
  assert.match(a.state, /^Anpfiff \d\d:\d\d Uhr$/);
});

test('Anzeige: kein Spiel heute', () => {
  const a = buildActivity({ ...BASE, matches: [] });
  assert.strictEqual(a.details, 'Wartet aufs nächste Tor');
  assert.strictEqual(a.state, 'Heute kein Spiel');
  assert.strictEqual(a.buttons[1].url, 'https://www.fotmob.com/de/leagues/54/overview/bundesliga');
});

test('Anzeige: lange Namen werden auf Discords 128 Zeichen gekürzt', () => {
  const long = T(1, 'X'.repeat(200));
  const a = buildActivity({ ...BASE, matches: [m(1, long, FCB, 1, 0, 'live', '5')] });
  assert.ok(a.details.length <= 128);
});

// Kleiner nachgebauter Discord: Handshake → READY, merkt sich alle SET_ACTIVITY-Befehle.
function fakeDiscord(pipeName, { rejectType = false } = {}) {
  const seen = [];
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    const reader = new FrameReader((op, data) => {
      seen.push([op, data]);
      if (op === OP.HANDSHAKE) {
        sock.write(encode(OP.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1, user: { username: 'test' } } }));
      } else if (op === OP.FRAME && data.cmd === 'SET_ACTIVITY') {
        const act = data.args.activity;
        if (rejectType && act && 'type' in act) {
          sock.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', evt: 'ERROR', nonce: data.nonce, data: { code: 4000, message: 'child "activity" fails because child "type" fails' } }));
        } else {
          sock.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', data: act, nonce: data.nonce }));
        }
      }
    });
    sock.on('data', (c) => reader.push(c));
    sock.on('error', () => {});
    sock.on('close', () => sockets.delete(sock));
  });
  return new Promise((resolve) =>
    server.listen(pipeName, () =>
      resolve({
        seen,
        kick: () => sockets.forEach((s) => s.destroy()),
        close: () => new Promise((r) => {
          sockets.forEach((s) => s.destroy());
          server.close(() => r());
        }),
      })
    )
  );
}

const pipeName = (tag) => `\\\\?\\pipe\\toralarm-test-${tag}-${process.pid}`;
const waitFor = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('Zeitüberschreitung');
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('Verbindung: Handshake mit Client-ID, dann wird der Status gesendet', { skip: process.platform !== 'win32' }, async () => {
  const name = pipeName('ok');
  const srv = await fakeDiscord(name);
  // Pipe 0 gibt es nicht (anderer Name) – der Client muss die nächste Nummer probieren
  const p = new DiscordPresence({ clientId: '123456789', pipe: (i) => (i === 1 ? name : `${name}-nichtda-${i}`) });
  p.start();
  p.setActivity(buildActivity({ ...BASE, matches: [] }));
  await waitFor(() => srv.seen.some(([op, d]) => op === OP.FRAME && d.cmd === 'SET_ACTIVITY'));
  const [op, hs] = srv.seen[0];
  assert.strictEqual(op, OP.HANDSHAKE);
  assert.deepStrictEqual(hs, { v: 1, client_id: '123456789' });
  const set = srv.seen.find(([o, d]) => o === OP.FRAME && d.cmd === 'SET_ACTIVITY')[1];
  assert.strictEqual(set.args.pid, process.pid);
  assert.strictEqual(set.args.activity.details, 'Wartet aufs nächste Tor');
  p.stop();
  await srv.close();
});

test('Verbindung: ältere Discord-Version lehnt Felder ab → Schritt für Schritt einfacher', { skip: process.platform !== 'win32' }, async () => {
  const name = pipeName('type');
  const srv = await fakeDiscord(name, { rejectType: true });
  const p = new DiscordPresence({ clientId: '1', pipe: () => name });
  p.start();
  p.setActivity(buildActivity({ ...BASE, matches: [m(1, FCA, FCB, 1, 0, 'live', '30')] }));
  await waitFor(() => srv.seen.filter(([o, d]) => o === OP.FRAME && d.cmd === 'SET_ACTIVITY').length >= 3);
  const sets = srv.seen.filter(([o, d]) => o === OP.FRAME && d.cmd === 'SET_ACTIVITY').map(([, d]) => d.args.activity);
  assert.ok('type' in sets[0] && 'details_url' in sets[0]);
  assert.ok('type' in sets[1] && !('details_url' in sets[1]));
  assert.ok(!('type' in sets[2]));
  assert.strictEqual(sets[2].details, 'Augsburg 1:0 Bayern (30.)');
  p.stop();
  await srv.close();
});

test('Verbindung: kein Discord offen → kein Absturz, kein Fehler nach außen', { skip: process.platform !== 'win32' }, async () => {
  const p = new DiscordPresence({ clientId: '1', pipe: (i) => pipeName(`gibtsnicht-${i}`), connectTimeout: 500 });
  p.start();
  p.setActivity(buildActivity({ ...BASE, matches: [] }));
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(p.ready, false);
  p.stop();
});

test('Ohne Client-ID startet nichts', () => {
  const p = new DiscordPresence({ clientId: '' });
  p.start();
  assert.strictEqual(p.enabled, false);
});

test('Anzeige: Pokal heißt "Runde", K.-o.-Runden ausgeschrieben', () => {
  const P = { id: 209, name: 'DFB-Pokal', short: 'Pokal' };
  const C = { id: 42, name: 'Champions League', short: 'CL' };
  const p = buildActivity({ ...BASE, matches: [{ ...m(1, FCA, FCB, 1, 0, 'live', '30'), competition: P, round: '2' }] });
  assert.strictEqual(p.assets.large_text, 'DFB-Pokal, 2. Runde');
  const c = buildActivity({ ...BASE, matches: [{ ...m(1, FCA, FCB, 1, 0, 'live', '30'), competition: C, round: '1/8' }] });
  assert.strictEqual(c.assets.large_text, 'Champions League, Achtelfinale');
});
