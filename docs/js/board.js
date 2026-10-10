// LED-Anzeigetafel: eine 5x7-Punktschrift und ein Raster aus Leuchtpunkten.
// Alles wird auf ein <canvas> gezeichnet – wie die Tafel im Stadion, Punkt für Punkt.

(() => {
  // prettier-ignore
  const GLYPHS = {
    A: ['.###.','#...#','#...#','#####','#...#','#...#','#...#'],
    B: ['####.','#...#','#...#','####.','#...#','#...#','####.'],
    C: ['.###.','#...#','#....','#....','#....','#...#','.###.'],
    D: ['###..','#..#.','#...#','#...#','#...#','#..#.','###..'],
    E: ['#####','#....','#....','####.','#....','#....','#####'],
    F: ['#####','#....','#....','####.','#....','#....','#....'],
    G: ['.###.','#...#','#....','#.###','#...#','#...#','.####'],
    H: ['#...#','#...#','#...#','#####','#...#','#...#','#...#'],
    I: ['.###.','..#..','..#..','..#..','..#..','..#..','.###.'],
    J: ['..###','...#.','...#.','...#.','...#.','#..#.','.##..'],
    K: ['#...#','#..#.','#.#..','##...','#.#..','#..#.','#...#'],
    L: ['#....','#....','#....','#....','#....','#....','#####'],
    M: ['#...#','##.##','#.#.#','#.#.#','#...#','#...#','#...#'],
    N: ['#...#','#...#','##..#','#.#.#','#..##','#...#','#...#'],
    O: ['.###.','#...#','#...#','#...#','#...#','#...#','.###.'],
    P: ['####.','#...#','#...#','####.','#....','#....','#....'],
    Q: ['.###.','#...#','#...#','#...#','#.#.#','#..#.','.##.#'],
    R: ['####.','#...#','#...#','####.','#.#..','#..#.','#...#'],
    S: ['.####','#....','#....','.###.','....#','....#','####.'],
    T: ['#####','..#..','..#..','..#..','..#..','..#..','..#..'],
    U: ['#...#','#...#','#...#','#...#','#...#','#...#','.###.'],
    V: ['#...#','#...#','#...#','#...#','#...#','.#.#.','..#..'],
    W: ['#...#','#...#','#...#','#.#.#','#.#.#','#.#.#','.#.#.'],
    X: ['#...#','#...#','.#.#.','..#..','.#.#.','#...#','#...#'],
    Y: ['#...#','#...#','.#.#.','..#..','..#..','..#..','..#..'],
    Z: ['#####','....#','...#.','..#..','.#...','#....','#####'],
    'Ä': ['.#.#.','.....','.###.','#...#','#####','#...#','#...#'],
    'Ö': ['.#.#.','.....','.###.','#...#','#...#','#...#','.###.'],
    'Ü': ['.#.#.','.....','#...#','#...#','#...#','#...#','.###.'],
    0: ['.###.','#...#','#...#','#...#','#...#','#...#','.###.'],
    1: ['..#..','.##..','..#..','..#..','..#..','..#..','.###.'],
    2: ['.###.','#...#','....#','...#.','..#..','.#...','#####'],
    3: ['#####','...#.','..#..','...#.','....#','#...#','.###.'],
    4: ['...#.','..##.','.#.#.','#..#.','#####','...#.','...#.'],
    5: ['#####','#....','####.','....#','....#','#...#','.###.'],
    6: ['..##.','.#...','#....','####.','#...#','#...#','.###.'],
    7: ['#####','....#','...#.','..#..','.#...','.#...','.#...'],
    8: ['.###.','#...#','#...#','.###.','#...#','#...#','.###.'],
    9: ['.###.','#...#','#...#','.####','....#','...#.','.##..'],
    ':': ['.','#','#','.','#','#','.'],
    '.': ['.','.','.','.','.','.','#'],
    ',': ['..','..','..','..','..','.#','#.'],
    '!': ['#','#','#','#','#','.','#'],
    "'": ['#','#','.','.','.','.','.'],
    '-': ['...','...','...','###','...','...','...'],
    '+': ['...','...','.#.','###','.#.','...','...'],
    '(': ['.#','#.','#.','#.','#.','#.','.#'],
    ')': ['#.','.#','.#','.#','.#','.#','#.'],
    '/': ['....#','....#','...#.','..#..','.#...','#....','#....'],
    '?': ['.###.','#...#','....#','...#.','..#..','.....','..#..'],
    '·': ['.','.','.','#','.','.','.'],
    ' ': ['...','...','...','...','...','...','...'],
  };

  // Leuchtfarben der Tafel: an, gedimmt (halbe Helligkeit), aus
  const COLORS = {
    amber: { on: '#ffb52e', half: '#7a5418', off: '#1f180d' },
    rot: { on: '#ff3b2f', half: '#7a1c16', off: '#2a0f0c' },
    gruen: { on: '#4dff5e', half: '#257a2d', off: '#0f2412' },
    weiss: { on: '#f2f2e8', half: '#74746f', off: '#222220' },
  };

  function clean(str) {
    return String(str || '')
      .toUpperCase()
      .replace(/[ßẞ]/g, 'SS')
      // Buchstaben ohne Akzent-Zerlegung von Hand übersetzen (Ø, Ł, …)
      .replace(/[ØŁĐÆŒÞ&]/g, (c) => ({ 'Ø': 'O', 'Ł': 'L', 'Đ': 'D', 'Æ': 'AE', 'Œ': 'OE', 'Þ': 'TH', '&': '+' })[c])
      .replace(/[“”„«»"]/g, "'")
      // Umlaute vor dem Entfernen der Akzente schützen (sonst wird aus Ü ein U)
      .replace(/[ÄÖÜ]/g, (c) => String.fromCharCode(1 + 'ÄÖÜ'.indexOf(c)))
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[\u0001-\u0003]/g, (c) => 'ÄÖÜ'[c.charCodeAt(0) - 1])
      .replace(/[–—]/g, '-')
      .replace(/[’`´]/g, "'");
  }

  function glyph(ch) {
    return GLYPHS[ch] || GLYPHS[' ']; // Unbekanntes lieber als Lücke statt als '?'
  }

  function measure(str, scale = 1) {
    const s = clean(str);
    let w = 0;
    for (let i = 0; i < s.length; i++) {
      w += glyph(s[i])[0].length * scale;
      if (i < s.length - 1) w += scale; // eine Punktspalte Abstand
    }
    return w;
  }

  class Board {
    constructor(canvas, { cols, rows, pitch, color = 'amber' }) {
      this.canvas = canvas;
      this.cols = cols;
      this.rows = rows;
      this.pitch = pitch;
      this.dots = new Uint8Array(cols * rows); // 0 aus, 1 an, 2 halb
      this.colors = COLORS[color] || COLORS.amber;
      this.ctx = canvas.getContext('2d');
      this.lit = document.createElement('canvas');
      this.litCtx = this.lit.getContext('2d');
      this.fit();
    }

    // Puffer passend zur Pixeldichte anlegen – auch neu, wenn sich Zoom oder Bildschirm-Skalierung ändern.
    fit() {
      const dpr = window.devicePixelRatio || 1;
      this.dpr = dpr;
      this.canvas.width = Math.round(this.cols * this.pitch * dpr);
      this.canvas.height = Math.round(this.rows * this.pitch * dpr);
      this.canvas.style.width = `${this.cols * this.pitch}px`;
      this.canvas.style.height = `${this.rows * this.pitch}px`;
      this.lit.width = this.canvas.width;
      this.lit.height = this.canvas.height;
      this.base = this.drawBase();
      this.prev = null;
    }

    // Andere Leuchtfarbe – die Tafel wird beim nächsten render() komplett neu gezeichnet.
    setColor(name) {
      const c = COLORS[name] || COLORS.amber;
      if (c === this.colors) return;
      this.colors = c;
      this.base = this.drawBase();
      this.prev = null;
    }

    // Die ausgeschalteten Punkte ändern sich nie – einmal zeichnen und wiederverwenden.
    drawBase() {
      const c = document.createElement('canvas');
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const g = c.getContext('2d');
      g.scale(this.dpr, this.dpr);
      g.fillStyle = '#0c0b09';
      g.fillRect(0, 0, this.cols * this.pitch, this.rows * this.pitch);
      g.fillStyle = this.colors.off;
      const r = this.pitch * 0.36;
      g.beginPath();
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          const px = x * this.pitch + this.pitch / 2;
          const py = y * this.pitch + this.pitch / 2;
          g.moveTo(px + r, py);
          g.arc(px, py, r, 0, Math.PI * 2);
        }
      }
      g.fill();
      return c;
    }

    clear() {
      this.dots.fill(0);
    }

    set(x, y, v = 1) {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
      this.dots[y * this.cols + x] = v;
    }

    // Schreibt Text ab Spalte x, Zeile y. clip: [von, bis) Spalten, außerhalb wird nichts gesetzt.
    text(str, x, y, { scale = 1, v = 1, clip = null } = {}) {
      const s = clean(str);
      let cx = x;
      for (const ch of s) {
        const g = glyph(ch);
        for (let gy = 0; gy < g.length; gy++) {
          for (let gx = 0; gx < g[gy].length; gx++) {
            if (g[gy][gx] !== '#') continue;
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                const px = cx + gx * scale + sx;
                if (clip && (px < clip[0] || px >= clip[1])) continue;
                this.set(px, y + gy * scale + sy, v);
              }
            }
          }
        }
        cx += (g[0].length + 1) * scale;
      }
      return cx;
    }

    render() {
      if ((window.devicePixelRatio || 1) !== this.dpr) this.fit();
      // Nichts geändert? Dann auch nichts neu zeichnen.
      if (this.prev && this.prev.every((v, i) => v === this.dots[i])) return;
      this.prev = this.dots.slice();
      const { ctx, litCtx, pitch, cols, rows } = this;
      litCtx.setTransform(1, 0, 0, 1, 0, 0);
      litCtx.clearRect(0, 0, this.lit.width, this.lit.height);
      litCtx.scale(this.dpr, this.dpr);
      const r = pitch * 0.4;
      for (const [val, color] of [
        [1, this.colors.on],
        [2, this.colors.half],
      ]) {
        litCtx.fillStyle = color;
        litCtx.beginPath();
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            if (this.dots[y * cols + x] !== val) continue;
            const px = x * pitch + pitch / 2;
            const py = y * pitch + pitch / 2;
            litCtx.moveTo(px + r, py);
            litCtx.arc(px, py, r, 0, Math.PI * 2);
          }
        }
        litCtx.fill();
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.base, 0, 0);
      // Leuchten: einmal weich darunter, dann scharf darüber
      ctx.globalAlpha = 0.3;
      ctx.filter = `blur(${1.2 * this.dpr}px)`;
      ctx.drawImage(this.lit, 0, 0);
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
      ctx.drawImage(this.lit, 0, 0);
    }
  }

  window.LED = { Board, measure, clean, glyph, COLORS };
})();
