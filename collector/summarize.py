"""수집한 글에 한글 3줄 요약과 긍정/중립/부정 판정을 붙입니다.

API 키(GEMINI_API_KEY)가 없으면 아무것도 하지 않고 넘어갑니다.
모델은 collector/ai.json 에서 바꿉니다.
"""
import json, time, urllib.request

TONES = ("pos", "neu", "neg")
PRIORITY = {"youtube": 0, "reddit": 1, "news": 2}

PROMPT = """너는 미국 주식 관련 게시물을 한국 개인 투자자에게 요약해 주는 편집자다.
아래 JSON 배열의 각 게시물에 대해 결과를 만들어라.

규칙:
- summary: 한국어 문장 1~3개의 배열. 각 문장은 60자 이내. 주어진 title과 excerpt에 있는 내용만 쓴다. 없는 사실, 수치, 전망을 지어내지 않는다.
- 내용이 부족하면 1문장으로만 쓴다.
- 게시물의 주장을 확인된 사실처럼 단정하지 않는다. "~라고 주장했다", "~을 다뤘다", "~라고 전망했다"처럼 게시물이 말한 내용임이 드러나게 쓴다.
- 광고, 할인 코드, 구독 안내, 면책 문구는 무시한다.
- tone: 게시물이 tickers의 종목에 대해 긍정적이면 "pos", 부정적이면 "neg", 판단하기 어렵거나 중립이면 "neu".
- 매수·매도를 권하는 표현을 쓰지 않는다.
- 출력은 JSON 배열만: [{"id": "...", "summary": ["..."], "tone": "pos|neu|neg"}]

게시물:
"""


def call_gemini(prompt, model, key):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2}}
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    return data["candidates"][0]["content"]["parts"][0]["text"]


PROVIDERS = {"gemini": call_gemini}


def parse_result(text, wanted_ids):
    """모델 응답에서 형식이 올바른 항목만 골라냅니다."""
    out = {}
    try:
        rows = json.loads(text)
    except (TypeError, ValueError):
        return out
    if not isinstance(rows, list):
        return out
    for r in rows:
        if not isinstance(r, dict) or r.get("id") not in wanted_ids or r.get("tone") not in TONES:
            continue
        s = r.get("summary")
        if isinstance(s, list) and 1 <= len(s) <= 3 and all(isinstance(x, str) and x.strip() for x in s):
            out[r["id"]] = {"summary_ko": [x.strip()[:120] for x in s], "tone": r["tone"]}
    return out


def summarize_posts(posts, cfg, key, caller=None, log=print, wait=time.sleep):
    """요약이 없는 글을 YouTube → Reddit → 뉴스, 최신순으로 정해진 개수만큼 처리합니다."""
    if not key:
        log("AI 키가 없어 요약을 건너뜁니다.")
        return 0
    caller = caller or PROVIDERS[cfg["provider"]]
    todo = [p for p in posts if not p.get("summary_ko") and p.get("summary_tries", 0) < cfg["max_tries"]]
    todo.sort(key=lambda p: p["published"], reverse=True)
    todo.sort(key=lambda p: PRIORITY.get(p["kind"], 9))
    todo = todo[:cfg["max_posts_per_run"]]
    done = 0
    for i in range(0, len(todo), cfg["batch_size"]):
        batch = todo[i:i + cfg["batch_size"]]
        if i and cfg.get("pause_seconds"):
            wait(cfg["pause_seconds"])  # 무료 등급의 분당 요청 한도를 넘지 않도록 쉬어 갑니다
        payload = [{"id": p["id"], "title": p["title"], "excerpt": p["excerpt"], "tickers": p["tickers"]} for p in batch]
        try:
            result = parse_result(caller(PROMPT + json.dumps(payload, ensure_ascii=False), cfg["model"], key),
                                  {p["id"] for p in batch})
        except Exception as e:
            log(f"[요약 실패] {type(e).__name__}: {e}")
            result = {}
            stop = True
        else:
            stop = False
        for p in batch:
            if p["id"] in result:
                p.update(result[p["id"]])
                p.pop("summary_tries", None)
                done += 1
            else:
                p["summary_tries"] = p.get("summary_tries", 0) + 1
        if stop:  # 한도 초과 등일 수 있으니 이번 실행은 여기서 멈춥니다
            break
    log(f"한글 요약 {done}건 추가")
    return done
