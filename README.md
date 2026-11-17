# 티커톡 (stockfeed)

미국주식 인플루언서 발언 앱 "티커톡"의 데이터 수집기와 앱입니다.

- `collector/collect.py` — YouTube·Reddit·뉴스 RSS를 모아 종목별로 분류
- `collector/sources.json` — 수집할 소스 목록 (YouTube 채널은 여기에 추가)
- `collector/tickers.json` — 추적 종목과 회사명 별칭
- `data/posts.json`, `data/trends.json` — 수집 결과 (30분마다 자동 갱신)
- 테스트: `npm test`
- 작업 방법과 현재 상태: `CLAUDE.md` 참고

수집 결과는 공개 글의 제목·발췌·원문 링크이며 투자 권유가 아닙니다.
