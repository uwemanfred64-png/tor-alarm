const test = require('node:test');
const assert = require('node:assert');
const store = require('../src/settingsStore');

const { DEFAULTS, migrate, sanitize, merge, isQuietNow, validate } = store;
const plain = (o) => JSON.parse(JSON.stringify(o));
const at = (h, m) => new Date(2026, 9, 10, h, m); // Ortszeit

// Echte Dateien aus Version 1.0
const ALT_1 = { sound: true, teams: [], knownTeams: ['1. FC Köln', 'Augsburg', 'Bayer Leverkusen'], disallowed: true, autostartSet: true };
const ALT_2 = { sound: false, teams: ['Hamburger SV'], disallowed: false };

// ---------------------------------------------------------------- DEFAULTS

test('DEFAULTS: Version 2 mit allen Feldern aus dem Bauplan', () => {
  assert.deepStrictEqual(Object.keys(DEFAULTS), [
    'version', 'design', 'ledColor', 'position', 'size', 'duration', 'sound', 'soundName', 'soundFile', 'volume',
    'favoriteSound', 'favoriteSoundFile', 'eventSounds', 'competitions', 'germanOnly', 'teams', 'favorite',
    'concededMode', 'events', 'forward', 'discordStatus', 'hotkey', 'quiet', 'muteUntil', 'autostartSet', 'knownTeams',
  ]);
  assert.strictEqual(DEFAULTS.version, 2);
  assert.strictEqual(DEFAULTS.discordStatus, true);
  assert.strictEqual(DEFAULTS.hotkey, 'CommandOrControl+Alt+T');
  assert.deepStrictEqual(plain(DEFAULTS.events), { disallowed: true, kickoff: false, halftime: false, fulltime: true, redcard: true });
});

test('DEFAULTS lässt sich nicht verändern, Ergebnisse sind frische Kopien', () => {
  assert.ok(Object.isFrozen(DEFAULTS) && Object.isFrozen(DEFAULTS.events) && Object.isFrozen(DEFAULTS.competitions));
  const a = sanitize({});
  a.events.kickoff = true;
  a.competitions.push(146);
  a.forward.ntfyTopic = 'x';
  assert.strictEqual(DEFAULTS.events.kickoff, false);
  assert.deepStrictEqual(plain(DEFAULTS.competitions), [54]);
  const b = sanitize({});
  assert.notStrictEqual(a.events, b.events);
  assert.strictEqual(b.events.kickoff, false);
  assert.ok(!Object.isFrozen(b) && !Object.isFrozen(b.quiet));
});

// ---------------------------------------------------------------- migrate

test('migrate: echte 1.0-Datei mit bekannten Teams und Autostart', () => {
  const s = migrate(ALT_1);
  assert.deepStrictEqual(s, {
    ...plain(DEFAULTS),
    sound: true,
    teams: [],
    events: { ...DEFAULTS.events, disallowed: true },
    autostartSet: true,
    knownTeams: [
      { id: null, name: '1. FC Köln', leagueId: 54 },
      { id: null, name: 'Augsburg', leagueId: 54 },
      { id: null, name: 'Bayer Leverkusen', leagueId: 54 },
    ],
  });
  assert.ok(!('disallowed' in s));
});

test('migrate: 1.0 ohne Ton, ein Team, aberkannte Tore aus', () => {
  const s = migrate(ALT_2);
  assert.strictEqual(s.version, 2);
  assert.strictEqual(s.sound, false);
  assert.deepStrictEqual(s.teams, [{ id: null, name: 'Hamburger SV' }]);
  assert.deepStrictEqual(s.events, { disallowed: false, kickoff: false, halftime: false, fulltime: true, redcard: true });
  assert.strictEqual(s.autostartSet, false);
  assert.deepStrictEqual(s.knownTeams, []);
  // alles Neue kommt aus den Standardwerten
  assert.strictEqual(s.design, 'tafel');
  assert.deepStrictEqual(s.competitions, [54]);
  assert.strictEqual(s.hotkey, 'CommandOrControl+Alt+T');
});

