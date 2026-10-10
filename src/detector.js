// Vergleicht zwei Abfragen und findet heraus, wo ein Tor gefallen ist.
//
// Wichtig:
//  - Beim allerersten Abruf wird nur der aktuelle Stand gemerkt (kein Alarm für alte Tore).
//  - Jede Seite wird für sich betrachtet: ein aberkanntes Tor auf der einen Seite darf ein
//    Tor auf der anderen Seite nicht verschlucken.
//  - Ein Rückgang (VAR) zählt erst, wenn er dropConfirm-mal hintereinander kommt. FotMob liefert
//    manchmal kurz einen veralteten Stand aus dem Cache – das soll keinen Alarm auslösen.
//  - silentDrops (OpenLigaDB): Rückgänge sind dort fast immer Verzögerung, kein VAR. Der Stand wird
//    nach der Bestätigung nur still angeglichen, ohne Meldung.
//  - Unsinnige Werte (keine ganze Zahl von 0 bis 30) werden ignoriert. Springt ein Stand auf einen
//    Schlag um mehr als 3 Tore, muss der nächste Abruf das bestätigen – dann kommt EIN Ereignis
//    'jump' (Sammelmeldung) statt einer Tor-Lawine.

const MAX_GOALS = 30;
const MAX_STEP = 3;
const plausible = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_GOALS;

class GoalDetector {
  constructor() {
    this.state = new Map(); // id -> { score: [h, a], drop: [null|{to,count}, null|{to,count}] }
    this.primed = false;
    this.lastUpdate = 0;
  }

  reset() {
    this.state.clear();
    this.primed = false;
    this.lastUpdate = 0;
  }

  // Startstand von außen vorgeben (z. B. beim Wechsel der Datenquelle).
  // own = was diese Quelle selbst schon geliefert hat (beim Seed noch nichts).
  seed(id, score) {
    this.state.set(id, { score: [score[0] | 0, score[1] | 0], drop: [null, null], jump: null, own: [0, 0] });
    this.primed = true;
  }

  update(matches, { dropConfirm = 2, silentDrops = false, now = Date.now() } = {}) {
    const events = [];
    for (const m of matches) {
      // Kaputte Werte: dieses Spiel in diesem Abruf auslassen, alter Stand bleibt
      if (!plausible(m.homeScore) || !plausible(m.awayScore)) continue;
      const next = [m.homeScore, m.awayScore];
      const prev = this.state.get(m.id);

      if (!prev) {
        // Spiel taucht neu auf: Stand nur merken.
        this.state.set(m.id, { score: next, drop: [null, null], jump: null, own: next.slice() });
        continue;
      }
      if (!prev.own) prev.own = [0, 0];

      const before = prev.score.slice();
      const cur = prev.score.slice();
      const sides = ['home', 'away'];
      const dropped = [];

      // 0) Riesensprung (> 3 Tore auf einer Seite): erst beim zweiten gleichen Abruf glauben
      if (next[0] - before[0] > MAX_STEP || next[1] - before[1] > MAX_STEP) {
        const j = prev.jump;
        if (j && j.to[0] === next[0] && j.to[1] === next[1]) {
          prev.jump = null;
          prev.drop = [null, null];
          prev.score = next.slice();
          prev.own = [Math.max(prev.own[0], next[0]), Math.max(prev.own[1], next[1])];
          events.push({ type: 'jump', match: m, prev: before, score: next.slice() });
        } else {
          prev.jump = { to: next.slice() };
        }
        continue;
      }
      prev.jump = null;

      // 1) bestätigte Rückgänge
      for (let i = 0; i < 2; i++) {
        if (next[i] >= before[i]) {
          prev.drop[i] = null;
          continue;
        }
        const d = prev.drop[i];
        if (d && d.to === next[i]) d.count += 1;
        else prev.drop[i] = { to: next[i], count: 1 };
        if (prev.drop[i].count >= dropConfirm) {
          cur[i] = next[i];
          prev.drop[i] = null;
          // Still bleibt ein Rückgang nur, wenn die Quelle den höheren Stand selbst nie geliefert hat
          // (z. B. OpenLigaDB hinkt dem übernommenen FotMob-Stand hinterher). Hat sie ihn selbst
          // gemeldet und nimmt ihn zurück, ist es eine echte Rücknahme.
          if (!silentDrops || next[i] < prev.own[i]) dropped.push(i);
        }
      }
      for (const i of dropped) events.push({ type: 'disallowed', side: sides[i], match: m, prev: before.slice(), score: cur.slice() });

      // 2) neue Tore, nacheinander mit Zwischenstand
      for (let i = 0; i < 2; i++) {
        while (cur[i] < next[i]) {
          cur[i] += 1;
          events.push({ type: 'goal', side: sides[i], nth: cur[i], match: m, score: cur.slice() });
        }
      }
      prev.score = cur;
      prev.own = [Math.max(prev.own[0], next[0]), Math.max(prev.own[1], next[1])];
    }

    this.lastUpdate = now;
    if (!this.primed) {
      this.primed = true;
      return [];
    }
    return events;
  }
}

