# 반곡 AI 버스 훈련소 — 작업 안내 (Claude Code용)

## 무엇인가
- 세종 반곡초 6-8 실과 공개수업(2026-10-20, 40분 1차시)용 3D 웹 게임. 성취기준 [6실05-05].
- 학생(21명, 1인 1태블릿, 6모둠)이 실제 반곡동 지도(OSM)를 돌아다니며 사람·탈것을 촬영 → 이름표 → 학습 → BRT 도로 시험 운행 → 데이터 편향 발견 → 지도 개방 후 데이터 보충·재학습 → 2차 운행 → 윤리원칙 카드.
- 2026 인공지능 윤리교육 콘텐츠 공모전(수업 설계 부문) 출품 예정.

## 반드시 지킬 것
- **게임과 현실 구분**: 지도만 실제(OpenStreetMap), 셔틀 '누비'·한결 연구원·주민은 가상 인물. 게임 요소엔 🎮, 실제 자료엔 📰 표시. 실존 상호명 쓰지 않기. OSM 출처(ODbL) 표기 유지.
- 학생 얼굴·개인정보 수집 없음(태블릿 실제 카메라 사용 안 함).
- 대상: 초등 6학년 — 쉬운 한국어, 큰 버튼, 터치 우선.

## 구조 (빌드 없이 ES 모듈, importmap)
- `index.html` — importmap으로 `vendor/three`(r186) 사용. 웹 서버 필요(`npx serve .`).
- `src/main.js` 게임 흐름(타이틀→스토리→모둠 선택→탐험/촬영→앨범→학습→시험 운행→결과·AI 속마음→윤리원칙), NPC 자동 배치, 촬영(96px 렌더 타깃), 미니맵, `window.__dbg` 테스트 도우미
- `src/ui.js` HUD·대화창(한 글자씩)·패널·배너·효과음(WebAudio 합성). 디자인은 같은 사용자의 '데이터리움' 아티팩트 스타일을 따름(어두운 관제 단말기 톤, 강조색 BRT 주황 #ff6a3d, Do Hyeon/IBM Plex Sans KR/Plex Mono)
- `src/config.js` 구역 6개(사각형), 구역별 NPC 수, 이름 있는 NPC, 시험 장면 12개, 대사, 윤리원칙 7개, 📰 진짜 자료 카드
- `src/world.js` `data/bangok.json` → 3D(건물 돌출·도로 띠·면·나무·정류장·표지판), 충돌(`blocked`), 조명(낮/밤/비), 공사 펜스
- `src/npc.js` 기본 도형 NPC, `bake()`로 한 메시로 병합(성능)
- `src/ml.js` 자체 ML: HOG+HSV 특징 → 은닉층 1개 MLP(Adam), `nearest()`로 AI 속마음
- `tools/osm_to_json.py` map.osm → data/bangok.json (좌표 1=1.5m, x동 z남, BRT busway를 이어 `route` 생성)

## 검증된 사실
- 편향 재현 확인(모둠당 36장 수집, 12장면×3회): 전 구역 골고루 33/36, 한 구역만 13~27/36. 휠체어→자동차·자전거 착각, 밤 장면 실패, 5모둠(밤만)은 낮 장면 실패.
- 시험 운행: 보통 약 1분 30초, 빨리 약 40초.

## 배포·협업 (완료)
- GitHub(비공개): rrjjyy123/bangok-ai-bus · Firebase 프로젝트 `bangok-ai-bus-1020`(세종교육청 계정) · https://bangok-ai-bus-1020.web.app (교사: /teacher.html)
- `src/net.js` 익명 로그인 + Cloud Firestore(asia-northeast3 서울). 게임 코드는 `rooms/{코드}/…` 경로로 쓰고 net.js가 문서로 바꿈: `rooms/{c}`(meta) · `devices/{uid}`(30초 하트비트, 90초 지나면 끊김) · `samples/{id}`(team 필드) · `dev/{t}_{uid}` · `ethics/{uid}` · `poll/{uid}`. 방 삭제는 `closing` 표시 → 하위 문서 → 방 순서. 보안 규칙 `firestore.rules`
- 로컬 테스트: `npx serve .` 후 `/teacher.html?mock=1`, `/?mock=1` → localStorage 가짜 서버로 탭끼리 동기화(`src/net-mock.js`, localhost에서만)
- 배포: `firebase deploy --only hosting,firestore` (GitHub Actions 자동 배포는 서비스 계정 키가 필요해 아직 안 함)
- 리허설 점검: 콘솔 `__dbg.evalDrive()` — 한 구역만 3.5~7.5/12, 골고루 9.3/12, 거래소 후 +3.6(4회 평균)

## 남은 일
1. 실제 태블릿 6대 이상 동시 접속·성능 확인(터치 기기는 pixelRatio 1.25)
2. 📰 진짜 세종 이야기 카드: 세종시 보도자료 내용으로 교체(현재 KPI뉴스 2025 기사 기반)
3. GitHub Actions → Firebase Hosting 자동 배포(원하면)

## 기획 문서
- PRD: `PRD_반곡AI버스훈련소_v2.md`(같은 폴더에 두면 참고)
