import json, sys, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "collector"))
import collect as c

FX = ROOT / "tests/fixtures"
TICKERS = json.loads((ROOT / "collector/tickers.json").read_text(encoding="utf-8"))


class T(unittest.TestCase):
    def test_parse_three_formats(self):
        yt = c.parse_feed((FX / "youtube.xml").read_bytes(), "youtube", "ch")
        self.assertEqual(len(yt), 2)
        self.assertEqual(yt[0]["author"], "Test Analyst")
        self.assertIn("$AMD", yt[0]["excerpt"])
        rd = c.parse_feed((FX / "reddit.xml").read_bytes(), "reddit", "r/stocks")
        self.assertEqual(rd[0]["url"], "https://www.reddit.com/r/stocks/comments/1/x/")
        self.assertNotIn("<", rd[0]["excerpt"])
        yh = c.parse_feed((FX / "yahoo.xml").read_bytes(), "news", "Yahoo")
        self.assertEqual(yh[0]["published"], "2026-11-14T21:00:00+00:00")

    def test_tagging(self):
        self.assertEqual(c.tag_tickers("Why Nvidia earnings matter $AMD", TICKERS), ["NVDA", "AMD"])
        self.assertEqual(c.tag_tickers("Thinking about TSLA after the Metaverse news. Meta is big", TICKERS), ["TSLA"])
        self.assertEqual(c.tag_tickers("$META and $COIN", TICKERS), ["META", "COIN"])
        self.assertEqual(c.tag_tickers("I spy a coin, AMDOCS, Intelligent", TICKERS), [])

    def test_collect_end_to_end(self):
        import urllib.error
        sources = {"youtube": [{"name": "ch", "handle": "@ch"}, {"name": "nochannel", "handle": "@none"}],
                   "reddit": [{"name": "r/stocks", "url": "reddit"}, {"name": "bad", "url": "broken"}],
                   "news_per_ticker": {"name": "Yahoo", "url_template": "yahoo-{ticker}"}}
        calls = {"reddit": 0}
        def fake(url):
            if url.endswith("/@ch"): return b'<link rel="alternate" href="https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv">'
            if url.endswith("/@none"): return b"<html>consent</html>"
            if "channel_id=UCabcdefghijklmnopqrstuv" in url: return (FX / "youtube.xml").read_bytes()
            if url == "reddit":
                calls["reddit"] += 1
                if calls["reddit"] == 1: raise urllib.error.HTTPError(url, 429, "Too Many Requests", None, None)
                return (FX / "reddit.xml").read_bytes()
            if url.startswith("yahoo-"): return (FX / "yahoo.xml").read_bytes()
            raise OSError("network down")
        waits, channels = [], {}
        posts, ok, total = c.collect(sources, {k: TICKERS[k] for k in ("NVDA", "AMD", "TSLA")}, fake,
                                     log=lambda m: None, channels=channels, wait=waits.append)
        self.assertEqual((ok, total), (5, 7))  # @none 과 bad 만 실패
        self.assertEqual(channels, {"@ch": "UCabcdefghijklmnopqrstuv"})
        self.assertEqual(waits, [3, 20, 3])  # 429 뒤 한 번 재시도
        # 종목 언급 없는 영상·뉴스("Chip stocks rally")는 제외
        self.assertEqual(sorted((p["kind"], tuple(p["tickers"])) for p in posts), [("reddit", ("TSLA",)), ("youtube", ("NVDA", "AMD"))])

    def test_merge_and_trends(self):
        now = datetime(2026, 11, 15, 12, tzinfo=timezone.utc)
        def p(i, hours, t): return {"id": str(i), "published": (now - timedelta(hours=hours)).isoformat(), "tickers": t, "summary_ko": None}
        old = [dict(p(1, 1, ["NVDA"]), summary_ko="요약"), p(9, 24 * 8, ["NVDA"])]
        new = [p(1, 1, ["NVDA"]), p(2, 2, ["NVDA"]), p(3, 3, ["NVDA", "TSLA"]), p(4, 30, ["NVDA"]), p(5, 5, ["TSLA"]), p(6, 30, ["TSLA"]), p(7, 40, ["TSLA"])]
        merged = c.merge(old, new, now)
        self.assertEqual([m["id"] for m in merged], ["1", "2", "3", "5", "4", "6", "7"])
        self.assertEqual(merged[0]["summary_ko"], "요약")
        self.assertEqual(c.clean("Buy\u2060 now https://bit.ly/x code: A <b>NVDA</b>"), "Buy now code: A NVDA")
        tr = c.compute_trends(merged, TICKERS, now)
        self.assertEqual([(r["ticker"], r["mentions_24h"], r["ratio"]) for r in tr], [("NVDA", 3, 3.0), ("TSLA", 2, 1.0)])


if __name__ == "__main__":
    unittest.main()
