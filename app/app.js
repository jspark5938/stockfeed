/* 티커톡 앱: GitHub에 30분마다 저장되는 수집 결과(data/*.json)를 읽어 화면에 보여줍니다.
   관심종목·구독·찜한 글은 이 기기에만 저장됩니다. */
(function () {
  "use strict";
  // 웹(GitHub Pages)에서는 같은 주소의 데이터를, 안드로이드 앱 안에서는 웹에 게시된 데이터를 읽습니다.
  var onPages = !window.Capacitor && (/github\.io$/.test(location.hostname) || location.hostname === "localhost" || location.hostname === "127.0.0.1");
  var BASE = onPages ? "" : "https://jspark5938.github.io/stockfeed/";
  var KIND = { youtube: "YouTube", reddit: "Reddit", news: "뉴스" };
  var TONE = { pos: "▲ 긍정", neu: "■ 중립", neg: "▼ 부정" };
  var S = { posts: [], trends: [], tickers: {}, updated: null, filter: "all", query: "" };
  var root = document.getElementById("app");

  function h(tag, attrs) {
    var el = document.createElement(tag), i, c;
    for (var k in attrs || {}) {
      if (k === "on") { for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]); }
      else if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    }
    for (i = 2; i < arguments.length; i++) {
      c = arguments[i];
      if (c == null || c === false) continue;
      (Array.isArray(c) ? c : [c]).forEach(function (x) {
        if (x != null && x !== false) el.appendChild(typeof x === "string" ? document.createTextNode(x) : x);
      });
    }
    return el;
  }

  // ----- 기기 저장소 -----
  function load(key, fallback) { try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } }
  function toggleIn(key, item) {
    var list = load(key, []);
    save(key, list.indexOf(item) >= 0 ? list.filter(function (x) { return x !== item; }) : list.concat(item));
  }
  function has(key, item) { return load(key, []).indexOf(item) >= 0; }

  function ago(iso) {
    var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 60) return m + "분 전";
    if (m < 60 * 24) return Math.round(m / 60) + "시간 전";
    return Math.round(m / 1440) + "일 전";
  }
  function ko(sym) { return (S.tickers[sym] && S.tickers[sym].ko) || sym; }
  function safeUrl(u) { return /^https:\/\//.test(u || "") ? u : null; }
  function authorHref(name) { return "#/a/" + encodeURIComponent(name); }
  function toast(msg) {
    var t = h("div", { class: "toast", role: "status" }, msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2000);
  }

  // ----- 공통 조각 -----
  function star(sym) {
    var on = has("watch", sym);
    return h("button", { type: "button", class: "star", "aria-pressed": String(on), "aria-label": sym + (on ? " 관심종목 해제" : " 관심종목 추가"),
      on: { click: function () { toggleIn("watch", sym); toast(on ? "관심종목에서 뺐습니다" : "관심종목에 추가했습니다"); render(true); } } }, on ? "★" : "☆");
  }
  function tickerRow(sym, left, right) {
    return h("div", { class: "row" },
      h("a", { class: "rowlink", href: "#/t/" + sym }, left,
        h("span", { class: "name" }, h("span", { class: "sym" }, sym), h("span", { class: "muted" }, ko(sym))), right),
      star(sym));
  }
  function followBtn(name) {
    var on = has("follow", name);
    return h("button", { type: "button", class: "pill accent", "aria-pressed": String(on),
      on: { click: function () { toggleIn("follow", name); toast(on ? "구독을 취소했습니다" : "구독했습니다"); render(true); } } }, on ? "구독 중 ✓" : "+ 구독");
  }
  function card(p) {
    var text = p.summary_ko && p.summary_ko.length ? p.summary_ko[0] : p.title;
    return h("a", { class: "card", href: "#/p/" + p.id },
      h("span", { class: "head" }, h("span", { class: "who" }, p.author), h("span", { class: "muted" }, (KIND[p.kind] || p.kind) + " · " + ago(p.published))),
      h("span", { class: "text" }, text),
      h("span", { class: "foot" }, h("span", { class: "tags" }, p.tickers.join(" · ")),
        h("span", { class: "tone" }, p.summary_ko ? (TONE[p.tone] || "") : "요약 준비 중")));
  }
  function cards(list, emptyMsg) {
    return list.length ? h("div", { class: "cards" }, list.map(card)) : h("p", { class: "empty" }, emptyMsg);
  }
  function header(title, right) {
    return h("div", { class: "top" }, h("div", { class: "brand" }, title), right || null);
  }
  function backBar(href, label, right) {
    return h("div", { class: "top" }, h("a", { class: "back", href: href }, "‹ " + label), right || null);
  }
  function toneCount(list) {
    var n = { pos: 0, neu: 0, neg: 0 };
    list.forEach(function (p) { if (p.summary_ko && n[p.tone] != null) n[p.tone]++; });
    return "긍정 " + n.pos + " · 중립 " + n.neu + " · 부정 " + n.neg + " (AI 요약이 끝난 글 기준)";
  }
  var NOTE = "공개된 글을 AI가 요약한 정보이며 투자 권유가 아닙니다.";

  // ----- 화면 -----
  function home() {
    var q = S.query.trim().toLowerCase();
    var out = [
      header("티커톡", h("div", { class: "muted" }, S.updated ? ago(S.updated) + " 갱신" : "")),
      h("label", { for: "q", class: "sr" }, "종목 검색"),
      h("input", { id: "q", class: "search", type: "search", placeholder: "종목명 또는 티커 검색 (예: NVDA, 엔비디아)", value: S.query,
        on: { input: function (e) { S.query = e.target.value; render(true); } } })
    ];
    if (q) {
      var hits = Object.keys(S.tickers).filter(function (s) {
        var t = S.tickers[s];
        return [s, t.ko].concat(t.aliases || []).some(function (x) { return x.toLowerCase().indexOf(q) >= 0; });
      });
      out.push(h("h2", null, "검색 결과"));
      out.push(hits.length ? h("div", { class: "box" }, hits.map(function (s) { return tickerRow(s); }))
        : h("p", { class: "empty" }, "아직 추적하지 않는 종목입니다."));
      return out;
    }
    out.push(h("h2", null, "지금 언급이 급증한 종목", h("span", null, "☆을 누르면 관심종목")));
    var tr = S.trends.slice(0, 5);
    out.push(tr.length ? h("div", { class: "box" }, tr.map(function (t, i) {
      return tickerRow(t.ticker, h("span", { class: "rank" }, String(i + 1)),
        h("span", { class: "buzz" }, t.mentions_24h + "건 · " + t.ratio + "배"));
    })) : h("p", { class: "empty" }, "아직 집계 중입니다."));
    out.push(h("h2", null, "최신 인플루언서 발언"));
    out.push(cards(S.posts.filter(function (p) { return p.kind !== "news"; }).slice(0, 30), "아직 글이 없습니다."));
    out.push(h("p", { class: "note" }, NOTE));
    out.push(h("p", { class: "note links" },
      h("a", { href: BASE + "docs/terms.html", target: "_blank", rel: "noopener" }, "이용약관"), " · ",
      h("a", { href: BASE + "docs/privacy.html", target: "_blank", rel: "noopener" }, "개인정보처리방침")));
    return out;
  }

  function watchTab() {
    var w = load("watch", []).filter(function (s) { return S.tickers[s]; });
    var out = [header("관심종목")];
    if (w.length) {
      out.push(h("div", { class: "box" }, w.map(function (s) { return tickerRow(s); })));
      out.push(h("h2", null, "관심종목 새 글"));
      out.push(cards(S.posts.filter(function (p) { return p.tickers.some(function (t) { return w.indexOf(t) >= 0; }); }).slice(0, 60), "아직 글이 없습니다."));
    } else {
      out.push(h("p", { class: "empty" }, "아직 관심종목이 없습니다. 아래에서 ☆을 눌러 추가하세요."));
    }
    var rest = Object.keys(S.tickers).filter(function (s) { return w.indexOf(s) < 0; });
    if (rest.length) {
      out.push(h("h2", null, "추가할 수 있는 종목"));
      out.push(h("div", { class: "box" }, rest.map(function (s) { return tickerRow(s); })));
    }
    return out;
  }

  function authorsByCount() {
    var m = {};
    S.posts.forEach(function (p) { if (p.kind === "youtube") m[p.author] = (m[p.author] || 0) + 1; });
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
  }
  function authorRow(name) {
    return h("div", { class: "row" }, h("a", { class: "rowlink", href: authorHref(name) }, h("span", { class: "name" }, h("span", { class: "sym" }, name))), followBtn(name));
  }
  function followTab() {
    var f = load("follow", []);
    var out = [header("구독")];
    if (f.length) {
      out.push(h("div", { class: "box" }, f.map(authorRow)));
      out.push(h("h2", null, "구독한 인플루언서의 새 글"));
      out.push(cards(S.posts.filter(function (p) { return f.indexOf(p.author) >= 0; }).slice(0, 60), "최근 7일간 새 글이 없습니다."));
    } else {
      out.push(h("p", { class: "empty" }, "구독한 인플루언서가 없습니다. 아래에서 골라 보세요."));
    }
    var rest = authorsByCount().filter(function (a) { return f.indexOf(a) < 0; });
    if (rest.length) {
      out.push(h("h2", null, "구독할 수 있는 채널", h("span", null, "최근 글이 많은 순")));
      out.push(h("div", { class: "box" }, rest.map(authorRow)));
    }
    return out;
  }

  function savedTab() {
    var saved = load("saved", {});
    var list = Object.keys(saved).map(function (k) { return saved[k]; })
      .sort(function (a, b) { return (b.saved_at || "").localeCompare(a.saved_at || ""); });
    return [header("찜한 글"), cards(list, "찜한 글이 없습니다. 글 화면에서 '찜하기'를 눌러 저장하세요."),
      h("p", { class: "note" }, "찜한 글은 이 기기에만 저장됩니다. 앱을 지우면 함께 사라집니다.")];
  }

  function ticker(sym) {
    var all = S.posts.filter(function (p) { return p.tickers.indexOf(sym) >= 0; });
    var on = has("watch", sym);
    var list = S.filter === "all" ? all : S.filter === "inf" ? all.filter(function (p) { return p.kind !== "news"; })
      : all.filter(function (p) { return p.summary_ko && p.tone === S.filter; });
    function pill(key, label) {
      return h("button", { type: "button", class: "pill", "aria-pressed": String(S.filter === key),
        on: { click: function () { S.filter = key; render(true); } } }, label);
    }
    return [
      backBar("#/", "홈", h("button", { type: "button", class: "pill accent", "aria-pressed": String(on), on: { click: function () {
        toggleIn("watch", sym); toast(on ? "관심종목에서 뺐습니다" : "관심종목에 추가했습니다"); render(true); } } }, on ? "★ 관심종목" : "☆ 관심종목 추가")),
      h("div", { class: "title" }, h("div", null, h("b", null, sym), h("span", { class: "muted" }, ko(sym)))),
      h("div", { class: "panel" }, h("span", { class: "label ai" }, "최근 7일 요약"),
        h("span", { class: "text" }, "수집된 글 " + all.length + "건"), h("span", { class: "muted" }, toneCount(all))),
      h("div", { class: "pills" }, pill("all", "전체"), pill("inf", "인플루언서"), pill("pos", "긍정"), pill("neg", "부정")),
      cards(list.slice(0, 60), "조건에 맞는 글이 없습니다.")
    ];
  }

  function author(name) {
    var all = S.posts.filter(function (p) { return p.author === name; });
    var cnt = {};
    all.forEach(function (p) { p.tickers.forEach(function (t) { cnt[t] = (cnt[t] || 0) + 1; }); });
    var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 5);
    return [
      backBar("#/follow", "구독", followBtn(name)),
      h("div", { class: "author" }, h("div", { class: "avatar", "aria-hidden": "true" }, name.replace(/^\/u\//, "").charAt(0).toUpperCase()),
        h("div", null, h("div", { class: "who big" }, name), h("div", { class: "muted" }, all.length ? (KIND[all[0].kind] || all[0].kind) : ""))),
      h("div", { class: "panel" }, h("span", { class: "label ai" }, "최근 7일"),
        h("span", { class: "text" }, "종목 관련 글 " + all.length + "건"), h("span", { class: "muted" }, toneCount(all))),
      top.length ? h("div", { class: "panel" }, h("span", { class: "label" }, "자주 언급한 종목"),
        h("div", { class: "chips" }, top.map(function (t) { return h("a", { class: "chip", href: "#/t/" + t }, t + " " + cnt[t]); }))) : null,
      h("h2", null, "최근 글"),
      cards(all.slice(0, 60), "최근 7일간 종목 관련 글이 없습니다.")
    ];
  }

  function share(p) {
    var url = safeUrl(p.url) || "";
    var text = "[티커톡] " + p.author + ": " + (p.summary_ko ? p.summary_ko[0] : p.title);
    if (navigator.share) { navigator.share({ text: text, url: url }).catch(function () {}); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text + "\n" + url).then(function () { toast("내용을 복사했습니다"); }, function () { toast("복사하지 못했습니다"); });
    } else toast("이 기기에서는 공유를 지원하지 않습니다");
  }
  function post(id) {
    var saved = load("saved", {});
    var p = S.posts.filter(function (x) { return x.id === id; })[0] || saved[id];
    if (!p) return [backBar("#/", "홈"), h("p", { class: "empty" }, "글을 찾을 수 없습니다. 7일이 지나 삭제되었을 수 있습니다.")];
    var url = safeUrl(p.url), isSaved = !!saved[id];
    return [
      backBar("#/t/" + p.tickers[0], p.tickers[0]),
      h("a", { class: "author", href: authorHref(p.author) }, h("div", { class: "avatar", "aria-hidden": "true" }, p.author.replace(/^\/u\//, "").charAt(0).toUpperCase()),
        h("div", null, h("div", { class: "who big" }, p.author + " ›"), h("div", { class: "muted" }, (KIND[p.kind] || p.kind) + " · " + p.source + " · " + ago(p.published)))),
      h("div", { class: "pills" },
        h("button", { type: "button", class: "pill accent", "aria-pressed": String(isSaved), on: { click: function () {
          var s = load("saved", {});
          if (s[id]) delete s[id]; else { s[id] = JSON.parse(JSON.stringify(p)); s[id].saved_at = new Date().toISOString(); }
          save("saved", s); toast(isSaved ? "찜을 해제했습니다" : "찜했습니다"); render(true); } } }, isSaved ? "♥ 찜함" : "♡ 찜하기"),
        h("button", { type: "button", class: "pill", on: { click: function () { share(p); } } }, "공유"),
        followBtn(p.author)),
      h("div", { class: "panel" }, h("span", { class: "label ai" }, "AI 한글 요약"),
        p.summary_ko ? h("ul", null, p.summary_ko.map(function (s) { return h("li", null, s); })) : h("span", { class: "text" }, "요약 준비 중입니다. 보통 몇 시간 안에 추가됩니다."),
        p.summary_ko ? h("span", { class: "label" }, TONE[p.tone] || "") : null),
      h("div", { class: "panel" }, h("span", { class: "label" }, "원문 제목"), h("span", { class: "text", lang: "en" }, p.title)),
      h("div", { class: "panel" }, h("span", { class: "label" }, "언급된 종목"),
        h("div", { class: "chips" }, p.tickers.map(function (t) { return h("a", { class: "chip", href: "#/t/" + t }, t); }))),
      url ? h("a", { class: "cta", href: url, target: "_blank", rel: "noopener noreferrer" }, "원본 보기 (" + (KIND[p.kind] || "링크") + ")") : null,
      h("p", { class: "note" }, "이 내용은 공개된 글을 요약한 정보이며 투자 권유가 아닙니다. 요약은 제목과 설명만을 바탕으로 AI가 작성해 원문과 다를 수 있습니다.")
    ];
  }

  function tabs(active) {
    var defs = [["", "홈", "⌂"], ["watch", "관심종목", "★"], ["follow", "구독", "＋"], ["saved", "찜", "♥"]];
    return h("nav", { class: "tabs", "aria-label": "주 메뉴" }, defs.map(function (d) {
      return h("a", { href: "#/" + d[0], class: "tab", "aria-current": active === d[0] ? "page" : null },
        h("span", { class: "ico", "aria-hidden": "true" }, d[2]), d[1]);
    }));
  }

  function render(stay) {
    var parts = location.hash.replace(/^#\/?/, "").split("/"), a = parts[0], arg = parts.slice(1).join("/");
    try { arg = decodeURIComponent(arg); } catch (e) { arg = ""; }
    var view = a === "t" && arg ? ticker(arg.toUpperCase()) : a === "p" && arg ? post(arg) : a === "a" && arg ? author(arg)
      : a === "watch" ? watchTab() : a === "follow" ? followTab() : a === "saved" ? savedTab() : home();
    var active = a === "watch" || a === "follow" || a === "saved" ? a : a === "a" ? "follow" : a === "t" || a === "p" ? null : "";
    root.replaceChildren.apply(root, view.filter(Boolean).concat(tabs(active)));
    if (stay) { var q = document.getElementById("q"); if (q && S.query) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    else window.scrollTo(0, 0);
  }

  function get(path) {
    return fetch(BASE + path, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(path + " " + r.status); return r.json(); });
  }
  window.addEventListener("hashchange", function () { S.filter = "all"; render(); });
  Promise.all([get("data/posts.json"), get("data/trends.json"), get("collector/tickers.json")]).then(function (d) {
    S.posts = d[0].posts; S.updated = d[0].updated; S.trends = d[1].trends; S.tickers = d[2];
    render();
  }).catch(function (e) {
    root.replaceChildren(h("p", { class: "empty" }, "데이터를 불러오지 못했습니다. 잠시 후 다시 열어 주세요. (" + e.message + ")"));
  });
})();
