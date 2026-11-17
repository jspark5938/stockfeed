# 티커톡 (저장소 이름: stockfeed)

미국주식 관련 SNS 인플루언서 발언을 모아 **종목별로 한글 요약**해서 보여주는 앱입니다.
이 문서는 Claude가 이 프로젝트를 이어서 작업할 때 먼저 읽는 설명서입니다. (2026-11-17 기준)

## 사용자와 일하는 방법

- 사용자(박종선, js)는 **코딩 지식이 없습니다.** 설명은 한국어로, 전문 용어 없이 결과 중심으로 합니다.
- 사용자가 직접 해야 하는 일(키 발급, 설정 화면 조작 등)은 클릭 순서대로 번호를 매겨 안내합니다.
- API 키나 토큰을 대화창에 붙여넣지 말라고 안내합니다. 키는 GitHub Secrets에만 둡니다.
- 확인하지 않은 것은 확인했다고 말하지 않습니다. (예: "자동 테스트는 통과, 실제 폰에서는 미확인")
- 코드를 바꾼 뒤에는 `npm test`를 돌리고, 통과하면 커밋·푸시합니다.
- **작업 전에 항상 `git pull`부터 합니다.** 수집기가 30분마다 `data/` 폴더를 커밋하기 때문에 안 하면 충돌이 납니다.

## 전체 구조

```
[GitHub Actions: 발언 수집]  30분마다 실행
  collector/collect.py   → YouTube·Reddit·뉴스에서 글 수집, 종목 분류, 트렌드 계산
  collector/summarize.py → Gemini로 한글 요약 + 긍정/중립/부정 판정
  → data/posts.json, data/trends.json 을 커밋

[GitHub Pages]  https://jspark5938.github.io/stockfeed/
  index.html + app/ (화면)  +  data/ (수집 결과)  +  docs/ (약관·방침)

[안드로이드 앱]  Capacitor 8 로 웹 화면을 감싼 것 (출석부 앱과 같은 방식)
  앱 안에는 화면만 있고, 데이터는 위 GitHub Pages 주소에서 받아옴
  → 데이터가 바뀌어도 앱 재설치 불필요
```

서버는 없습니다. 비용은 0원입니다 (모두 무료 등급).

## 파일 안내

| 위치 | 내용 |
|---|---|
| `collector/collect.py` | 수집기 본체. RSS·YouTube API 읽기, 종목 태깅, 7일 보관, 트렌드 계산 |
| `collector/summarize.py` | AI 요약. 키 없으면 건너뜀. 503 등은 30초 뒤 1회 재시도 |
| `collector/sources.json` | 수집 대상. YouTube 채널(이름 + @핸들), Reddit, 뉴스 |
| `collector/tickers.json` | 추적 종목 64개. `ko`(한글명), `aliases`(회사명), `bare:false`(티커가 일반 단어와 겹쳐 `$META`처럼 $ 붙을 때만 인식) |
| `collector/ai.json` | AI 모델·처리량 설정. 모델 교체는 `model` 한 줄만 바꾸면 됨 |
| `data/` | 수집 결과 (자동 생성, 직접 고치지 않음). `channels.json`은 @핸들→채널ID 캐시 |
| `index.html`, `app/` | 화면. 순수 JS (프레임워크 없음). 해시 주소(`#/t/NVDA` 등)로 화면 이동 |
| `docs/` | 개인정보처리방침, 이용약관 |
| `android/` | Capacitor 안드로이드 프로젝트. 아이콘·시작화면 이미지 포함 |
| `build.js` | 화면 파일을 `www/`로 복사 (앱 빌드용) |
| `tests/` | 수집기 테스트(파이썬) + 화면 테스트(`app_smoke.js`, 실제 `data/`로 동작 확인) |
| `.github/workflows/collect.yml` | 수집 실행 |
| `.github/workflows/build-apk.yml` | 화면·안드로이드 파일이 바뀌면 테스트용 APK를 빌드해 `test-build` 릴리스에 올림 |

## 명령어

