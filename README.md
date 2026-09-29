# 반곡 AI 버스 훈련소 (개발 중)

6-8 실과 공개수업용 웹앱. 실제 반곡동 지도에서 사진 데이터를 모아 자율주행 셔틀 '누비'(가상)의 이미지 분류 AI를 학습시키고 BRT 도로에서 시험 운행한다.

## 실행
정적 파일이라 웹 서버로 열면 된다(파일 더블클릭은 모듈 로딩이 막힘).
- `npx serve .` 또는 VS Code Live Server
- three.js는 `vendor/three`에 포함(인터넷 없이 동작). 글꼴만 Google Fonts 사용(없으면 기본 글꼴).

## 구조
- `data/bangok.json` 반곡동 지도 데이터(OpenStreetMap, ODbL) — `python3 tools/osm_to_json.py map.osm data/bangok.json`로 다시 만들 수 있음
- `src/config.js` 구역·NPC 수·시험 장면·대사·윤리원칙·진짜 자료 카드
- `src/world.js` 지도 → 3D(건물 돌출, 도로, 공원, 정류장, 표지판)
- `src/npc.js` 사람·탈것 모델
- `src/ml.js` 자체 머신러닝(HOG+색 특징 → 작은 신경망)
- `src/main.js` 게임 흐름, 촬영, 학습, 시험 운행, AI 속마음

## 다음 단계
- Firebase(모둠 공유 앨범·데이터 거래소·교사 화면·투표)
