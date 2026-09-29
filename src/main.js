// 반곡 AI 버스 훈련소 — 메인
import * as THREE from 'three';
import { ZONES, zoneAt, ZONE_NPCS, NAMED_NPCS, TEST_SCENES, LABELS, LABEL_ICON, LIMIT_FIRST, LIMIT_BONUS, DIALOG, ETHICS, REAL_NEWS } from './config.js';
import { buildWorld, applyLight, buildFence, updateRain, textSprite, blocked, moveRainTo, resetRain } from './world.js';
import { makeNPC, makeExplorer, makeShuttle, TRUTH, KIND_NAME } from './npc.js';
import { extractFeatures, flipRGBA, Classifier, IMG } from './ml.js';
import { $, sleep, esc, mountUI, Snd, setObj, toast, fadeTo, banner, fx, talk, choose, lines, dialogOpen, panel, panelOpen } from './ui.js';

const app = document.getElementById('app');
mountUI(app);

const LABEL_COLOR = { '사람': '#ff6a3d', '자전거': '#4fd1ff', '킥보드': '#b58cff', '자동차': '#ffd166' };
const NPC_COLOR = { '도윤': '#ffd166', '유모차 아빠': '#3a86ff', '정 할머니': '#9c6644', '산책하는 주민': '#6a994e', '중학생 형': '#06d6a0' };

// ---------- 상태 ----------
const S = {
  mode: 'title',        // title | story | explore | drive
  team: null, zone: null,
  samples: [], clf: null, trainedCount: 0,
  mapUnlocked: false, drives: [], ethics: null, curLight: 'day',
};
const LAYER_UI = 1;

// ---------- three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.domElement.className = 'view';
app.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1500);
camera.layers.enable(LAYER_UI);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const MAP = await fetch('data/bangok.json').then(r => r.json());
const world = buildWorld(scene, MAP);

// ---------- NPC 배치(실제 도로·보행로를 따라) ----------
let seedN = 2026;
const rnd = () => { seedN = (seedN * 16807) % 2147483647; return seedN / 2147483647; };
const PEOPLE_ROADS = ['footway', 'pedestrian', 'path', 'living_street', 'residential', 'service', 'tertiary', 'secondary'];
const CAR_ROADS = ['tertiary', 'secondary', 'residential', 'service', 'living_street'];
function segsIn(rect, kinds) {
  const [x0, x1, z0, z1] = rect, out = [];
  for (const r of MAP.roads) {
    if (!kinds.includes(r.kind)) continue;
    for (let i = 0; i < r.p.length - 1; i++) {
      const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (mx > x0 + 3 && mx < x1 - 3 && mz > z0 + 3 && mz < z1 - 3) out.push({ a: r.p[i], b: r.p[i + 1], r, len: Math.hypot(bx - ax, bz - az) });
    }
  }
  return out;
}
function spotFor(kind, rect) {
  const vehicle = kind === 'car', bike = kind === 'cyclist' || kind === 'scooter';
  let segs = vehicle ? segsIn(rect, CAR_ROADS) : bike ? segsIn(rect, ['cycleway']) : segsIn(rect, PEOPLE_ROADS);
  if (!segs.length) segs = segsIn(rect, PEOPLE_ROADS);
  if (!segs.length) return null;
  const total = segs.reduce((a, s) => a + s.len, 0);
  for (let tries = 0; tries < 60; tries++) {
    let pick = rnd() * total, sg = segs[0];
    for (const s of segs) { pick -= s.len; if (pick <= 0) { sg = s; break; } }
    const t = rnd(), dx = sg.b[0] - sg.a[0], dz = sg.b[1] - sg.a[1], L = sg.len || 1, nx = -dz / L, nz = dx / L;
    const foot = ['footway', 'pedestrian', 'path', 'cycleway', 'steps'].includes(sg.r.kind);
    let off = 0;
    if (vehicle) off = (rnd() < 0.5 ? -1 : 1) * sg.r.w / 4;
    else if (!foot) off = (rnd() < 0.5 ? -1 : 1) * (sg.r.w / 2 + 1.6);
    const x = sg.a[0] + dx * t + nx * off, z = sg.a[1] + dz * t + nz * off;
    const [x0, x1, z0, z1] = rect;
    if (x < x0 + 2 || x > x1 - 2 || z < z0 + 2 || z > z1 - 2) continue;
    if (blocked(world, x, z, 1.5)) continue;
    return { x, z, dir: new THREE.Vector3(dx / L, 0, dz / L) };
  }
  return null;
}
const npcs = [];
function addNPC(kind, zid, spot, name) {
  const g = makeNPC(kind);
  g.position.set(spot.x, 0, spot.z);
  const dir = spot.dir.clone();
  if (kind !== 'car' && kind !== 'cyclist' && kind !== 'scooter' && rnd() < 0.5) dir.set(-dir.z, 0, dir.x);
  g.rotation.y = Math.atan2(dir.x, dir.z) + (rnd() < 0.5 ? Math.PI : 0);
  g.userData.home = new THREE.Vector3(spot.x, 0, spot.z);
  g.userData.dir = new THREE.Vector3(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
  g.userData.wander = kind === 'car' ? 0 : kind === 'cyclist' || kind === 'scooter' ? 7 : kind === 'wheelchair' || kind === 'elder' || name ? 0 : 2.5;
  g.userData.phase = rnd() * 6.28;
  g.userData.zone = zid;
  g.userData.name = name || null;
  if (name) {
    const tag = textSprite(`💬 ${name}`, { size: 40, bg: 'rgba(10,16,32,0.9)', color: '#7ed98a', scale: 0.035 });
    tag.position.set(0, kind === 'child' ? 1.9 : 2.8, 0);
    g.add(tag); g.userData.tag = tag;
  }
  scene.add(g); npcs.push(g);
}
for (const zn of ZONES) for (const [kind, n] of Object.entries(ZONE_NPCS[zn.id])) for (let i = 0; i < n; i++) { const sp = spotFor(kind, zn.rect); if (sp) addNPC(kind, zn.id, sp); }
for (const nn of NAMED_NPCS) {
  const zn = ZONES.find(z => z.id === nn.zone);
  let best = null, bd = 1e9;
  for (let i = 0; i < 40; i++) { const sp = spotFor(nn.kind, zn.rect); if (!sp) continue; const d = Math.hypot(sp.x - nn.near[0], sp.z - nn.near[1]); if (d < bd) { bd = d; best = sp; } }
  if (best) addNPC(nn.kind, zn.id, best, nn.name);
}

const player = makeExplorer(0xffffff);
scene.add(player);
const ring = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.7, 32), new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
function setUILayer(o) { o.traverse(c => c.layers.set(LAYER_UI)); }
scene.traverse(o => { if (o.isSprite) o.layers.set(LAYER_UI); });
setUILayer(player); setUILayer(ring); setUILayer(world.fences);
const shuttle = makeShuttle(); shuttle.visible = false; scene.add(shuttle);