test('migrate: 1.0 mit kaputten Werten', () => {
  const s = migrate({ sound: 'ja', teams: 'Hamburger SV', disallowed: 1, knownTeams: [null, 3, '', 'Augsburg', 'Augsburg'], autostartSet: 'true' });
  assert.strictEqual(s.sound, true);
  assert.deepStrictEqual(s.teams, []);
  assert.strictEqual(s.events.disallowed, true);
  assert.deepStrictEqual(s.knownTeams, [{ id: null, name: 'Augsburg', leagueId: 54 }]);
  assert.strictEqual(s.autostartSet, false);
});

test('migrate: Version-2-Datei bleibt, wie sie ist', () => {
  const v2 = {
    ...plain(DEFAULTS),
    design: 'videotext',
    teams: [{ id: 9790, name: 'Hamburger SV' }],
    favorite: { id: 8406, name: 'Augsburg' },
    knownTeams: [{ id: 8406, name: 'Augsburg', leagueId: 54 }],
    forward: { ntfyTopic: 'toralarm-k7m2x', discordWebhook: '', onlyFavorite: true },
  };
  assert.deepStrictEqual(migrate(v2), v2);
  assert.deepStrictEqual(migrate(migrate(ALT_1)), migrate(ALT_1));
});

test('migrate: null, undefined, Müll und JSON-Text', () => {
  for (const raw of [null, undefined, 42, 'kaputt', '', [], [1, 2], true, NaN, () => 1, Symbol('x')]) {
    assert.deepStrictEqual(migrate(raw), plain(DEFAULTS), String(typeof raw));
  }
  assert.strictEqual(migrate(JSON.stringify(ALT_2)).sound, false);
  assert.deepStrictEqual(migrate('{"version":2,"design":"ticker"}').design, 'ticker');
});

// ---------------------------------------------------------------- sanitize

test('sanitize: unbekannte Designs, Farben, Positionen fallen auf den Standard', () => {
  const s = sanitize({ design: 'neon', ledColor: 'lila', position: 'mitte', concededMode: 'laut', soundName: 'trompete', favoriteSound: 7 });
  assert.strictEqual(s.design, 'tafel');
  assert.strictEqual(s.ledColor, 'amber');
  assert.strictEqual(s.position, 'unten-rechts');
  assert.strictEqual(s.concededMode, 'normal');
  assert.strictEqual(s.soundName, 'pfiff');
  assert.strictEqual(s.favoriteSound, 'hupe');
  // Groß-/Kleinschreibung und Leerzeichen sind egal
  assert.strictEqual(sanitize({ design: ' Videotext ' }).design, 'videotext');
  assert.strictEqual(sanitize({ favoriteSound: 'gleich' }).favoriteSound, 'gleich');
});

test('sanitize: Zahlen werden begrenzt und gerundet', () => {
  assert.strictEqual(sanitize({ volume: 500 }).volume, 100);
  assert.strictEqual(sanitize({ volume: -1 }).volume, 0);
  assert.strictEqual(sanitize({ volume: '35' }).volume, 35);
  assert.strictEqual(sanitize({ volume: 'laut' }).volume, 70);
  assert.strictEqual(sanitize({ duration: -3 }).duration, 5);
  assert.strictEqual(sanitize({ duration: 61 }).duration, 60);
  assert.strictEqual(sanitize({ duration: 14.6 }).duration, 15);
  assert.strictEqual(sanitize({ duration: NaN }).duration, 14);
  assert.strictEqual(sanitize({ duration: Infinity }).duration, 14);
  assert.strictEqual(sanitize({ duration: '' }).duration, 14);
  assert.strictEqual(sanitize({ size: 125 }).size, 125);
  assert.strictEqual(sanitize({ size: '150' }).size, 150);
  assert.strictEqual(sanitize({ size: 110 }).size, 100);
  assert.strictEqual(sanitize({ size: 140 }).size, 150);
  assert.strictEqual(sanitize({ size: 500 }).size, 150);
  assert.strictEqual(sanitize({ size: null }).size, 100);
  assert.strictEqual(sanitize({ muteUntil: -5 }).muteUntil, 0);
  assert.strictEqual(sanitize({ muteUntil: 1791651600000.4 }).muteUntil, 1791651600000);
  assert.strictEqual(sanitize({ muteUntil: 'bald' }).muteUntil, 0);
});

