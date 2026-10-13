// Sonidos UI sintetizados (WebAudio, sin archivos) + botón mute.
(function () {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('rdb_mute') === '1'; } catch {}
  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(f, d, type, g, when) {
    if (muted) return;
    try {
      const c = ac(), o = c.createOscillator(), gn = c.createGain();
      when = when || 0;
      o.type = type || 'sine';
      o.frequency.value = f;
      gn.gain.setValueAtTime(0.0001, c.currentTime + when);
      gn.gain.exponentialRampToValueAtTime(g || 0.06, c.currentTime + when + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + when + d);
      o.connect(gn); gn.connect(c.destination);
      o.start(c.currentTime + when);
      o.stop(c.currentTime + when + d + 0.05);
    } catch {}
  }
  const S = {
    click() { tone(660, 0.07, 'triangle', 0.05); tone(990, 0.06, 'sine', 0.035, 0.04); },
    send() { tone(520, 0.08, 'sine', 0.06); tone(784, 0.1, 'sine', 0.06, 0.07); },
    open() { tone(440, 0.09, 'triangle', 0.045); tone(660, 0.09, 'triangle', 0.045, 0.06); },
    error() { tone(180, 0.18, 'sawtooth', 0.045); },
    key() { tone(1250, 0.03, 'square', 0.012); },
    toggle(on) { tone(on ? 880 : 440, 0.08, 'sine', 0.05); }
  };
  window.RDBSound = S;

  const btn = document.createElement('button');
  btn.id = 'muteBtn';
  btn.title = 'Sonido on/off';
  const paint = () => { btn.textContent = muted ? '🔇' : '🔊'; };
  paint();
  btn.onclick = () => {
    muted = !muted;
    try { localStorage.setItem('rdb_mute', muted ? '1' : '0'); } catch {}
    paint();
    S.toggle(!muted);
  };
  document.body.appendChild(btn);

  document.addEventListener('click', e => {
    if (e.target.closest('#muteBtn')) return;
    if (e.target.closest('button, a, .seccard, .brow, .trow.topic')) S.click();
  }, true);

  let last = 0;
  document.addEventListener('keydown', e => {
    const t = e.target;
    if (!t || !/INPUT|TEXTAREA/.test(t.tagName)) return;
    const now = Date.now();
    if (now - last < 70) return;
    last = now;
    if (e.key === 'Enter') S.send();
    else if (e.key.length === 1) S.key();
  }, true);
})();