// ---------- 촬영(이미지 수집) ----------
const CAP = 96;
const rt = new THREE.WebGLRenderTarget(CAP, CAP); rt.texture.colorSpace = THREE.SRGBColorSpace;
const capCam = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
const capBuf = new Uint8Array(CAP * CAP * 4);
const cvBig = Object.assign(document.createElement('canvas'), { width: CAP, height: CAP });
const cvSmall = Object.assign(document.createElement('canvas'), { width: IMG, height: IMG });
const ctxBig = cvBig.getContext('2d', { willReadFrequently: true }), ctxSmall = cvSmall.getContext('2d', { willReadFrequently: true });
function capture(from, target, aimY, size) {
  const aim = target.clone(); aim.y = aimY;
  capCam.position.copy(from);
  const dist = from.distanceTo(aim);
  capCam.fov = THREE.MathUtils.clamp(2 * Math.atan((size * 0.62) / dist) * 180 / Math.PI, 6, 70);
  capCam.updateProjectionMatrix(); capCam.lookAt(aim);
  const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping; // 학습 이미지는 톤매핑 없이 일정하게
  renderer.setRenderTarget(rt); renderer.render(scene, capCam);
  renderer.readRenderTargetPixels(rt, 0, 0, CAP, CAP, capBuf);
  renderer.setRenderTarget(null); renderer.toneMapping = tm;
  const img = ctxBig.createImageData(CAP, CAP);
  for (let y = 0; y < CAP; y++) for (let x = 0; x < CAP; x++) {
    const s = ((CAP - 1 - y) * CAP + x) * 4, d = (y * CAP + x) * 4, n = (Math.random() - 0.5) * 16;
    img.data[d] = capBuf[s] + n; img.data[d + 1] = capBuf[s + 1] + n; img.data[d + 2] = capBuf[s + 2] + n; img.data[d + 3] = 255;
  }
  ctxBig.putImageData(img, 0, 0);
  const thumb = cvBig.toDataURL('image/jpeg', 0.85);
  ctxSmall.drawImage(cvBig, 0, 0, IMG, IMG);
  const small = ctxSmall.getImageData(0, 0, IMG, IMG).data;
  return { thumb, feat: extractFeatures(small), featFlip: extractFeatures(flipRGBA(small)) };
}

