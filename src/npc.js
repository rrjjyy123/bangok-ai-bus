// NPC 모델 — 기본 도형 조합(외부 에셋 없음)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 여러 도형을 한 덩어리 메시로 합치기(태블릿 성능용). 스프라이트는 그대로 둔다.
const bakedMat = new THREE.MeshLambertMaterial({ vertexColors: true });
export function bake(group, material = bakedMat) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const geos = [], rm = [];
  group.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const c = o.material.color, n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    geos.push(g); rm.push(o);
  });
  rm.forEach(o => o.parent.remove(o));
  if (!geos.length) return group;
  const merged = new THREE.Mesh(mergeGeometries(geos), material);
  geos.forEach(g => g.dispose());
  group.add(merged);
  return group;
}

export const TRUTH = {
  adult: '사람', child: '사람', worker: '사람', elder: '사람', wheelchair: '사람', stroller: '사람',
  umbrella: '사람', dogwalker: '사람', cyclist: '자전거', scooter: '킥보드', car: '자동차',
};
export const KIND_NAME = {
  adult: '어른', child: '어린이', worker: '회사원', elder: '어르신', wheelchair: '휠체어 사용자', stroller: '유모차 미는 사람',
  umbrella: '우산 쓴 사람', dogwalker: '강아지 산책하는 사람', cyclist: '자전거', scooter: '킥보드', car: '자동차',
};

const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}
const geo = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 14, 10),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  cone: new THREE.ConeGeometry(0.5, 1, 14),
  torus: new THREE.TorusGeometry(0.5, 0.07, 6, 18),
};
function part(g, color, sx, sy, sz, x, y, z, parent) {
  const m = new THREE.Mesh(geo[g], mat(color));
  m.scale.set(sx, sy, sz); m.position.set(x, y, z);
  m.castShadow = false;
  parent.add(m);
  return m;
}

let seed = 12345;
function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
const SKIN = [0xf1c27d, 0xe0ac69, 0xffdbac, 0xc68642, 0x8d5524];
const SHIRT = [0xe63946, 0x457b9d, 0x2a9d8f, 0xf4a261, 0x8338ec, 0xffb703, 0x3a86ff, 0xfb5607, 0x6a994e];
const PANTS = [0x264653, 0x3d405b, 0x6c584c, 0x1d3557, 0x495057];
const HAIR = [0x2b2118, 0x3b2a1a, 0x111111, 0x6f4e37, 0xcfcfcf];

// 서 있는 사람. h: 키 배율
function person(g, { h = 1, shirt, pants, skin, hair, pose = 'stand' } = {}) {
  shirt ??= pick(SHIRT); pants ??= pick(PANTS); skin ??= pick(SKIN); hair ??= pick(HAIR);
  const legY = 0.45 * h;
  if (pose === 'stand') {
    part('box', pants, 0.18 * h, 0.9 * h, 0.2 * h, -0.12 * h, legY, 0, g);
    part('box', pants, 0.18 * h, 0.9 * h, 0.2 * h, 0.12 * h, legY, 0, g);
  }
  part('box', shirt, 0.52 * h, 0.62 * h, 0.3 * h, 0, 1.2 * h, 0, g);            // 몸통
  part('box', shirt, 0.14 * h, 0.58 * h, 0.16 * h, -0.34 * h, 1.18 * h, 0, g);  // 팔
  part('box', shirt, 0.14 * h, 0.58 * h, 0.16 * h, 0.34 * h, 1.18 * h, 0, g);
  part('sphere', skin, 0.36 * h, 0.4 * h, 0.36 * h, 0, 1.72 * h, 0, g);           // 머리
  part('sphere', hair, 0.38 * h, 0.22 * h, 0.38 * h, 0, 1.84 * h, -0.02 * h, g);
  return g;
}

function wheel(g, r, x, y, z, color = 0x222222) {
  const w = new THREE.Mesh(geo.torus, mat(color));
  w.scale.set(r * 2, r * 2, r * 2); w.position.set(x, y, z); w.rotation.y = Math.PI / 2;
  g.add(w); return w;
}