```
npm test                         # 전체 테스트 (파이썬 9개 + 화면 22개)
python3 collector/collect.py     # 수집기 직접 실행 (키 없으면 요약은 건너뜀)
npm run sync                     # 화면을 안드로이드 프로젝트에 반영
```

## 외부 설정 (코드 밖에 있는 것)

- **GitHub Secrets**: `GEMINI_API_KEY`, `YOUTUBE_API_V3` (YouTube 키의 실제 이름이 이것. 워크플로에서 `YOUTUBE_API_KEY` 환경변수로 넘김)
- **cron-job.org**: 30분마다 GitHub API로 `collect.yml`을 실행시킴 (GitHub 자체 예약 실행은 몇 시간씩 밀려서 백업으로만 남겨둠)
  - 사용자가 만든 GitHub 토큰(`stockfeed-trigger`, Actions 쓰기 권한)을 씀. **만료되면 30분 실행이 멈춤** → 재발급 안내 필요
- **GitHub Pages**: main 브랜치 루트에서 게시
- **테스트 앱 다운로드**: https://github.com/jspark5938/stockfeed/releases/download/test-build/tickertalk-test.apk

## 확정된 결정

- 앱 이름 **티커톡**, 패키지 `com.jspark5938.tickertalk` (스토어 출시 후 변경 불가), 개발자 표기 **ISTECH** (출석부 앱과 동일)
- 아이콘: 파란 바탕 + 입체 말풍선 + 막대 그래프 + 주황 상승 화살표 (사용자가 선택)
- 주식 먼저, 코인은 나중에
- 데이터는 무료 소스로 시작 (X/트위터 API는 유료라 보류)
- AI: 지금은 무료 Gemini(`gemini-3.5-flash-lite`) 하나. 나중에 유료 플랜이 생기면 "기본 요약은 무료 AI, 유료 기능(심층 요약 등)만 유료 AI"로 확장 예정
- 요약은 주장을 사실처럼 단정하지 않게 ("~라고 주장했다"). 매수·매도 권유 표현 금지
- 관심종목·구독·찜은 지금은 **기기에만 저장** (localStorage). 로그인 생기면 서버로 옮김
- 좋아요·댓글은 보류 (사용자 적을 때 빈약해 보이고, 댓글은 관리 부담)
- 약관·방침은 로그인/유료 구독을 "도입 예정"으로 미리 써둠. 기능 붙일 때 표시 떼고 시행일 갱신

## 알려진 문제

- **Gemini 무료 등급 503 오류가 잦음.** 요약이 밀리면 유료 전환이나 모델 교체 검토
- **YouTube RSS가 전체 404 나는 장애가 반복됨** → 공식 API를 먼저 쓰고 실패 시 RSS. Morningstar 채널은 API로 404 (원인 미확인)
- 채널 5곳은 주소를 못 찾아 뺐음: Dave Lee on Investing, Farzad, Tesla Daily, Felix & Friends, Parkev Tatevosian
- `data/posts.json`이 1.5MB 이상으로 커지는 중. 앱이 통째로 받으므로 느려지면 종목별 분할 필요
- 요약은 영상 제목·설명만 근거로 함 (자막 미사용)
- 공유 버튼은 앱 안에서 공유창 대신 "복사"로 대체될 수 있음 (실제 폰에서 미확인)
- 채널 선정은 Claude가 고른 것이라 검증 필요

## 남은 할 일 (권장 순서)

1. 사용자의 실제 폰 테스트 결과 반영 (한글 검색 수정 확인 포함)
2. 출시용 빌드: 서명 키 생성 → GitHub Secrets 등록 → AAB 자동 빌드, 버전 번호 관리
3. 스토어 등록 자료: 설명문, 스크린샷
4. 사용자가 직접: Play 스토어·키프리스에서 "티커톡" 중복·상표 확인 (틱톡과 발음 유사한 점 주의), 유사투자자문업 해당 여부 전문가 확인
5. 품질: 영상 자막 기반 요약, 종목 화면에서 뉴스와 인플루언서 글 분리, 숨기기·읽음 표시
6. 서버(Firebase): 로그인·동기화 → 푸시 알림 → 유료 구독·광고 → 좋아요. 주가 표시, 코인 추가
