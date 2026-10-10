const test = require('node:test');
const assert = require('node:assert');
const forward = require('../src/forward');
const texts = require('../src/texts');

const MSG = {
  title: 'Tor für Augsburg – 2:1',
  message: 'Augsburg 2:1 Bayern (78.)\nRobin Fellhauer verwandelt den Elfmeter zum 2:1.',
  click: 'https://www.fotmob.com/de/match/5881179',
  tags: ['soccer'],
};
const ID = '123456789012345678';
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ_-0123456789abcdefghijklmnopqrstu';
const HOOK = `https://discord.com/api/webhooks/${ID}/${TOKEN}`;
const SENT_TO = `https://discord.com/api/v10/webhooks/${ID}/${TOKEN}`;

// Antworten als Fabrik – ein Response-Körper lässt sich nur einmal lesen.
const reply = (status, body, headers) => () =>
  new Response(body == null ? null : typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

// Ersetzt fetch; jede Anfrage wird mitgeschrieben. Antworten der Reihe nach, die letzte wiederholt sich.
function mockFetch(...answers) {
  const calls = [];
  forward.setFetch(async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (a instanceof Error) throw a;
    return a(url, opts);
  });
  return calls;
}

// Hängt nie – bricht erst ab, wenn das AbortSignal kommt (wie fetch bei Zeitüberschreitung).
function hangingFetch() {
  const calls = [];
  forward.setFetch(
    (url, opts) =>
      new Promise((resolve, reject) => {
        calls.push(url);
        opts.signal.addEventListener('abort', () => {
          const e = new Error('This operation was aborted');
          e.name = 'AbortError';
          reject(e);
        });
      })
  );
  return calls;
}

const flush = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

function settled(p) {
  const state = { done: false, value: null };
  p.then((v) => {
    state.done = true;
    state.value = v;
  });
  return state;
}

test.afterEach(() => forward.setFetch(() => Promise.reject(new Error('kein Netz in Tests'))));

// ---------------------------------------------------------------- Prüfen

test('validateNtfyTopic: nur [A-Za-z0-9_-]{1,64}, kopierte ntfy.sh-Adresse geht auch', () => {
  for (const ok of ['toralarm', 'Tor_Alarm-2026', 'a', 'x'.repeat(64), 'https://ntfy.sh/toralarm-max', 'ntfy.sh/abc', '  toralarm  ']) {
    assert.strictEqual(forward.validateNtfyTopic(ok), true, ok);
  }
  for (const bad of ['', '   ', 'mit leerzeichen', 'tor-alarm!', 'tore-für-mich', 'x'.repeat(65), 'https://example.com/abc', 'https://ntfy.sh/a/b', null, undefined, 42, {}]) {
    assert.strictEqual(forward.validateNtfyTopic(bad), false, String(bad));
  }
  assert.strictEqual(forward.normalizeNtfyTopic('https://ntfy.sh/toralarm-max/'), 'toralarm-max');
});

test('validateDiscordWebhook: nur echte Discord-Webhook-Adressen', () => {
  for (const ok of [
    HOOK,
    `https://discordapp.com/api/webhooks/${ID}/${TOKEN}`,
    `https://ptb.discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://canary.discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com/api/v10/webhooks/${ID}/${TOKEN}`,
    `${HOOK}/`,
    `  ${HOOK}  `,
    `${HOOK}?thread_id=987654321098765432`,
  ]) {
    assert.strictEqual(forward.validateDiscordWebhook(ok), true, ok);
  }
  for (const bad of [
    '',
    'kein link',
    `http://discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://evil.com/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com.evil.com/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com@evil.com/api/webhooks/${ID}/${TOKEN}`,
    `https://user:pw@discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com:8443/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com/api/webhooks/${ID}`,
    `https://discord.com/api/webhooks/abc/${TOKEN}`,
    `https://discord.com/channels/${ID}/${ID}`,
    `${HOOK}/slack`,
    `${HOOK}?thread_id=abc`,
    null,
    42,
  ]) {
    assert.strictEqual(forward.validateDiscordWebhook(bad), false, String(bad));
  }
  assert.strictEqual(forward.normalizeDiscordWebhook(`https://discordapp.com/api/webhooks/${ID}/${TOKEN}/`), SENT_TO);
  assert.strictEqual(forward.normalizeDiscordWebhook(`${HOOK}?thread_id=987654321098765432&wait=true`), `${SENT_TO}?thread_id=987654321098765432`);
});

