// Tor-Alarm – Töne. Läuft im versteckten Sound-Fenster (sound.html).
// Alles außer "datei" wird mit WebAudio erzeugt, es gibt keine Sounddateien im Projekt.
// Jede Synthese bekommt einen beliebigen BaseAudioContext und einen Ziel-Knoten: derselbe Code
// spielt live und lässt sich offline (OfflineAudioContext) nachmessen.
(function (root) {
  const NAMES = ['pfiff', 'anpfiff', 'halbzeitpfiff', 'abpfiff', 'rotpfiff', 'hupe', 'glocke', 'jubel', 'datei'];
  const MAX_FILE = 30; // eigene Dateien höchstens so viele Sekunden, dann ausblenden
  const MAX_LEN = 7; // kein erzeugter Ton (samt Hall) ist länger

  // Grundpegel je Klang bei Lautstärke 70 – per Offline-Messung aufeinander abgestimmt.
  const LEVEL = { pfeife: 0.164, hupe: 0.125, glocke: 0.16, jubel: 0.22 };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Lautstärke 0..100 → Verstärkung, linear: 70 = 1 (so laut wie der Pfiff aus Version 1.0).
  function gainFor(volume) {
    const v = volume == null || volume === '' ? 70 : Number(volume);
    return Number.isFinite(v) ? clamp(v, 0, 100) / 70 : 1;
  }

  // Windows-Pfad → file:///-URL. Jeder Pfadteil wird kodiert (Leerzeichen, Umlaute, #, % …).
  function fileUrl(file) {
    let p = String(file == null ? '' : file).trim();
    if (!p) throw new Error('Keine Sounddatei ausgewählt.');
    p = p.replace(/\\/g, '/');
    if (/^\/\/[?.]\/unc\//i.test(p)) p = '//' + p.slice(8); // \\?\UNC\server\freigabe\…
    else if (/^\/\/[?.]\/[a-z]:\//i.test(p)) p = p.slice(4); // \\?\C:\…
    let head;
    if (/^[a-z]:\//i.test(p)) {
      head = 'file:///' + p.slice(0, 2);
      p = p.slice(2);
    } else if (/^\/\/[^/]+\/[^/]+/.test(p)) {
      const host = p.slice(2).split('/')[0];
      head = 'file://' + host;
      p = p.slice(2 + host.length);
    } else {
      throw new Error(`Sounddatei braucht einen vollständigen Pfad: ${file}`);
    }
    try {
      return head + p.split('/').map((s) => encodeURIComponent(s)).join('/');
    } catch {
      throw new Error(`Ungültiger Dateipfad: ${file}`);
    }
  }

  // ------------------------------------------------------------ Zufall und Puffer

  // Kleiner Zufallsgenerator mit Startwert (mulberry32): gleicher Startwert, gleiche Folge –
  // so sind Offline-Messungen reproduzierbar, live klingt trotzdem jeder Ton etwas anders.
  function random(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Puffer (Rauschen, Hall …) werden je AudioContext einmal gebaut und wiederverwendet.
  const stores = new WeakMap();
  function cached(ctx, key, make) {
    let m = stores.get(ctx);
    if (!m) stores.set(ctx, (m = new Map()));
    if (!m.has(key)) m.set(key, make());
    return m.get(key);
  }

  // Eigener Startwert je Puffer und Kanal (aus dem Namen), damit sich kein Rauschen wiederholt
  function seedOf(key, ch) {
    let h = 7 + ch * 977;
    for (const c of key) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
    return h;
  }

  function buffer(ctx, key, seconds, channels, fill, rate = ctx.sampleRate) {
    return cached(ctx, key, () => {
      const b = ctx.createBuffer(channels, Math.round(rate * seconds), rate);
      for (let ch = 0; ch < channels; ch++) fill(b.getChannelData(ch), random(seedOf(key, ch)), rate);
      return b;
    });
  }

  const white = (ctx) =>
    buffer(ctx, 'weiss', 2, 1, (d, rand) => {
      for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
    });

  // Rosa Rauschen (Filter nach Paul Kellet), zwei unabhängige Kanäle für Breite
  const pink = (ctx) =>
    buffer(ctx, 'rosa', 4, 2, (d, rand) => {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = rand() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    });

  // Braunes Rauschen (aufsummiert) – das tiefe Grummeln im Stadion
  const brown = (ctx) =>
    buffer(ctx, 'braun', 4, 1, (d, rand) => {
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        last = (last + 0.02 * (rand() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    });

  // Langsame Zufallskurve (-1..1, 8 Stützpunkte pro Sekunde, nahtlos schleifbar).
  // Tempo über playbackRate – damit schwanken Tonhöhe und Lautstärke wie bei echten Menschen/Instrumenten.
  const wobble = (ctx) =>
    buffer(
      ctx,
      'wackeln',
      20,
      1,
      (d, rand, rate) => {
        const step = rate / 8;
        const knots = Array.from({ length: Math.ceil(d.length / step) + 1 }, () => rand() * 2 - 1);
        knots[knots.length - 1] = knots[0];
        for (let i = 0; i < d.length; i++) {
          const k = Math.floor(i / step);
          const w = (1 - Math.cos(Math.PI * ((i % step) / step))) / 2;
          d[i] = knots[k] * (1 - w) + knots[k + 1] * w;
        }
      },
      8000,
    );

  // Stadion-Hall: Impulsantwort aus abklingendem Rauschen, die Höhen verklingen schneller.
  const hall = (ctx) =>
    buffer(ctx, 'hall', 1.8, 2, (d, rand, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const a = Math.exp((-2 * Math.PI * (600 + 8000 * Math.exp(-t * 2.5))) / sr);
        lp = a * lp + (1 - a) * (rand() * 2 - 1);
        d[i] = lp * Math.exp(-t * 3.8) * Math.min(1, t / 0.015);
      }
    });

  // Weiche Sättigung (tanh) – lässt die Hupenmembran schnarren
  const saturation = (ctx) =>
    cached(ctx, 'saettigung', () => {
      const c = new Float32Array(1025);
      for (let i = 0; i < c.length; i++) c[i] = Math.tanh(1.8 * ((i / 512) - 1)) / Math.tanh(1.8);
      return c;
    });

  // ------------------------------------------------------------ Bausteine

  function amp(ctx, value) {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  }

  // Bei lowpass/highpass ist Q in dB (-3 ≈ ohne Überhöhung), sonst die Güte.
  function filter(ctx, type, freq, q, gain) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    if (gain != null) f.gain.value = gain;
    return f;
  }

  function noise(ctx, buf, t, stop, rand) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(t, rand() * (buf.duration - 0.1));
    src.stop(stop);
    return src;
  }

  // Zufallskurve als Steuersignal (Ausgang ±depth), wird auf AudioParams gelegt.
  function wobbler(ctx, t, stop, rate, depth, rand) {
    const src = ctx.createBufferSource();
    src.buffer = wobble(ctx);
    src.loop = true;
    src.playbackRate.value = rate;
    const g = amp(ctx, depth);
    src.connect(g);
    src.start(t, rand() * 19);
    src.stop(stop);
    return g;
  }

  function addHall(ctx, from, out, wet) {
    const conv = ctx.createConvolver();
    conv.buffer = hall(ctx);
    from.connect(conv).connect(amp(ctx, wet)).connect(out);
  }

  // ------------------------------------------------------------ Pfeife

  // Fast reiner Ton mit etwas 2. und 3. Harmonischer
  const whistleWave = (ctx) =>
    cached(ctx, 'pfeife', () => ctx.createPeriodicWave(new Float32Array(4), new Float32Array([0, 1, 0.08, 0.03])));

  // Ein Pfiff. Die Kugel in der Pfeife lässt Tonhöhe und Lautstärke ~35-mal pro Sekunde flattern.
  function blast(ctx, out, t, len, rand) {
    const end = t + len;
    const stop = end + 0.12;
    const f = 2830 * (1 + (rand() - 0.5) * 0.02);
    const rate = 33 + rand() * 7;

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(whistleWave(ctx));
    const fq = osc.frequency;
    fq.setValueAtTime(f * 0.94, t); // beim Anblasen zieht der Ton hoch
    fq.setTargetAtTime(f, t, 0.012);
    if (len > 0.4) {
      // langer Pfiff: der Atem lässt die Tonhöhe leicht wandern
      fq.setValueAtTime(f, t + 0.1);
      fq.linearRampToValueAtTime(f * 1.007, t + len * 0.55);
      fq.linearRampToValueAtTime(f * 1.002, end - 0.04);
    } else {
      fq.setValueAtTime(f, end - 0.04);
    }
    fq.exponentialRampToValueAtTime(f * 0.96, end + 0.04); // beim Absetzen sackt er ab

    // Kugel: Frequenz- und Lautstärke-Flattern, kommt beim Anblasen erst in Schwung und
    // rollt nie ganz gleichmäßig
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.setValueAtTime(rate * 0.6, t);
    lfo.frequency.linearRampToValueAtTime(rate, t + 0.07);
    wobbler(ctx, t, stop, 1.5, rate * 0.15, rand).connect(lfo.frequency);
    lfo.connect(amp(ctx, f * 0.03)).connect(fq);
    wobbler(ctx, t, stop, 3, f * 0.006, rand).connect(fq);
    const flutter = amp(ctx, 0.76);
    lfo.connect(amp(ctx, 0.24)).connect(flutter.gain);
    wobbler(ctx, t, stop, 0.7, 0.06, rand).connect(flutter.gain);

    // Luft: Rauschen um den Pfeifton, beim Anblasen ein kurzes Zischen
    const air = noise(ctx, white(ctx), t, stop, rand);
    air.connect(filter(ctx, 'bandpass', f, 4)).connect(amp(ctx, 0.4)).connect(flutter);
    const chiff = amp(ctx, 0);
    chiff.gain.setValueAtTime(0, t);
    chiff.gain.linearRampToValueAtTime(0.22, t + 0.006);
    chiff.gain.setTargetAtTime(0, t + 0.006, 0.012);
    air.connect(filter(ctx, 'bandpass', 3600, 0.9)).connect(chiff).connect(out);

    const env = amp(ctx, 0);
    const g = env.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(1, t + 0.02);
    if (len > 0.4) {
      g.setValueAtTime(1, t + 0.06);
      g.linearRampToValueAtTime(0.85, t + 0.3);
      g.setValueAtTime(0.85, end - 0.03);
    } else {
      g.setValueAtTime(1, end - 0.03);
    }
    g.setTargetAtTime(0, end - 0.03, 0.016);
    osc.connect(flutter).connect(env).connect(out);

    for (const n of [osc, lfo]) {
      n.start(t);
      n.stop(stop);
    }
    return stop;
  }

  // [Beginn, Länge] in Sekunden
  const WHISTLES = {
    pfiff: [[0, 0.16], [0.25, 0.5]],
    anpfiff: [[0, 0.9]],
    halbzeitpfiff: [[0, 0.45], [0.62, 0.75]],
    abpfiff: [[0, 0.3], [0.44, 0.3], [0.88, 1.3]],
    // Rote Karte: drei kurze, scharfe Stöße – klingt anders als der Tor-Doppelpfiff
    rotpfiff: [[0, 0.1], [0.17, 0.1], [0.34, 0.1]],
  };

  function whistle(ctx, out, t, rand, pattern) {
    const level = amp(ctx, LEVEL.pfeife);
    level.connect(out);
    let end = t;
    for (const [at, len] of pattern) end = Math.max(end, blast(ctx, level, t + at, len, rand));
    return end - t;
  }

  // ------------------------------------------------------------ Hupe

  // Drucklufthupe wie in der Fankurve: drei leicht verstimmte Trichter (Akkord um 230–350 Hz),
  // schnarrende Membran (Sägezahn + Rechteck, leicht übersteuert), Trichter-Klangfarbe, Ventil-Zischen.
  function horn(ctx, out, t, rand) {
    const end = t + 1.15; // so lange ist das Ventil offen
    const stop = end + 0.5;

    // Gasdruck: beim Öffnen zieht der Ton hoch, beim Loslassen sackt er ab (in Cent)
    const pitch = ctx.createConstantSource();
    const p = pitch.offset;
    p.setValueAtTime(-120, t);
    p.setTargetAtTime(0, t, 0.025);
    p.setValueAtTime(0, end);
    p.linearRampToValueAtTime(-150, end + 0.22);
    const jitter = wobbler(ctx, t, stop, 1.5, 5, rand);

    const mix = amp(ctx, 0.3);
    for (const [f, a] of [[232.5, 1], [295.4, 0.75], [348.2, 0.5]]) {
      for (const [type, cents, share] of [['sawtooth', -5, 1], ['square', 6, 0.45]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = cents + (rand() - 0.5) * 6;
        pitch.connect(o.detune);
        jitter.connect(o.detune);
        o.connect(amp(ctx, a * share)).connect(mix);
        o.start(t);
        o.stop(stop);
      }
    }
    pitch.start(t);
    pitch.stop(stop);

    const shaper = ctx.createWaveShaper();
    shaper.curve = saturation(ctx);
    // Trichter: Höhen öffnen sich mit dem Druck und schließen beim Loslassen
    const lp = filter(ctx, 'lowpass', 700, -3);
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.setTargetAtTime(3400, t, 0.03);
    lp.frequency.setTargetAtTime(2800, t + 0.3, 0.5);
    lp.frequency.setTargetAtTime(600, end, 0.08);

    const env = amp(ctx, 0);
    const g = env.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(1.1, t + 0.045); // Anstoß etwas lauter
    g.setTargetAtTime(1, t + 0.045, 0.08);
    g.setTargetAtTime(0, end, 0.055);

    const level = amp(ctx, LEVEL.hupe);
    mix
      .connect(shaper)
      .connect(lp)
      .connect(filter(ctx, 'peaking', 1400, 1.4, 6))
      .connect(filter(ctx, 'peaking', 2600, 2, 4))
      .connect(filter(ctx, 'highpass', 170, -3))
      .connect(env)
      .connect(level);
    level.connect(out);
    addHall(ctx, level, out, 0.18);

    // Ventil: kurzes Zischen beim Öffnen, leises Rauschen, solange Gas strömt
    const hiss = amp(ctx, 0);
    hiss.gain.setValueAtTime(0, t);
    hiss.gain.linearRampToValueAtTime(0.16, t + 0.008);
    hiss.gain.setTargetAtTime(0.025, t + 0.008, 0.04);
    hiss.gain.setTargetAtTime(0, end, 0.03);
    noise(ctx, white(ctx), t, stop, rand).connect(filter(ctx, 'bandpass', 3200, 0.8)).connect(hiss).connect(level);

    return stop - t + 0.9;
  }

  // ------------------------------------------------------------ Glocke

  // Teiltöne einer kleinen Bronzeglocke: [Verhältnis zum Grundton, Stärke, Abklingzeit s, Schwebung Hz].
  // Wie bei echten Glocken nicht ganzzahlig (Unterton, Prime, Terz, Quinte, Nominal …), die großen
  // Teiltöne als Paar mit leichter Schwebung.
  const BELL = [
    [0.5, 0.3, 1.1, 0.5],
    [1, 0.45, 0.85, 0.8],
    [1.188, 0.38, 0.7, 1.1],
    [1.502, 0.15, 0.45, 0],
    [2.004, 0.55, 0.6, 1.5],
    [2.515, 0.22, 0.35, 0],
    [2.662, 0.2, 0.3, 1.8],
    [3.011, 0.14, 0.24, 0],
    [4.07, 0.1, 0.16, 0],
    [5.24, 0.07, 0.11, 0],
    [6.53, 0.05, 0.08, 0],
  ];

  function bell(ctx, out, t, rand) {
    const f0 = 620;
    const hits = [[0, 1], [0.3, 0.8], [0.6, 0.95]]; // [Zeitpunkt, Stärke]
    const damp = t + 0.6 + 1.7; // dann legt jemand die Hand auf die Glocke
    const stop = damp + 0.8;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(1, damp);
    bus.gain.setTargetAtTime(0, damp, 0.12);

    for (const [dt, vel] of hits) {
      const h = t + dt;
      for (const [r, a, tau, beat] of BELL) {
        const peak = a * vel ** (1 + r * 0.25); // fester Schlag → mehr hohe Teiltöne
        const freqs = beat ? [r * f0 - beat / 2, r * f0 + beat / 2] : [r * f0];
        for (const f of freqs) {
          const o = ctx.createOscillator();
          o.frequency.value = f;
          const g = amp(ctx, 0);
          g.gain.setValueAtTime(0, h);
          g.gain.linearRampToValueAtTime(peak / freqs.length, h + 0.002);
          g.gain.setTargetAtTime(0, h + 0.002, tau);
          o.connect(g).connect(bus);
          // zufällige Phase (Start bis eine Periode früher, stumm): sonst addieren sich
          // alle Teiltöne im Anschlag zu einer unnatürlich spitzen Welle
          o.start(Math.max(0, h - rand() / f));
          o.stop(Math.min(stop, h + tau * 8));
        }
      }
      // Klöppel: kurzes, helles Klicken
      const click = amp(ctx, 0);
      click.gain.setValueAtTime(0, h);
      click.gain.linearRampToValueAtTime(0.25 * vel, h + 0.0015);
      click.gain.setTargetAtTime(0, h + 0.0015, 0.005);
      noise(ctx, white(ctx), h, h + 0.06, rand).connect(filter(ctx, 'bandpass', 3000, 1.2)).connect(click).connect(bus);
    }

    const level = amp(ctx, LEVEL.glocke);
    bus.connect(level).connect(out);
    addHall(ctx, level, out, 0.25);
    return stop - t + 0.9;
  }

  // ------------------------------------------------------------ Jubel

  // S-Kurve 0 → 1 für das Anschwellen
  const swell = (ctx) =>
    cached(ctx, 'anschwellen', () => {
      const c = new Float32Array(33);
      for (let i = 0; i < c.length; i++) {
        const x = i / 32;
        c[i] = x * x * (3 - 2 * x);
      }
      return c;
    });

  // Rauschbänder im Bereich der Stimmen: [Mitte Hz, Pegel]
  const CROWD_BANDS = [[300, 0.8], [420, 0.95], [580, 1], [800, 1], [1100, 0.9], [1500, 0.75], [2100, 0.55], [3000, 0.35]];

  // Stadionjubel: rosa Rauschen in acht Sprachbändern, jedes schwankt für sich (viele Stimmen
  // durcheinander), die ganze Menge wogt langsam; dazu ein Chor aus vielen leicht verschiedenen
  // Rufen, etwas Grummeln und viel Hall.
  function crowd(ctx, out, t, rand) {
    const end = t + 3; // 0,5 s anschwellen, 2,5 s halten
    const stop = end + 2;

    const bus = amp(ctx, 0);
    const g = bus.gain;
    g.setValueCurveAtTime(swell(ctx), t, 0.5);
    g.linearRampToValueAtTime(1.06, t + 1.2);
    g.linearRampToValueAtTime(0.96, t + 2.1);
    g.linearRampToValueAtTime(1, t + 2.6);
    g.linearRampToValueAtTime(0.9, end);
    g.setTargetAtTime(0, end, 0.3);

    // langsames Auf und Ab der ganzen Menge
    const surge = amp(ctx, 1);
    wobbler(ctx, t, stop, 0.1, 0.12, rand).connect(surge.gain);

    const air = noise(ctx, pink(ctx), t, stop, rand);
    for (const [fc, lvl] of CROWD_BANDS) {
      const band = amp(ctx, lvl);
      wobbler(ctx, t, stop, 0.6 + rand() * 0.8, lvl * 0.3, rand).connect(band.gain);
      air.connect(filter(ctx, 'bandpass', fc, 2.2)).connect(band).connect(surge);
    }

    // Viele Rufe: Sägezahn-Stimmen 150–390 Hz, steigen zu Beginn an ("Tooor"), schwanken in Höhe
    // und Lautstärke, verteilt im Raum; danach Vokal-Formanten (a/o).
    const voices = ctx.createGain();
    for (let i = 0; i < 28; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 150 * 2.6 ** rand();
      const det = o.detune;
      det.setValueAtTime(-260 - rand() * 200, t);
      det.setTargetAtTime(0, t, 0.18 + rand() * 0.2);
      const w = wobbler(ctx, t, stop, 0.5 + rand() * 0.7, 1, rand);
      w.connect(amp(ctx, 45)).connect(det);
      const vg = amp(ctx, 0.55);
      w.connect(amp(ctx, 0.45)).connect(vg.gain);
      const pan = ctx.createStereoPanner();
      pan.pan.value = rand() * 1.6 - 0.8;
      o.connect(vg).connect(pan).connect(voices);
      o.start(t + rand() * 0.15);
      o.stop(stop);
    }
    const vowel = amp(ctx, 0.2);
    for (const [fc, q, lvl] of [[350, 1.5, 0.6], [700, 5, 1], [1150, 6, 0.6], [2500, 7, 0.25]]) {
      voices.connect(filter(ctx, 'bandpass', fc, q)).connect(amp(ctx, lvl)).connect(vowel);
    }
    vowel.connect(surge);

    // etwas Grummeln (Stadiondach, Getrampel)
    noise(ctx, brown(ctx), t, stop, rand).connect(filter(ctx, 'bandpass', 170, 0.8)).connect(amp(ctx, 0.15)).connect(surge);

    // Beim Anschwellen und Abklingen dumpfer, auf dem Höhepunkt hell
    const tone = filter(ctx, 'lowpass', 1800, -3);
    tone.frequency.setValueAtTime(1800, t);
    tone.frequency.setTargetAtTime(6000, t, 0.15);
    tone.frequency.setTargetAtTime(1600, end, 0.4);

    const level = amp(ctx, LEVEL.jubel);
    surge.connect(bus).connect(filter(ctx, 'highpass', 140, -3)).connect(tone).connect(level).connect(out);
    addHall(ctx, level, out, 0.35);
    return stop - t + 0.9;
  }

  // ------------------------------------------------------------ Zusammenbau

  const SYNTH = {
    pfiff: (ctx, out, t, rand) => whistle(ctx, out, t, rand, WHISTLES.pfiff),
    anpfiff: (ctx, out, t, rand) => whistle(ctx, out, t, rand, WHISTLES.anpfiff),
    halbzeitpfiff: (ctx, out, t, rand) => whistle(ctx, out, t, rand, WHISTLES.halbzeitpfiff),
    abpfiff: (ctx, out, t, rand) => whistle(ctx, out, t, rand, WHISTLES.abpfiff),
    rotpfiff: (ctx, out, t, rand) => whistle(ctx, out, t, rand, WHISTLES.rotpfiff),
    hupe: horn,
    glocke: bell,
    jubel: crowd,
  };

  // Baut einen Ton in ctx (AudioContext oder OfflineAudioContext) auf, Ausgang in dest,
  // Beginn bei when. Gibt die Dauer samt Ausklingen in Sekunden zurück.
  function build(ctx, dest, name, when, seed = 1) {
    const make = SYNTH[name];
    if (!make) throw new Error(`Unbekannter Ton: ${name}`);
    return make(ctx, dest, when, random(seed));
  }

  // Gemeinsamer Ausgang: Begrenzer gegen Übersteuern (mehrere Töne gleichzeitig, Lautstärke 100),
  // dahinter eine harte Notbremse knapp unter 1.0.
  function masterChain(ctx) {
    const input = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 3;
    comp.ratio.value = 20;
    comp.attack.value = 0.002;
    comp.release.value = 0.2;
    // Der Kompressor hebt laut Web-Audio-Norm alles automatisch an (bei diesen Werten x1,397,
    // nachgemessen) – zurücknehmen, damit leise Töne unverändert durchgehen.
    const trim = amp(ctx, 1 / 1.397);
    const ceiling = ctx.createWaveShaper();
    ceiling.curve = cached(ctx, 'decke', () => {
      const c = new Float32Array(4097);
      for (let i = 0; i < c.length; i++) {
        const x = i / 2048 - 1;
        const a = Math.abs(x);
        c[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.19 * Math.tanh((a - 0.8) / 0.19));
      }
      return c;
    });
    input.connect(comp).connect(trim).connect(ceiling).connect(ctx.destination);
    return input;
  }

  // Ton offline berechnen – exakt derselbe Weg wie live (Lautstärke, Begrenzer, Synthese).
  async function renderOffline(name, { volume = 70, sampleRate = 48000, seed = 1 } = {}) {
    const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * MAX_LEN), sampleRate);
    const voice = amp(ctx, gainFor(volume));
    voice.connect(masterChain(ctx));
    const duration = build(ctx, voice, name, 0, seed);
    return { buffer: await ctx.startRendering(), duration };
  }

  // ------------------------------------------------------------ Live abspielen

  let live = null; // { ctx, input } – ein AudioContext für alle Töne
  let playing = 0;
  let idleTimer = null;
  let seed = (Date.now() % 100000) + 1;

  function withTimeout(promise, ms, message) {
    let timer;
    const late = new Promise((_r, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  async function liveContext() {
    if (!live || live.ctx.state === 'closed') {
      let ctx;
      try {
        ctx = new AudioContext();
      } catch (e) {
        throw new Error(`Tonausgabe nicht möglich: ${e.message}`);
      }
      live = { ctx, input: masterChain(ctx) };
    }
    if (live.ctx.state !== 'running') {
      await withTimeout(live.ctx.resume(), 3000, 'Tonausgabe startet nicht (kein Audiogerät?).');
    }
    return live;
  }

  // Nach ein paar Sekunden Ruhe pausieren: kein offener Audiostrom, der Rechner darf schlafen.
  function idleLater() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!playing && live && live.ctx.state === 'running') live.ctx.suspend().catch(() => {});
    }, 8000);
  }

  async function playSynth(name, volume) {
    const gain = gainFor(volume);
    if (!gain) return;
    playing++;
    clearTimeout(idleTimer);
    let voice = null;
    try {
      const { ctx, input } = await liveContext();
      voice = amp(ctx, gain);
      voice.connect(input);
      const duration = build(ctx, voice, name, ctx.currentTime + 0.03, seed++);
      await sleep((duration + 0.1) * 1000);
    } finally {
      if (voice) voice.disconnect();
      playing--;
      idleLater();
    }
  }

  // ------------------------------------------------------------ Eigene Datei

  let current = null; // die gerade laufende Datei – eine neue löst sie ab

  function fileProblem(file, err) {
    if (err && err.code === 3) return `Sounddatei ist beschädigt: ${file}`;
    return `Sounddatei fehlt oder lässt sich nicht abspielen: ${file}`;
  }

  function playFile(file, volume) {
    const url = fileUrl(file);
    if (current) current.stop();
    const vol = clamp(gainFor(volume) * 0.7, 0, 1); // audio.volume 0..1 = Lautstärke/100
    if (!vol) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const audio = new Audio();
      const me = { stop: () => fade(150) };
      let done = false;
      let fader = null;
      const cap = setTimeout(() => fade(1500), MAX_FILE * 1000);

      function finish(err) {
        if (done) return;
        done = true;
        clearTimeout(cap);
        clearInterval(fader);
        if (current === me) current = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load(); // Datei wieder freigeben
        if (err) reject(err);
        else resolve();
      }
      function fade(ms) {
        if (done || fader) return;
        const from = audio.volume;
        const start = performance.now();
        fader = setInterval(() => {
          const k = (performance.now() - start) / ms;
          if (k >= 1) finish();
          else audio.volume = from * (1 - k);
        }, 25);
      }

      audio.addEventListener('ended', () => finish());
      audio.addEventListener('error', () => finish(new Error(fileProblem(file, audio.error))));
      audio.preload = 'auto';
      audio.volume = vol;
      audio.src = url;
      current = me;
      audio.play().catch((e) => {
        if (e && e.name === 'AbortError') return;
        finish(new Error(fileProblem(file, audio.error)));
      });
    });
  }

  // ------------------------------------------------------------ Einstieg

  // job = { name, file, volume } – liefert ein Promise, das nach dem Ende des Tons erfüllt ist.
  async function play(job) {
    const name = job && job.name;
    if (!NAMES.includes(name)) throw new Error(`Unbekannter Ton: ${name}`);
    if (name === 'datei') return playFile(job.file, job.volume);
    return playSynth(name, job.volume);
  }

  const api = { NAMES, gainFor, fileUrl, build, masterChain, renderOffline, play };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TA_SOUND = api;

  if (root.taSound) {
    root.taSound.onPlay((job) => {
      play(job).catch((e) => root.taSound.error((e && e.message) || String(e)));
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