test('sanitize: Schalter nur als echte Booleans', () => {
  const s = sanitize({ sound: 'false', eventSounds: 0, germanOnly: null, autostartSet: 1 });
  assert.strictEqual(s.sound, true);
  assert.strictEqual(s.eventSounds, true);
  assert.strictEqual(s.germanOnly, true);
  assert.strictEqual(s.autostartSet, false);
  assert.strictEqual(sanitize({ sound: false }).sound, false);
});

test('sanitize: Ruhezeit mit kaputter Uhrzeit', () => {
  assert.deepStrictEqual(sanitize({ quiet: { enabled: true, from: '25:99', to: '7:30' } }).quiet, { enabled: true, from: '23:00', to: '07:30' });
  assert.deepStrictEqual(sanitize({ quiet: { enabled: 'ja', from: '22.15', to: 800 } }).quiet, { enabled: false, from: '22:15', to: '08:00' });
  assert.deepStrictEqual(sanitize({ quiet: 'nachts' }).quiet, plain(DEFAULTS.quiet));
  assert.strictEqual(sanitize({ quiet: { from: '24:00' } }).quiet.from, '23:00');
});

test('sanitize: Ereignisse feldweise, fehlende aus dem Standard', () => {
  assert.deepStrictEqual(sanitize({ events: { kickoff: true, redcard: 'nein' } }).events, {
    disallowed: true, kickoff: true, halftime: false, fulltime: true, redcard: true,
  });
  assert.deepStrictEqual(sanitize({ events: [true, false] }).events, plain(DEFAULTS.events));
});

test('sanitize: Wettbewerbe – nur positive ganze IDs, ohne Doppelte', () => {
  assert.deepStrictEqual(sanitize({ competitions: [54, '146', 54, -1, 'x', 1.5, null, 42] }).competitions, [54, 146, 42]);
  assert.deepStrictEqual(sanitize({ competitions: 'bundesliga' }).competitions, [54]);
  assert.deepStrictEqual(sanitize({ competitions: [] }).competitions, []);
});

test('sanitize: Teams und Lieblingsverein', () => {
  const s = sanitize({
    teams: ['Hamburger SV', { id: 9790, name: 'Hamburger SV' }, { id: '8406', name: ' Augsburg ' }, { name: '' }, null, 5, { id: 9823 }, { id: 8406, name: 'FC Augsburg' }],
    favorite: { id: 9823, name: 'Bayern München', logo: 'egal' },
  });
  // "Hamburger SV" ohne ID wird durch den Eintrag mit ID ersetzt, doppelte IDs fliegen raus
  assert.deepStrictEqual(s.teams, [{ id: 9790, name: 'Hamburger SV' }, { id: 8406, name: 'Augsburg' }]);
  assert.deepStrictEqual(s.favorite, { id: 9823, name: 'Bayern München' });
  assert.deepStrictEqual(sanitize({ favorite: 'Hamburger SV' }).favorite, { id: null, name: 'Hamburger SV' });
  assert.strictEqual(sanitize({ favorite: {} }).favorite, null);
  assert.strictEqual(sanitize({ favorite: 42 }).favorite, null);
  assert.strictEqual(sanitize({ favorite: { id: -3, name: 'Köln' } }).favorite.id, null);
});