// ---------------------------------------------------------------- ntfy

test('ntfy: POST als JSON an die Wurzel-Adresse', async () => {
  const calls = mockFetch(reply(200, { id: 'abc', event: 'message' }));
  const r = await forward.sendNtfy('toralarm-test', MSG);
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://ntfy.sh/');
  assert.strictEqual(calls[0].opts.method, 'POST');
  assert.strictEqual(calls[0].opts.headers['Content-Type'], 'application/json');
  assert.ok(calls[0].opts.signal instanceof AbortSignal);
  assert.deepStrictEqual(calls[0].body, {
    topic: 'toralarm-test',
    title: 'Tor für Augsburg – 2:1',
    message: 'Augsburg 2:1 Bayern (78.)\nRobin Fellhauer verwandelt den Elfmeter zum 2:1.',
    tags: ['soccer'],
    click: 'https://www.fotmob.com/de/match/5881179',
  });
});

test('ntfy: Thema aus kopierter Adresse, Link nur mit https', async () => {
  const calls = mockFetch(reply(200, {}));
  await forward.sendNtfy('https://ntfy.sh/toralarm-max', { ...MSG, click: 'http://unsicher.example' });
  assert.strictEqual(calls[0].body.topic, 'toralarm-max');
  assert.ok(!('click' in calls[0].body));
  await forward.sendNtfy('toralarm-max', { ...MSG, click: null, tags: undefined });
  assert.ok(!('click' in calls[1].body));
  assert.deepStrictEqual(calls[1].body.tags, ['soccer']);
});

test('ntfy: ungültige Eingaben – verständliche Meldung, keine Anfrage', async () => {
  const calls = mockFetch(reply(200, {}));
  assert.deepStrictEqual(await forward.sendNtfy('', MSG), { ok: false, error: 'Kein ntfy-Thema eingetragen.' });
  const bad = await forward.sendNtfy('tore für mich', MSG);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /^ntfy-Thema ungültig/);
  assert.deepStrictEqual(await forward.sendNtfy('toralarm', null), { ok: false, error: 'Keine Nachricht zum Senden.' });
  assert.deepStrictEqual(await forward.sendNtfy('toralarm', { title: '  ', message: '' }), { ok: false, error: 'Keine Nachricht zum Senden.' });
  assert.strictEqual(calls.length, 0);
});

test('ntfy: HTTP-Fehler werden zu deutschen Meldungen', async () => {
  const cases = [
    [400, /lehnt die Nachricht ab \(Fehler 400\)/],
    [403, /anderes Thema/],
    [413, /zu groß/],
    [429, /zu viele Nachrichten.*Tageslimit/],
    [500, /gestört \(Fehler 500\)/],
    [502, /gestört \(Fehler 502\)/],
    [418, /Fehler 418/],
  ];
  for (const [status, re] of cases) {
    mockFetch(reply(status, { code: status * 100, http: status, error: 'english text' }));
    const r = await forward.sendNtfy('toralarm', MSG);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, re, `${status}: ${r.error}`);
  }
});

test('ntfy: keine Verbindung', async () => {
  const err = new TypeError('fetch failed');
  err.cause = { code: 'ENOTFOUND' };
  mockFetch(err);
  assert.deepStrictEqual(await forward.sendNtfy('toralarm', MSG), { ok: false, error: 'Keine Verbindung zu ntfy.sh – Internet prüfen.' });
});

test('ntfy: nach 8 Sekunden ohne Antwort abgebrochen', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = hangingFetch();
  const s = settled(forward.sendNtfy('toralarm', MSG));
  await flush();
  assert.strictEqual(calls.length, 1);
  t.mock.timers.tick(7999);
  await flush();
  assert.strictEqual(s.done, false, 'zu früh abgebrochen');
  t.mock.timers.tick(1);
  await flush();
  assert.strictEqual(s.done, true);
  assert.deepStrictEqual(s.value, { ok: false, error: 'ntfy.sh antwortet nicht (nach 8 Sekunden abgebrochen).' });
});

test('ntfy: zu lange Nachricht wird unter 4096 Byte gekürzt', async () => {
  const calls = mockFetch(reply(200, {}));
  await forward.sendNtfy('toralarm', { ...MSG, message: 'Tor für Köln. '.repeat(600), title: 'Ü'.repeat(2000) });
  const b = calls[0].body;
  assert.ok(Buffer.byteLength(b.message) <= 4096, Buffer.byteLength(b.message));
  assert.ok(b.message.endsWith('…'));
  assert.ok(Buffer.byteLength(b.title) <= 1024, Buffer.byteLength(b.title));
});

