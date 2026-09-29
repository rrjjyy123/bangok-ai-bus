// 선생님 화면(전자칠판) — 방 만들기, 단계 제어, 모둠 현황, 우리 반 데이터 지도, 점수 비교, 윤리 카드, 책임 투표
import { connect } from './net.js';
import { ZONES, LABELS, LABEL_ICON, ETHICS, POLL, EPILOGUE, KINDS, KIND_SHORT } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const app = $('#t-app');
let toastT = 0;
function toast(t, ms = 2600) {
  const el = $('#toast'); el.textContent = t; el.hidden = false; el.style.opacity = 1;
  clearTimeout(toastT); toastT = setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.hidden = true, 300); }, ms);
}
const ROOMS_KEY = 'bangok-teacher-rooms';
const myRooms = () => { try { return JSON.parse(localStorage.getItem(ROOMS_KEY)) || []; } catch (e) { return []; } };
const saveRooms = list => { try { localStorage.setItem(ROOMS_KEY, JSON.stringify(list)); } catch (e) { } };

let net;
try { net = await connect(); }
catch (e) {
  app.innerHTML = `<div class="t-start"><h1>서버에 연결하지 못했어요</h1><p>인터넷 연결을 확인한 뒤 새로 고침해 주세요.</p></div>`;
  throw e;
}

// ---------- 시작: 방 만들기 · 내 방 목록 ----------
async function showStart() {
  const list = [];
  for (const code of myRooms()) {
    const meta = await net.get(`rooms/${code}/meta`).catch(() => null);
    if (meta && meta.teacherUid === net.uid) list.push({ code, meta });
  }
  saveRooms(list.map(r => r.code));
  app.innerHTML = `<div class="t-start">
    <div class="eyebrow">반곡 AI 버스 훈련소 · 선생님 화면</div>
    <h1>수업 방</h1>
    <p>방을 만들면 4자리 코드가 나와요. 학생 태블릿에서 <b>탐험 시작하기</b> → 방 코드를 누르면 들어와요.</p>
    <button class="btn pri big" id="mk">＋ 새 수업 방 만들기</button>
    ${list.length ? `<h2>내가 만든 방</h2><div class="t-rooms">${list.map(r => `<div class="t-room"><b>${r.code}</b><span>${new Date(r.meta.createdAt).toLocaleString('ko-KR')}</span><button class="btn" data-open="${r.code}">열기</button><button class="btn" data-del="${r.code}">삭제</button></div>`).join('')}</div>` : ''}
    <p class="t-note">방에는 학생 이름·얼굴·위치를 저장하지 않아요. 수업이 끝나면 방을 삭제해 주세요. 선생님 권한은 이 브라우저에 저장돼요(다른 컴퓨터에서는 이 방을 조작할 수 없어요).</p>
  </div>`;
  $('#mk').onclick = createRoom;
  app.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openRoom(b.dataset.open));
  app.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm(`방 ${b.dataset.del}을(를) 삭제할까요? 모은 사진과 기록이 모두 지워져요.`)) return;
    await net.remove(`rooms/${b.dataset.del}`); toast('방을 삭제했어요.'); showStart();
  });
}
async function createRoom() {
  $('#mk').disabled = true;
  let code = null;
  for (let i = 0; i < 20 && !code; i++) {
    const c = String(1000 + Math.floor(Math.random() * 9000));
    if (!(await net.get(`rooms/${c}/meta`))) code = c;
  }
  if (!code) { toast('방을 만들지 못했어요. 다시 눌러 주세요.'); $('#mk').disabled = false; return; }
  await net.set(`rooms/${code}/meta`, { teacherUid: net.uid, createdAt: Date.now(), allowTrain: false, mapUnlocked: false, exchangeOpen: false, locked: false, stableMode: false, poll: 'none', epilogue: 0 });
  saveRooms([code, ...myRooms().filter(c => c !== code)]);
  openRoom(code);
}