test('sanitize: bekannte Teams', () => {
  const s = sanitize({ knownTeams: ['Augsburg', { id: 8406, name: 'Augsburg', leagueId: 54 }, { id: 8406, name: 'Augsburg', leagueId: 54 }, { id: 8406, name: 'Augsburg', leagueId: '42' }, 'x'.repeat(101)] });
  assert.deepStrictEqual(s.knownTeams, [
    { id: null, name: 'Augsburg', leagueId: null },
    { id: 8406, name: 'Augsburg', leagueId: 54 },
    { id: 8406, name: 'Augsburg', leagueId: 42 },
  ]);
});

test('sanitize: eigene Sounddatei', () => {
  const s = sanitize({ soundName: 'datei', soundFile: 'C:\\Users\\bryan\\Music\\tor.mp3' });
  assert.strictEqual(s.soundName, 'datei');
  assert.strictEqual(s.soundFile, 'C:\\Users\\bryan\\Music\\tor.mp3');
  // "Als Pfad kopieren" setzt Anführungszeichen
  assert.strictEqual(sanitize({ soundFile: '"D:\\Sounds\\hupe.wav"' }).soundFile, 'D:\\Sounds\\hupe.wav');
  assert.strictEqual(sanitize({ soundFile: '\\\\nas\\musik\\tor.ogg' }).soundFile, '\\\\nas\\musik\\tor.ogg');
  // ohne gültigen Pfad kein "datei"
  for (const file of ['', 'tor.mp3', 'C:\\a\nb.mp3', 42]) {
    const x = sanitize({ soundName: 'datei', soundFile: file });
    assert.strictEqual(x.soundName, 'pfiff', JSON.stringify(file));
    assert.strictEqual(x.soundFile, '');
  }
  assert.strictEqual(sanitize({ favoriteSound: 'datei' }).favoriteSound, 'hupe');
  assert.strictEqual(sanitize({ favoriteSound: 'datei', favoriteSoundFile: 'C:\\x.m4a' }).favoriteSound, 'datei');
});

test('sanitize: Weiterleitung', () => {
  const f = (forward) => sanitize({ forward }).forward;
  assert.deepStrictEqual(f({ ntfyTopic: ' toralarm-k7m2x ', onlyFavorite: true }), { ntfyTopic: 'toralarm-k7m2x', discordWebhook: '', onlyFavorite: true });
  // aus der App kopierte Adresse -> nur das Thema
  assert.strictEqual(f({ ntfyTopic: 'https://ntfy.sh/toralarm-k7m2x' }).ntfyTopic, 'toralarm-k7m2x');
  assert.strictEqual(f({ ntfyTopic: 'ntfy.sh/tore_123/' }).ntfyTopic, 'tore_123');
  // Strenge Prüfung macht Main/forward.js (mit Fehlermeldung) – hier bleibt der Text erhalten
  assert.strictEqual(f({ ntfyTopic: 'mein thema' }).ntfyTopic, 'mein thema');
  assert.strictEqual(f({ ntfyTopic: 17 }).ntfyTopic, '');
  const hook = 'https://discord.com/api/webhooks/123456789/abc_DEF-ghi';
  assert.strictEqual(f({ discordWebhook: ` ${hook}\n` }).discordWebhook, hook);
  assert.strictEqual(f({ discordWebhook: ['x'] }).discordWebhook, '');
  assert.deepStrictEqual(f('an'), plain(DEFAULTS.forward));
});

test('sanitize: Tastenkürzel', () => {
  const k = (hotkey) => sanitize({ hotkey }).hotkey;
  assert.strictEqual(k(''), '');
  assert.strictEqual(k('CommandOrControl+Alt+T'), 'CommandOrControl+Alt+T');
  assert.strictEqual(k('Ctrl+Shift+F5'), 'Ctrl+Shift+F5');
  assert.strictEqual(k('CommandOrControl+Alt+Plus'), 'CommandOrControl+Alt+Plus');
  assert.strictEqual(k('Alt+num5'), 'Alt+num5');
  for (const bad of ['T', 'F9', 'Alt+', 'Strg+Alt+T', 'Alt+Alt+T', 'Ctrl+CommandOrControl+T', 'Alt+TT', 'Alt+F25', 42, null, 'Command+T']) {
    assert.strictEqual(k(bad), 'CommandOrControl+Alt+T', String(bad));
  }
});

