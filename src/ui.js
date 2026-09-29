// 화면 UI: HUD·대화창·패널·배너·효과음
export const $ = (s, r = document) => r.querySelector(s);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// 받침에 맞는 조사 붙이기: josa('사람', '이/가') → '사람이', josa('자전거', '으로/로') → '자전거로'
export function josa(w, pair) {
  const [a, b] = pair.split('/'), c = w.charCodeAt(w.length - 1);
  const jong = c >= 0xAC00 && c <= 0xD7A3 ? (c - 0xAC00) % 28 : 0;
  return w + (a.startsWith('으') ? (jong && jong !== 8 ? a : b) : (jong ? a : b));
}

export function mountUI(app) {
  app.insertAdjacentHTML('beforeend', `
  <div id="hud" hidden>
    <div id="obj"><div class="k">현재 목표</div><div class="v" id="objText"></div>
      <div id="steps"><span data-s="1">① 데이터 모으기</span><span data-s="2">② 이름표</span><span data-s="3">③ 학습</span><span data-s="4">④ 시험 운행</span></div>
      <div id="chips"><span class="chip game">🎮 게임 속 이야기</span><span class="chip" id="zoneChip"></span></div></div>
    <div id="reticle"><i></i><i></i><i></i><i></i></div>
    <div id="prompt" hidden></div>
    <div id="tray"></div>
    <div id="topR">
      <canvas class="minimap" width="336" height="336"></canvas>
      <div class="row"><button class="hbtn" data-a="result" hidden>결과</button><button class="hbtn" data-a="album">앨범 [Q]</button><button class="hbtn" data-a="menu">메뉴</button></div>
    </div>
    <div id="mapnote">지도 © OpenStreetMap 기여자(ODbL) · 🎮 인물과 이야기는 모두 상상입니다</div>
  </div>
  <div id="touch" hidden>
    <div id="joy"><div id="knob"></div></div>
    <div id="tbtns">
      <div class="row"><button class="hbtn" data-a="ethics">윤리원칙</button><button class="hbtn" data-a="train">학습</button><button class="hbtn" data-a="drive">시험 운행</button></div>
      <button id="btnShot" data-a="shot">📷<br>찍기</button>
    </div>
  </div>
  <div id="flash"></div><div id="scanfx"></div><div id="hurt"></div>
  <div id="fade"></div>
  <div id="banner" hidden><div><div class="s" id="bS"></div><div class="t" id="bT"></div><div class="d" id="bD"></div></div></div>
  <div id="dialog" hidden><div class="pt" id="dPt"></div><div class="dmain"><div id="dName"></div><div id="dText"></div><div id="dChoices" hidden></div><div id="dNext" hidden>▼ 누르기 · Space</div></div></div>
  <div id="panel" hidden><div id="panelCard"><div id="panelBody"></div><div id="panelBtns"></div></div></div>
  <div id="screen" hidden></div>
  <div id="toast" hidden></div>`);
  $('#dialog').addEventListener('click', advance);
  addEventListener('keydown', e => {
    if (!$('#dialog').hidden && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); advance(); }
  });
}

// ---------- 효과음(파일 없이 합성) ----------
export const Snd = {
  ctx: null, on: true, hum: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.master = this.ctx.createGain(); this.master.gain.value = .5; this.master.connect(this.ctx.destination); } catch (e) { this.ctx = null; }
  },
  tone(f, d = .12, type = 'sine', v = .2, slide = 0, delay = 0) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + d);
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(v, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + d + .05);
  },
  noise(d = .08, v = .2) {
    if (!this.ctx || !this.on) return;
    const n = this.ctx.sampleRate * d, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), a = b.getChannelData(0);
    for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); g.gain.value = v; s.buffer = b; s.connect(g); g.connect(this.master); s.start();
  },
  play(n) {
    switch (n) {
      case 'type': this.tone(1500, .018, 'square', .012); break;
      case 'blip': this.tone(880, .05, 'square', .05); break;
      case 'shutter': this.noise(.05, .35); this.tone(2200, .04, 'square', .05, 0, .06); this.noise(.04, .2); break;
      case 'save': this.tone(660, .08, 'triangle', .14); this.tone(990, .14, 'triangle', .14, 0, .07); break;
      case 'ok': this.tone(660, .1, 'triangle', .16); this.tone(990, .18, 'triangle', .16, 0, .09); break;
      case 'bad': for (let i = 0; i < 3; i++) this.tone(620, .18, 'square', .07, -240, i * .22); break;
      case 'learn': for (let i = 0; i < 6; i++) this.tone(400 + i * 120, .08, 'triangle', .07, 0, i * .07); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, .3, 'triangle', .14, 0, i * .12)); break;
      case 'door': this.tone(90, .9, 'sawtooth', .06, 60); break;
    }
  },
  busHum(on) {
    if (!this.ctx) return;
    if (on && !this.hum) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 55; lp.type = 'lowpass'; lp.frequency.value = 220; g.gain.value = this.on ? .05 : 0;
      o.connect(lp); lp.connect(g); g.connect(this.master); o.start(); this.hum = { o, g };
    } else if (!on && this.hum) { try { this.hum.o.stop(); } catch (e) { } this.hum = null; }
  },
  toggle() { this.on = !this.on; if (this.hum) this.hum.g.gain.value = this.on ? .05 : 0; return this.on; },
};

