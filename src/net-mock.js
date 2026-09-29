// 개발용 가짜 서버(localhost에서 ?mock=1일 때만): localStorage에 트리를 두고 탭끼리 storage 이벤트로 동기화
const KEY = 'bangok-mockdb';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
const parts = p => p.split('/').filter(Boolean);
const at = (tree, p) => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), tree);
const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
const NOW = { '.sv': 'timestamp' };
const fill = v => Array.isArray(v) ? v.map(fill) : v && typeof v === 'object' ? (v['.sv'] ? Date.now() : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))) : v;
function write(p, v) {
  const tree = load(), ks = parts(p);
  if (!ks.length) return;
  let o = tree;
  for (const k of ks.slice(0, -1)) { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; }
  const last = ks[ks.length - 1];
  if (v == null) delete o[last]; else o[last] = fill(v);
  localStorage.setItem(KEY, JSON.stringify(tree));
  check();
}
const subs = new Set();
function check() { const tree = load(); subs.forEach(s => s(tree)); }
addEventListener('storage', e => { if (e.key === KEY) check(); });

export async function connectMock() {
  let uid = sessionStorage.getItem('mock-uid');
  if (!uid) { uid = 'u' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('mock-uid', uid); }
  const onUnload = [];
  addEventListener('pagehide', () => onUnload.forEach(p => write(p, null)));
  return {
    uid,
    get: async p => clone(at(load(), p)),
    set: async (p, v) => write(p, v),
    update: async (p, obj) => { for (const [k, v] of Object.entries(obj)) write(`${p}/${k}`, v); },
    remove: async p => write(p, null),
    on: (p, ev, cb) => {
      let prev = ev === 'value' ? undefined : {};
      const run = tree => {
        const cur = clone(at(tree, p));
        if (ev === 'value') { const s = JSON.stringify(cur); if (s !== prev) { prev = s; cb(cur, parts(p).pop()); } return; }
        const now = cur && typeof cur === 'object' ? cur : {};
        for (const [k, v] of Object.entries(now)) {
          if (!(k in prev)) { if (ev === 'child_added') cb(v, k); }
          else if (JSON.stringify(prev[k]) !== JSON.stringify(v) && ev === 'child_changed') cb(v, k);
        }
        if (ev === 'child_removed') for (const k of Object.keys(prev)) if (!(k in now)) cb(prev[k], k);
        prev = now;
      };
      subs.add(run); setTimeout(() => run(load()));
      return () => subs.delete(run);
    },
    removeOnDisconnect: p => { if (!onUnload.includes(p)) onUnload.push(p); },
    connected: cb => { setTimeout(() => cb(true)); return () => { }; },
    now: () => NOW,
  };
}