test('sanitize: unbekannte Schlüssel fliegen raus, Version ist immer 2', () => {
  const s = sanitize({ disallowed: false, autostart: true, foo: 1, version: 7 });
  assert.deepStrictEqual(Object.keys(s), Object.keys(DEFAULTS));
  assert.strictEqual(s.version, 2);
});

test('sanitize wirft nie', () => {
  const evil = new Proxy({}, { get() { throw new Error('boom'); } });
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  const getter = { get design() { throw new Error('boom'); }, volume: 20 };
  for (const x of [null, undefined, 0, 'x', [], evil, proxy, Object.create(null), { teams: { length: 1e9 } }]) {
    assert.deepStrictEqual(sanitize(x), plain(DEFAULTS));
  }
  const g = sanitize(getter);
  assert.strictEqual(g.design, 'tafel');
  assert.strictEqual(g.volume, 20);
});

// ---------------------------------------------------------------- merge

test('merge: Teil-Objekt bei events ändert nur dieses Feld', () => {
  const cur = sanitize({ events: { disallowed: false, kickoff: false, halftime: true, fulltime: false, redcard: false } });
  const s = merge(cur, { events: { kickoff: true } });
  assert.deepStrictEqual(s.events, { disallowed: false, kickoff: true, halftime: true, fulltime: false, redcard: false });
});

test('merge: forward und quiet feldweise', () => {
  const cur = sanitize({ forward: { ntfyTopic: 'abc', discordWebhook: '', onlyFavorite: false }, quiet: { enabled: true, from: '22:00', to: '07:00' } });
  const s = merge(cur, { forward: { onlyFavorite: true }, quiet: { to: '06:30' } });
  assert.deepStrictEqual(s.forward, { ntfyTopic: 'abc', discordWebhook: '', onlyFavorite: true });
  assert.deepStrictEqual(s.quiet, { enabled: true, from: '22:00', to: '06:30' });
});

test('merge: Arrays werden ersetzt, nicht angehängt', () => {
  const cur = sanitize({ competitions: [54, 146], teams: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] });
  const s = merge(cur, { competitions: [208], teams: [{ id: 3, name: 'C' }] });
  assert.deepStrictEqual(s.competitions, [208]);
  assert.deepStrictEqual(s.teams, [{ id: 3, name: 'C' }]);
  assert.deepStrictEqual(merge(cur, { teams: [] }).teams, []);
});

test('merge: Lieblingsverein setzen und wieder entfernen', () => {
  const s = merge(DEFAULTS, { favorite: { id: 8406, name: 'Augsburg' } });
  assert.deepStrictEqual(s.favorite, { id: 8406, name: 'Augsburg' });
  assert.strictEqual(merge(s, { favorite: null }).favorite, null);
  assert.deepStrictEqual(merge(s, { favorite: {} }).favorite, { id: 8406, name: 'Augsburg' });
});

test('merge: kaputte Werte im Teil-Objekt behalten den bisherigen Stand', () => {
  const cur = sanitize({ volume: 30, design: 'ticker', hotkey: 'CommandOrControl+Alt+K', teams: [{ id: 1, name: 'A' }], duration: 20 });
  const s = merge(cur, { volume: 'laut', design: 'neon', hotkey: 'Quatsch', teams: 'alle', duration: null, events: 'an', quiet: { from: '25:99' } });
  assert.strictEqual(s.volume, 30);
  assert.strictEqual(s.design, 'ticker');
  assert.strictEqual(s.hotkey, 'CommandOrControl+Alt+K');
  assert.deepStrictEqual(s.teams, [{ id: 1, name: 'A' }]);
  assert.strictEqual(s.duration, 20);
  assert.deepStrictEqual(s.events, plain(DEFAULTS.events));
  assert.strictEqual(s.quiet.from, '23:00');
  // Grenzen gelten trotzdem
  assert.strictEqual(merge(cur, { volume: 500 }).volume, 100);
  assert.strictEqual(merge(cur, { duration: -3 }).duration, 5);
  assert.strictEqual(merge(cur, { hotkey: '' }).hotkey, '');
});