// ---------- HUD 도우미 ----------
export function setObj(t) { const v = $('#objText'); v.innerHTML = t; $('#obj').animate([{ opacity: .2, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 400 }); }
let toastT = 0;
export function toast(t, ms = 2400) {
  const el = $('#toast'); el.textContent = t; el.hidden = false; el.style.opacity = 1;
  clearTimeout(toastT); toastT = setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.hidden = true, 300); }, ms);
}
export function fadeTo(v, ms = 800) { const f = $('#fade'); f.style.transition = `opacity ${ms}ms`; f.style.opacity = v; return sleep(ms); }
export function banner(s, t, d) {
  const b = $('#banner'); $('#bS').textContent = s; $('#bT').textContent = t; $('#bD').textContent = d || '';
  b.hidden = false; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  return sleep(3200).then(() => { b.hidden = true; });
}
export function fx(id) { const f = $('#' + id); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); if (id === 'hurt') setTimeout(() => f.classList.remove('on'), 700); }

// ---------- 대화창(한 글자씩) ----------
export const WHO = {
  han: ['한결 연구원', 'han', true], nubi: ['누비', 'nubi', true], sys: ['', 'sys', false], me: ['탐험대', 'me', false],
};
let dState = null;
function showDialog(who, text, opts, res) {
  const w = typeof who === 'string' ? (WHO[who] || WHO.sys) : who; // who가 객체면 NPC {name, color}
  const dlg = $('#dialog');
  const cls = typeof who === 'string' ? w[1] : 'npc';
  const name = typeof who === 'string' ? w[0] : who.name;
  const isGame = typeof who === 'string' ? w[2] : true;
  dlg.hidden = false; dlg.className = cls; document.body.classList.add('dlg');
  $('#dName').innerHTML = `${esc(name)}${isGame ? ' <span class="tag game">🎮 게임 속 인물</span>' : ''}`;
  const pt = $('#dPt'); pt.className = 'pt ' + cls; pt.style.setProperty('--pt-c', typeof who === 'string' ? '' : (who.color || '#6a994e'));
  $('#dChoices').innerHTML = ''; $('#dChoices').hidden = true; $('#dNext').hidden = true;
  const full = text, plain = full.replace(/<[^>]+>/g, '');
  const me = { full, typing: true, opts, res }; dState = me;
  let i = 0; $('#dText').textContent = '';
  const step = () => {
    if (dState !== me || !me.typing) return;
    i++; $('#dText').textContent = plain.slice(0, i);
    if (cls !== 'sys' && i % 3 === 0) Snd.play('type');
    if (i < plain.length) me.timer = setTimeout(step, 22); else finishType();
  };
  step();
}
function finishType() {
  const s = dState; if (!s) return;
  s.typing = false; clearTimeout(s.timer); $('#dText').innerHTML = s.full;
  if (s.opts) {
    const box = $('#dChoices'); box.hidden = false;
    s.opts.forEach((o, k) => { const b = document.createElement('button'); b.className = 'choice'; b.innerHTML = o; b.onclick = e => { e.stopPropagation(); if (dState !== s) return; Snd.play('blip'); dState = null; closeSoon(); s.res(k); }; box.appendChild(b); });
  } else $('#dNext').hidden = false;
}
function closeSoon() { setTimeout(() => { if (!dState) { $('#dialog').hidden = true; document.body.classList.remove('dlg'); } }, 40); }
function advance() { const s = dState; if (!s) return; if (s.typing) { finishType(); return; } if (s.opts) return; dState = null; Snd.play('blip'); closeSoon(); s.res(); }
export const talk = (who, text) => new Promise(r => showDialog(who, text, null, r));
export const choose = (who, text, opts) => new Promise(r => showDialog(who, text, opts, r));
export async function lines(arr) { for (const [w, t] of arr) await talk(w, t); }
export function dialogOpen() { return !$('#dialog').hidden; }

// ---------- 패널 ----------
export function panel(html, buttons = [['닫기', 'pri']], { wide = false, onOpen } = {}) {
  return new Promise(res => {
    const p = $('#panel'); p.hidden = false; p.className = wide ? 'wide' : '';
    $('#panelBody').innerHTML = html; $('#panelBody').scrollTop = 0;
    const bar = $('#panelBtns'); bar.innerHTML = '';
    const close = i => { p.hidden = true; Snd.play('blip'); res(i); };
    buttons.forEach(([label, style], i) => { const b = document.createElement('button'); b.className = 'btn ' + (style || ''); b.textContent = label; b.onclick = () => close(i); bar.appendChild(b); });
    if (onOpen) onOpen($('#panelBody'), close, bar);
  });
}
export function panelOpen() { return !$('#panel').hidden; }
