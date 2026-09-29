// 자체 구현 이미지 분류기 — 외부 라이브러리·모델 파일 없이 동작
// 1) 특징 추출: HOG(윤곽선 방향 히스토그램) + HSV 색 히스토그램
// 2) 학습: 은닉층 1개짜리 작은 신경망(MLP) + Adam
// 3) 설명: 특징 공간에서 가장 비슷한 학습 사진 찾기(코사인 유사도)

export const IMG = 64; // 특징 추출용 이미지 한 변(px)

// rgba: Uint8(ClampedArray) 길이 IMG*IMG*4, 위쪽 행부터
export function extractFeatures(rgba, size = IMG) {
  const n = size * size;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
  }
  // --- HOG ---
  const cell = 8, cells = size / cell, bins = 9;
  const hist = new Float32Array(cells * cells * bins);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const gx = gray[y * size + x + 1] - gray[y * size + x - 1];
      const gy = gray[(y + 1) * size + x] - gray[(y - 1) * size + x];
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag < 1e-4) continue;
      let ang = Math.atan2(gy, gx) * 180 / Math.PI;
      if (ang < 0) ang += 180;
      const b = ang / 20 - 0.5;
      let b0 = Math.floor(b), w1 = b - b0;
      let b1 = b0 + 1;
      if (b0 < 0) b0 += bins;
      if (b1 >= bins) b1 -= bins;
      const cx = Math.min(cells - 1, (x / cell) | 0), cy = Math.min(cells - 1, (y / cell) | 0);
      const base = (cy * cells + cx) * bins;
      hist[base + b0] += mag * (1 - w1);
      hist[base + b1] += mag * w1;
    }
  }
  const blocks = cells - 1;
  const hog = new Float32Array(blocks * blocks * 4 * bins);
  let k = 0;
  for (let by = 0; by < blocks; by++) {
    for (let bx = 0; bx < blocks; bx++) {
      const start = k;
      let ss = 1e-6;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const base = ((by + dy) * cells + bx + dx) * bins;
        for (let t = 0; t < bins; t++) { const v = hist[base + t]; hog[k++] = v; ss += v * v; }
      }
      // L2-Hys 정규화
      let norm = Math.sqrt(ss);
      let ss2 = 1e-6;
      for (let i = start; i < k; i++) { hog[i] = Math.min(0.2, hog[i] / norm); ss2 += hog[i] * hog[i]; }
      norm = Math.sqrt(ss2);
      for (let i = start; i < k; i++) hog[i] /= norm;
    }
  }
  // --- 색(HSV) 히스토그램: 색상 12칸(채도 가중) + 밝기 4칸 + 평균 밝기·대비 ---
  const hue = new Float32Array(12), val = new Float32Array(4);
  let sumV = 0, sumV2 = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4] / 255, g = rgba[i * 4 + 1] / 255, b = rgba[i * 4 + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    const s = mx > 0 ? d / mx : 0;
    let h = 0;
    if (d > 1e-5) {
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    hue[Math.min(11, (h / 30) | 0)] += s;
    val[Math.min(3, (mx * 4) | 0)] += 1;
    sumV += mx; sumV2 += mx * mx;
  }
  const color = new Float32Array(18);
  let hs = 1e-6; for (let i = 0; i < 12; i++) hs += hue[i];
  for (let i = 0; i < 12; i++) color[i] = hue[i] / hs;
  for (let i = 0; i < 4; i++) color[12 + i] = val[i] / n;
  const meanV = sumV / n;
  color[16] = meanV;
  color[17] = Math.sqrt(Math.max(0, sumV2 / n - meanV * meanV));

  const out = new Float32Array(hog.length + color.length);
  out.set(hog, 0);
  // 색 특징은 개수가 적으므로 비중을 키워 준다
  for (let i = 0; i < color.length; i++) out[hog.length + i] = color[i] * 3;
  return out;
}

export function flipRGBA(rgba, size = IMG) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const s = (y * size + x) * 4, d = (y * size + (size - 1 - x)) * 4;
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
  }
  return out;
}