export function makeNPC(kind) {
  const g = new THREE.Group();
  g.userData.kind = kind;
  g.userData.truth = TRUTH[kind];
  switch (kind) {
    case 'adult': person(g); break;
    case 'child': {
      person(g, { h: 0.62 });
      part('box', pick([0xffd166, 0xef476f, 0x06d6a0, 0x118ab2]), 0.36, 0.4, 0.18, 0, 0.78, -0.22, g); // 책가방
      break;
    }
    case 'worker': {
      person(g, { shirt: pick([0x22223b, 0x2b2d42, 0x3d405b]), pants: 0x1b1b2f });
      part('box', 0x5a3e2b, 0.4, 0.3, 0.1, 0.45, 0.75, 0, g); // 서류가방
      break;
    }
    case 'elder': {
      const p = person(new THREE.Group(), { hair: 0xdedede, shirt: pick([0x9c6644, 0x7f5539, 0x6d6875]) });
      p.rotation.x = 0.18; g.add(p);
      part('cyl', 0x5c4033, 0.05, 1.0, 0.05, 0.45, 0.5, 0.25, g); // 지팡이
      break;
    }
    case 'wheelchair': {
      // 앉은 사람 + 큰 바퀴 2 + 작은 앞바퀴
      const seat = 0.55;
      const shirt = pick(SHIRT), skin = pick(SKIN);
      part('box', 0x333333, 0.62, 0.08, 0.6, 0, seat, 0, g);           // 좌판
      part('box', 0x333333, 0.62, 0.6, 0.08, 0, seat + 0.32, -0.3, g); // 등받이
      wheel(g, 0.36, -0.36, 0.36, -0.05, 0x444444);
      wheel(g, 0.36, 0.36, 0.36, -0.05, 0x444444);
      wheel(g, 0.1, -0.25, 0.1, 0.38); wheel(g, 0.1, 0.25, 0.1, 0.38);
      part('box', pick(PANTS), 0.44, 0.16, 0.5, 0, seat + 0.12, 0.2, g);  // 허벅지
      part('box', pick(PANTS), 0.4, 0.45, 0.14, 0, seat - 0.15, 0.42, g); // 종아리
      part('box', shirt, 0.5, 0.6, 0.3, 0, seat + 0.45, -0.1, g);
      part('box', shirt, 0.13, 0.45, 0.15, -0.33, seat + 0.4, 0, g);
      part('box', shirt, 0.13, 0.45, 0.15, 0.33, seat + 0.4, 0, g);
      part('sphere', skin, 0.34, 0.38, 0.34, 0, seat + 0.95, -0.08, g);
      part('sphere', 0xdedede, 0.36, 0.2, 0.36, 0, seat + 1.07, -0.1, g);
      break;
    }
    case 'stroller': {
      person(g);
      const s = new THREE.Group(); s.position.set(0, 0, 0.9); g.add(s);
      const c = pick([0x3a86ff, 0xff006e, 0x8ecae6, 0x6a994e]);
      part('box', c, 0.55, 0.4, 0.75, 0, 0.6, 0, s);
      part('sphere', c, 0.6, 0.5, 0.7, 0, 0.85, -0.15, s); // 차양
      wheel(s, 0.12, -0.25, 0.12, 0.3); wheel(s, 0.12, 0.25, 0.12, 0.3);
      wheel(s, 0.12, -0.25, 0.12, -0.3); wheel(s, 0.12, 0.25, 0.12, -0.3);
      part('cyl', 0x555555, 0.04, 0.5, 0.04, 0, 1.0, -0.45, s).rotation.x = 0.6;
      break;
    }
    case 'umbrella': {
      person(g, { shirt: pick([0x6c757d, 0x495057, 0x1d3557, 0xe9c46a]) });
      part('cyl', 0x333333, 0.04, 1.2, 0.04, 0.2, 1.7, 0.1, g);
      part('cone', pick([0xe63946, 0xffb703, 0x3a86ff, 0x2a9d8f, 0x222222]), 1.5, 0.45, 1.5, 0.2, 2.4, 0.1, g);
      break;
    }
    case 'dogwalker': {
      person(g);
      const d = new THREE.Group(); d.position.set(0.8, 0, 0.6); g.add(d);
      const dc = pick([0xf4e1c1, 0x8b5a2b, 0x222222, 0xffffff]);
      part('box', dc, 0.25, 0.25, 0.6, 0, 0.35, 0, d);
      part('box', dc, 0.22, 0.22, 0.25, 0, 0.5, 0.35, d);
      for (const [x, z] of [[-0.08, 0.2], [0.08, 0.2], [-0.08, -0.2], [0.08, -0.2]]) part('box', dc, 0.07, 0.25, 0.07, x, 0.12, z, d);
      break;
    }
    case 'cyclist': {
      const fc = pick([0xe63946, 0x1d3557, 0x2a9d8f, 0xffb703]);
      wheel(g, 0.36, 0, 0.36, 0.6); wheel(g, 0.36, 0, 0.36, -0.6);
      part('box', fc, 0.06, 0.06, 1.2, 0, 0.7, 0, g).rotation.x = 0.1;
      part('box', fc, 0.06, 0.6, 0.06, 0, 0.55, -0.25, g);
      part('box', fc, 0.06, 0.55, 0.06, 0, 0.62, 0.5, g);
      part('box', 0x222222, 0.5, 0.05, 0.05, 0, 0.95, 0.5, g); // 핸들
      const p = person(new THREE.Group(), { pose: 'sit' }); p.position.set(0, -0.15, -0.1); p.rotation.x = 0.25; g.add(p);
      part('box', pick(PANTS), 0.16, 0.6, 0.18, -0.12, 0.55, -0.05, g);
      part('box', pick(PANTS), 0.16, 0.6, 0.18, 0.12, 0.55, 0.05, g);
      break;
    }
    case 'scooter': {
      const c = pick([0x00b4d8, 0xff006e, 0x80ed99, 0xffd60a]);
      part('box', c, 0.2, 0.06, 0.8, 0, 0.12, 0, g);
      part('cyl', 0x555555, 0.05, 1.0, 0.05, 0, 0.62, 0.38, g);
      part('box', 0x222222, 0.45, 0.05, 0.05, 0, 1.1, 0.38, g);
      wheel(g, 0.09, 0, 0.09, 0.38); wheel(g, 0.09, 0, 0.09, -0.36);
      const p = person(new THREE.Group(), { h: 0.85 }); p.position.set(0, 0.15, -0.05); g.add(p);
      break;
    }
    case 'car': {
      const c = pick([0xffffff, 0x222222, 0xc0c0c0, 0xd62828, 0x1d3557, 0x2a9d8f]);
      part('box', c, 1.8, 0.7, 4.0, 0, 0.65, 0, g);
      part('box', c, 1.6, 0.6, 2.0, 0, 1.25, -0.2, g);
      part('box', 0x8ecae6, 1.62, 0.45, 1.6, 0, 1.28, -0.2, g);
      for (const [x, z] of [[-0.9, 1.3], [0.9, 1.3], [-0.9, -1.3], [0.9, -1.3]]) wheel(g, 0.34, x, 0.34, z);
      part('box', 0xfff3b0, 0.4, 0.15, 0.05, -0.6, 0.75, 2.0, g);
      part('box', 0xfff3b0, 0.4, 0.15, 0.05, 0.6, 0.75, 2.0, g);
      break;
    }
  }
  // 촬영 조준점 높이
  g.userData.aimY = { child: 0.7, car: 0.9, wheelchair: 0.8, scooter: 0.8, cyclist: 0.9 }[kind] ?? 1.1;
  g.userData.size = kind === 'car' ? 4.2 : kind === 'child' ? 1.3 : 2.2;
  return bake(g);
}