// ---------- 입력 ----------
const input = { jx: 0, jy: 0, yaw: Math.PI, pitch: 0.08, keys: {} };
const busy = () => dialogOpen() || panelOpen() || !$('#screen').hidden;
addEventListener('keydown', e => {
  input.keys[e.code] = true;
  if (S.mode !== 'explore' || busy()) return;
  if (e.code === 'Space' || e.code === 'KeyE') { e.preventDefault(); takePhoto(); }
  if (e.code === 'KeyQ') openAlbum();
  if (e.code === 'KeyT') talkNearby();
  if (e.code === 'Escape') openMenu();
});
addEventListener('keyup', e => { input.keys[e.code] = false; });
addEventListener('blur', () => { for (const k in input.keys) input.keys[k] = false; });
{
  const joy = $('#joy'), knob = $('#knob');
  let id = null;
  const move = e => {
    const r = joy.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const m = r.width / 2 - 20, L = Math.hypot(dx, dy); if (L > m) { dx *= m / L; dy *= m / L; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`; input.jx = dx / m; input.jy = dy / m;
  };
  joy.addEventListener('pointerdown', e => { id = e.pointerId; joy.setPointerCapture(id); move(e); });
  joy.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
  const end = e => { if (e.pointerId !== id) return; id = null; input.jx = input.jy = 0; knob.style.transform = ''; };
  joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
  // 화면 끌어서 둘러보기
  let lid = null, lx = 0, ly = 0;
  renderer.domElement.addEventListener('pointerdown', e => { lid = e.pointerId; lx = e.clientX; ly = e.clientY; });
  addEventListener('pointermove', e => {
    if (e.pointerId !== lid || S.mode !== 'explore' || busy()) return;
    input.yaw -= (e.clientX - lx) * 0.005; input.pitch = THREE.MathUtils.clamp(input.pitch + (e.clientY - ly) * 0.003, -0.35, 0.55);
    lx = e.clientX; ly = e.clientY;
  });
  addEventListener('pointerup', e => { if (e.pointerId === lid) lid = null; });
}
app.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b || S.mode !== 'explore' || busy()) return;
  Snd.init();
  ({ shot: takePhoto, album: openAlbum, menu: openMenu, train: openTrain, drive: startDrive, ethics: openEthics, talk: talkNearby })[b.dataset.a]?.();
});

// ---------- HUD ----------
const studentSamples = () => S.samples;
const limit = () => LIMIT_FIRST + (S.mapUnlocked ? LIMIT_BONUS : 0);
function updateHUD() {
  const n = S.samples.length, trained = !!S.clf, drove = S.drives.length;
  $('#zoneChip').textContent = `📍 ${S.mapUnlocked ? '반곡동 전체' : S.zone.name}`;
  $('#tray').innerHTML = LABELS.map(l => `<span class="grp"><span class="dot" style="background:${LABEL_COLOR[l]}"></span>${l} <strong>${S.samples.filter(s => s.label === l).length}</strong></span>`).join('') + `<span class="grp cap">📷 <strong>${n}/${limit()}</strong></span>`;
  document.querySelectorAll('#steps span').forEach(sp => {
    const s = +sp.dataset.s; let c = '';
    if (s <= 2) c = trained ? 'done' : 'on';
    if (s === 3) c = trained ? 'done' : canTrain() ? 'on' : '';
    if (s === 4) c = drove ? 'done' : trained ? 'on' : '';
    sp.className = c;
  });
  $('[data-a="drive"]').disabled = !trained;
  $('[data-a="train"]').disabled = !canTrain();
  // 현재 목표
  const stale = trained && S.samples.length !== S.trainedCount;
  let o;
  if (!trained) o = canTrain() ? `사진이 모였어요! <b>학습</b>으로 누비를 공부시키거나, 사진을 더 모아도 좋아요. (${n}/${limit()})` : `사람과 탈것에 조준하고 <b>📷 찍기</b> → 이름표를 붙이세요. 이름표 2가지 이상, 6장 넘게! (${n}/${limit()})`;
  else if (stale) o = `새로 찍은 사진이 있어요. <b>학습</b>을 다시 해야 누비가 배워요.`;
  else if (!drove) o = `<b>시험 운행</b>으로 누비가 BRT 도로에서 잘 알아보는지 확인하세요.`;
  else if (drove === 1 && !S.mapUnlocked) o = `결과에서 틀린 장면의 <b>AI 속마음</b>을 살펴보세요. 왜 틀렸을까요?`;
  else if (drove === 1) o = `공사가 끝났어요! 누비가 놓친 대상을 찾아 사진을 더 모으고 → 학습 → <b>2차 시험 운행</b>`;
  else o = `<b>윤리원칙</b>에서 오늘 누비에게 가장 필요했던 원칙을 골라 제출하세요.`;
  if (o !== updateHUD.last) { setObj(o); updateHUD.last = o; }
}
const canTrain = () => S.samples.length >= 6 && LABELS.filter(l => S.samples.some(s => s.label === l)).length >= 2;

// ---------- 조준 ----------
let target = null;
const _v = new THREE.Vector3(), _f = new THREE.Vector3();
function findTarget() {
  camera.getWorldDirection(_f);
  let best = null, bestA = 1e9;
  for (const n of npcs) {
    if (!n.visible) continue;
    const d = n.position.distanceTo(player.position);
    if (d < 2.5 || d > 18) continue;
    _v.set(n.position.x, n.userData.aimY, n.position.z).sub(camera.position);
    const dist = _v.length(), ang = _f.angleTo(_v.normalize());
    const lim = Math.atan((n.userData.size * 0.6) / dist) + 0.07;
    if (ang < lim && ang < bestA) { bestA = ang; best = n; }
  }
  return best;
}

// ---------- 촬영 → 이름표 ----------
async function takePhoto() {
  if (S.mode !== 'explore' || busy()) return;
  Snd.init();
  if (!target) { toast('사람이나 탈것에 조준해 주세요. 조준점이 주황색이 되면 찍을 수 있어요.'); return; }
  if (S.samples.length >= limit()) { toast(`사진은 ${limit()}장까지예요. 앨범에서 필요 없는 사진을 지울 수 있어요.`); return; }
  Snd.play('shutter'); fx('flash');
  const from = player.position.clone().add(new THREE.Vector3((Math.random() - .5) * 0.6, 1.5 + Math.random() * 0.4, (Math.random() - .5) * 0.6));
  const c = capture(from, target.position, target.userData.aimY, target.userData.size);
  const sample = { id: 's' + Date.now() + Math.random().toString(36).slice(2, 5), kind: target.userData.kind, zone: S.zone.id, light: S.curLight, ...c };
  await sleep(250);
  const k = await panel(`<div class="eyebrow">② 이름표 붙이기</div><div class="ph">이 사진은 무엇인가요?</div>
    <img class="bigshot" src="${c.thumb}" alt="찍은 사진">
    <div class="labels">${LABELS.map((l, i) => `<button data-i="${i}"><i>${LABEL_ICON[l]}</i>${l}</button>`).join('')}</div>
    <p class="pp" style="font-size:14px;color:var(--muted)">이름표가 틀리면 누비도 틀리게 배워요. 잘 보고 골라 주세요.</p>`,
    [['버리기', '']], { onOpen: (body, close) => body.querySelectorAll('[data-i]').forEach(b => b.onclick = () => close(10 + +b.dataset.i)) });
  if (k < 10) return;
  sample.label = LABELS[k - 10];
  S.samples.push(sample);
  Snd.play('save'); flyToTray(c.thumb);
  updateHUD();
}
function flyToTray(src) {
  const im = document.createElement('img'); im.src = src; im.className = 'flyshot';
  im.style.left = (innerWidth / 2 - 60) + 'px'; im.style.top = (innerHeight * 0.46 - 60) + 'px';
  app.appendChild(im);
  const tr = $('#tray').getBoundingClientRect();
  requestAnimationFrame(() => { im.style.left = (tr.right - 50) + 'px'; im.style.top = (tr.top - 10) + 'px'; im.style.width = im.style.height = '28px'; im.style.opacity = .3; });
  setTimeout(() => im.remove(), 700);
}

// ---------- 데이터 앨범 ----------
async function openAlbum() {
  const all = S.samples, max = Math.max(1, ...LABELS.map(l => all.filter(s => s.label === l).length));
  const k = await panel(`<div class="eyebrow">우리 모둠 데이터</div><div class="ph">데이터 앨범 <span class="mono" style="font-size:16px;color:var(--muted)">${all.length}/${limit()}</span></div>
    <div class="bars">${LABELS.map(l => { const n = all.filter(s => s.label === l).length; return `<div class="bar"><span>${LABEL_ICON[l]} ${l}</span><span class="tr"><span class="fl" style="width:${n / max * 100}%;background:${LABEL_COLOR[l]}"></span></span><span class="n">${n}장</span></div>`; }).join('')}</div>
    <p class="pp" style="font-size:14px;color:var(--muted)">사진을 누르면 이름표를 고치거나 지울 수 있어요. 한쪽으로 치우친 이름표는 없나요?</p>
    <div class="shots">${all.map((s, i) => `<button class="shot" data-i="${i}"><img src="${s.thumb}" alt=""><span class="lb" style="color:${LABEL_COLOR[s.label]}">${s.label}</span></button>`).join('') || '<p class="pp">아직 사진이 없어요.</p>'}</div>`,
    [['닫기', 'pri']], { wide: true, onOpen: (body, close) => body.querySelectorAll('[data-i]').forEach(b => b.onclick = () => close(100 + +b.dataset.i)) });
  if (k < 100) return;
  const s = S.samples[k - 100];
  const r = await panel(`<div class="eyebrow">이름표 고치기</div><img class="bigshot" src="${s.thumb}" alt="">
    <div class="labels">${LABELS.map((l, i) => `<button data-i="${i}" class="${l === s.label ? 'on' : ''}"><i>${LABEL_ICON[l]}</i>${l}</button>`).join('')}</div>`,
    [['사진 지우기', ''], ['돌아가기', 'pri']], { onOpen: (body, close) => body.querySelectorAll('[data-i]').forEach(b => b.onclick = () => close(10 + +b.dataset.i)) });
  if (r === 0) S.samples = S.samples.filter(x => x !== s);
  if (r >= 10) s.label = LABELS[r - 10];
  updateHUD(); openAlbum();
}

// ---------- 학습 ----------
async function openTrain() {
  if (!canTrain()) { toast('이름표 2가지 이상으로 사진을 6장 넘게 모아 주세요.'); return; }
  const labels = LABELS.filter(l => S.samples.some(s => s.label === l));
  const EPOCHS = 50;
  let btnBar;
  const done = panel(`<div class="eyebrow">③ 학습시키기</div><div class="ph">누비가 공부하는 중</div>
    <p class="pp">사진 <b class="mono">${S.samples.length}</b>장을 보며 틀린 만큼 조금씩 고쳐 가요. 배우는 이름표: ${labels.map(l => `<span style="color:${LABEL_COLOR[l]}">${LABEL_ICON[l]} ${l}</span>`).join(' · ')}</p>
    ${labels.length < LABELS.length ? `<div class="card game"><span class="tag game">🎮</span> 누비는 <b>${LABELS.filter(l => !labels.includes(l)).join(', ')}</b> 사진을 한 장도 못 봤어요. 이것들은 알아볼 수 없어요.</div>` : ''}
    <canvas class="chart" width="880" height="190"></canvas>
    <p class="pp mono st" style="font-size:14px">준비 중…</p>`, [['다음', 'pri']], { onOpen: (b, c, bar) => { btnBar = bar; bar.querySelector('button').disabled = true; } });
  const cv = $('#panelBody canvas'), ctx = cv.getContext('2d'), st = $('#panelBody .st');
  const hist = [];
  const draw = () => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#28405e'; ctx.lineWidth = 1;
    for (let y = 30; y < 180; y += 37) { ctx.beginPath(); ctx.moveTo(44, y); ctx.lineTo(870, y); ctx.stroke(); }
    ctx.font = '600 14px "IBM Plex Mono", monospace'; ctx.fillStyle = '#ff5a6e'; ctx.fillText('틀린 정도(손실)', 48, 20); ctx.fillStyle = '#7ed98a'; ctx.fillText('맞힌 비율', 760, 20);
    const mx = Math.max(...hist.map(p => p.loss), 0.5); ctx.lineWidth = 3;
    const X = i => 44 + i / (EPOCHS - 1) * 826;
    ctx.strokeStyle = '#ff5a6e'; ctx.beginPath(); hist.forEach((p, i) => { const y = 178 - p.loss / mx * 146; i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); }); ctx.stroke();
    ctx.strokeStyle = '#7ed98a'; ctx.beginPath(); hist.forEach((p, i) => { const y = 178 - p.acc * 146; i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); }); ctx.stroke();
  };
  Snd.play('learn'); fx('scanfx');
  await sleep(300);
  const clf = new Classifier(labels);
  await clf.train(S.samples, {
    epochs: EPOCHS,
    onEpoch: (ep, loss, acc) => { hist.push({ loss, acc }); st.textContent = `학습 ${ep + 1}/${EPOCHS}회 · 공부한 사진 맞힌 비율 ${(acc * 100).toFixed(0)}%`; if (ep % 2 || ep === EPOCHS - 1) { draw(); return new Promise(r => requestAnimationFrame(r)); } },
  });
  S.clf = clf; S.trainedCount = S.samples.length;
  st.innerHTML = `학습 완료 · 공부한 사진 맞힌 비율 <b style="color:var(--ok)">${(clf.finalAcc * 100).toFixed(0)}%</b> — 처음 보는 거리에서도 잘할까요?`;
  Snd.play('ok'); btnBar.querySelector('button').disabled = false;
  await done; updateHUD();
}

// ---------- 시험 운행 ----------
const route = MAP.route.map(([x, z]) => new THREE.Vector3(x, 0, z));
const segLen = []; let routeLen = 0;
for (let i = 0; i < route.length - 1; i++) { const l = route[i].distanceTo(route[i + 1]); segLen.push(l); routeLen += l; }
function routeAt(d) {
  d = THREE.MathUtils.clamp(d, 0, routeLen - 0.01);
  for (let i = 0; i < segLen.length; i++) {
    if (d <= segLen[i]) { const t = d / segLen[i]; return { p: route[i].clone().lerp(route[i + 1], t), dir: route[i + 1].clone().sub(route[i]).normalize() }; }
    d -= segLen[i];
  }
  return { p: route[route.length - 1].clone(), dir: route[route.length - 1].clone().sub(route[route.length - 2]).normalize() };
}
const REACT = {
  wheelchair: p => `누비야… 나를 ${p}(으)로 봤구나.`, child: p => `나 여기 있어요! 나는 ${p}(이)가 아니에요!`,
  stroller: () => `아기가 타고 있어요! 조심해 주세요!`, elder: () => `어이쿠, 깜짝이야!`,
  dogwalker: () => `밤이라 우리가 안 보였나 봐요!`, umbrella: () => `비 오는 날에도 나를 봐 줘야지!`,
  worker: p => `나를 ${p}(으)로 봤다고요?`, adult: p => `나는 ${p}(이)가 아니에요!`,
};
let drive = null;
async function startDrive() {
  if (!S.clf) return;
  if (S.samples.length !== S.trainedCount) {
    const k = await choose('nubi', '새로 찍은 사진은 아직 공부하지 않았어요. 그래도 지금 출발할까요?', ['지금 출발할래요', '먼저 다시 학습할래요']);
    if (k === 1) { openTrain(); return; }
  }
  S.mode = 'drive';
  await fadeTo(1, 500);
  $('#hud').hidden = true; $('#touch').hidden = true;
  player.visible = false; ring.visible = false; world.fences.visible = false;
  npcs.forEach(n => n.visible = false);
  shuttle.visible = true;
  app.insertAdjacentHTML('beforeend', `<div id="driveHud"><div id="driveTop"><span class="chip game">🎮 시험 운행 ${S.drives.length + 1}회차</span><span class="scene" id="dprog"></span><button class="hbtn" id="dfast">⏩ 빨리</button></div><div id="judge" hidden></div></div>`);
  drive = { dist: 0, speed: 32, fast: 1, idx: 0, state: 'run', wait: 0, actor: null, records: [] };
  $('#dfast').onclick = () => { drive.fast = drive.fast === 1 ? 2.5 : 1; $('#dfast').textContent = drive.fast === 1 ? '⏩ 빨리' : '▶ 보통'; };
  applyLight(scene, world, TEST_SCENES[0].light); S.curLight = TEST_SCENES[0].light;
  updateDrive(0.016);
  await fadeTo(0, 500);
  Snd.busHum(true);
  banner(`시험 운행 ${S.drives.length + 1}회차`, 'BRT 반곡동 구간', '국책연구단지 → 반곡동 정류장 → 반곡고 방향 · 🎮 게임 속 장면');
}
function updateDrive(dt) {
  const D = drive; dt *= D.fast;
  const sc = TEST_SCENES[D.idx], sceneDist = sc ? sc.t * routeLen : routeLen;
  $('#dprog').textContent = `장면 ${Math.min(D.idx + 1, TEST_SCENES.length)} / ${TEST_SCENES.length}`;
  if (D.state === 'run') {
    if (sc && !D.actor && D.dist > sceneDist - 50) {
      if (S.curLight !== sc.light) { applyLight(scene, world, sc.light); S.curLight = sc.light; toast({ night: '🌙 밤이 되었어요', rain: '🌧️ 비가 내려요', day: '☀️ 맑은 낮이에요' }[sc.light]); }
      const { p, dir } = routeAt(sceneDist), side = new THREE.Vector3(-dir.z, 0, dir.x);
      const a = makeNPC(sc.kind);
      a.position.copy(p).addScaledVector(side, (Math.random() < 0.5 ? -1 : 1) * (5.5 + Math.random() * 1.5));
      const face = TRUTH[sc.kind] === '자동차' ? dir.clone().negate() : side.clone();
      a.rotation.y = Math.atan2(face.x, face.z) + (Math.random() - 0.5) * 0.6;
      if (sc.light === 'rain') moveRainTo(world, p.x, p.z);
      scene.add(a); D.actor = a;
    }
    const stopAt = sceneDist - 11;
    let v = D.speed;
    if (D.actor) v = Math.max(3, Math.min(D.speed, (stopAt - D.dist) * 2));
    D.dist += v * dt;
    if (D.actor && D.dist >= stopAt) { D.dist = stopAt; D.state = 'judge'; judge(); }
    if (!sc && D.dist >= routeLen - 1) { finishDrive(); return; }
  } else if (D.state === 'show') {
    D.wait -= dt;
    if (D.wait <= 0) {
      scene.remove(D.actor); D.actor = null; D.idx++; $('#judge').hidden = true; D.state = 'run';
      if (D.idx >= TEST_SCENES.length) { finishDrive(); return; }
    }
  }
  const { p, dir } = routeAt(D.dist);
  shuttle.position.copy(p); shuttle.rotation.y = Math.atan2(dir.x, dir.z);
  camera.position.lerp(p.clone().addScaledVector(dir, -14).add(new THREE.Vector3(0, 6.5, 0)), 0.12);
  camera.lookAt(p.clone().addScaledVector(dir, 10).add(new THREE.Vector3(0, 1.5, 0)));
}
function judge() {
  const D = drive, sc = TEST_SCENES[D.idx], a = D.actor, { p, dir } = routeAt(D.dist);
  const eye = p.clone().addScaledVector(dir, 3.2).add(new THREE.Vector3((Math.random() - .5) * 0.4, 1.7 + Math.random() * 0.3, 0));
  shuttle.visible = false;
  const c = capture(eye, a.position, a.userData.aimY, a.userData.size);
  shuttle.visible = true;
  const pr = S.clf.predict(c.feat), truth = TRUTH[sc.kind];
  const correct = pr.label === truth, danger = truth === '사람' && pr.label !== '사람';
  D.records.push({ clf: S.clf, kind: sc.kind, truth, pred: pr.label, conf: pr.conf, probs: pr.probs, feat: c.feat, thumb: c.thumb, correct, danger, light: sc.light });
  fx('scanfx');
  const J = $('#judge'); J.hidden = false; J.className = correct ? 'good' : 'bad';
  const probs = Object.entries(pr.probs).sort((x, y) => y[1] - x[1]);
  const head = correct ? (truth === '사람' ? '사람이 보여요! 멈춰서 기다릴게요.' : `${pr.label}(이)네요. 조심해서 지나갈게요.`)
    : `${danger ? '⚠ 위험!' : '✕ 틀렸어요'} ${KIND_NAME[sc.kind]}을(를) ${pr.label}(으)로 착각했어요`;
  J.innerHTML = `<img src="${c.thumb}" alt=""><div class="eyebrow">누비의 눈 · 인식 결과</div><div class="h">${head}</div>
    <div class="bars">${probs.map(([l, v]) => `<div class="bar"><span>${LABEL_ICON[l]} ${l}</span><span class="tr"><span class="fl" style="width:${(v * 100).toFixed(0)}%;background:${LABEL_COLOR[l]}"></span></span><span class="n">${(v * 100).toFixed(0)}%</span></div>`).join('')}</div>
    ${danger && REACT[sc.kind] ? `<div class="say">🎮 ${KIND_NAME[sc.kind]}: “${REACT[sc.kind](pr.label)}”</div>` : ''}`;
  if (correct) Snd.play('ok'); else { Snd.play('bad'); if (danger) fx('hurt'); }
  D.state = 'show'; D.wait = correct ? 2.0 : 3.6;
}
async function finishDrive() {
  const D = drive; drive = null;
  Snd.busHum(false);
  await fadeTo(1, 500);
  $('#driveHud').remove();
  shuttle.visible = false; player.visible = true; world.fences.visible = true;
  npcs.forEach(n => n.visible = true);
  S.drives.push(D.records);
  resetRain(world);
  applyLight(scene, world, S.zone.light); S.curLight = S.zone.light;
  S.mode = 'explore'; $('#hud').hidden = false; $('#touch').hidden = false;
  updateHUD();
  await fadeTo(0, 400);
  await showResult(S.drives.length - 1);
  if (S.drives.length === 1) await lines([['nubi', '틀린 장면을 눌러 <b>AI 속마음</b>을 보면, 제가 왜 헷갈렸는지 알 수 있어요.'], ['han', '우리 모둠 데이터에 <b>없던 것</b>은 무엇이었을까요? 모둠 친구들과 이야기해 보세요.']]);
  else if (S.drives.length >= 2) await lines([['nubi', '데이터가 다양해지니까 더 많은 사람을 알아볼 수 있게 됐어요!'], ['han', '마지막으로 <b>윤리원칙</b>에서 오늘 누비에게 가장 필요했던 원칙을 골라 주세요.']]);
}
async function showResult(i) {
  const recs = S.drives[i], ok = recs.filter(r => r.correct).length, danger = recs.filter(r => r.danger).length;
  const prev = i > 0 ? S.drives[i - 1].filter(r => r.correct).length : null;
  Snd.play(ok >= 9 ? 'win' : 'blip');
  const k = await panel(`<div class="eyebrow">시험 운행 ${i + 1}회차 결과</div><div class="ph">누비의 시험 성적</div>
    <div class="stats"><div><div class="big">${ok}<span style="font-size:28px;color:var(--muted)">/${recs.length}</span></div><div class="k">맞힌 장면</div></div>
      <div><div class="big" style="color:var(--bad)">${danger}</div><div class="k">위험했던 장면</div></div>
      ${prev !== null ? `<div><div class="big" style="color:var(--ok)">${ok - prev >= 0 ? '+' : ''}${ok - prev}</div><div class="k">지난번보다</div></div>` : ''}</div>
    <p class="pp">빨간 줄을 누르면 <b style="color:var(--brt)">AI 속마음</b>을 볼 수 있어요.</p>
    <div class="rows">${recs.map((r, j) => `<button class="rrow ${r.correct ? 'good' : 'bad'}" data-j="${j}"><img src="${r.thumb}" alt=""><span class="t">${KIND_NAME[r.kind]} ${r.light === 'night' ? '🌙' : r.light === 'rain' ? '🌧️' : '☀️'}<small>정답 ${r.truth} · 누비 ${r.pred} ${(r.conf * 100).toFixed(0)}%</small></span><span class="mark ${r.correct ? 'ok' : r.danger ? 'warn' : 'bad'}">${r.correct ? '맞음' : r.danger ? '위험' : '틀림'}</span></button>`).join('')}</div>`,
    [['확인', 'pri']], { wide: true, onOpen: (body, close) => body.querySelectorAll('.rrow.bad').forEach(b => b.onclick = () => close(100 + +b.dataset.j)) });
  if (k >= 100) { await showMind(recs[k - 100]); return showResult(i); }
}
async function showMind(r) {
  const nn = r.clf.nearest(r.feat, 3), probs = Object.entries(r.probs).sort((a, b) => b[1] - a[1]);
  const has = S.samples.filter(s => s.kind === r.kind).length;
  await panel(`<div class="eyebrow">AI 속마음 보기</div><div class="ph">누비는 왜 ${r.pred}(이)라고 생각했을까?</div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;margin-top:8px">
      <div><img class="bigshot" style="width:170px;margin:0" src="${r.thumb}" alt=""><p class="pp mono" style="font-size:13px">누비가 본 장면 · 정답 ${KIND_NAME[r.kind]}(${r.truth})</p></div>
      <div style="flex:1;min-width:240px"><div class="eyebrow" style="color:var(--nubi)">누비의 판단</div><div class="bars">${probs.map(([l, v]) => `<div class="bar"><span>${LABEL_ICON[l]} ${l}</span><span class="tr"><span class="fl" style="width:${(v * 100).toFixed(0)}%;background:${LABEL_COLOR[l]}"></span></span><span class="n">${(v * 100).toFixed(0)}%</span></div>`).join('')}</div></div>
    </div>
    <div class="card"><div class="eyebrow" style="color:var(--nubi)">누비가 떠올린 가장 비슷한 우리 데이터 3장</div>
      <div class="shots" style="grid-template-columns:repeat(3,110px)">${nn.map(n => `<div class="shot"><img src="${n.sample.thumb}" alt=""><span class="lb" style="color:${LABEL_COLOR[n.sample.label]}">${n.sample.label} · 닮음 ${(Math.max(0, n.sim) * 100).toFixed(0)}</span></div>`).join('')}</div></div>
    <div class="card"><b>생각해 보기</b><p class="pp">우리 데이터에 <b style="color:var(--brt)">${KIND_NAME[r.kind]}</b> 사진은 <b class="mono">${has}</b>장 있었어요. ${has ? '어떤 조건(밤·비·각도)이 달랐을까요?' : '누비는 한 번도 본 적이 없었어요. 어디에 가면 찍을 수 있을까요?'}</p></div>`,
    [['돌아가기', 'pri']], { wide: true });
}

// ---------- 윤리원칙 ----------
async function openEthics() {
  let sel = S.ethics?.card ?? null;
  const k = await panel(`<div class="eyebrow">대한민국 인공지능 윤리원칙 · 7대 실천원칙</div><div class="ph">오늘 누비에게 가장 필요했던 원칙은?</div>
    <p class="pp" style="font-size:14px"><span class="tag real">📰 진짜 자료</span> 2026년 정부가 정한 원칙이에요.</p>
    <div class="ethics">${ETHICS.map((e, i) => `<button data-i="${i}" class="${sel === i ? 'on' : ''}"><b>${e.name}</b><span>${e.desc}</span></button>`).join('')}</div>
    <textarea id="why" rows="2" placeholder="왜 그 원칙을 골랐나요? 한 줄로 적어 보세요.">${esc(S.ethics?.reason ?? '')}</textarea>`,
    [['닫기', ''], ['제출하기', 'pri']], { wide: true, onOpen: body => body.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { sel = +b.dataset.i; body.querySelectorAll('[data-i]').forEach(x => x.classList.toggle('on', +x.dataset.i === sel)); Snd.play('blip'); }) });
  if (k !== 1) return;
  if (sel === null) { toast('원칙 카드를 한 장 골라 주세요.'); return openEthics(); }
  S.ethics = { card: sel, reason: $('#why')?.value ?? '' };
  Snd.play('win'); toast(`「${ETHICS[sel].name}」 제출 완료! (서버 연결 후 선생님 화면에 모여요)`, 3200);
}

// ---------- 대화 ----------
function nearbyNamed() { return npcs.find(n => n.userData.name && n.visible && n.position.distanceTo(player.position) < 8) || null; }
async function talkNearby() {
  const n = nearbyNamed(); if (!n) return;
  const who = { name: n.userData.name, color: NPC_COLOR[n.userData.name] };
  for (const l of DIALOG[n.userData.name] || ['안녕!']) await talk(who, l);
}

// ---------- 메뉴 · 교사용 ----------
async function openMenu() {
  const k = await panel(`<div class="eyebrow">일시 정지</div><div class="ph">메뉴</div>
    <div class="card"><b>조작</b><div class="ctrls" style="margin:10px 0 0">${controlsHTML()}</div></div>
    <div class="card"><b>교사용</b><p class="pp" style="font-size:14px">서버 연결 전 임시 메뉴예요. 나중에는 교사 화면(전자칠판)에서 모든 모둠을 한 번에 조작합니다.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn sm" data-m="unlock" ${S.mapUnlocked ? 'disabled' : ''}>🚧 공사 끝! 지도 전체 개방 (+${LIMIT_BONUS}장)</button><button class="btn sm" data-m="news">📰 진짜 세종 이야기</button><button class="btn sm" data-m="team">모둠 바꾸기</button></div></div>`,
    [['처음 화면으로', ''], [Snd.on ? '소리 끄기' : '소리 켜기', ''], ['계속하기', 'pri']],
    { onOpen: (body, close) => body.querySelectorAll('[data-m]').forEach(b => b.onclick = () => close({ unlock: 10, news: 11, team: 12 }[b.dataset.m])) });
  if (k === 0) location.reload();
  if (k === 1) Snd.toggle();
  if (k === 10) unlockMap();
  if (k === 11) showRealNews();
  if (k === 12) { $('#hud').hidden = true; $('#touch').hidden = true; S.mode = 'story'; await pickTeam(); }
}
async function unlockMap() {
  S.mapUnlocked = true; buildFence(world, null); updateHUD();
  Snd.play('door');
  await banner('공사 완료', '반곡동 전체 개방', `사진 ${LIMIT_BONUS}장 추가 · 모든 구역을 다닐 수 있어요`);
  await lines([['han', '공사가 끝났어요! 이제 <b>반곡동 어디든</b> 갈 수 있어요.'], ['han', '누비가 놓친 대상은 어느 구역에 있을까요? 찾아가서 사진을 더 모으고, <b>다시 학습</b>시켜 보세요.']]);
}
async function showRealNews() {
  await panel(`<span class="tag real">📰 진짜 세종 이야기</span><div class="ph">${REAL_NEWS.title}</div>
    <div class="card real">${REAL_NEWS.body.map(p => `<p class="pp">${p}</p>`).join('')}<p class="pp mono" style="font-size:12px;color:var(--muted)">${REAL_NEWS.source}</p></div>
    <div class="card game"><p class="pp" style="font-size:15px">게임 속 셔틀 '누비', 한결 연구원, 동네 주민들은 <b>상상으로 만든 인물</b>이에요. 위 내용만 실제 사실이에요.</p></div>`, [['닫기', 'pri']]);
}
function controlsHTML() {
  return `<kbd>왼쪽 스틱 · WASD</kbd><span>이동</span><kbd>화면 끌기</kbd><span>둘러보기</span><kbd>📷 찍기 · Space</kbd><span>조준한 대상 촬영</span><kbd>Q</kbd><span>데이터 앨범</span><kbd>T</kbd><span>주민과 이야기</span><kbd>Esc</kbd><span>메뉴</span>`;
}

// ---------- 타이틀 · 스토리 ----------
let flyT = 0;
async function showTitle() {
  S.mode = 'title';
  const scr = $('#screen'); scr.hidden = false;
  scr.innerHTML = `<div>
    <div class="logo">반곡 AI<br>버스 훈련소</div><div class="logo-sub">BANGOK · SHUTTLE VISION LAB</div>
    <p class="tagline">자율주행 셔틀 '누비'는 아직 아무것도 볼 줄 몰라요.<br>반곡동을 누비며 데이터를 모으고, 누비의 눈을 만들어 주세요.</p>
    <div class="notice"><p><span class="tag game">🎮 게임</span> 지도는 <b>진짜 반곡동</b>(OpenStreetMap)을 본떠 만들었어요.</p><p>셔틀 누비, 등장인물, 이야기는 <b>모두 상상</b>이에요. <span class="tag real">📰 진짜 자료</span> 표시만 실제 사실이에요.</p></div>
    <div class="menu"><button class="btn pri" id="tNew">탐험 시작하기</button><button class="linkbtn" id="tTeach">교사용 · 📰 진짜 세종 이야기</button></div>
    <div class="ctrls">${controlsHTML()}</div></div>`;
  await fadeTo(0, 1200);
  $('#tTeach').onclick = () => { Snd.init(); scr.hidden = true; showRealNews().then(() => { scr.hidden = false; }); };
  await new Promise(r => $('#tNew').onclick = r);
  Snd.init(); Snd.play('blip');
  scr.hidden = true; S.mode = 'story';
  await lines([
    ['sys', '2026년 가을, 세종시 반곡동. (🎮 게임 속 이야기)'],
    ['han', '반곡초등학교 6학년 탐험대 여러분, 반가워요! 자율주행 연구소의 <b>한결 연구원</b>이에요.'],
    ['han', '곧 반곡동 BRT 도로에 자율주행 셔틀 <b>누비</b>가 달릴 예정이에요. 그런데 문제가 생겼어요.'],
    ['nubi', '삐빅… 앞에 무엇이 있는지 모르겠어요. 저는 아직 <b>아무것도 볼 줄 몰라요</b>…'],
    ['han', '인공지능은 <b>데이터</b>로 배워요. 여러분이 동네 사람과 탈것을 찍고 이름표를 붙여 주면, 누비가 그걸 보고 배울 수 있어요.'],
    ['han', '순서를 기억해요. <b>① 데이터 모으기 → ② 이름표 붙이기 → ③ 학습시키기 → ④ 시험 운행</b>'],
  ]);
  await pickTeam();
}
async function pickTeam() {
  const k = await panel(`<div class="eyebrow">탐험대 편성</div><div class="ph">우리 모둠을 골라요</div>
    <p class="pp">모둠마다 먼저 조사할 구역이 달라요.</p>
    <div class="teams">${ZONES.map(z => `<button data-t="${z.id}" style="--c:${z.color}"><b>${z.id}모둠</b><span>${z.name}${z.light === 'night' ? ' · 🌙 밤' : z.light === 'rain' ? ' · 🌧️ 비' : ''}</span></button>`).join('')}</div>`,
    [], { wide: true, onOpen: (body, close) => body.querySelectorAll('[data-t]').forEach(b => b.onclick = () => close(+b.dataset.t)) });
  S.team = k; S.zone = ZONES.find(z => z.id === k);
  player.userData.shirtMat.color.set(S.zone.color);
  let best = null, bd = 1e9;
  for (let i = 0; i < 40; i++) { const sp = spotFor('adult', S.zone.rect); if (!sp) continue; const d = Math.hypot(sp.x - S.zone.spawn[0], sp.z - S.zone.spawn[1]); if (d < bd) { bd = d; best = sp; } }
  player.position.set(best ? best.x : S.zone.spawn[0], 0, best ? best.z : S.zone.spawn[1]);
  buildFence(world, S.mapUnlocked ? null : S.zone); setUILayer(world.fences);
  applyLight(scene, world, S.zone.light); S.curLight = S.zone.light;
  await fadeTo(1, 400);
  S.mode = 'explore'; placeCamera(true);
  $('#hud').hidden = false; $('#touch').hidden = false; updateHUD();
  await fadeTo(0, 600);
  await banner(`${k}모둠 · 1단계 데이터 모으기`, S.zone.name, '지금은 주변이 공사 중이라 이 구역 안에서만 다닐 수 있어요');
  await lines([
    ['han', `${k}모둠의 구역은 <b>${S.zone.name}</b>이에요. 길에서 만나는 사람과 탈것에 조준하고 <b>📷 찍기</b>를 누르세요.`],
    ['han', '같은 대상도 앞·옆·뒤에서 찍으면 누비가 더 잘 배워요. 💬 표시가 있는 주민과는 이야기도 나눌 수 있어요.'],
  ]);
}

// ---------- 미니맵 ----------
const mm = $('.minimap'), mctx = mm.getContext('2d');
const [BX0, BX1, BZ0, BZ1] = MAP.bounds;
const base = Object.assign(document.createElement('canvas'), { width: Math.ceil(BX1 - BX0), height: Math.ceil(BZ1 - BZ0) });
{
  const c = base.getContext('2d');
  c.fillStyle = '#1d2b22'; c.fillRect(0, 0, base.width, base.height);
  const A = { residential: '#26334a', school: '#4a3b28', park: '#2f5a33', wood: '#284d2b', grass: '#34583a', water: '#1f5d8c', pitch: '#3a6b3a' };
  const path = p => { c.beginPath(); p.forEach(([x, z], i) => i ? c.lineTo(x - BX0, z - BZ0) : c.moveTo(x - BX0, z - BZ0)); };
  for (const a of MAP.areas) if (A[a.kind]) { c.fillStyle = A[a.kind]; path(a.p); c.closePath(); c.fill(); }
  c.lineCap = c.lineJoin = 'round';
  for (const r of MAP.rivers) { c.strokeStyle = '#2f7fbf'; c.lineWidth = r.w; path(r.p); c.stroke(); }
  for (const r of MAP.roads) { c.strokeStyle = r.kind === 'busway' ? '#ff6a3d' : r.w >= 5 ? '#6f7f96' : '#46566b'; c.lineWidth = Math.max(2, r.w); path(r.p); c.stroke(); }
  c.fillStyle = '#9aa9bd'; for (const b of MAP.buildings) { path(b.p); c.closePath(); c.fill(); }
}
function drawMinimap() {
  const W = 336, view = 420, s = W / view, px = player.position.x, pz = player.position.z;
  mctx.fillStyle = '#0a1020'; mctx.fillRect(0, 0, W, W);
  mctx.drawImage(base, px - BX0 - view / 2, pz - BZ0 - view / 2, view, view, 0, 0, W, W);
  const tx = x => (x - px) * s + W / 2, tz = z => (z - pz) * s + W / 2;
  for (const z of ZONES) {
    const mine = S.zone && z.id === S.zone.id; if (!S.mapUnlocked && !mine) continue;
    const [x0, x1, z0, z1] = z.rect; mctx.strokeStyle = z.color; mctx.lineWidth = mine ? 5 : 2; mctx.setLineDash(mine ? [] : [8, 6]);
    mctx.strokeRect(tx(x0), tz(z0), (x1 - x0) * s, (z1 - z0) * s);
  }
  mctx.setLineDash([]);
  mctx.save(); mctx.translate(W / 2, W / 2); mctx.rotate(-input.yaw + Math.PI);
  mctx.fillStyle = '#ff6a3d'; mctx.beginPath(); mctx.moveTo(0, -14); mctx.lineTo(10, 10); mctx.lineTo(0, 5); mctx.lineTo(-10, 10); mctx.closePath(); mctx.fill();
  mctx.restore();
}

// ---------- 카메라 ----------
function placeCamera(snap) {
  const f = new THREE.Vector3(Math.sin(input.yaw), 0, Math.cos(input.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
  const want = player.position.clone().addScaledVector(f, -6.5).addScaledVector(r, -1.3).add(new THREE.Vector3(0, 2.9 + input.pitch * 3, 0));
  if (snap) camera.position.copy(want); else camera.position.lerp(want, 0.18);
  camera.lookAt(player.position.clone().addScaledVector(f, 12).addScaledVector(r, -1.3).add(new THREE.Vector3(0, 1.5 - input.pitch * 8, 0)));
}

// ---------- 루프 ----------
const clock = new THREE.Clock();
let mmTimer = 0;
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
  for (const n of npcs) {
    const u = n.userData; if (!u.wander) continue;
    const sp = u.kind === 'cyclist' || u.kind === 'scooter' ? 0.5 : 0.35;
    n.position.copy(u.home).addScaledVector(u.dir, Math.sin(t * sp + u.phase) * u.wander);
    const b = Math.atan2(u.dir.x, u.dir.z); n.rotation.y = Math.cos(t * sp + u.phase) >= 0 ? b : b + Math.PI;
  }
  if (S.mode === 'drive' && drive) updateDrive(dt);
  else if (S.mode === 'title' || S.mode === 'story' && !S.zone) {
    flyT += dt * 0.05;
    camera.position.set(-150 + Math.cos(flyT) * 260, 150, -60 + Math.sin(flyT) * 200);
    camera.lookAt(-120, 0, -40);
  } else if (S.mode === 'explore') {
    const free = !busy();
    let mx = 0, my = 0;
    if (free) {
      mx = input.jx; my = input.jy;
      if (input.keys.KeyW || input.keys.ArrowUp) my = -1; if (input.keys.KeyS || input.keys.ArrowDown) my = 1;
      if (input.keys.KeyA) mx = -1; if (input.keys.KeyD) mx = 1;
      if (input.keys.ArrowLeft) input.yaw += dt * 2; if (input.keys.ArrowRight) input.yaw -= dt * 2;
    }
    const f = new THREE.Vector3(Math.sin(input.yaw), 0, Math.cos(input.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
    const mv = f.multiplyScalar(-my).add(r.multiplyScalar(mx));
    if (mv.lengthSq() > 0.01) {
      mv.clampLength(0, 1).multiplyScalar(22 * dt);
      const tryMove = (dx, dz) => {
        const nx = player.position.x + dx, nz = player.position.z + dz;
        if (blocked(world, nx, nz, 0.8)) return;
        let [x0, x1, z0, z1] = S.mapUnlocked ? [BX0 + 5, BX1 - 5, BZ0 + 5, BZ1 - 5] : S.zone.rect;
        if (!S.mapUnlocked) { x0 += 1.5; x1 -= 1.5; z0 += 1.5; z1 -= 1.5; }
        if (nx < x0 || nx > x1 || nz < z0 || nz > z1) { if (!S.mapUnlocked) toast('🚧 지금은 공사 중이라 나갈 수 없어요', 1200); return; }
        player.position.x = nx; player.position.z = nz;
      };
      tryMove(mv.x, 0); tryMove(0, mv.z);
      player.rotation.y = Math.atan2(mv.x, mv.z);
      player.position.y = Math.abs(Math.sin(t * 12)) * 0.08;
    } else player.position.y = 0;
    const zn = zoneAt(player.position.x, player.position.z), lk = zn ? zn.light : 'day';
    if (lk !== S.curLight) { applyLight(scene, world, lk); S.curLight = lk; }
    placeCamera(false);
    target = free ? findTarget() : null;
    ring.visible = !!target; if (target) ring.position.set(target.position.x, 0.14, target.position.z);
    $('#reticle').classList.toggle('lock', !!target);
    $('#btnShot').classList.toggle('ready', !!target);
    const near = free ? nearbyNamed() : null;
    const pr = $('#prompt');
    if (target || near) {
      pr.hidden = false;
      pr.innerHTML = (target ? `<b>📷</b>찍을 수 있어요 · ${Math.round(target.position.distanceTo(player.position) * 1.5)}m` : '') + (target && near ? '　' : '') + (near ? `<b>T</b>${esc(near.userData.name)}와 이야기` : '');
      pr.style.pointerEvents = near ? 'auto' : 'none';
      pr.onclick = near ? () => talkNearby() : null;
    } else pr.hidden = true;
    for (const n of npcs) if (n.userData.tag) n.userData.tag.visible = n.position.distanceTo(camera.position) > 9;
    mmTimer -= dt; if (mmTimer <= 0) { drawMinimap(); mmTimer = 0.12; }
  }
  if (world.rain.visible) updateRain(world, dt);
  renderer.render(scene, camera);
}
tick();
showTitle();

// 개발·테스트용 도우미
window.__dbg = {
  S, npcs, player, input,
  aimAt(i, dist = 7) { const n = npcs[i]; const ang = Math.random() * 6.28; player.position.set(n.position.x - Math.sin(ang) * dist, 0, n.position.z - Math.cos(ang) * dist); input.yaw = ang; input.pitch = 0.08; placeCamera(true); },
  findTarget: () => { const t = findTarget(); return t ? npcs.indexOf(t) : -1; },
  shootRaw(i) {
    const n = npcs[i], zn = zoneAt(n.position.x, n.position.z); applyLight(scene, world, zn ? zn.light : 'day');
    const from = player.position.clone().add(new THREE.Vector3((Math.random() - .5) * 0.6, 1.5 + Math.random() * 0.4, (Math.random() - .5) * 0.6));
    const c = capture(from, n.position, n.userData.aimY, n.userData.size);
    S.samples.push({ id: 'r' + S.samples.length, kind: n.userData.kind, label: n.userData.truth, zone: zn?.id, ...c });
  },
  async train() { const used = LABELS.filter(l => S.samples.some(s => s.label === l)); const c = new Classifier(used); await c.train(S.samples, { epochs: 50 }); S.clf = c; S.trainedCount = S.samples.length; updateHUD(); return c.finalAcc; },
  startDrive, unlockMap, openAlbum, openTrain, openEthics, updateHUD,
};