test('merge: eigene Datei ohne Pfad behält den bisherigen Ton', () => {
  const cur = sanitize({ soundName: 'hupe' });
  assert.strictEqual(merge(cur, { soundName: 'datei' }).soundName, 'hupe');
  const withFile = merge(cur, { soundName: 'datei', soundFile: 'C:\\tor.mp3' });
  assert.strictEqual(withFile.soundName, 'datei');
  // Pfad gelöscht -> zurück auf den Standard
  assert.strictEqual(merge(withFile, { soundFile: '' }).soundName, 'pfiff');
});

test('merge: undefined und unbekannte Schlüssel werden ignoriert', () => {
  const cur = sanitize({ design: 'ticker', events: { kickoff: true } });
  const s = merge(cur, { design: undefined, events: { kickoff: undefined, halftime: true }, autostart: false, version: 1, foo: 'bar' });
  assert.strictEqual(s.design, 'ticker');
  assert.strictEqual(s.events.kickoff, true);
  assert.strictEqual(s.events.halftime, true);
  assert.strictEqual(s.version, 2);
  assert.ok(!('autostart' in s) && !('foo' in s));
});

test('merge: Müll als Eingabe wirft nie', () => {
  assert.deepStrictEqual(merge(null, null), plain(DEFAULTS));
  assert.deepStrictEqual(merge(undefined, 'x'), plain(DEFAULTS));
  assert.strictEqual(merge('kaputt', { design: 'videotext' }).design, 'videotext');
  assert.strictEqual(merge([], [1, 2]).design, 'tafel');
  const evil = new Proxy({}, { ownKeys() { throw new Error('boom'); }, get() { throw new Error('boom'); }, has() { throw new Error('boom'); } });
  assert.deepStrictEqual(merge(sanitize({ volume: 40 }), evil).volume, 40);
});

test('merge: Eingaben bleiben unverändert, Ergebnis ist eine neue Kopie', () => {
  const cur = sanitize({ forward: { ntfyTopic: 'abc' } });
  const before = plain(cur);
  const partial = { forward: { onlyFavorite: true }, competitions: [54, 208] };
  const s = merge(cur, partial);
  assert.deepStrictEqual(cur, before);
  assert.deepStrictEqual(partial, { forward: { onlyFavorite: true }, competitions: [54, 208] });
  assert.notStrictEqual(s.forward, cur.forward);
  assert.notStrictEqual(s.competitions, partial.competitions);
  s.forward.ntfyTopic = 'neu'; // main.js setzt bei Fehlern einzelne Felder zurück
  assert.strictEqual(cur.forward.ntfyTopic, 'abc');
});

// ---------------------------------------------------------------- isQuietNow

test('isQuietNow: über Mitternacht (23:00–08:00)', () => {
  const s = sanitize({ quiet: { enabled: true, from: '23:00', to: '08:00' } });
  assert.strictEqual(isQuietNow(s, at(22, 59)), false);
  assert.strictEqual(isQuietNow(s, at(23, 0)), true);
  assert.strictEqual(isQuietNow(s, at(23, 30)), true);
  assert.strictEqual(isQuietNow(s, at(0, 0)), true);
  assert.strictEqual(isQuietNow(s, at(3, 15)), true);
  assert.strictEqual(isQuietNow(s, at(7, 59)), true);
  assert.strictEqual(isQuietNow(s, at(8, 0)), false);
  assert.strictEqual(isQuietNow(s, at(15, 30)), false);
});