// ---------- 수업 방 ----------
const R = { code: null, meta: {}, devices: {}, teams: {}, samples: {}, ethics: {}, poll: {}, tab: 'status', subs: [] };
function openRoom(code) {
  R.subs.forEach(u => u()); R.subs = [];
  Object.assign(R, { code, meta: {}, devices: {}, teams: {}, samples: {}, ethics: {}, poll: {} });
  const base = `rooms/${code}`;
  const studentURL = `${location.origin}${location.pathname.replace(/teacher\.html$/, '')}?room=${code}`;
  app.innerHTML = `<header class="t-head">
      <div class="t-code"><span>방 코드</span><b>${code}</b></div>
      <div class="t-info"><div class="t-url">학생 주소 <b>${esc(studentURL.replace(/^https?:\/\//, ''))}</b></div><div id="devCount" class="mono"></div></div>
      <button class="btn" id="back">← 방 목록</button>
    </header>
    <nav class="t-ctrl" id="ctrl"></nav>
    <nav class="t-tabs">${[['status', '모둠 현황'], ['map', '우리 반 데이터 지도'], ['score', '점수 비교'], ['ethics', '윤리원칙 카드'], ['poll', '책임 투표']].map(([k, n]) => `<button data-tab="${k}">${n}</button>`).join('')}</nav>
    <main id="view"></main>
    <details class="t-set"><summary>설정</summary>
      <label><input type="checkbox" id="stable"> <b>안정 모드</b> — 돌발 상황 때 실제 판단 대신 '우리 데이터에 같은 대상이 있었는지'로 시험 결과를 정해요</label>
      <button class="btn" id="delRoom">이 방 삭제하기(수업 끝)</button>
    </details>
    <div id="overlay" hidden></div>`;
  $('#back').onclick = () => { R.subs.forEach(u => u()); R.subs = []; showStart(); };
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { R.tab = b.dataset.tab; render(); });
  $('#stable').onchange = e => setMeta({ stableMode: e.target.checked });
  $('#delRoom').onclick = async () => {
    if (!confirm(`방 ${code}을(를) 삭제할까요? 학생 기기는 혼자 하기로 바뀌고, 모은 사진과 기록이 모두 지워져요.`)) return;
    R.subs.forEach(u => u()); R.subs = [];
    await net.remove(base); saveRooms(myRooms().filter(c => c !== code)); toast('방을 삭제했어요.'); showStart();
  };
  const on = (p, ev, cb) => R.subs.push(net.on(p, ev, cb));
  on(`${base}/meta`, 'value', v => { if (!v) return; R.meta = v; renderCtrl(); });
  on(`${base}/devices`, 'value', v => { R.devices = v || {}; render(); });
  on(`${base}/teams`, 'value', v => { R.teams = v || {}; render(); });
  on(`${base}/ethics`, 'value', v => { R.ethics = v || {}; render(); });
  on(`${base}/poll`, 'value', v => { R.poll = v || {}; render(); });
  // 사진은 썸네일이 커서 추가·변경분만 받고, 분석에 필요한 숨은 정보만 남긴다
  for (const z of ZONES) {
    const t = z.id, p = `${base}/samples/${t}`; R.samples[t] = {};
    const keep = v => ({ label: v.label, kind: v.kind, light: v.light, from: v.from || null });
    on(p, 'child_added', (v, id) => { if (v) { R.samples[t][id] = keep(v); renderSoon(); } });
    on(p, 'child_changed', (v, id) => { if (v) { R.samples[t][id] = keep(v); renderSoon(); } });
    on(p, 'child_removed', (v, id) => { delete R.samples[t][id]; renderSoon(); });
  }
  render();
}
const setMeta = v => net.update(`rooms/${R.code}/meta`, v).catch(e => toast('바꾸지 못했어요: ' + e.message));

function renderCtrl() {
  const m = R.meta;
  $('#stable').checked = !!m.stableMode;
  const B = (id, label, on, cls = '') => `<button class="tbtn ${on ? 'on' : ''} ${cls}" id="${id}">${label}</button>`;
  $('#ctrl').innerHTML = [
    B('cOpen', '📖 오프닝', false),
    B('cTrain', m.allowTrain ? '③ 학습·시험 운행 허용됨' : '③ 학습·시험 운행 허용', m.allowTrain),
    B('cMap', m.mapUnlocked ? '🚧 지도 개방됨' : '🚧 지도 전체 개방', m.mapUnlocked),
    B('cMarket', m.exchangeOpen ? '🔁 거래소 열림' : '🔁 데이터 거래소 열기', m.exchangeOpen),
    B('cPoll', m.poll === 'open' ? '🗳 투표 마감하기' : '🗳 책임 투표 시작', m.poll === 'open'),
    B('cEpi', '🎬 에필로그', false),
    B('cLock', m.locked ? '▶ 멈춤 풀기' : '✋ 모두 멈춤', m.locked, 'warn'),
  ].join('');
  $('#cOpen').onclick = () => playLines(OPENING);
  $('#cTrain').onclick = () => setMeta({ allowTrain: !m.allowTrain });
  $('#cMap').onclick = () => { if (m.mapUnlocked) return; if (confirm('공사를 끝내고 반곡동 지도 전체를 열까요? (되돌릴 수 없어요, 사진 +20장)')) setMeta({ mapUnlocked: true }); };
  $('#cMarket').onclick = () => setMeta({ exchangeOpen: !m.exchangeOpen });
  $('#cPoll').onclick = () => { setMeta({ poll: m.poll === 'open' ? 'closed' : 'open' }); R.tab = 'poll'; render(); };
  $('#cEpi').onclick = () => { if (confirm('학생 기기에 에필로그를 보낼까요?')) { setMeta({ epilogue: Date.now() }); playLines(EPILOGUE); } };
  $('#cLock').onclick = () => setMeta({ locked: !m.locked });
}

