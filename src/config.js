// 게임 설정 — 지도(임시), 구역, NPC 배치, 시험 운행 코스
// ※ 지도는 실제 반곡동 OSM 데이터를 받으면 교체 예정인 "임시 배치"

export const LABELS = ['사람', '자전거', '킥보드', '자동차'];
export const EMPTY = '빈 도로';
export const LABEL_ICON = { '사람': '🚶', '자전거': '🚲', '킥보드': '🛴', '자동차': '🚗', '빈 도로': '🛣️' };

export const LIMIT_FIRST = 40;   // 1차 수집 한도
export const LIMIT_BONUS = 20;   // 지도 개방 후 추가 한도

// 시간대(조명) 프리셋
export const LIGHTS = {
  day:   { sky: 0xbfe3ff, fog: 0xcfe8ff, amb: 0.95, sun: 1.6, sunColor: 0xfff4e0, hemiG: 0x8fbf6a },
  night: { sky: 0x0b1530, fog: 0x0b1530, amb: 0.16, sun: 0.10, sunColor: 0x8fa8ff, hemiG: 0x10141f },
  rain:  { sky: 0x8a96a3, fog: 0x8e99a5, amb: 0.65, sun: 0.55, sunColor: 0xdfe6ee, hemiG: 0x5e6f5a },
};

// 구역: x0,x1,z0,z1 (월드 좌표, 1 = 1.5m, x=동쪽, z=남쪽) — 실제 반곡동 OSM 지도 기준
export const ZONES = [
  { id: 1, name: '반곡초 주변',          light: 'day',   rect: [-250, -125, -230, -30], color: '#f4a261', spawn: [-170, -45] },
  { id: 2, name: '수루배마을 4단지',     light: 'day',   rect: [-30, 170, -250, -40],   color: '#2a9d8f', spawn: [60, -50] },
  { id: 3, name: 'BRT 반곡동 정류장',   light: 'day',   rect: [-200, -60, 20, 110],    color: '#e76f51', spawn: [-110, 35] },
  { id: 4, name: '세종국책연구단지',     light: 'day',   rect: [-558, -340, 150, 320],  color: '#577590', spawn: [-420, 230] },
  { id: 5, name: '재께뜰공원 산책로',   light: 'night', rect: [-125, -30, -110, -25],  color: '#6a4c93', spawn: [-80, -35] },
  { id: 6, name: '한누리대로 상가',     light: 'rain',  rect: [-60, 100, -20, 110],    color: '#e9c46a', spawn: [-20, 30] },
];

export function zoneAt(x, z) {
  for (const zn of ZONES) { const [x0, x1, z0, z1] = zn.rect; if (x >= x0 && x < x1 && z >= z0 && z < z1) return zn; }
  return null;
}

// 구역별 등장 NPC 수(위치는 지도 도로·보행로를 따라 자동 배치)
export const ZONE_NPCS = {
  1: { child: 6, adult: 2, cyclist: 2, car: 2 },
  2: { stroller: 3, elder: 2, adult: 2, car: 3 },
  3: { wheelchair: 3, adult: 3, worker: 1, car: 2 },
  4: { worker: 5, adult: 1, car: 5 },
  5: { adult: 3, dogwalker: 3, cyclist: 3 },
  6: { umbrella: 5, scooter: 4, car: 1 },
};
// 이름 있는 NPC(게임 속 가상 인물)의 대략 위치
export const NAMED_NPCS = [
  { kind: 'child', name: '도윤', zone: 1, near: [-165, -60] },
  { kind: 'stroller', name: '유모차 아빠', zone: 2, near: [60, -70] },
  { kind: 'wheelchair', name: '정 할머니', zone: 3, near: [-120, 45] },
  { kind: 'dogwalker', name: '산책하는 주민', zone: 5, near: [-80, -50] },
  { kind: 'scooter', name: '중학생 형', zone: 6, near: [-20, 20] },
];

// 시험 운행: 경로는 지도 데이터의 BRT 전용도로(route). 12개 장면(경로 비율 t)
export const TEST_SCENES = [
  { kind: 'worker', t: 0.05, light: 'day' },
  { kind: 'car', t: 0.12, light: 'day' },
  { kind: 'adult', t: 0.20, light: 'day' },
  { kind: 'wheelchair', t: 0.30, light: 'day' },
  { kind: 'child', t: 0.38, light: 'day' },
  { kind: 'umbrella', t: 0.46, light: 'rain' },
  { kind: 'scooter', t: 0.53, light: 'rain' },
  { kind: 'dogwalker', t: 0.61, light: 'night' },
  { kind: 'cyclist', t: 0.68, light: 'night' },
  { kind: 'child', t: 0.75, light: 'night' },
  { kind: 'stroller', t: 0.85, light: 'day' },
  { kind: 'elder', t: 0.94, light: 'day' },
];