// 게임 캐릭터(탐험대원)
export function makeExplorer(teamColor) {
  const g = new THREE.Group();
  person(g, { h: 0.7, shirt: 0xfefefd, pants: 0x264653 });
  part('box', 0x222222, 0.2, 0.14, 0.1, 0.18, 0.95, 0.2, g); // 카메라
  const shirtMat = new THREE.MeshLambertMaterial({ color: teamColor });
  g.traverse(o => { if (o.isMesh && o.material === mat(0xfefefd)) o.material = shirtMat; });
  g.userData.shirtMat = shirtMat;
  return g;
}

// 셔틀 '누비'
export function makeShuttle() {
  const g = new THREE.Group();
  part('box', 0xf8f9fa, 2.6, 2.4, 6.0, 0, 1.6, 0, g);
  part('box', 0x48cae4, 2.62, 0.9, 5.2, 0, 2.1, 0.1, g);
  part('box', 0x0077b6, 2.64, 0.3, 6.02, 0, 0.6, 0, g);
  part('box', 0x48cae4, 2.2, 1.2, 0.05, 0, 2.0, 3.01, g);
  // 눈(카메라)
  const eyeL = part('sphere', 0x111111, 0.35, 0.35, 0.2, -0.6, 2.2, 3.05, g);
  const eyeR = part('sphere', 0x111111, 0.35, 0.35, 0.2, 0.6, 2.2, 3.05, g);
  g.userData.eyes = [eyeL, eyeR];
  for (const [x, z] of [[-1.3, 2], [1.3, 2], [-1.3, -2], [1.3, -2]]) wheel(g, 0.45, x, 0.45, z);
  return g;
}