// ---------- 화면 그리기 ----------
let rsT = 0;
function renderSoon() { clearTimeout(rsT); rsT = setTimeout(render, 150); }
const teamSamples = t => Object.values(R.samples[t] || {});
const devsOf = t => Object.values(R.devices).filter(d => d.team === t).length;
const devRecs = t => Object.values(R.teams[t]?.dev || {});
const best = (t, k) => { const v = devRecs(t).map(d => d[k]).filter(Boolean); return v.length ? v.reduce((a, b) => (b.ok > a.ok ? b : a)) : null; };
function render() {
  if (!R.code || !$('#view')) return;
  $('#devCount').textContent = `📱 접속한 기기 ${Object.keys(R.devices).length}대`;
  app.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === R.tab));
  const v = $('#view');
  if (R.tab === 'status') v.innerHTML = `<div class="t-grid">${ZONES.map(z => {
    const t = z.id, ss = teamSamples(t), trained = devRecs(t).some(d => d.trained), s1 = best(t, 's1'), s2 = best(t, 's2');
    return `<div class="t-team" style="--c:${z.color}"><div class="t-th"><b>${t}모둠</b><span>${z.name}</span><em>📱 ${devsOf(t)}</em></div>
      <div class="t-big">${ss.length}<small>장</small></div>
      <div class="t-lbl">${LABELS.map(l => `<span>${LABEL_ICON[l]} ${ss.filter(s => s.label === l).length}</span>`).join('')}</div>
      <div class="t-st"><span class="${trained ? 'ok' : ''}">${trained ? '✓ 학습함' : '학습 전'}</span><span>1차 <b>${s1 ? `${s1.ok}/${s1.n}` : '–'}</b></span><span>2차 <b>${s2 ? `${s2.ok}/${s2.n}` : '–'}</b></span></div></div>`;
  }).join('')}</div>`;
  else if (R.tab === 'map') {
    const cols = [...KINDS.map(k => [k, KIND_SHORT[k], s => s.kind === k]), ['night', '🌙 밤', s => s.light === 'night'], ['rain', '🌧️ 비', s => s.light === 'rain']];
    const all = ZONES.flatMap(z => teamSamples(z.id));
    const tot = cols.map(([, , f]) => all.filter(f).length);
    const low = cols.map((c, i) => [c[1], tot[i]]).sort((a, b) => a[1] - b[1]).slice(0, 3);
    v.innerHTML = `<p class="t-lead">모둠별로 모은 사진 속 <b>대상 종류</b>예요. 빨간 칸은 한 장도 없는 곳이에요. (학생 화면에는 보이지 않는 숨은 정보)</p>
      <div class="t-scroll"><table class="t-map"><thead><tr><th></th>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th>합계</th></tr></thead><tbody>
      ${ZONES.map(z => { const ss = teamSamples(z.id); return `<tr><th style="color:${z.color}">${z.id}모둠</th>${cols.map(([, , f]) => { const n = ss.filter(f).length; return `<td class="${n ? '' : 'zero'}">${n}</td>`; }).join('')}<td class="sum">${ss.length}</td></tr>`; }).join('')}
      <tr class="tot"><th>우리 반</th>${tot.map(n => `<td class="${n ? n < 4 ? 'few' : '' : 'zero'}">${n}</td>`).join('')}<td class="sum">${all.length}</td></tr></tbody></table></div>
      ${all.length ? `<p class="t-say">📌 우리 반 데이터에 ${low.map(([n, c]) => `<b>${n}</b> 사진은 <b>${c}장</b>`).join(', ')}밖에 없어요.</p>` : ''}`;
  } else if (R.tab === 'score') {
    v.innerHTML = `<p class="t-lead">시험 운행 12장면 중 맞힌 수 (모둠에서 가장 잘한 기기 기준)</p><div class="t-bars">${ZONES.map(z => {
      const s1 = best(z.id, 's1'), s2 = best(z.id, 's2'), w = s => s ? s.ok / s.n * 100 : 0;
      return `<div class="t-brow"><b style="color:${z.color}">${z.id}모둠</b><div class="t-btrack"><div class="b1" style="width:${w(s1)}%"><span>${s1 ? `1차 ${s1.ok}` : ''}</span></div><div class="b2" style="width:${w(s2)}%"><span>${s2 ? `2차 ${s2.ok}` : ''}</span></div></div>
        <em>${s1 && s2 ? `${s2.ok - s1.ok >= 0 ? '+' : ''}${s2.ok - s1.ok}` : ''}</em></div>
        ${s1?.missed?.length ? `<div class="t-miss">1차에 놓친 대상: ${[...new Set(s1.missed)].map(k => KIND_SHORT[k] || k).join(', ')}</div>` : ''}`;
    }).join('')}</div><p class="t-leg"><span class="k1"></span>1차 <span class="k2"></span>2차</p>`;
  } else if (R.tab === 'ethics') {
    const es = Object.values(R.ethics);
    const cnt = ETHICS.map((e, i) => es.filter(x => x.card === i).length), mx = Math.max(1, ...cnt);
    v.innerHTML = `<p class="t-lead">오늘 누비에게 가장 필요했던 원칙 — ${es.length}명 제출</p><div class="t-eth">${ETHICS.map((e, i) => `<div class="t-ecard ${cnt[i] === mx && cnt[i] ? 'top' : ''}">
      <div class="t-eh"><b>${e.name}</b><span>${cnt[i]}</span></div><div class="t-ebar"><i style="width:${cnt[i] / mx * 100}%"></i></div>
      <ul>${es.filter(x => x.card === i && x.reason).map(x => `<li><em>${x.team}모둠</em> ${esc(x.reason)}</li>`).join('')}</ul></div>`).join('')}</div>`;
  } else if (R.tab === 'poll') {
    const vs = Object.values(R.poll), cnt = POLL.options.map((o, i) => vs.filter(x => x === i).length), mx = Math.max(1, ...cnt);
    v.innerHTML = `<p class="t-lead"><span class="tag game">🎮 가정</span> ${POLL.q} — ${vs.length}표 ${R.meta.poll === 'open' ? '<b class="live">● 투표 중</b>' : R.meta.poll === 'closed' ? '(마감)' : '(시작 전)'}</p>
      <div class="t-poll">${POLL.options.map((o, i) => `<div class="t-prow"><b>${o}</b><div class="t-ptrack"><i style="width:${cnt[i] / mx * 100}%"></i></div><span>${cnt[i]}</span></div>`).join('')}</div>`;
  }
}