// ---------------------------------------------------------------- Discord

test('Discord: Nachricht mit fettem Titel, Link ohne Vorschau, niemand wird angepingt', async () => {
  const calls = mockFetch(reply(204, null));
  const r = await forward.sendDiscord(HOOK, MSG);
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, SENT_TO);
  assert.strictEqual(calls[0].opts.method, 'POST');
  assert.strictEqual(calls[0].opts.headers['Content-Type'], 'application/json');
  assert.deepStrictEqual(calls[0].body, {
    username: 'Tor-Alarm',
    content:
      '**Tor für Augsburg – 2:1**\nAugsburg 2:1 Bayern (78.)\nRobin Fellhauer verwandelt den Elfmeter zum 2:1.\n<https://www.fotmob.com/de/match/5881179>',
    allowed_mentions: { parse: [] },
    flags: 4, // keine Vorschaukarten
  });
});

test('Discord: getarnte Links aus Namen werden unschädlich gemacht', async () => {
  const calls = mockFetch(reply(204, null));
  await forward.sendDiscord(HOOK, { title: 'Tor', message: 'Spieler [Klick mich](https://boese.example) trifft', click: null });
  const content = calls[0].body.content;
  assert.ok(!content.includes('](h'), content);
  assert.ok(content.includes('[Klick mich]​(https://boese.example)'));
});

test('Discord: Markdown in Namen wird entschärft, Länge höchstens 2000', async () => {
  const calls = mockFetch(reply(204, null));
  await forward.sendDiscord(HOOK, { title: 'Tor für *Stern*', message: '@everyone _x_ `y` ~z~ |s|\n1. FC Köln 1:0 Bayern\n- Liste\n# Kopf', click: null });
  const content = calls[0].body.content;
  assert.strictEqual(content, '**Tor für \\*Stern\\***\n@everyone \\_x\\_ \\`y\\` \\~z\\~ \\|s\\|\n1\\. FC Köln 1:0 Bayern\n\\- Liste\n\\# Kopf');
  assert.deepStrictEqual(calls[0].body.allowed_mentions, { parse: [] });

  await forward.sendDiscord(HOOK, { ...MSG, message: 'Tor. '.repeat(1000) });
  assert.ok(calls[1].body.content.length <= 2000, calls[1].body.content.length);
  assert.ok(calls[1].body.content.endsWith('>'));
});

test('Discord: 404 heißt Webhook gelöscht', async () => {
  mockFetch(reply(404, { message: 'Unknown Webhook', code: 10015 }));
  assert.deepStrictEqual(await forward.sendDiscord(HOOK, MSG), { ok: false, error: 'Discord antwortet mit 404 – Webhook gelöscht?' });
});

test('Discord: weitere HTTP-Fehler', async () => {
  const cases = [
    [400, /lehnt die Nachricht ab/],
    [401, /401 – Webhook-Adresse/],
    [403, /403 – keine Berechtigung/],
    [500, /gestört \(Fehler 500\)/],
    [302, /Fehler 302/],
  ];
  for (const [status, re] of cases) {
    mockFetch(reply(status, { message: 'x' }));
    const r = await forward.sendDiscord(HOOK, MSG);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, re, `${status}: ${r.error}`);
  }
});

test('Discord: 429 – einmal nach retry_after erneut versuchen', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = mockFetch(reply(429, { message: 'You are being rate limited.', retry_after: 0.5, global: false }), reply(204, null));
  const s = settled(forward.sendDiscord(HOOK, MSG));
  await flush();
  assert.strictEqual(calls.length, 1);
  t.mock.timers.tick(499);
  await flush();
  assert.strictEqual(calls.length, 1, 'zu früh wiederholt');
  t.mock.timers.tick(1);
  await flush();
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[1].body, calls[0].body);
  assert.deepStrictEqual(s.value, { ok: true });
});

test('Discord: 429 – höchstens 5 s warten, danach Fehler', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = mockFetch(reply(429, { message: 'You are being rate limited.', retry_after: 30, global: true }));
  const s = settled(forward.sendDiscord(HOOK, MSG));
  await flush();
  t.mock.timers.tick(4999);
  await flush();
  assert.strictEqual(calls.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.strictEqual(calls.length, 2, 'nach 5 s genau einmal wiederholt');
  assert.deepStrictEqual(s.value, { ok: false, error: 'Discord bremst gerade (zu viele Nachrichten) – später noch einmal versuchen.' });
});

