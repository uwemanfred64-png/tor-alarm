const test = require('node:test');
const assert = require('node:assert');
const { fileURLToPath } = require('node:url');
const sound = require('../src/sound/sound');

// ------------------------------------------------------------ Attrappe eines BaseAudioContext
// Zeichnet alle Knoten, Verbindungen, Start/Stopp und Automationen auf und prüft dabei, was echtes
// WebAudio mit einer Ausnahme quittieren würde (NaN, exponentielle Rampe auf 0, Start vor 0 …).

function fakeContext(sampleRate = 48000) {
  const errors = [];
  const nodes = [];
  const sources = [];
  const ok = (v, what) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${what}: ${v}`);
  };

  function param(owner, name, value) {
    const events = [];
    const p = {
      owner,
      name,
      value,
      events,
      setValueAtTime(v, t) {
        ok(v, `${name}.setValueAtTime`);
        ok(t, `${name}.setValueAtTime t`);
        events.push(['set', v, t]);
        return p;
      },
      linearRampToValueAtTime(v, t) {
        ok(v, `${name}.linearRamp`);
        ok(t, `${name}.linearRamp t`);
        events.push(['lin', v, t]);
        return p;
      },
      exponentialRampToValueAtTime(v, t) {
        ok(v, `${name}.expRamp`);
        ok(t, `${name}.expRamp t`);
        if (v === 0) errors.push(`${name}: exponentielle Rampe auf 0`);
        events.push(['exp', v, t]);
        return p;
      },
      setTargetAtTime(v, t, tc) {
        ok(v, `${name}.setTarget`);
        ok(t, `${name}.setTarget t`);
        if (!(tc > 0)) errors.push(`${name}: Zeitkonstante ${tc}`);
        events.push(['target', v, t, tc]);
        return p;
      },
      setValueCurveAtTime(curve, t, d) {
        if (!(curve.length >= 2)) errors.push(`${name}: Kurve zu kurz`);
        for (const c of curve) ok(c, `${name}.curve`);
        if (!(d > 0)) errors.push(`${name}: Kurvendauer ${d}`);
        events.push(['curve', Array.from(curve), t, d]);
        return p;
      },
    };
    return p;
  }

  function node(kind, params = {}) {
    const n = { kind, outputs: [], params: [] };
    for (const [k, v] of Object.entries(params)) {
      n[k] = param(n, `${kind}.${k}`, v);
      n.params.push(n[k]);
    }
    n.connect = (dest) => {
      if (!dest) errors.push(`${kind}: connect ohne Ziel`);
      n.outputs.push(dest);
      return dest && dest.outputs ? dest : undefined; // an AudioParam: kein Rückgabewert
    };
    n.disconnect = () => {
      n.outputs.length = 0;
    };
    nodes.push(n);
    return n;
  }

  function source(kind, params) {
    const n = node(kind, params);
    n.start = (t = 0, offset = 0) => {
      ok(t, `${kind}.start`);
      if (t < 0) errors.push(`${kind}: start(${t}) < 0`);
      if (n.started != null) errors.push(`${kind}: zweimal gestartet`);
      if (offset < 0) errors.push(`${kind}: offset < 0`);
      n.started = t;
    };
    n.stop = (t = 0) => {
      ok(t, `${kind}.stop`);
      n.stopped = t;
    };
    sources.push(n);
    return n;
  }

  const ctx = {
    sampleRate,
    currentTime: 0,
    createGain: () => node('gain', { gain: 1 }),
    createOscillator: () => {
      const o = source('osc', { frequency: 440, detune: 0 });
      o.type = 'sine';
      o.setPeriodicWave = (w) => {
        if (!w) errors.push('osc: PeriodicWave fehlt');
        o.type = 'custom';
      };
      return o;
    },
    createBufferSource: () => {
      const s = source('buffer', { playbackRate: 1, detune: 0 });
      s.loop = false;
      s.buffer = null;
      return s;
    },
    createConstantSource: () => source('constant', { offset: 1 }),
    createBiquadFilter: () => {
      const f = node('biquad', { frequency: 350, Q: 1, gain: 0, detune: 0 });
      f.type = 'lowpass';
      return f;
    },
    createWaveShaper: () => node('shaper'),
    createStereoPanner: () => node('panner', { pan: 0 }),
    createConvolver: () => node('convolver'),
    createDynamicsCompressor: () => node('compressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }),
    createPeriodicWave: (real, imag) => {
      if (real.length !== imag.length) errors.push('PeriodicWave: Längen verschieden');
      return { real, imag };
    },
    createBuffer: (channels, length, rate) => {
      if (!(length > 0) || !(rate >= 3000)) errors.push(`createBuffer(${channels}, ${length}, ${rate})`);
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: (i) => data[i] };
    },
  };
  ctx.destination = node('destination');
  return { ctx, errors, nodes, sources };
}

// Führt ein Knoten (über Knoten oder AudioParams) bis zum Ziel?
function reaches(n, dest, seen = new Set()) {
  if (n === dest) return true;
  if (seen.has(n)) return false;
  seen.add(n);
  return n.outputs.some((o) => (o.owner ? reaches(o.owner, dest, seen) : reaches(o, dest, seen)));
}

const SYNTH = sound.NAMES.filter((n) => n !== 'datei');

// ------------------------------------------------------------ Tests

test('alle Namen aus dem Bauplan sind da', () => {
  assert.deepStrictEqual(sound.NAMES, ['pfiff', 'anpfiff', 'halbzeitpfiff', 'abpfiff', 'hupe', 'glocke', 'jubel', 'datei']);
});

test('Lautstärke: linear, 70 = 1, 0 = stumm, Grenzen', () => {
  assert.strictEqual(sound.gainFor(0), 0);
  assert.strictEqual(sound.gainFor(70), 1);
  assert.strictEqual(sound.gainFor(35), 0.5);
  assert.strictEqual(sound.gainFor(100), 100 / 70);
  assert.strictEqual(sound.gainFor(250), 100 / 70);
  assert.strictEqual(sound.gainFor(-3), 0);
  assert.strictEqual(sound.gainFor('70'), 1);
  assert.strictEqual(sound.gainFor(undefined), 1); // fehlt → Standard 70
  assert.strictEqual(sound.gainFor('quatsch'), 1);
});

test('Dateipfad → file:///-URL mit Leerzeichen, Umlauten, # und %', () => {
  assert.strictEqual(sound.fileUrl('C:\\Users\\bryan\\Mein Ordner ä\\tor.wav'), 'file:///C:/Users/bryan/Mein%20Ordner%20%C3%A4/tor.wav');
  assert.strictEqual(sound.fileUrl('D:\\Töne\\Tor #1 – 100%.mp3'), 'file:///D:/T%C3%B6ne/Tor%20%231%20%E2%80%93%20100%25.mp3');
  assert.strictEqual(sound.fileUrl('\\\\nas\\Musik\\Hymne.ogg'), 'file://nas/Musik/Hymne.ogg');
  assert.strictEqual(sound.fileUrl('\\\\?\\C:\\lang\\tor.m4a'), 'file:///C:/lang/tor.m4a');
  assert.strictEqual(sound.fileUrl('C:/schon/vorwärts.wav'), 'file:///C:/schon/vorw%C3%A4rts.wav');
  // zurück übersetzt ergibt sich wieder genau der Pfad
  for (const p of ['C:\\Users\\bryan\\Mein Ordner ä\\tor.wav', 'D:\\Töne\\Tor #1 – 100% (Ü).mp3', 'E:\\a&b;c=d\\x+y.wav']) {
    assert.strictEqual(fileURLToPath(sound.fileUrl(p), { windows: true }), p);
  }
});

test('Dateipfad: leer oder nicht vollständig → verständlicher Fehler', () => {
  assert.throws(() => sound.fileUrl(''), /Keine Sounddatei/);
  assert.throws(() => sound.fileUrl(null), /Keine Sounddatei/);
  assert.throws(() => sound.fileUrl('tor.mp3'), /vollständigen Pfad/);
  assert.throws(() => sound.fileUrl('C:tor.mp3'), /vollständigen Pfad/);
  assert.throws(() => sound.fileUrl('C:\\kaputt\\\uD800.wav'), /Ungültiger Dateipfad/);
});

test('play: unbekannter Ton und unbrauchbare Datei werden abgelehnt', async () => {
  await assert.rejects(sound.play({ name: 'tröte' }), /Unbekannter Ton: tröte/);
  await assert.rejects(sound.play(null), /Unbekannter Ton/);
  await assert.rejects(sound.play({ name: 'datei', file: 'relativ.mp3', volume: 70 }), /vollständigen Pfad/);
  await assert.rejects(sound.play({ name: 'datei', file: '', volume: 70 }), /Keine Sounddatei/);
});

for (const name of SYNTH) {
  test(`Synthese "${name}": gültige Automationen, alles gestoppt, alles am Ausgang`, () => {
    const { ctx, errors, nodes, sources } = fakeContext();
    const dest = ctx.createGain();
    const when = 0.25;
    const duration = sound.build(ctx, dest, name, when, 42);
    assert.deepStrictEqual(errors, []);
    assert.ok(Number.isFinite(duration) && duration > 0.5 && duration < 7, `Dauer ${duration}`);
    assert.ok(sources.length > 0);
    for (const s of sources) {
      assert.ok(s.started != null, `${s.kind} nie gestartet`);
      assert.ok(s.stopped != null, `${s.kind} nie gestoppt – würde ewig laufen`);
      assert.ok(s.stopped > s.started, `${s.kind} stoppt vor dem Start`);
      assert.ok(s.started >= when - 0.01, `${s.kind} startet vor dem Ton (${s.started})`);
      assert.ok(s.stopped <= when + duration + 1e-9, `${s.kind} läuft über die gemeldete Dauer hinaus`);
    }
    for (const n of nodes) {
      if (n === dest || n === ctx.destination) continue;
      assert.ok(reaches(n, dest), `${n.kind} hängt in der Luft`);
    }
  });
}

test('Synthese ist mit gleichem Startwert gleich, mit anderem anders', () => {
  const events = (seed) => {
    const { ctx, nodes } = fakeContext();
    sound.build(ctx, ctx.createGain(), 'jubel', 0, seed);
    return JSON.stringify(nodes.map((n) => n.params.map((p) => [p.value, p.events])));
  };
  assert.strictEqual(events(5), events(5));
  assert.notStrictEqual(events(5), events(6));
});

test('Pfiffe: Anzahl und Länge wie beim Schiri', () => {
  const blasts = (name) => {
    const { ctx, sources } = fakeContext();
    sound.build(ctx, ctx.createGain(), name, 0, 1);
    // je Pfiff genau ein Tonoszillator mit eigener Wellenform (dazu der Flatter-LFO als Dreieck)
    return sources.filter((s) => s.kind === 'osc' && s.type === 'custom').map((s) => +(s.stopped - s.started).toFixed(2));
  };
  assert.deepStrictEqual(blasts('pfiff'), [0.28, 0.62]);
  assert.deepStrictEqual(blasts('anpfiff'), [1.02]);
  assert.deepStrictEqual(blasts('halbzeitpfiff'), [0.57, 0.87]);
  assert.deepStrictEqual(blasts('abpfiff'), [0.42, 0.42, 1.42]);
});

test('unbekannter Name beim Bauen wirft', () => {
  const { ctx } = fakeContext();
  assert.throws(() => sound.build(ctx, ctx.createGain(), 'datei', 0), /Unbekannter Ton/);
});