test('isQuietNow: am selben Tag (13:00–15:00)', () => {
  const s = sanitize({ quiet: { enabled: true, from: '13:00', to: '15:00' } });
  assert.strictEqual(isQuietNow(s, at(12, 59)), false);
  assert.strictEqual(isQuietNow(s, at(13, 0)), true);
  assert.strictEqual(isQuietNow(s, at(14, 59)), true);
  assert.strictEqual(isQuietNow(s, at(15, 0)), false);
  assert.strictEqual(isQuietNow(s, at(23, 30)), false);
  assert.strictEqual(isQuietNow(s, at(3, 0)), false);
});

test('isQuietNow: ausgeschaltet oder leere Spanne', () => {
  assert.strictEqual(isQuietNow(sanitize({ quiet: { enabled: false, from: '00:00', to: '23:59' } }), at(12, 0)), false);
  assert.strictEqual(isQuietNow(sanitize({ quiet: { enabled: true, from: '08:00', to: '08:00' } }), at(8, 0)), false);
  assert.strictEqual(isQuietNow(DEFAULTS, at(23, 30)), false);
});

test('isQuietNow: Zeitstempel und Rohdaten gehen auch', () => {
  const raw = { quiet: { enabled: true, from: '1:00', to: '6:00' } };
  assert.strictEqual(isQuietNow(raw, at(2, 0).getTime()), true);
  assert.strictEqual(isQuietNow(raw, at(6, 0).getTime()), false);
  assert.strictEqual(typeof isQuietNow(raw), 'boolean'); // ohne Datum: jetzt
});

test('isQuietNow wirft nie', () => {
  const on = sanitize({ quiet: { enabled: true } });
  for (const [s, d] of [[null, at(1, 0)], [undefined, undefined], ['x', at(1, 0)], [{}, at(1, 0)], [{ quiet: null }, at(1, 0)],
    [{ quiet: { enabled: true, from: '25:99', to: '08:00' } }, at(1, 0)], [{ quiet: { enabled: true, from: 7, to: [] } }, at(1, 0)],
    [on, 'kein Datum'], [on, new Date(NaN)], [on, {}]]) {
    assert.strictEqual(isQuietNow(s, d), false);
  }
});

// ---------------------------------------------------------------- validate (Zusatz für settings:save)

test('validate: Meldungen nur für Eingaben, die nicht gehen', () => {
  assert.deepStrictEqual(validate({ design: 'ticker', forward: { ntfyTopic: 'toralarm-k7m2x', discordWebhook: '' }, hotkey: '' }), {});
  assert.deepStrictEqual(validate({ forward: { ntfyTopic: 'https://ntfy.sh/tore' } }), {});
  const e = validate({
    hotkey: 'T',
    forward: { ntfyTopic: 'mein thema', discordWebhook: 'https://example.com/api/webhooks/1/x' },
    quiet: { from: '25:99' },
    soundFile: 'tor.mp3',
    competitions: [],
  });
  assert.deepStrictEqual(Object.keys(e).sort(), ['competitions', 'discordWebhook', 'hotkey', 'ntfyTopic', 'quiet', 'soundFile']);
  assert.ok(e.ntfyTopic.includes('Buchstaben'));
  assert.deepStrictEqual(validate(null), {});
  assert.deepStrictEqual(validate({ forward: { discordWebhook: 'https://discordapp.com/api/webhooks/123/abc' } }), {});
  assert.ok(validate({ forward: { ntfyTopic: 'x'.repeat(65) } }).ntfyTopic);
});

test('discordStatus: Standard an, nur echte Booleans, 1.0-Dateien bekommen den Standard', () => {
  assert.strictEqual(migrate(ALT_1).discordStatus, true);
  assert.strictEqual(sanitize({ discordStatus: false }).discordStatus, false);
  assert.strictEqual(sanitize({ discordStatus: 'nein' }).discordStatus, true);
  assert.strictEqual(merge(sanitize({}), { discordStatus: false }).discordStatus, false);
  assert.strictEqual(merge(sanitize({ discordStatus: false }), { discordStatus: 1 }).discordStatus, false);
});
