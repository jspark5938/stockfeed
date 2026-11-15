"""무료 소스(YouTube·Reddit·뉴스 RSS)에서 글을 모아 종목별로 분류합니다.

실행:  python3 collector/collect.py
결과:  data/posts.json (최근 7일 글), data/trends.json (언급 급증 순위)
외부 라이브러리 없이 파이썬 기본 기능만 사용합니다.
"""
import hashlib, html, json, re, sys, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEEP_DAYS = 7
UA = "Mozilla/5.0 (compatible; stockfeed-collector/0.1)"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def clean(text, limit=500):
    text = html.unescape(re.sub(r"<[^>]+>", " ", html.unescape(text or "")))
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
        posts.append({
            "id": hashlib.sha1(link.encode()).hexdigest()[:16],
            "kind": kind,
            "source": source,
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


def tag_tickers(text, tickers):
    found = []
    for sym, info in tickers.items():
        pats = [r"\$" + re.escape(sym) + r"\b"]
        if info.get("bare", True):
            pats.append(r"(?<![A-Za-z$])" + re.escape(sym) + r"(?![A-Za-z])")
        hit = any(re.search(p, text) for p in pats) or any(
            re.search(r"\b" + re.escape(a) + r"\b", text, re.I) for a in info.get("aliases", []))
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
        by_id.setdefault(p["id"], p)  # 이미 있는 글(요약 포함)은 그대로 둡니다
    cutoff = now - timedelta(days=KEEP_DAYS)
    kept = [p for p in by_id.values() if datetime.fromisoformat(p["published"]) >= cutoff]
    kept.sort(key=lambda p: p["published"], reverse=True)
    return kept


def collect(sources, tickers, fetcher=fetch, log=print):
    jobs = []
    for ch in sources.get("youtube", []):
        jobs.append(("youtube", ch["name"],
                     "https://www.youtube.com/feeds/videos.xml?channel_id=" + ch["channel_id"], None))
    for r in sources.get("reddit", []):
        jobs.append(("reddit", r["name"], r["url"], None))
    news = sources.get("news_per_ticker")
    if news:
        for sym in tickers:
            jobs.append(("news", news["name"], news["url_template"].format(ticker=sym), sym))
    posts, ok = [], 0
    for kind, name, url, forced in jobs:
        try:
            items = parse_feed(fetcher(url), kind, name)
        except Exception as e:  # 한 소스가 실패해도 나머지는 계속 수집
            log(f"[실패] {name}: {e}")
            continue
        ok += 1
        for p in items:
            found = tag_tickers(p["title"] + " " + p["excerpt"], tickers)
            if forced and forced not in found:
                found.insert(0, forced)
            p["tickers"] = found
            if found:  # 종목과 무관한 글은 버립니다
                posts.append(p)
    return posts, ok, len(jobs)


def main():
    sources = json.loads((ROOT / "collector/sources.json").read_text(encoding="utf-8"))
    tickers = json.loads((ROOT / "collector/tickers.json").read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc)
    new, ok, total = collect(sources, tickers)
    out = ROOT / "data/posts.json"
    old = json.loads(out.read_text(encoding="utf-8"))["posts"] if out.exists() else []
    posts = merge(old, new, now)
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"updated": now.isoformat(), "posts": posts}, ensure_ascii=False, indent=1), encoding="utf-8")
    (ROOT / "data/trends.json").write_text(json.dumps(
        {"updated": now.isoformat(), "trends": compute_trends(posts, tickers, now)}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"소스 {ok}/{total}개 성공, 새 글 {len(new)}건, 보관 중 {len(posts)}건")
    if total and ok == 0:
        sys.exit("모든 소스 수집에 실패했습니다.")


if __name__ == "__main__":
    main()
