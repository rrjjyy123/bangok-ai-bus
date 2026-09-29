// 반곡동 3D 월드 — OpenStreetMap 데이터(data/bangok.json)로 생성
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ZONES, LIGHTS } from './config.js';
import { bake } from './npc.js';

export function textSprite(text, { size = 48, color = '#1b263b', bg = 'rgba(255,255,255,0.92)', scale = 0.05 } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `bold ${size}px "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + size;
  c.width = w; c.height = size * 1.6;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(0, 0, c.width, c.height, size * 0.4); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(c.width * scale, c.height * scale, 1);
  return s;
}

// ---- 기하 도우미 ----
export function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distSeg(x, z, [ax, az], [bx, bz]) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}
function bbox(p) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return [x0, x1, z0, z1];
}
function colorize(g, color) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3), c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function keepPNC(g) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; }

// 다각형(바닥 면) → 평면 지오메트리
function flatPoly(p, y, color) {
  const shape = new THREE.Shape(p.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  return keepPNC(colorize(g, color));
}
// 폴리라인 → 띠(도로)
function ribbon(p, w, y, color) {
  const pos = [];
  const hw = w / 2;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i], [bx, bz] = p[i + 1];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L * hw, nz = dx / L * hw;
    pos.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz,
             ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz);
  }
  // 이음새 원
  const seg = 10;
  for (const [cx, cz] of p) for (let k = 0; k < seg; k++) {
    const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
    pos.push(cx, y, cz, cx + Math.cos(a1) * hw, y, cz + Math.sin(a1) * hw, cx + Math.cos(a0) * hw, y, cz + Math.sin(a0) * hw);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length); for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return colorize(g, color);
}

const AREA_STYLE = {
  residential: [0xe7e3da, 0.02], school: [0xf3dfb8, 0.03], park: [0x9ccc65, 0.035], wood: [0x6b9b3a, 0.035], grass: [0xaed581, 0.035],
  pitch: [0x7cb342, 0.045], playground: [0xdce775, 0.045], parking: [0xbdbdbd, 0.045], water: [0x4fa3e0, 0.05], construction: [0xcdbfb3, 0.025], office: [0xd5dbe3, 0.025],
};
const ROAD_STYLE = {
  secondary: [0x4a4e57, 0.10], tertiary: [0x4a4e57, 0.10], residential: [0x5b5f68, 0.09], living_street: [0x8d8f96, 0.09], service: [0x6b6e75, 0.085],
  busway: [0xa3483a, 0.12], pedestrian: [0xd9cbb3, 0.07], footway: [0xe8dcc6, 0.07], path: [0xcbb994, 0.07], steps: [0xbfb3a0, 0.07], cycleway: [0xd98c7a, 0.075],
};
const BLD_COLOR = { apartments: [0xf4f0e8, 0xe9e2d6, 0xf7efe2, 0xdfe6ee], school: [0xf2e2c4], office: [0xb8c4d6, 0xa9b8cc], commercial: [0xf4d6a0, 0xf2b5a0, 0xc9e4de], kindergarten: [0xffd6a5], church: [0xe0d4f5] };

export function buildWorld(scene, data) {
  const world = { data, colliders: [], fences: new THREE.Group(), rain: null, roadsFor: {} };
  const [X0, X1, Z0, Z1] = data.bounds;
  world.bounds = data.bounds;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8fbf6a, 0.9);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
  sun.position.set(200, 400, 150);
  scene.add(hemi, sun);
  world.hemi = hemi; world.sun = sun;

  // 바닥
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0 + 800, Z1 - Z0 + 800), new THREE.MeshLambertMaterial({ color: 0xb5c99a }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const vmat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  // 면(단지·공원·학교…)
  const areaGeos = [];
  for (const a of data.areas) {
    const st = AREA_STYLE[a.kind]; if (!st || a.p.length < 3) continue;
    try { areaGeos.push(flatPoly(a.p, st[1], st[0])); } catch (e) { /* 잘못된 다각형 무시 */ }
  }
  if (areaGeos.length) scene.add(new THREE.Mesh(mergeGeometries(areaGeos), vmat));

  // 도로·하천
  const roadGeos = [];
  for (const r of data.rivers) roadGeos.push(ribbon(r.p, r.w, 0.06, 0x4fa3e0));
  for (const r of data.roads) {
    const st = ROAD_STYLE[r.kind]; if (!st) continue;
    roadGeos.push(ribbon(r.p, r.w, st[1], st[0]));
    (world.roadsFor[r.kind] ??= []).push(r);
  }
  // 중앙선(큰 도로)
  for (const r of data.roads) {
    if (r.w < 9 || r.kind === 'busway') continue;
    for (let i = 0; i < r.p.length - 1; i++) {
      const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      for (let d = 2; d < L - 2; d += 9) {
        const t0 = d / L, t1 = Math.min(1, (d + 4) / L);
        roadGeos.push(ribbon([[ax + (bx - ax) * t0, az + (bz - az) * t0], [ax + (bx - ax) * t1, az + (bz - az) * t1]], 0.35, 0.13, 0xf1faee));
      }
    }
  }
  scene.add(new THREE.Mesh(mergeGeometries(roadGeos), vmat));

  // 건물(돌출)
  const bGeos = [];
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const b of data.buildings) {
    if (b.p.length < 3) continue;
    const pal = BLD_COLOR[b.type] || [0xe0d8cc, 0xd6cfc4];
    const col = new THREE.Color(pal[Math.floor(rnd() * pal.length)]);
    try {
      const shape = new THREE.Shape(b.p.map(([x, z]) => new THREE.Vector2(x, -z)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      // 옆면·지붕 색 구분(그룹 0 = 윗·아랫면, 1 = 옆면)
      const n = g.attributes.position.count, ca = new Float32Array(n * 3);
      const roof = col.clone().multiplyScalar(0.8);
      for (const gr of g.groups) for (let i = gr.start; i < gr.start + gr.count; i++) {
        const idx = g.index ? g.index.getX(i) : i;
        const c = gr.materialIndex === 0 ? roof : col;
        ca[idx * 3] = c.r; ca[idx * 3 + 1] = c.g; ca[idx * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
      bGeos.push(keepPNC(g));
      world.colliders.push({ p: b.p, bb: bbox(b.p) });
      // 아파트 층 띠
      if (b.type === 'apartments' || b.type === 'office') {
        for (let y = 4; y < b.h - 2; y += 4) {
          const sg = new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: false });
          sg.rotateX(-Math.PI / 2); sg.scale(1.004, 1, 1.004); sg.translate(0, y, 0);
          bGeos.push(keepPNC(colorize(sg, 0x9fb3c8)));
        }
      }
    } catch (e) { /* 무시 */ }
  }
  scene.add(new THREE.Mesh(mergeGeometries(bGeos), vmat));

  // 나무(공원·숲·잔디)
  const treeSpots = [];
  for (const a of data.areas) {
    if (!['park', 'wood', 'grass'].includes(a.kind)) continue;
    const [x0, x1, z0, z1] = bbox(a.p);
    const area = (x1 - x0) * (z1 - z0);
    const n = Math.min(160, Math.floor(area / (a.kind === 'wood' ? 180 : 450)));
    for (let i = 0; i < n; i++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      if (!pointInPoly(x, z, a.p)) continue;
      if (nearRoad(world, x, z, 2.5)) continue;
      treeSpots.push([x, z, 0.8 + rnd() * 0.6]);
    }
  }
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2, 6); trunkGeo.translate(0, 1, 0);
  const leafGeo = new THREE.ConeGeometry(1.6, 4, 7); leafGeo.translate(0, 3.8, 0);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x7f5539 }), treeSpots.length);
  const leaf = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x386641 }), treeSpots.length);
  const m4 = new THREE.Matrix4();
  treeSpots.forEach(([x, z, s], i) => { m4.makeScale(s, s, s).setPosition(x, 0, z); trunk.setMatrixAt(i, m4); leaf.setMatrixAt(i, m4); });
  scene.add(trunk, leaf);

  // 정류장: BRT 반곡동 정류장 쉘터 + 표지
  const shelters = new THREE.Group();
  const done = new Set();
  for (const s of data.stops) {
    const key = s.name + Math.round(s.x / 30);
    if (done.has(key)) continue; done.add(key);
    const brt = s.name === '반곡동';
    const g = new THREE.Group();
    const roof = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 2.4), new THREE.MeshLambertMaterial({ color: brt ? 0xc0392b : 0x3a506b }));
    roof.position.y = 3; g.add(roof);
    for (const px of [-3.6, 3.6]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 0.2), roof.material); p.position.set(px, 1.5, -0.8); g.add(p); }
    const bench = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 0.7), new THREE.MeshLambertMaterial({ color: 0x8d99ae }));
    bench.position.set(0, 0.5, -0.6); g.add(bench);
    g.position.set(s.x, 0, s.z);
    shelters.add(g);
    const sp = textSprite(brt ? '🚏 BRT 반곡동 정류장' : `🚏 ${s.name}`, { size: 44, bg: brt ? 'rgba(192,57,43,0.95)' : 'rgba(58,80,107,0.92)', color: '#fff', scale: 0.045 });
    sp.position.set(s.x, 6.5, s.z); scene.add(sp);
  }
  scene.add(bake(shelters));

  // 이름 표지판(단지·학교·공원·연구단지)
  const LSTYLE = { apt: ['rgba(42,157,143,0.94)', '#fff', 26], school: ['rgba(244,162,97,0.95)', '#fff', 16], park: ['rgba(106,153,78,0.94)', '#fff', 10], office: ['rgba(87,117,144,0.94)', '#fff', 22] };
  for (const l of data.labels) {
    const st = LSTYLE[l.kind] || LSTYLE.apt;
    const sp = textSprite(l.text, { size: 60, bg: st[0], color: st[1], scale: 0.07 });
    sp.position.set(l.x, st[2] + 20, l.z); scene.add(sp);
  }

  // 비(상가 구역)
  const rz = ZONES.find(z => z.light === 'rain');
  const rainN = 1500, rp = new Float32Array(rainN * 3);
  const [rx0, rx1, rz0, rz1] = rz.rect;
  for (let i = 0; i < rainN; i++) { rp[i * 3] = rx0 + Math.random() * (rx1 - rx0); rp[i * 3 + 1] = Math.random() * 30; rp[i * 3 + 2] = rz0 + Math.random() * (rz1 - rz0); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  world.rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: 0xaecbe0, size: 0.25 }));
  world.rainRect = rz.rect;
  scene.add(world.rain);

  scene.add(world.fences);
  return world;
}

export function nearRoad(world, x, z, margin = 0) {
  for (const list of Object.values(world.roadsFor)) for (const r of list) {
    if (['footway', 'path', 'steps', 'cycleway', 'pedestrian'].includes(r.kind)) continue;
    for (let i = 0; i < r.p.length - 1; i++) if (distSeg(x, z, r.p[i], r.p[i + 1]) < r.w / 2 + margin) return true;
  }
  return false;
}

export function blocked(world, x, z, r = 0.9) {
  for (const c of world.colliders) {
    const [x0, x1, z0, z1] = c.bb;
    if (x < x0 - r || x > x1 + r || z < z0 - r || z > z1 + r) continue;
    if (pointInPoly(x, z, c.p)) return true;
    for (let i = 0; i < c.p.length; i++) if (distSeg(x, z, c.p[i], c.p[(i + 1) % c.p.length]) < r) return true;
  }
  return false;
}

// 비를 특정 위치 주변으로 옮기기(시험 운행용)
export function moveRainTo(world, x, z) {
  const p = world.rain.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { p.setX(i, x - 60 + Math.random() * 120); p.setZ(i, z - 60 + Math.random() * 120); }
  p.needsUpdate = true;
}
export function resetRain(world) {
  const [x0, x1, z0, z1] = world.rainRect;
  const p = world.rain.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { p.setX(i, x0 + Math.random() * (x1 - x0)); p.setZ(i, z0 + Math.random() * (z1 - z0)); }
  p.needsUpdate = true;
}

export function updateRain(world, dt) {
  const p = world.rain.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { let y = p.getY(i) - dt * 25; if (y < 0) y += 30; p.setY(i, y); }
  p.needsUpdate = true;
}

export function applyLight(scene, world, key) {
  const L = LIGHTS[key];
  scene.background = new THREE.Color(L.sky);
  scene.fog = new THREE.Fog(L.fog, key === 'night' ? 25 : 80, key === 'night' ? 140 : 520);
  world.hemi.intensity = L.amb; world.hemi.groundColor.set(L.hemiG);
  world.sun.intensity = L.sun; world.sun.color.set(L.sunColor);
  world.rain.visible = key === 'rain';
}

export function buildFence(world, zone) {
  world.fences.clear();
  if (!zone) return;
  const [x0, x1, z0, z1] = zone.rect;
  const bars = new THREE.Group();
  const barMat = new THREE.MeshLambertMaterial({ color: 0xff8800 });
  const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const edges = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
  for (const [ax, az, bx, bz] of edges) {
    const len = Math.hypot(bx - ax, bz - az);
    for (let d = 0, k = 0; d < len; d += 4, k++) {
      const t = d / len;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const b = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(bx - ax) > 0 ? 3.6 : 0.3, 0.5, Math.abs(bz - az) > 0 ? 3.6 : 0.3), k % 2 ? barMat : whiteMat);
      b.position.set(x + (bx - ax) / len * 1.8, 1.1, z + (bz - az) / len * 1.8);
      bars.add(b);
    }
    for (let d = 20; d < len; d += 45) {
      const t = d / len;
      const sp = textSprite('🚧 공사 중', { size: 40, bg: 'rgba(255,136,0,0.95)', color: '#fff', scale: 0.04 });
      sp.position.set(ax + (bx - ax) * t, 3.2, az + (bz - az) * t);
      world.fences.add(sp);
    }
  }
  world.fences.add(bake(bars));
}