// Anpfiff, Halbzeit, Abpfiff und Rote Karten.
//
//  - Wie beim GoalDetector: erster Abruf und neu auftauchende Spiele werden nur gemerkt.
//  - Anpfiff, Halbzeit und Abpfiff gibt es pro Spiel höchstens einmal, auch wenn FotMob aus dem Cache
//    kurz einen alten Stand liefert (live -> pre -> live).
//  - Anpfiff nur, solange das Spiel gerade erst läuft – wer nach dem Standby in der 70. Minute
//    wieder da ist, bekommt keinen "Anpfiff" mehr.
//  - Rote Karten: pro neuer Karte ein Ereignis, nth = die wievielte Rote dieser Mannschaft. Weniger
//    Karten (VAR nimmt Rot zurück) zählen erst, wenn es dropConfirm-mal hintereinander so kommt.

const KICKOFF_WINDOW_MIN = 20;
const SIDES = ['home', 'away'];

function redCardsOf(m) {
  const r = Array.isArray(m.redCards) ? m.redCards : [];
  return [Math.max(0, r[0] | 0), Math.max(0, r[1] | 0)];
}

function justStarted(m, now) {
  const min = parseInt(m.minute, 10);
  if (Number.isFinite(min)) return min <= KICKOFF_WINDOW_MIN;
  if (m.minute) return false; // "Halbzeit" o. ä. – den Anpfiff haben wir verpasst
  // OpenLigaDB kennt keine Minute: nach der Anstoßzeit gehen
  const start = m.startUtc ? Date.parse(m.startUtc) : NaN;
  return !Number.isFinite(start) || now - start <= KICKOFF_WINDOW_MIN * 60_000;
}

class StatusTracker {
  constructor() {
    this.state = new Map(); // id -> { kickoff, live, halftime, fulltime, red: [h, a], drop: [..] }
    this.primed = false;
    this.lastUpdate = 0;
  }

  reset() {
    this.state.clear();
    this.primed = false;
    this.lastUpdate = 0;
  }

  update(matches, { now = Date.now(), dropConfirm = 2 } = {}) {
    const t = +now;
    const events = [];
    for (const m of matches || []) {
      const red = redCardsOf(m);
      const prev = this.state.get(m.id);

      if (!prev) {
        // Spiel taucht neu auf: Stand nur merken.
        this.state.set(m.id, {
          kickoff: m.status !== 'pre', // schon angepfiffen (oder abgesagt) -> kein Anpfiff mehr
          live: m.status === 'live', // irgendwann laufend gesehen -> Abpfiff möglich
          halftime: m.minute === 'Halbzeit',
          fulltime: m.status === 'done',
          red,
          drop: [null, null],
        });
        continue;
      }

      if (!prev.kickoff && m.status === 'live') {
        prev.kickoff = true;
        if (justStarted(m, t)) events.push({ type: 'kickoff', match: m });
      }
      if (m.status === 'live') prev.live = true;

      for (let i = 0; i < 2; i++) {
        if (red[i] < prev.red[i]) {
          const d = prev.drop[i];
          if (d && d.to === red[i]) d.count += 1;
          else prev.drop[i] = { to: red[i], count: 1 };
          if (prev.drop[i].count >= dropConfirm) {
            prev.red[i] = red[i];
            prev.drop[i] = null;
          }
          continue;
        }
        prev.drop[i] = null;
        while (prev.red[i] < red[i]) {
          prev.red[i] += 1;
          events.push({ type: 'redcard', match: m, side: SIDES[i], nth: prev.red[i] });
        }
      }

      if (!prev.halftime && m.minute === 'Halbzeit') {
        prev.halftime = true;
        events.push({ type: 'halftime', match: m });
      }

      // Abpfiff nur nach "laufend" – pre -> done (Spiel komplett verschlafen) bleibt still.
      if (!prev.fulltime && prev.live && m.status === 'done') {
        prev.fulltime = true;
        events.push({ type: 'fulltime', match: m });
      }
    }

    this.lastUpdate = t;
    if (!this.primed) {
      this.primed = true;
      return [];
    }
    return events;
  }
}

module.exports = { GoalDetector, StatusTracker };
