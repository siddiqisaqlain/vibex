// The Wardrobe's ambience: soft piano, played live in the browser with the Web Audio API.
// Nothing is recorded or downloaded and the music is generated as it plays (an original, slow,
// never-repeating piece in C major), so there is no copyright in it: it's our own sound.
// The piano voice: a felt-hammer attack, harmonics that fade faster than the note, a tone that
// darkens as it decays, a touch of hammer noise, all in a soft room reverb.
// Browsers only allow sound after the visitor touches the page, so it starts on the first tap,
// click or key, fades in, pauses when the tab is hidden, and has a mute button (remembered).
(() => {
  const KEY = "vx-wd-sound";
  const LEVEL = 0.45; // master volume: soft, in the background (peaks around -28 dBFS)
  const store = { get() { try { return localStorage.getItem(KEY); } catch { return null; } }, set(v) { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } } };
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;

  let ctx = null, master = null, on = store.get() !== "off";
  let dry = null, verb = null, noiseBuf = null, nextBar = 0, bar = 0, ticker = null;
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  // phones: small speakers can't play the low left hand, so it moves up an octave, and a lighter
  // piano voice (fewer harmonics) saves battery
  const PHONE = matchMedia("(pointer: coarse)").matches || /iPhone|iPad|Android/i.test(navigator.userAgent);
  // iPhone/iPad: play as background ambience: it mixes with the visitor's own music instead of
  // stopping it, and stays silent when the phone's silent switch is on (Safari 16.4+)
  try { if (navigator.audioSession) navigator.audioSession.type = "ambient"; } catch { /* older Safari */ }
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // slow and open: Cmaj7, Am7, Fmaj7, G (sus) ... and now and then Em7 or Dm9 for colour
  const PROG = [
    { bass: [36, 43], tones: [60, 64, 67, 71, 72, 76] },   // Cmaj7
    { bass: [33, 40], tones: [57, 60, 64, 67, 69, 72] },   // Am7
    { bass: [29, 36], tones: [57, 60, 64, 65, 69, 72] },   // Fmaj7
    { bass: [31, 38], tones: [59, 62, 65, 67, 71, 74] },   // G7sus-ish
  ];
  const COLOUR = [
    { bass: [28, 35], tones: [59, 62, 64, 67, 71, 74] },   // Em7
    { bass: [26, 33], tones: [60, 62, 65, 69, 72, 76] },   // Dm9
  ];
  const BEAT = 1.15; // seconds: a slow, unhurried pulse

  function build() {
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -24; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    // a soft room: 3.5 s tail, darker as it decays
    const len = Math.floor(ctx.sampleRate * 3.5), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) { const k = 0.25 + 0.7 * (i / len); lp = lp * k + (Math.random() * 2 - 1) * (1 - k); d[i] = lp * Math.pow(1 - i / len, 2.6) * 2.2; }
    }
    verb = ctx.createConvolver(); verb.buffer = ir;
    buildSfx(ir);
    const wet = ctx.createGain(); wet.gain.value = 0.42; verb.connect(wet).connect(master);
    dry = ctx.createGain(); dry.gain.value = 0.8; dry.connect(master);
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
    nextBar = ctx.currentTime + 0.3;
    ticker = setInterval(schedule, 250);
    schedule();
  }

  // one piano note
  function key(midi, when, vel = 0.7, len = 4) {
    const f = hz(midi);
    const out = ctx.createGain(); out.gain.value = 0.11 * vel;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.max(-0.6, Math.min(0.6, (midi - 60) / 30)); out.connect(pan); pan.connect(dry); pan.connect(verb); }
    else { out.connect(dry); out.connect(verb); }
    // felt: the tone starts warm and darkens as the note dies away; softer notes are darker
    const felt = ctx.createBiquadFilter(); felt.type = "lowpass"; felt.Q.value = 0.3;
    felt.frequency.setValueAtTime(900 + 2400 * vel, when);
    felt.frequency.exponentialRampToValueAtTime(380 + 300 * vel, when + 1.6);
    felt.connect(out);
    // a few harmonics, slightly stretched like real strings, each with its own decay
    const partials = PHONE ? [[1, 1], [2, 0.42], [3, 0.2], [4, 0.1]] : [[1, 1], [2, 0.42], [3, 0.2], [4, 0.1], [5, 0.05], [6, 0.025]];
    const low = midi < 48;
    for (const [n, amp] of partials) {
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.value = f * n * (1 + 0.00035 * n * n);
      o.detune.value = (Math.random() - 0.5) * 3;
      const g = ctx.createGain();
      const tau = (low ? 2.6 : 1.9) / Math.pow(n, 0.75);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(amp, when + 0.006);
      g.gain.setTargetAtTime(amp * 0.35, when + 0.006, 0.18);           // the quick first drop of a struck string
      g.gain.setTargetAtTime(0.0001, when + 0.25, tau);                   // then the long ring
      g.gain.setTargetAtTime(0, when + len, 0.25);                        // the damper comes down
      o.connect(g).connect(felt);
      o.start(when); o.stop(when + len + 1.5);
    }
    // the felt hammer touching the string
    const h = ctx.createBufferSource(); h.buffer = noiseBuf;
    const hb = ctx.createBiquadFilter(); hb.type = "bandpass"; hb.frequency.value = Math.min(3000, f * 3); hb.Q.value = 1.2;
    const hg = ctx.createGain(); hg.gain.value = 0.05 * vel;
    h.connect(hb).connect(hg).connect(out); h.start(when);
  }

  // one bar: a low root and fifth, then a few chord tones broken gently upward, a melody note on top now and then
  function playBar(t) {
    const ch = bar % 8 === 7 && Math.random() < 0.6 ? pick(COLOUR) : PROG[bar % PROG.length];
    bar++;
    const human = () => (Math.random() - 0.5) * 0.06;
    const up = PHONE ? 12 : 0;
    key(ch.bass[0] + up, t + human(), 0.55, BEAT * 4.2);
    if (Math.random() < 0.7) key(ch.bass[1] + up, t + BEAT * 0.5 + human(), 0.42, BEAT * 3.6);
    // two to four upper notes, rising, unevenly spaced, quiet
    const ups = [...ch.tones].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 3)).sort((a, b) => a - b);
    const slots = [1, 1.5, 2, 2.5, 3, 3.5].sort(() => Math.random() - 0.5).slice(0, ups.length).sort((a, b) => a - b);
    ups.forEach((n, i) => key(n, t + BEAT * slots[i] + human(), 0.35 + Math.random() * 0.25, BEAT * 2.6));
    // a soft high note to answer, in some bars only
    if (Math.random() < 0.35) key(pick(ch.tones) + 12, t + BEAT * (2.75 + Math.random()) + human(), 0.28, BEAT * 2.4);
  }

  // look ahead a little and schedule whole bars on the audio clock (smooth even if the page is busy)
  function schedule() {
    if (!ctx || ctx.state !== "running") return;
    if (nextBar < ctx.currentTime) nextBar = ctx.currentTime + 0.1; // back from a hidden tab: carry on, don't catch up
    while (nextBar < ctx.currentTime + 1.2) { playBar(nextBar); nextBar += BEAT * 4; }
  }

  // ---------- sound effects: the wardrobe's own furniture sounds, made the same way (no recordings) ----------
  let sfx = null, sfxVerb = null, white = null, lastBrush = 0;
  function buildSfx(ir) {
    sfx = ctx.createGain(); sfx.gain.value = 0.3; // clear but soft: about 12 dB above the music
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    sfx.connect(comp).connect(ctx.destination);
    sfxVerb = ctx.createConvolver(); sfxVerb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.22; sfxVerb.connect(wet).connect(comp);
    white = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = white.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const out = (node, wet = 0.4) => { node.connect(sfx); if (wet) { const w = ctx.createGain(); w.gain.value = wet; node.connect(w).connect(sfxVerb); } };
  // filtered noise with an envelope [[time, gain], ...] and an optional filter sweep [[time, hz], ...]
  function noise(t, { type = "bandpass", f = 1000, q = 1, env, sweep, am = 0, amDepth = 0, wet = 0.4, pan = 0 }) {
    const src = ctx.createBufferSource(); src.buffer = white; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.Q.value = q; flt.frequency.setValueAtTime(f, t);
    if (sweep) for (const [dt, hz] of sweep) flt.frequency.exponentialRampToValueAtTime(hz, t + dt);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    for (const [dt, v] of env) g.gain.linearRampToValueAtTime(v, t + dt);
    let tail = g;
    if (am) { // grainy texture: runners, creaks, rustles
      const mod = ctx.createGain(); mod.gain.value = 1 - amDepth;
      const lfo = ctx.createOscillator(); lfo.type = "square"; lfo.frequency.value = am;
      const depth = ctx.createGain(); depth.gain.value = amDepth;
      lfo.connect(depth).connect(mod.gain); lfo.start(t); lfo.stop(t + env[env.length - 1][0] + 0.1);
      g.connect(mod); tail = mod;
    }
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; tail.connect(p); tail = p; }
    src.connect(flt).connect(g); out(tail, wet);
    src.start(t, Math.random()); src.stop(t + env[env.length - 1][0] + 0.05);
  }
  // a short ringing tone: clicks, thuds, metal and glass
  function ring(t, { f, f2, type = "sine", gain = 0.2, attack = 0.002, decay = 0.3, wet = 0.4, pan = 0 }) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + decay);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    let tail = g;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); tail = p; }
    o.connect(g); out(tail, wet);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }
  const thud = (t, f = 80, gain = 0.5, decay = 0.28) => { ring(t, { f, f2: f * 0.62, gain, attack: 0.004, decay, wet: 0.25 }); noise(t, { type: "lowpass", f: 260, q: 0.7, env: [[0.003, gain * 0.5], [0.09, 0]], wet: 0.2 }); };
  const click = (t, f = 2200, gain = 0.12) => { ring(t, { f, gain, decay: 0.03, wet: 0.15 }); noise(t, { f: f * 1.4, q: 3, env: [[0.001, gain * 0.9], [0.025, 0]], wet: 0.1 }); };
  const metal = (t, base, gain = 0.06, pan = 0) => { for (const [m, a, d] of [[1, 1, 0.5], [2.76, 0.55, 0.35], [5.4, 0.3, 0.22]]) ring(t, { f: base * m, gain: gain * a, decay: d, wet: 0.5, pan }); };
  const glass = (t, base = 2350, gain = 0.07) => { for (const [m, a, d] of [[1, 1, 0.9], [2.32, 0.4, 0.55], [4.25, 0.18, 0.3]]) ring(t, { f: base * m, gain: gain * a, decay: d, wet: 0.6 }); };

  const SFX = {
    doorOpen(t) {
      click(t, 1700, 0.1);                                                                    // the magnetic catch lets go
      noise(t + 0.05, { type: "lowpass", f: 300, q: 0.6, sweep: [[0.5, 1100], [1.3, 260]], env: [[0.35, 0.16], [1.3, 0]], wet: 0.5 }); // air as the doors swing
      noise(t + 0.12, { f: 620, q: 6, am: 38, amDepth: 0.7, env: [[0.25, 0.035], [0.7, 0.02], [0.95, 0]], wet: 0.3, pan: -0.3 }); // a little wooden give at the hinge
    },
    doorClose(t) {
      noise(t, { type: "lowpass", f: 900, q: 0.6, sweep: [[0.45, 260]], env: [[0.2, 0.14], [0.5, 0]], wet: 0.4 });
      thud(t + 0.48, 78, 0.55, 0.32);                                                          // soft, damped, heavy
      click(t + 0.5, 1500, 0.07);                                                               // the catch
    },
    drawerOpen(t) {
      noise(t, { f: 1500, q: 1.8, sweep: [[0.42, 900]], am: 140, amDepth: 0.35, env: [[0.06, 0.13], [0.36, 0.1], [0.46, 0]], wet: 0.25 }); // ball-bearing runners
      thud(t + 0.44, 140, 0.22, 0.14);                                                         // the soft stop
      noise(t + 0.65, { type: "lowpass", f: 400, q: 0.8, sweep: [[0.6, 1400]], env: [[0.3, 0.05], [0.7, 0]], wet: 0.5 }); // the tray rising
    },
    drawerClose(t) {
      noise(t, { type: "lowpass", f: 1200, q: 0.7, sweep: [[0.35, 400]], env: [[0.15, 0.04], [0.35, 0]], wet: 0.4 }); // tray lowering
      noise(t + 0.3, { f: 1300, q: 1.8, sweep: [[0.4, 850]], am: 140, amDepth: 0.35, env: [[0.05, 0.12], [0.34, 0.08], [0.42, 0]], wet: 0.25 });
      thud(t + 0.72, 95, 0.3, 0.2);                                                            // soft-close settle
    },
    pickJacket(t, pan) {
      noise(t, { f: 4200, q: 5, sweep: [[0.14, 3000]], env: [[0.01, 0.06], [0.14, 0]], wet: 0.3, pan });       // hook sliding on the rail
      metal(t + 0.02, 1650 + Math.random() * 200, 0.05, pan);                                                     // brass ring
      noise(t + 0.04, { type: "highpass", f: 2200, q: 0.5, am: 23, amDepth: 0.6, env: [[0.05, 0.05], [0.3, 0]], wet: 0.2, pan }); // fabric
    },
    hangBack(t, pan) { metal(t, 1500 + Math.random() * 200, 0.035, pan); noise(t, { type: "highpass", f: 2600, q: 0.5, am: 19, amDepth: 0.6, env: [[0.04, 0.03], [0.2, 0]], wet: 0.2, pan }); },
    brush(t, pan, v = 1) { metal(t, 1300 + Math.random() * 900, 0.018 + 0.02 * v, pan); },
    pickBottle(t) { glass(t, 2300 + Math.random() * 300, 0.07); noise(t, { type: "lowpass", f: 600, env: [[0.002, 0.08], [0.05, 0]], wet: 0.1 }); },
    setDown(t) { ring(t, { f: 420, f2: 300, gain: 0.12, decay: 0.08, wet: 0.2 }); noise(t, { type: "lowpass", f: 900, env: [[0.002, 0.07], [0.04, 0]], wet: 0.1 }); glass(t + 0.005, 2600, 0.02); },
    boxOpen(t) { noise(t, { type: "lowpass", f: 180, q: 1.2, sweep: [[0.3, 900]], env: [[0.08, 0.16], [0.35, 0]], wet: 0.3 }); noise(t + 0.18, { type: "highpass", f: 3000, am: 31, amDepth: 0.7, env: [[0.05, 0.03], [0.3, 0]], wet: 0.3 }); },
    boxClose(t) { noise(t, { type: "lowpass", f: 900, q: 1, sweep: [[0.22, 200]], env: [[0.05, 0.1], [0.24, 0]], wet: 0.2 }); thud(t + 0.22, 160, 0.16, 0.08); },
    bag(t) { noise(t, { f: 2800, q: 0.8, am: 27, amDepth: 0.75, env: [[0.04, 0.08], [0.18, 0.04], [0.42, 0]], wet: 0.25 }); noise(t + 0.2, { f: 3600, q: 0.8, am: 33, amDepth: 0.8, env: [[0.03, 0.05], [0.25, 0]], wet: 0.25 }); },
    tap(t) { click(t, 1250, 0.05); },
  };
  // the page calls VXSfx.play("doorOpen"), etc. Silent until the visitor has touched the page, and when muted.
  window.VXSfx = {
    play(name, { delay = 0, pan = 0, v = 1 } = {}) {
      if (!on || !ctx || !sfx || ctx.state !== "running" || !SFX[name]) return;
      if (name === "brush") { const now = performance.now(); if (now - lastBrush < 90) return; lastBrush = now; }
      try { SFX[name](ctx.currentTime + 0.01 + delay, Math.max(-0.7, Math.min(0.7, pan)), v); } catch { /* never let a sound break the page */ }
    },
  };

  function fadeTo(v, secs) {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(v, t + secs);
  }
  function start() {
    if (!on) return;
    if (!ctx) build();
    ctx.resume?.();
    fadeTo(LEVEL, 5);
  }
  function stop() { fadeTo(0, 0.8); }

  // The first touch of the page starts it (that's when browsers allow sound). iPhones only count a
  // finished tap (touchend / click), so all of them are listened for until the sound is really running.
  // Every later tap also wakes it if the phone paused it (a call, Siri, the screen locking).
  const GESTURES = ["pointerdown", "touchend", "click", "keydown"];
  const wake = () => {
    if (!on) return;
    if (!ctx) { start(); paint(); return; }
    if (ctx.state !== "running" && !document.hidden) ctx.resume?.().then(() => { if (master.gain.value < LEVEL / 2) fadeTo(LEVEL, 3); }).catch(() => {});
  };
  GESTURES.forEach((g) => addEventListener(g, wake, { capture: true, passive: true }));

  // quiet while the tab is hidden
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else if (on) { ctx.resume(); }
  });

  // the mute button, beside "Back to shop"
  const css = document.createElement("style");
  css.textContent = `.wd-sound{all:unset;cursor:pointer;display:inline-grid;place-items:center;width:40px;height:40px;border-radius:50%;color:var(--ink,#161514);
    background:var(--glass,rgba(251,249,246,.72));backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);
    box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 4px 18px rgba(40,30,20,.08);margin-right:8px}
    .wd-sound:focus-visible{outline:2px solid var(--red,#e2382c);outline-offset:2px}
    .wd-sound svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .wd-top-right{display:flex;align-items:center}`;
  document.head.appendChild(css);
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "wd-sound";
  const ICON_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
  function paint() {
    btn.innerHTML = on ? ICON_ON : ICON_OFF;
    btn.setAttribute("aria-label", on ? "Turn the ambience off" : "Turn the ambience on");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    on = !on; store.set(on ? "on" : "off");
    if (on) start(); else stop();
    paint();
  });
  paint();
  const back = document.querySelector(".wd-back");
  if (back) {
    const wrap = document.createElement("div"); wrap.className = "wd-top-right";
    back.replaceWith(wrap); wrap.append(btn, back);
  }
})();
