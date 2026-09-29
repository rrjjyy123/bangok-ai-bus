// 실시간 협업(Cloud Firestore + 익명 로그인)
// 게임 코드는 'rooms/{코드}/…' 경로로 읽고 쓰고, 여기서 Firestore 문서 구조로 바꿔 준다.
//   rooms/{c}                 ← meta(선생님 설정)
//   rooms/{c}/devices/{uid}   ← 접속 기기(30초마다 ts 갱신, 90초 넘으면 끊긴 것으로 봄)
//   rooms/{c}/samples/{id}    ← 사진(team 필드로 모둠 구분)
//   rooms/{c}/dev/{t}_{uid}   ← 기기별 학습·시험 기록
//   rooms/{c}/ethics/{uid} · rooms/{c}/poll/{uid}
// 연결에 실패하면 예외를 던지고, 게임은 '혼자 하기' 모드로 계속된다.
import { firebaseConfig } from './firebase-config.js';

const CDN = 'https://www.gstatic.com/firebasejs/12.10.0/';
export const FRESH_MS = 90000;
let conn = null;

const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

export async function connect() {
  if (conn) return conn;
  if (location.hostname === 'localhost' && new URLSearchParams(location.search).has('mock')) return (conn = await (await import('./net-mock.js')).connectMock());
  const [{ initializeApp }, A, F] = await withTimeout(Promise.all([
    import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-firestore.js'),
  ]), 10000, '서버 파일을 받지 못했어요');
  const app = initializeApp(firebaseConfig);
  const cred = await withTimeout(A.signInAnonymously(A.getAuth(app)), 10000, '서버에 접속하지 못했어요');
  const db = F.getFirestore(app);
  const uid = cred.user.uid;

  const split = p => { const [r, c, ...rest] = p.split('/').filter(Boolean); if (r !== 'rooms' || !c) throw new Error('bad path ' + p); return [c, rest]; };
  const room = c => F.doc(db, 'rooms', c);
  const col = (c, name) => F.collection(db, 'rooms', c, name);
  const docOf = (c, name, id) => F.doc(db, 'rooms', c, name, id);
  const map = qs => { const o = {}; qs.forEach(d => o[d.id] = d.data()); return o; };
  const byTeam = qs => { const o = {}; qs.forEach(d => { const v = d.data(); (o[v.team] ||= {})[d.id] = v; }); return o; };
  const teams = qs => { const o = {}; qs.forEach(d => { const v = d.data(); ((o[v.team] ||= { dev: {} }).dev)[v.uid] = v; }); return o; };
  const polls = qs => { const o = {}; qs.forEach(d => o[d.id] = d.data().v); return o; };
  const bad = p => { throw new Error('지원하지 않는 경로: ' + p); };

  // 같은 대상을 여러 곳에서 구독해도 Firestore 구독은 하나만(읽기 횟수 절약)
  const shared = new Map();
  function subscribe(key, make, deliver) {
    let s = shared.get(key);
    if (!s) {
      s = { fns: new Set(), last: null };
      s.unsub = make(snap => { s.last = snap; s.fns.forEach(fn => fn(snap, false)); });
      shared.set(key, s);
    } else if (s.last) setTimeout(() => s.last && deliver(s.last, true));
    s.fns.add(deliver);
    return () => { s.fns.delete(deliver); if (!s.fns.size) { s.unsub(); shared.delete(key); } };
  }

  conn = {
    uid,
    async get(p) {
      const [c, r] = split(p), run = q => withTimeout(q, 10000, '서버 응답이 없어요');
      if (r[0] === 'meta' && r.length === 1) { const s = await run(F.getDoc(room(c))); return s.exists() ? s.data() : null; }
      if (r[0] === 'devices' && r.length === 1) return map(await run(F.getDocs(col(c, 'devices'))));
      if (r[0] === 'samples' && r.length === 1) return byTeam(await run(F.getDocs(col(c, 'samples'))));
      if (r[0] === 'poll' && r.length === 2) { const s = await run(F.getDoc(docOf(c, 'poll', r[1]))); return s.exists() ? s.data().v : null; }
      bad(p);
    },
    async set(p, v) {
      const [c, r] = split(p);
      if (r[0] === 'meta') return F.setDoc(room(c), v);
      if (r[0] === 'devices' && r.length === 2) return F.setDoc(docOf(c, 'devices', r[1]), v);
      if (r[0] === 'samples' && r.length === 3) return F.setDoc(docOf(c, 'samples', r[2]), { ...v, team: +r[1] });
      if (r[0] === 'ethics' && r.length === 2) return F.setDoc(docOf(c, 'ethics', r[1]), v);
      if (r[0] === 'poll' && r.length === 2) return F.setDoc(docOf(c, 'poll', r[1]), { v });
      bad(p);
    },
    async update(p, v) {
      const [c, r] = split(p);
      if (r[0] === 'meta') return F.updateDoc(room(c), v);
      if (r[0] === 'samples' && r.length === 3) return F.updateDoc(docOf(c, 'samples', r[2]), v);
      if (r[0] === 'teams' && r[2] === 'dev' && r.length === 4) return F.setDoc(docOf(c, 'dev', `${r[1]}_${r[3]}`), { ...v, team: +r[1], uid: r[3] }, { merge: true });
      bad(p);
    },
    async remove(p) {
      const [c, r] = split(p);
      if (!r.length) { // 방 전체 정리(선생님): 먼저 '닫는 중' 표시 → 학생 기기가 앨범을 챙겨 혼자 하기로 바뀜 → 하위 문서 → 방 문서
        await F.updateDoc(room(c), { closing: true }).catch(() => { });
        await new Promise(res => setTimeout(res, 2500));
        for (const name of ['samples', 'devices', 'dev', 'ethics', 'poll']) {
          const qs = await F.getDocs(col(c, name));
          for (let i = 0; i < qs.docs.length; i += 400) {
            const b = F.writeBatch(db); qs.docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit();
          }
        }
        return F.deleteDoc(room(c));
      }
      if (r[0] === 'samples' && r.length === 3) return F.deleteDoc(docOf(c, 'samples', r[2]));
      if (r[0] === 'devices' && r.length === 2) return F.deleteDoc(docOf(c, 'devices', r[1]));
      bad(p);
    },
    // 이벤트 구독: 'value' | 'child_added' | 'child_changed' | 'child_removed'. 구독 해제 함수를 돌려준다
    on(p, ev, cb) {
      const [c, r] = split(p);
      if (r[0] === 'meta' && ev === 'value') return subscribe(p, fn => F.onSnapshot(room(c), fn), s => cb(s.exists() ? s.data() : null, 'meta'));
      if (r[0] === 'samples' && r.length === 2) {
        const type = { child_added: 'added', child_changed: 'modified', child_removed: 'removed' }[ev];
        // 늦게 붙은 구독자는 지금 있는 사진을 모두 '추가'로 받는다
        return subscribe(p, fn => F.onSnapshot(F.query(col(c, 'samples'), F.where('team', '==', +r[1])), fn), (qs, replay) => {
          if (replay) { if (type === 'added') qs.forEach(d => cb(d.data(), d.id)); return; }
          qs.docChanges().forEach(ch => { if (ch.type === type) cb(ch.doc.data(), ch.doc.id); });
        });
      }
      const whole = { devices: map, teams: teams, ethics: map, poll: polls }[r[0]];
      if (whole && r.length === 1 && ev === 'value') return subscribe(p, fn => F.onSnapshot(col(c, r[0] === 'teams' ? 'dev' : r[0]), fn), qs => cb(whole(qs), r[0]));
      bad(p + ' ' + ev);
    },
    // Firestore에는 '연결이 끊기면 지우기'가 없어서, 30초마다 ts를 새로 쓰고(끊기면 멈춤) 창을 닫을 때 지운다
    removeOnDisconnect(p) {
      const [c, r] = split(p); if (r[0] !== 'devices') return;
      const ref = docOf(c, 'devices', r[1]);
      clearInterval(conn._beat); let fails = 0;
      conn._beat = setInterval(() => F.setDoc(ref, { ts: Date.now() }, { merge: true }).then(() => fails = 0).catch(() => { if (++fails >= 3) clearInterval(conn._beat); }), 30000);
      if (!conn._hide) { conn._hide = true; addEventListener('pagehide', () => F.deleteDoc(ref).catch(() => { })); }
    },
    connected(cb) {
      const f = () => cb(navigator.onLine);
      addEventListener('online', f); addEventListener('offline', f); setTimeout(f);
      return () => { removeEventListener('online', f); removeEventListener('offline', f); };
    },
    now: () => Date.now(),
  };
  return conn;
}

// 특징값(Float32Array) ↔ 짧은 문자열(0~255로 줄인 뒤 base64). 서버 용량을 아끼려고 쓴다
export function packFeat(f) {
  let mx = 1e-6; for (const v of f) if (v > mx) mx = v;
  const q = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) q[i] = Math.max(0, Math.min(255, Math.round(f[i] / mx * 255)));
  let s = ''; for (const b of q) s += String.fromCharCode(b);
  return mx.toFixed(5) + ':' + btoa(s);
}
export function unpackFeat(str) {
  const [m, b] = str.split(':'), mx = +m, s = atob(b), f = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) f[i] = s.charCodeAt(i) / 255 * mx;
  return f;
}
