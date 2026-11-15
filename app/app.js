/* 스톡피드 앱: GitHub에 30분마다 저장되는 수집 결과(data/*.json)를 읽어 화면에 보여줍니다. */
(function () {
  "use strict";
  var onPages = /github\.io$/.test(location.hostname) || location.hostname === "localhost" || location.hostname === "127.0.0.1";
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

  function watch() { try { return JSON.parse(localStorage.getItem("watch") || "[]"); } catch (e) { return []; } }
  function setWatch(list) { try { localStorage.setItem("watch", JSON.stringify(list)); } catch (e) { /* 저장 불가 환경 */ } }

  function ago(iso) {
    var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 60) return m + "분 전";
    if (m < 60 * 24) return Math.round(m / 60) + "시간 전";
    return Math.round(m / 1440) + "일 전";
  }
  function ko(sym) { return (S.tickers[sym] && S.tickers[sym].ko) || sym; }
  function safeUrl(u) { return /^https:\/\//.test(u || "") ? u : null; }

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

  function home() {
    var q = S.query.trim().toLowerCase(), w = watch();
    var out = [
      h("div", { class: "top" }, h("div", { class: "brand" }, "스톡피드"),
        h("div", { class: "muted" }, S.updated ? ago(S.updated) + " 갱신" : "")),
      h("label", { for: "q", class: "muted", style: "position:absolute;left:-9999px" }, "종목 검색"),
      h("input", { id: "q", class: "search", type: "search", placeholder: "종목명 또는 티커 검색 (예: NVDA, 엔비디아)", value: S.query,
        on: { input: function (e) { S.query = e.target.value; render(true); } } })
    ];
    if (q) {
      var hits = Object.keys(S.tickers).filter(function (s) {
        var t = S.tickers[s];
        return [s, t.ko].concat(t.aliases || []).some(function (x) { return x.toLowerCase().indexOf(q) >= 0; });
      });
      out.push(h("h2", null, "검색 결과"));
      out.push(hits.length ? h("div", { class: "box" }, hits.map(function (s) {
        return h("a", { class: "row", href: "#/t/" + s }, h("span", { class: "name" }, h("span", { class: "sym" }, s), h("span", { class: "muted" }, ko(s))));
      })) : h("p", { class: "empty" }, "아직 추적하지 않는 종목입니다."));
      return out;
    }
    out.push(h("h2", null, "지금 언급이 급증한 종목", h("span", null, "최근 24시간")));
    var tr = S.trends.slice(0, 5);
    out.push(tr.length ? h("div", { class: "box" }, tr.map(function (t, i) {
      return h("a", { class: "row", href: "#/t/" + t.ticker }, h("span", { class: "rank" }, String(i + 1)),
        h("span", { class: "name" }, h("span", { class: "sym" }, t.ticker), h("span", { class: "muted" }, t.name_ko)),
        h("span", { class: "buzz" }, "언급 " + t.mentions_24h + "건 · " + t.ratio + "배"));
    })) : h("p", { class: "empty" }, "아직 집계 중입니다."));
    var feed, title;
    if (w.length) {
      title = "관심종목 새 글";
      feed = S.posts.filter(function (p) { return p.tickers.some(function (t) { return w.indexOf(t) >= 0; }); });
    } else {
      title = "최신 인플루언서 발언";
      feed = S.posts.filter(function (p) { return p.kind !== "news"; });
    }
    out.push(h("h2", null, title, w.length ? null : h("span", null, "관심종목을 추가하면 맞춤 표시")));
    out.push(cards(feed.slice(0, 30), "아직 글이 없습니다."));
    out.push(h("p", { class: "note" }, "공개된 글을 AI가 요약한 정보이며 투자 권유가 아닙니다."));
    return out;
  }

  function ticker(sym) {
    var all = S.posts.filter(function (p) { return p.tickers.indexOf(sym) >= 0; });
    var n = { pos: 0, neu: 0, neg: 0 };
    all.forEach(function (p) { if (p.summary_ko && n[p.tone] != null) n[p.tone]++; });
    var w = watch(), on = w.indexOf(sym) >= 0;
    var list = S.filter === "all" ? all : S.filter === "inf" ? all.filter(function (p) { return p.kind !== "news"; })
      : all.filter(function (p) { return p.summary_ko && p.tone === S.filter; });
    function pill(key, label) {
      return h("button", { type: "button", class: "pill", "aria-pressed": String(S.filter === key),
        on: { click: function () { S.filter = key; render(); } } }, label);
    }
    return [
      h("div", { class: "top" }, h("a", { class: "back", href: "#/" }, "‹ 홈"),
        h("button", { type: "button", class: "pill watch", "aria-pressed": String(on), on: { click: function () {
          setWatch(on ? w.filter(function (x) { return x !== sym; }) : w.concat(sym)); render(); } } }, on ? "관심종목 ✓" : "관심종목 추가")),
      h("div", { class: "title" }, h("div", null, h("b", null, sym), h("span", { class: "muted" }, ko(sym)))),
      h("div", { class: "panel" }, h("span", { class: "label ai" }, "최근 7일 요약"),
        h("span", { class: "text" }, "수집된 글 " + all.length + "건"),
        h("span", { class: "muted" }, "긍정 " + n.pos + " · 중립 " + n.neu + " · 부정 " + n.neg + " (AI 요약이 끝난 글 기준)")),
      h("div", { class: "pills" }, pill("all", "전체"), pill("inf", "인플루언서"), pill("pos", "긍정"), pill("neg", "부정")),
      cards(list.slice(0, 60), "조건에 맞는 글이 없습니다.")
    ];
  }

  function post(id) {
    var p = S.posts.filter(function (x) { return x.id === id; })[0];
    if (!p) return [h("div", { class: "top" }, h("a", { class: "back", href: "#/" }, "‹ 홈")), h("p", { class: "empty" }, "글을 찾을 수 없습니다. 7일이 지나 삭제되었을 수 있습니다.")];
    var url = safeUrl(p.url);
    return [
      h("div", { class: "top" }, h("a", { class: "back", href: "#/t/" + p.tickers[0] }, "‹ " + p.tickers[0])),
      h("div", { class: "author" }, h("div", { class: "avatar", "aria-hidden": "true" }, p.author.replace(/^\/u\//, "").charAt(0).toUpperCase()),
        h("div", null, h("div", { class: "who" }, p.author), h("div", { class: "muted" }, (KIND[p.kind] || p.kind) + " · " + p.source + " · " + ago(p.published)))),
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

  function render(keepFocus) {
    var m = location.hash.match(/^#\/(t|p)\/([\w.-]+)$/);
    var view = !m ? home() : m[1] === "t" ? ticker(m[2].toUpperCase()) : post(m[2]);
    root.replaceChildren.apply(root, view.filter(Boolean));
    if (keepFocus) { var q = document.getElementById("q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
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