// 결정적 난수(학습 결과 재현용)
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export class Classifier {
  constructor(labels) {
    this.labels = labels; // 학습에 쓰인 라벨 목록
    this.trained = false;
  }

  // samples: [{feat: Float32Array, featFlip?: Float32Array, label: string}]
  // onEpoch(epoch, loss, acc) 콜백 — 학습 곡선 표시용
  async train(samples, { epochs = 60, hidden = 24, lr = 0.004, l2 = 1e-4, seed = 7, onEpoch } = {}) {
    const labels = this.labels;
    const X = [], Y = [];
    for (const s of samples) {
      const y = labels.indexOf(s.label);
      if (y < 0) continue;
      X.push(s.feat); Y.push(y);
      if (s.featFlip) { X.push(s.featFlip); Y.push(y); }
    }
    const D = X[0].length, H = hidden, C = labels.length, N = X.length;
    // 표준화
    const mean = new Float32Array(D), std = new Float32Array(D);
    for (const x of X) for (let j = 0; j < D; j++) mean[j] += x[j] / N;
    for (const x of X) for (let j = 0; j < D; j++) { const d = x[j] - mean[j]; std[j] += d * d / N; }
    for (let j = 0; j < D; j++) std[j] = Math.sqrt(std[j]) + 0.05;
    const Xs = X.map(x => { const z = new Float32Array(D); for (let j = 0; j < D; j++) z[j] = (x[j] - mean[j]) / std[j]; return z; });

    const rand = rng(seed);
    const gauss = () => { let u = 0, v = 0; while (u === 0) u = rand(); v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const W1 = new Float32Array(D * H), b1 = new Float32Array(H), W2 = new Float32Array(H * C), b2 = new Float32Array(C);
    for (let i = 0; i < W1.length; i++) W1[i] = gauss() * Math.sqrt(2 / D);
    for (let i = 0; i < W2.length; i++) W2[i] = gauss() * Math.sqrt(2 / H);
    const params = [W1, b1, W2, b2];
    const m = params.map(p => new Float32Array(p.length)), v = params.map(p => new Float32Array(p.length));
    const g = params.map(p => new Float32Array(p.length));
    const h = new Float32Array(H), o = new Float32Array(C), dh = new Float32Array(H);
    let t = 0;
    const b1a = 0.9, b2a = 0.999;
    let loss = 0, acc = 0;
    for (let ep = 0; ep < epochs; ep++) {
      for (const gg of g) gg.fill(0);
      loss = 0; acc = 0;
      for (let n = 0; n < N; n++) {
        const x = Xs[n], y = Y[n];
        for (let k = 0; k < H; k++) {
          let s = b1[k];
          for (let j = 0, idx = k; j < D; j++, idx += H) s += x[j] * W1[idx];
          h[k] = s > 0 ? s : 0;
        }
        let mx = -1e9;
        for (let c = 0; c < C; c++) { let s = b2[c]; for (let k = 0; k < H; k++) s += h[k] * W2[k * C + c]; o[c] = s; if (s > mx) mx = s; }
        let se = 0; for (let c = 0; c < C; c++) { o[c] = Math.exp(o[c] - mx); se += o[c]; }
        let best = 0;
        for (let c = 0; c < C; c++) { o[c] /= se; if (o[c] > o[best]) best = c; }
        if (best === y) acc++;
        loss += -Math.log(o[y] + 1e-9);
        // 역전파
        o[y] -= 1;
        for (let c = 0; c < C; c++) g[3][c] += o[c];
        dh.fill(0);
        for (let k = 0; k < H; k++) {
          if (h[k] <= 0) continue;
          for (let c = 0; c < C; c++) { g[2][k * C + c] += h[k] * o[c]; dh[k] += W2[k * C + c] * o[c]; }
        }
        for (let k = 0; k < H; k++) {
          if (h[k] <= 0) continue;
          g[1][k] += dh[k];
          const d = dh[k];
          for (let j = 0, idx = k; j < D; j++, idx += H) g[0][idx] += x[j] * d;
        }
      }
      loss /= N; acc /= N;
      // Adam 갱신
      t++;
      for (let p = 0; p < 4; p++) {
        const P = params[p], G = g[p], M = m[p], V = v[p];
        for (let i = 0; i < P.length; i++) {
          const gi = G[i] / N + l2 * P[i];
          M[i] = b1a * M[i] + (1 - b1a) * gi;
          V[i] = b2a * V[i] + (1 - b2a) * gi * gi;
          const mh = M[i] / (1 - Math.pow(b1a, t)), vh = V[i] / (1 - Math.pow(b2a, t));
          P[i] -= lr * mh / (Math.sqrt(vh) + 1e-8);
        }
      }
      if (onEpoch) { const r = onEpoch(ep, loss, acc); if (r && r.then) await r; }
    }
    Object.assign(this, { D, H, C, W1, b1, W2, b2, mean, std, trained: true, finalLoss: loss, finalAcc: acc });
    // 설명용: 학습 데이터 표준화 특징 보관(원본 사진만, 좌우반전 제외)
    this.memory = samples.filter(s => labels.includes(s.label)).map(s => ({ s, z: this.standardize(s.feat) }));
    return { loss, acc };
  }

  standardize(x) {
    const z = new Float32Array(this.D);
    for (let j = 0; j < this.D; j++) z[j] = (x[j] - this.mean[j]) / this.std[j];
    return z;
  }

  predict(feat) {
    const { D, H, C, W1, b1, W2, b2 } = this;
    const x = this.standardize(feat);
    const h = new Float32Array(H), o = new Float32Array(C);
    for (let k = 0; k < H; k++) { let s = b1[k]; for (let j = 0, idx = k; j < D; j++, idx += H) s += x[j] * W1[idx]; h[k] = s > 0 ? s : 0; }
    let mx = -1e9;
    for (let c = 0; c < C; c++) { let s = b2[c]; for (let k = 0; k < H; k++) s += h[k] * W2[k * C + c]; o[c] = s; if (s > mx) mx = s; }
    let se = 0; for (let c = 0; c < C; c++) { o[c] = Math.exp(o[c] - mx); se += o[c]; }
    const probs = {};
    let best = 0;
    for (let c = 0; c < C; c++) { o[c] /= se; probs[this.labels[c]] = o[c]; if (o[c] > o[best]) best = c; }
    return { label: this.labels[best], conf: o[best], probs };
  }

  // 가장 비슷한 학습 사진 k장
  nearest(feat, k = 3) {
    const z = this.standardize(feat);
    let zn = 0; for (let j = 0; j < z.length; j++) zn += z[j] * z[j]; zn = Math.sqrt(zn) + 1e-9;
    const scored = this.memory.map(({ s, z: m }) => {
      let dot = 0, mn = 0;
      for (let j = 0; j < z.length; j++) { dot += z[j] * m[j]; mn += m[j] * m[j]; }
      return { sample: s, sim: dot / (zn * (Math.sqrt(mn) + 1e-9)) };
    });
    scored.sort((a, b) => b.sim - a.sim);
    return scored.slice(0, k);
  }
}
