"""무료 소스(YouTube·Reddit·뉴스 RSS)에서 글을 모아 종목별로 분류합니다.

실행:  python3 collector/collect.py
결과:  data/posts.json (최근 7일 글), data/trends.json (언급 급증 순위)
외부 라이브러리 없이 파이썬 기본 기능만 사용합니다.
"""
import hashlib, html, json, os, re, sys, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from summarize import summarize_posts

ROOT = Path(__file__).resolve().parent.parent
KEEP_DAYS = 7
UA = "Mozilla/5.0 (compatible; stockfeed-collector/0.1)"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def resolve_channel_id(handle, fetcher=fetch):
    """@핸들로 채널 페이지를 열어 UC로 시작하는 채널 ID를 찾습니다."""
    page = fetcher("https://www.youtube.com/" + handle).decode("utf-8", "replace")
    for pat in (r"feeds/videos\.xml\?channel_id=(UC[\w-]{22})", r"youtube\.com/channel/(UC[\w-]{22})"):
        m = re.search(pat, page)
        if m:
            return m.group(1)
    raise ValueError("채널 ID를 찾지 못했습니다")


def fetch_reddit(url, fetcher=fetch, wait=time.sleep):
    """Reddit은 요청이 잦으면 429로 거부하므로 간격을 두고, 거부되면 한 번 더 시도합니다."""
    wait(3)
    try:
        return fetcher(url)
    except urllib.error.HTTPError as e:
        if e.code != 429:
            raise
        wait(20)
        return fetcher(url)


def clean(text, limit=800):
    text = html.unescape(re.sub(r"<[^>]+>", " ", html.unescape(text or "")))
    text = re.sub(r"https?://\S+", " ", text)  # 광고·제휴 링크 제거
    text = re.sub(r"[\u200b-\u200f\u2060-\u2064\ufeff]", "", text)  # 보이지 않는 문자 제거
    return re.sub(r"\s+", " ", text).strip()[:limit]


