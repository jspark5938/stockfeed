import json, sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "collector"))
import summarize as s

CFG = {"provider": "gemini", "model": "m", "batch_size": 2, "max_posts_per_run": 3, "max_tries": 3}


def post(i, kind, hour, **kw):
    return dict({"id": str(i), "kind": kind, "published": f"2026-11-15T{hour:02d}:00:00+00:00",
                 "title": "t", "excerpt": "e", "tickers": ["NVDA"], "summary_ko": None, "tone": None}, **kw)


class T(unittest.TestCase):
    def test_no_key_skips(self):
        posts = [post(1, "news", 1)]
        self.assertEqual(s.summarize_posts(posts, CFG, None, caller=lambda *a: 1 / 0, log=lambda m: None), 0)
        self.assertIsNone(posts[0]["summary_ko"])

    def test_priority_batches_and_validation(self):
        posts = [post(1, "news", 9), post(2, "youtube", 1), post(3, "reddit", 5), post(4, "youtube", 3),
                 post(5, "youtube", 8, summary_ko=["이미 있음"], tone="pos"), post(6, "news", 2, summary_tries=3)]
        seen = []
        def fake(prompt, model, key):
            ids = [r["id"] for r in json.loads(prompt.split("게시물:\n")[1])]
            seen.append(ids)
            return json.dumps([{"id": i, "summary": ["요약"], "tone": "pos" if i != "3" else "great"} for i in ids] + [{"id": "999", "summary": ["x"], "tone": "neu"}])
        n = s.summarize_posts(posts, CFG, "k", caller=fake, log=lambda m: None)
        self.assertEqual(seen, [["4", "2"], ["3"]])  # YouTube 최신순 먼저, 그다음 Reddit, 한도 3건
        self.assertEqual(n, 2)
        by = {p["id"]: p for p in posts}
        self.assertEqual((by["4"]["summary_ko"], by["4"]["tone"]), (["요약"], "pos"))
        self.assertEqual((by["3"]["summary_ko"], by["3"]["summary_tries"]), (None, 1))  # 잘못된 tone 은 거부
        self.assertIsNone(by["1"]["summary_ko"])

    def test_error_stops_run_and_bad_json(self):
        posts = [post(i, "youtube", i) for i in range(1, 5)]
        calls = []
        def boom(*a):
            calls.append(1); raise OSError("429")
        self.assertEqual(s.summarize_posts(posts, CFG, "k", caller=boom, log=lambda m: None), 0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(s.parse_result("not json", {"1"}), {})
        self.assertEqual(s.parse_result('{"id":"1"}', {"1"}), {})
        self.assertEqual(s.parse_result('[{"id":"1","summary":[],"tone":"pos"}]', {"1"}), {})


if __name__ == "__main__":
    unittest.main()