test('Discord: 429 ohne JSON – Wartezeit aus Retry-After', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = mockFetch(reply(429, '<html>slow down</html>', { 'Retry-After': '2' }), reply(204, null));
  const s = settled(forward.sendDiscord(HOOK, MSG));
  await flush();
  t.mock.timers.tick(1999);
  await flush();
  assert.strictEqual(calls.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(s.value, { ok: true });
});

test('Discord: nach 8 Sekunden ohne Antwort abgebrochen', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  hangingFetch();
  const s = settled(forward.sendDiscord(HOOK, MSG));
  await flush();
  t.mock.timers.tick(8000);
  await flush();
  assert.deepStrictEqual(s.value, { ok: false, error: 'Discord antwortet nicht (nach 8 Sekunden abgebrochen).' });
});

test('Discord: ungültige Eingaben und keine Verbindung', async () => {
  const calls = mockFetch(new TypeError('fetch failed'));
  assert.deepStrictEqual(await forward.sendDiscord('', MSG), { ok: false, error: 'Keine Discord-Webhook-Adresse eingetragen.' });
  assert.deepStrictEqual(await forward.sendDiscord('https://example.com/hook', MSG), { ok: false, error: 'Webhook-Adresse ungültig.' });
  assert.deepStrictEqual(await forward.sendDiscord(HOOK, undefined), { ok: false, error: 'Keine Nachricht zum Senden.' });
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(await forward.sendDiscord(HOOK, MSG), { ok: false, error: 'Keine Verbindung zu Discord – Internet prüfen.' });
});

// ---------------------------------------------------------------- Nie werfen

test('wirft nie – auch nicht bei kaputtem fetch', async () => {
  const weird = [
    () => {
      throw new Error('synchron kaputt');
    },
    async () => undefined,
    async () => null,
    async () => ({ status: 204 }), // ohne ok und text()
    async () => ({
      ok: true,
      status: 200,
      text: () => {
        throw new Error('Körper kaputt');
      },
    }),
    async () => ({ ok: false, status: 404, text: async () => '{kein json', headers: { get: () => { throw new Error('x'); } } }),
  ];
  for (const fn of weird) {
    forward.setFetch(fn);
    for (const r of [await forward.sendNtfy('toralarm', MSG), await forward.sendDiscord(HOOK, MSG)]) {
      assert.strictEqual(typeof r.ok, 'boolean');
      if (!r.ok) assert.strictEqual(typeof r.error, 'string');
    }
  }
  forward.setFetch(async () => ({ status: 204 }));
  assert.deepStrictEqual(await forward.sendDiscord(HOOK, MSG), { ok: true });
  forward.setFetch(null); // zurück auf das echte fetch – darf nicht werfen
});

// ---------------------------------------------------------------- Zusammenspiel mit texts.js

test('Karte -> forwardMessage -> ntfy und Discord', async () => {
  const card = {
    type: 'goal',
    home: { id: 8406, name: 'Augsburg', full: 'Augsburg' },
    away: { id: 1, name: 'Köln', full: '1. FC Köln' },
    competition: { id: 54, name: 'Bundesliga', short: 'Bundesliga' },
    round: '5',
    url: 'https://www.fotmob.com/de/match/1',
    score: [0, 1],
    minute: '90+2',
    side: 'away',
    team: 'Köln',
    goal: { scorer: 'Linton Maina', minute: '90+2', ownGoal: false, penalty: false, assist: 'Jan Thielmann' },
    pending: false,
  };
  const calls = mockFetch(reply(200, {}));
  const msg = texts.forwardMessage(card);
  assert.deepStrictEqual(await forward.sendNtfy('toralarm', msg), { ok: true });
  const b = calls[0].body;
  assert.strictEqual(b.title, 'Tor für Köln – 0:1');
  assert.ok(b.message.startsWith('Augsburg 0:1 Köln (90.+2)\nLinton Maina '), b.message);
  assert.ok(b.message.endsWith(' Vorlage: Jan Thielmann.'), b.message);
  mockFetch(reply(204, null));
  assert.deepStrictEqual(await forward.sendDiscord(HOOK, msg), { ok: true });
});