def parse_date(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
    except ValueError:
        try:
            d = parsedate_to_datetime(s)
        except (TypeError, ValueError):
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def parse_feed(xml_bytes, kind, source):
    """RSS 2.0과 Atom(YouTube·Reddit)을 모두 읽어 공통 형식으로 바꿉니다."""
    root = ET.fromstring(xml_bytes)
    for el in root.iter():
        el.tag = el.tag.split("}")[-1]
    posts = []
    for it in root.findall(".//entry") or root.findall(".//item"):
        link_el = it.find("link")
        link = ""
        if link_el is not None:
            link = (link_el.get("href") or link_el.text or "").strip()
        when = parse_date(it.findtext("published") or it.findtext("updated") or it.findtext("pubDate"))
        title = clean(it.findtext("title"), 300)
        if not (link and title and when):
            continue
        body = (it.findtext("group/description") or it.findtext("description")
                or it.findtext("content") or it.findtext("summary") or "")
        cat = it.find("category")
        board = (cat.get("label") or "").strip() if kind == "reddit" and cat is not None else ""
        posts.append({
            "id": hashlib.sha1(link.encode()).hexdigest()[:16],
            "kind": kind,
            "source": board or source,
            "author": clean(it.findtext("author/name"), 80) or source,
            "title": title,
            "excerpt": clean(body),
            "url": link,
            "published": when.isoformat(),
            "tickers": [],
            "summary_ko": None,
            "tone": None,
        })
    return posts


# 종목과 무관하게 설명란에 흔히 붙는 문구 (예: "Apple Podcasts에서 듣기")
BOILERPLATE = re.compile(r"Apple (?:Podcasts?|Music|TV\+?|Books)|Amazon (?:Music|Prime|[Aa]ffiliate\w*|[Aa]ssociate\w*|[Ss]tore\w*|[Ll]inks?)"
                         r"|Google (?:Play|Podcasts?|News|Search|Docs|Sheets|Finance)|App Store|Disney\+")


def tag_tickers(text, tickers):
    text = BOILERPLATE.sub(" ", text)
    found = []
    for sym, info in tickers.items():
        pats = [r"\$" + re.escape(sym) + r"\b"]
        if info.get("bare", True):
            pats.append(r"(?<![A-Za-z$])" + re.escape(sym) + r"(?![A-Za-z])")
        hit = any(re.search(p, text) for p in pats) or any(
            re.search(r"\b(?:" + re.escape(a) + "|" + re.escape(a.upper()) + r")\b", text) for a in info.get("aliases", []))
        if hit:
            found.append(sym)
    return found


def compute_trends(posts, tickers, now):
    cur, prev = {}, {}
    for p in posts:
        age = now - datetime.fromisoformat(p["published"])
        bucket = cur if age <= timedelta(hours=24) else prev if age <= timedelta(hours=48) else None
        if bucket is None:
            continue
        for t in p["tickers"]:
            bucket[t] = bucket.get(t, 0) + 1
    rows = [{"ticker": t, "name_ko": tickers[t]["ko"], "mentions_24h": c,
             "mentions_prev_24h": prev.get(t, 0), "ratio": round(c / max(prev.get(t, 0), 1), 2)}
            for t, c in cur.items() if c >= 2]
    rows.sort(key=lambda r: (-r["ratio"], -r["mentions_24h"], r["ticker"]))
    return rows


def merge(old, new, now):
    by_id = {p["id"]: p for p in old}
    for p in new:
        cur = by_id.get(p["id"])
        if cur is None or not cur.get("summary_ko"):  # 요약된 글은 그대로 두고, 나머지는 최신 내용으로 교체
            if cur and cur.get("summary_tries"):
                p["summary_tries"] = cur["summary_tries"]
            by_id[p["id"]] = p
    cutoff = now - timedelta(days=KEEP_DAYS)
    kept = [p for p in by_id.values() if datetime.fromisoformat(p["published"]) >= cutoff]
    kept.sort(key=lambda p: p["published"], reverse=True)
    return kept


def collect(sources, tickers, fetcher=fetch, log=print, channels=None, wait=time.sleep):
    channels = {} if channels is None else channels  # 핸들 → 채널 ID 기억
    jobs = []
    for ch in sources.get("youtube", []):
        jobs.append(("youtube", ch["name"], ch))
    for r in sources.get("reddit", []):
        jobs.append(("reddit", r["name"], r["url"]))
    news = sources.get("news_per_ticker")
    if news:
        for sym in tickers:
            jobs.append(("news", news["name"], news["url_template"].format(ticker=sym)))
    posts, ok = [], 0
    for kind, name, target in jobs:
        try:
            if kind == "youtube":
                cid = target.get("channel_id") or channels.get(target["handle"])
                if not cid:
                    cid = channels[target["handle"]] = resolve_channel_id(target["handle"], fetcher)
                raw = fetcher("https://www.youtube.com/feeds/videos.xml?channel_id=" + cid)
            elif kind == "reddit":
                raw = fetch_reddit(target, fetcher, wait)
            else:
                raw = fetcher(target)
            items = parse_feed(raw, kind, name)
            if kind == "youtube" and items and items[0]["author"].lower() != name.lower():
                log(f"[확인] {name} ({target.get('handle')}) → 실제 채널명: {items[0]['author']}")
        except Exception as e:  # 한 소스가 실패해도 나머지는 계속 수집
            log(f"[실패] {name}: {e}")
            continue
        ok += 1
        for p in items:
            p["tickers"] = tag_tickers(p["title"] + " " + p["excerpt"], tickers)
            if p["tickers"]:  # 제목·본문에 종목이 실제로 언급된 글만 남깁니다
                posts.append(p)
    return posts, ok, len(jobs)


def main():
    sources = json.loads((ROOT / "collector/sources.json").read_text(encoding="utf-8"))
    tickers = json.loads((ROOT / "collector/tickers.json").read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc)
    ch_file = ROOT / "data/channels.json"
    channels = json.loads(ch_file.read_text(encoding="utf-8")) if ch_file.exists() else {}
    new, ok, total = collect(sources, tickers, channels=channels)
    out = ROOT / "data/posts.json"
    old = json.loads(out.read_text(encoding="utf-8"))["posts"] if out.exists() else []
    for p in old:  # 예전 글도 현재 기준으로 다시 분류
        p["tickers"] = tag_tickers(p["title"] + " " + p["excerpt"], tickers)
    old = [p for p in old if p["tickers"]]
    posts = merge(old, new, now)
    ai_cfg = json.loads((ROOT / "collector/ai.json").read_text(encoding="utf-8"))
    summarize_posts(posts, ai_cfg, os.environ.get("GEMINI_API_KEY"))
    out.parent.mkdir(exist_ok=True)
    ch_file.write_text(json.dumps(channels, ensure_ascii=False, indent=1), encoding="utf-8")
    out.write_text(json.dumps({"updated": now.isoformat(), "posts": posts}, ensure_ascii=False, indent=1), encoding="utf-8")
    (ROOT / "data/trends.json").write_text(json.dumps(
        {"updated": now.isoformat(), "trends": compute_trends(posts, tickers, now)}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"소스 {ok}/{total}개 성공, 새 글 {len(new)}건, 보관 중 {len(posts)}건")
    if total and ok == 0:
        sys.exit("모든 소스 수집에 실패했습니다.")


if __name__ == "__main__":
    main()
