// 실시간 협업(Firebase Realtime Database + 익명 로그인)
// 연결에 실패하면 예외를 던지고, 게임은 '혼자 하기' 모드로 계속된다.
import { firebaseConfig } from './firebase-config.js';

const CDN = 'https://www.gstatic.com/firebasejs/12.10.0/';
let conn = null;

const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

export async function connect() {
  if (conn) return conn;
  if (location.hostname === 'localhost' && new URLSearchParams(location.search).has('mock')) return (conn = await (await import('./net-mock.js')).connectMock());
  const [{ initializeApp }, A, D] = await withTimeout(Promise.all([
    import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-database.js'),
  ]), 10000, '서버 파일을 받지 못했어요');
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const cred = await withTimeout(A.signInAnonymously(auth), 10000, '서버에 접속하지 못했어요');
  const db = D.getDatabase(app);
  const R = p => D.ref(db, p);
  conn = {
    uid: cred.user.uid,
    get: async p => (await withTimeout(D.get(R(p)), 10000, '서버 응답이 없어요')).val(),
    set: (p, v) => D.set(R(p), v),
    update: (p, v) => D.update(R(p), v),
    remove: p => D.remove(R(p)),
    // 이벤트 구독: 'value' | 'child_added' | 'child_changed' | 'child_removed'. 구독 해제 함수를 돌려준다
    on: (p, ev, cb) => {
      const fn = { value: D.onValue, child_added: D.onChildAdded, child_changed: D.onChildChanged, child_removed: D.onChildRemoved }[ev];
      return fn(R(p), snap => cb(snap.val(), snap.key));
    },
    removeOnDisconnect: p => D.onDisconnect(R(p)).remove(),
    connected: cb => D.onValue(R('.info/connected'), s => cb(!!s.val())),
    now: () => D.serverTimestamp(),
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