// ---------- 오프닝 · 에필로그(큰 화면용 대사) ----------
const OPENING = [
  ['sys', '2026년 가을, 세종시 반곡동. (🎮 게임 속 이야기)'],
  ['han', '반곡초등학교 6학년 여러분! 곧 반곡초 앞에 자율주행 셔틀 <b>누비</b>가 달리게 됐어요.'],
  ['han', '그런데 문제가 있어요. 누비는 아직 <b>아무것도 볼 줄 몰라요.</b> 여러분이 누비의 눈이 되어 줄 데이터를 모아 주세요!'],
  ['nubi', '삐빅… 앞에 뭐가 있는지 모르겠어요…'],
  ['han', '인공지능 만드는 4단계: <b>① 데이터 모으기 → ② 이름표 붙이기 → ③ 학습시키기 → ④ 시험하기</b>'],
];
const WHO = { han: ['한결 연구원', 'han'], nubi: ['누비', 'nubi'], sys: ['', 'sys'] };
function playLines(arr) {
  const ov = $('#overlay'); let i = 0;
  const show = () => {
    if (i >= arr.length) { ov.hidden = true; return; }
    const [w, t] = arr[i], [name, cls] = WHO[w];
    ov.hidden = false;
    ov.innerHTML = `<div class="t-line ${cls}"><div class="pt ${cls}"></div><div><div class="t-name">${name}${name ? ' <span class="tag game">🎮 게임 속 인물</span>' : ''}</div><div class="t-text">${t}</div><div class="t-next">화면을 누르면 다음 ▶ (${i + 1}/${arr.length})</div></div></div>`;
  };
  ov.onclick = () => { i++; show(); };
  show();
}

showStart();