// 게임 속 인물 대사(모두 가상 인물)
export const DIALOG = {
  '도윤': ['나는 1학년 도윤이야!', '나는 키가 작아서 자동차에서 잘 안 보인대요.'],
  '유모차 아빠': ['안녕? 아기랑 산책 중이야.', '유모차는 사람일까, 탈것일까? 누비가 헷갈리지 않았으면 좋겠구나.'],
  '정 할머니': ['버스를 기다리는 중이란다.', '버스 탈 때마다 기사님이 경사판을 내려 주셨는데, 자율주행 셔틀도 나를 알아볼까?'],
  '산책하는 주민': ['밤 산책은 시원해서 좋아.', '그런데 밤에는 사람이 잘 안 보이지. 누비도 그럴까?'],
  '중학생 형': ['킥보드 타는 중!', '킥보드는 자전거랑 달라! 누비가 잘 구별했으면 좋겠다.'],
};

// 대한민국 인공지능 윤리원칙 7대 원칙(2026. 8. 21. 과학기술관계장관회의 의결, 과기정통부·KISDI). 설명은 초등 눈높이로 풀어 씀
export const ETHICS = [
  { name: '인간중심성', desc: 'AI는 사람을 돕고, 필요하면 사람이 멈추거나 바로잡을 수 있어야 해요.' },
  { name: '프라이버시 보호', desc: '사람들의 개인정보를 소중히 지켜야 해요.' },
  { name: '공정성·포용성', desc: '누구도 빠뜨리지 않고 모두를 공평하게 대해야 해요.' },
  { name: '책임성', desc: '문제가 생기면 누가 책임지고 바로잡을지 분명해야 해요.' },
  { name: '안전성', desc: '사람의 생명과 몸, 마음을 다치게 하지 않아야 해요.' },
  { name: '신뢰성', desc: 'AI가 믿을 수 있을 만큼 정확하고 꾸준해야 해요.' },
  { name: '투명성', desc: 'AI를 썼는지, 어떻게 판단했는지, 한계가 무엇인지 알려야 해요.' },
];

// 🎮 책임 투표(에필로그 토의용 가정 상황)
export const POLL = {
  q: '누비가 사고를 냈다면 누구의 책임일까요?',
  options: ['셔틀 회사', '데이터를 모은 사람', '세종시', '타고 있던 사람', '모두 함께'],
};

// 🎮 에필로그 대사(게임 속 인물)
export const EPILOGUE = [
  ['nubi', '고마워요. 이제 정 할머니도, 도윤이도 잘 보여요.'],
  ['nubi', '그래도 저는 <b>틀릴 수 있어요.</b> 그래서 사람이 함께 지켜봐 줘야 해요.'],
  ['han', '요즘은 버스 기사 대신 자율주행차를 지켜보는 <b>원격 관제사</b>, 데이터를 모으고 이름표를 붙이는 <b>데이터 라벨러</b> 같은 새로운 직업이 생기고 있어요.'],
  ['han', '다음 시간에는 인공지능이 우리 사회를 어떻게 바꾸는지 더 알아봐요. 오늘 정말 수고했어요!'],
];

// 교사 화면 '우리 반 데이터 지도'의 열(대상 종류)
export const KINDS = ['child', 'adult', 'worker', 'elder', 'wheelchair', 'stroller', 'umbrella', 'dogwalker', 'cyclist', 'scooter', 'car'];
export const KIND_SHORT = { child: '어린이', adult: '어른', worker: '회사원', elder: '어르신', wheelchair: '휠체어', stroller: '유모차', umbrella: '우산', dogwalker: '강아지 산책', cyclist: '자전거', scooter: '킥보드', car: '자동차' };

// 📰 진짜 세종 이야기(현실 자료) — 교사 메뉴에서만 표시
export const REAL_NEWS = {
  title: '세종시에는 실제로 자율주행 버스가 다녀요',
  body: [
    '세종시 BRT 도로에서는 2022년부터 국내 첫 광역 자율주행 버스가 운행되고 있어요.',
    '2025년 5월 22일부터 자율주행 버스가 5대로 늘었고, A2 노선(오송역 ↔ 정부세종청사 ↔ 세종터미널 ↔ 반석역)은 평일 하루 6번 왕복해요.',
    '요금과 결제 방법은 일반 간선버스와 같아요.',
  ],
  source: '출처: KPI뉴스 「BRT 자율주행버스 증차로 오송~세종~반석 왕복 6회로 확대」(2025) — 세종시 보도자료로 교체 예정',
};
