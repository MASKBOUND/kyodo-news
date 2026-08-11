/* 協働新聞 軽量エディットモード
   文字直接修正(contenteditable) + 記事カードのドラッグ並べ替え(SortableJS) + 画像差し替え + localStorage保存/書き出し
   外部サービス不要・クライアント完結。印刷/PDFには影響しない。 */
(function () {
  "use strict";
  var issue = (document.body.dataset.issue || "issue");
  var LSKEY = "kyodo_edit_" + issue;
  var pages = Array.prototype.slice.call(document.querySelectorAll(".page"));
  var colsList = pages.map(function (p) { return p.querySelector(".cols"); }).filter(Boolean);
  var TEXT_SEL = "p,h1,h2,h3,h4,li,figcaption,span,b,small";
  var sortables = [];
  var editing = false;

  // ---- 保存済みの編集を復元 ----
  try {
    var saved = JSON.parse(localStorage.getItem(LSKEY) || "null");
    if (saved && Array.isArray(saved.cols)) {
      saved.cols.forEach(function (html, i) {
        if (colsList[i] && typeof html === "string") colsList[i].innerHTML = html;
      });
      flash("保存した編集を復元しました");
    }
  } catch (e) { /* noop */ }

  // ---- 画像クリックで差し替え ----
  var picker = document.createElement("input");
  picker.type = "file"; picker.accept = "image/*"; picker.style.display = "none";
  document.body.appendChild(picker);
  var pendingImg = null;
  picker.addEventListener("change", function () {
    var f = picker.files && picker.files[0]; if (!f || !pendingImg) return;
    var r = new FileReader();
    r.onload = function () { pendingImg.src = r.result; };
    r.readAsDataURL(f);
    picker.value = "";
  });
  function onImgClick(e) {          // クリック＝選択（大きさ/切り抜きの対象に）
    if (!editing) return;
    e.preventDefault(); e.stopPropagation();
    selectImg(e.currentTarget);
  }
  function onImgDbl(e) {            // ダブルクリック＝写真の差し替え
    if (!editing) return;
    e.preventDefault();
    pendingImg = e.currentTarget;
    picker.click();
  }

  // ---- 追加(挿入)する要素のテンプレ ----
  var PLACEHOLDER_IMG =
    "data:image/svg+xml;utf8," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">' +
      '<rect width="300" height="200" fill="#eef3f6" stroke="#b9c6d0"/>' +
      '<text x="150" y="104" font-size="16" fill="#7a8a95" text-anchor="middle" font-family="sans-serif">クリックで画像を選択</text></svg>');

  function makeBlock(type) {
    var el = document.createElement(type === "divider" ? "hr" : (type === "image" ? "figure" : (type === "box" ? "div" : "article")));
    if (type === "heading") el.innerHTML = '<h2>新しい見出し</h2><p>ここに本文を入力…</p>';
    else if (type === "text") el.innerHTML = '<p>ここに本文を入力…</p>';
    else if (type === "briefs") el.innerHTML = '<h3>小見出し</h3><ul class="briefs"><li>項目を入力…</li><li>項目を入力…</li></ul>';
    else if (type === "box") { el.className = "box"; el.innerHTML = '<h3>枠のタイトル</h3><p>内容を入力…</p>'; }
    else if (type === "image") el.innerHTML = '<img src="' + PLACEHOLDER_IMG + '" alt=""><figcaption>キャプションを入力…</figcaption>';
    else if (type === "divider") el.className = "ed-hr";
    el.setAttribute("data-ed-new", "1");
    return el;
  }

  var activeCols = null; // 最後に触れたページの列。挿入先。
  function currentCols() { return activeCols || colsList[0]; }

  // URL→QR画像(データURL)。qrcode-generatorライブラリを使用。
  function makeQR(url) {
    if (typeof qrcode === "undefined") { flash("QR生成ライブラリの読込に失敗しました"); return null; }
    var qr = qrcode(0, "M"); qr.addData(url); qr.make();
    return qr.createDataURL(6, 0); // cellSize, margin
  }
  function buildQRBlock(url, label) {
    var data = makeQR(url); if (!data) return null;
    var fig = document.createElement("figure");
    fig.className = "ed-qrblock"; fig.setAttribute("data-ed-new", "1");
    fig.innerHTML = '<img class="ed-qrimg" src="' + data + '" alt="QR"><figcaption>' +
      (label || url) + '</figcaption>';
    return fig;
  }

  function insertBlock(type) {
    if (!editing) setEditing(true);
    var cols = currentCols(); if (!cols) return;
    if (type === "qr") {
      var url = prompt("QRコードにするURL（アドレス）を入力してください", "https://");
      if (!url || url === "https://") return;
      var label = prompt("QRの下に表示するラベル（空欄可）", "") || "";
      var block = buildQRBlock(url.trim(), label.trim());
      if (!block) return;
      cols.appendChild(block);
      block.querySelector("figcaption").setAttribute("contenteditable", "true");
      block.scrollIntoView({ block: "center", behavior: "smooth" });
      flash("QRを追加しました（" + url.trim() + "）");
      return;
    }
    var el = makeBlock(type);
    cols.appendChild(el);
    // 追加要素も編集可能・並べ替え対象に
    el.querySelectorAll(TEXT_SEL).forEach(function (t) { t.setAttribute("contenteditable", "true"); });
    var img = el.matches("img") ? el : el.querySelector("img");
    if (img) { img.addEventListener("click", onImgClick); }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (type === "image" && img) { pendingImg = img; picker.click(); }
    else { var f = el.querySelector(TEXT_SEL); if (f) { f.focus(); } }
    setTimeout(fitFill, 60);
    flash("要素を追加しました（掴んで位置調整・クリックで編集）");
  }

  // ---- 編集モードのON/OFF ----
  function setEditing(on) {
    editing = on;
    document.body.classList.toggle("editing", on);
    document.getElementById("editbar").hidden = !on;
    var toggle = document.getElementById("ed-toggle");
    if (toggle) toggle.textContent = on ? "✏️ 編集中…" : "✏️ 編集モード";

    colsList.forEach(function (cols) {
      // テキスト編集の可否
      cols.querySelectorAll(TEXT_SEL).forEach(function (el) {
        if (on) el.setAttribute("contenteditable", "true");
        else el.removeAttribute("contenteditable");
      });
      // 画像クリック差し替え
      cols.querySelectorAll("img").forEach(function (img) {
        img.removeEventListener("click", onImgClick);
        img.removeEventListener("dblclick", onImgDbl);
        if (on) { img.addEventListener("click", onImgClick); img.addEventListener("dblclick", onImgDbl); }
      });
    });

    // ドラッグ並べ替え
    if (on) {
      if (window.Sortable) {
        colsList.forEach(function (cols) {
          sortables.push(window.Sortable.create(cols, {
            animation: 150, handle: false, draggable: "> *",
            ghostClass: "ed-ghost", chosenClass: "ed-chosen",
            filter: "[contenteditable=true]:focus", preventOnFilter: false,
            onEnd: function () { setTimeout(fitFill, 60); }   // 並べ替え/削除後に再フィット
          }));
        });
      } else {
        flash("並べ替え機能(Sortable)の読込に失敗。文字修正は使えます");
      }
    } else {
      sortables.forEach(function (s) { try { s.destroy(); } catch (e) {} });
      sortables = [];
    }
  }

  // ---- 保存(localStorage) ----
  function save() {
    try {
      var data = { cols: colsList.map(function (c) { return c.innerHTML; }), free: freeOn, at: new Date().toISOString() };
      localStorage.setItem(LSKEY, JSON.stringify(data));
      if (freeOn) saveFree();
      saveMargins();
      flash("この端末に保存しました ✓");
    } catch (e) {
      flash("保存に失敗（画像が大きすぎる可能性）。HTML書き出しをお使いください");
    }
  }

  // ---- 変更を破棄 ----
  function reset() {
    if (!confirm("保存した編集を破棄して、公開中の内容に戻します。よろしいですか？")) return;
    localStorage.removeItem(LSKEY);
    location.reload();
  }

  // ================= 自由配置モード（interact.js） =================
  var LSKEY_FREE = "kyodo_free_" + issue;
  var freeOn = false, interactBound = false;

  function setFreeLabel() {
    var b = document.getElementById("ed-free");
    if (!b) return;
    b.textContent = freeOn ? "🧩 自由配置ON" : "🧩 自由配置OFF";
    b.classList.toggle("ed-primary", freeOn);
  }

  function enterFree() {
    if (!editing) setEditing(true);
    var pel = document.getElementById("paper"); if (pel) pel.style.zoom = 1; // 等倍で計測・ドラッグ
    // 並べ替え(Sortable)は自由配置と競合するので停止
    sortables.forEach(function (s) { try { s.destroy(); } catch (e) {} });
    sortables = [];
    colsList.forEach(function (cols) {
      var children = Array.prototype.slice.call(cols.children);
      var crect = cols.getBoundingClientRect();
      var boxes = children.map(function (ch) {           // 先に全要素を計測
        var r = ch.getBoundingClientRect();
        return { l: r.left - crect.left, t: r.top - crect.top, w: r.width };
      });
      children.forEach(function (ch, i) {                 // その後で絶対配置へ
        if (!ch.dataset.edId) ch.dataset.edId = "b" + i;
        ch.style.left = boxes[i].l + "px";
        ch.style.top = boxes[i].t + "px";
        ch.style.width = boxes[i].w + "px";
      });
    });
    document.body.classList.add("freelayout");
    applySavedFree();
    bindInteract();
    freeOn = true; setFreeLabel();
    flash("自由配置ON：掴んで移動／角でリサイズ／ダブルクリックで文字編集");
  }

  function exitFree() {
    document.body.classList.remove("freelayout");
    colsList.forEach(function (cols) {
      Array.prototype.slice.call(cols.children).forEach(function (ch) {
        ch.style.left = ch.style.top = ch.style.width = ch.style.height = "";
        ch.classList.remove("ed-textediting");
      });
    });
    freeOn = false; setFreeLabel();
    if (editing) setEditing(true); // 並べ替えを再有効化
    fitFill();                     // 再フィット＋画面ズーム復帰
  }

  function bindInteract() {
    if (interactBound) return;
    if (typeof interact === "undefined") { flash("自由配置ライブラリの読込に失敗しました"); return; }
    interactBound = true;
    interact("body.freelayout .cols > *")
      .draggable({
        ignoreFrom: ".ed-textediting,[contenteditable=true]",
        listeners: { move: function (e) {
          var t = e.target;
          t.style.left = (parseFloat(t.style.left) || 0) + e.dx + "px";
          t.style.top = (parseFloat(t.style.top) || 0) + e.dy + "px";
        } }
      })
      .resizable({
        edges: { left: true, right: true, top: true, bottom: true },
        ignoreFrom: ".ed-textediting",
        listeners: { move: function (e) {
          var t = e.target;
          t.style.width = e.rect.width + "px";
          t.style.height = e.rect.height + "px";
          t.style.left = (parseFloat(t.style.left) || 0) + e.deltaRect.left + "px";
          t.style.top = (parseFloat(t.style.top) || 0) + e.deltaRect.top + "px";
        } }
      });
    // ダブルクリックで文字編集（編集中はドラッグ無効）
    colsList.forEach(function (cols) {
      cols.addEventListener("dblclick", function (e) {
        if (!freeOn) return;
        var block = e.target.closest(".cols > *"); if (!block) return;
        block.classList.add("ed-textediting");
        block.querySelectorAll(TEXT_SEL).forEach(function (t) { t.setAttribute("contenteditable", "true"); });
        var tgt = (e.target.closest && e.target.closest(TEXT_SEL)) || block.querySelector(TEXT_SEL);
        if (tgt) tgt.focus();
      });
    });
    document.addEventListener("focusout", function (e) {
      var block = e.target && e.target.closest && e.target.closest(".ed-textediting");
      if (block) setTimeout(function () {
        if (!block.contains(document.activeElement)) block.classList.remove("ed-textediting");
      }, 60);
    });
  }

  function saveFree() {
    var all = {};
    colsList.forEach(function (cols, ci) {
      Array.prototype.slice.call(cols.children).forEach(function (ch) {
        if (!ch.dataset.edId) return;
        all[ci + ":" + ch.dataset.edId] = { l: ch.style.left, t: ch.style.top, w: ch.style.width, h: ch.style.height };
      });
    });
    localStorage.setItem(LSKEY_FREE, JSON.stringify(all));
  }
  function applySavedFree() {
    var saved; try { saved = JSON.parse(localStorage.getItem(LSKEY_FREE) || "null"); } catch (e) { return; }
    if (!saved) return;
    colsList.forEach(function (cols, ci) {
      Array.prototype.slice.call(cols.children).forEach(function (ch) {
        var v = saved[ci + ":" + ch.dataset.edId];
        if (!v) return;
        if (v.l) ch.style.left = v.l; if (v.t) ch.style.top = v.t;
        if (v.w) ch.style.width = v.w; if (v.h) ch.style.height = v.h;
      });
    });
  }

  // ---- 公開/書き出し用HTML：編集機能は残し、一時状態だけリセット ----
  function getCleanHTML() {
    var clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll(".ed-pool-panel").forEach(function (n) { n.remove(); }); // 素材/見出しパネルは書き出さない
    clone.querySelectorAll("[contenteditable]").forEach(function (n) { n.removeAttribute("contenteditable"); });
    clone.querySelectorAll(".ed-ghost,.ed-chosen,.ed-textediting,.ed-selected,.ed-imgsel").forEach(function (n) {
      n.classList.remove("ed-ghost", "ed-chosen", "ed-textediting", "ed-selected", "ed-imgsel");
    });
    var body = clone.querySelector("body");
    if (body) body.classList.remove("editing"); // freelayout クラス＆配置は残す
    var bar = clone.querySelector("#editbar"); if (bar) bar.setAttribute("hidden", "");
    var tg = clone.querySelector("#ed-toggle"); if (tg) tg.textContent = "✏️ 編集モード";
    var pp = clone.querySelector("#paper"); if (pp) pp.style.zoom = ""; // 端末依存ズームは焼き込まない（読込時に再計算）
    return "<!doctype html>\n" + clone.outerHTML;
  }

  function exportHtml() {
    var blob = new Blob([getCleanHTML()], { type: "text/html" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kyodo_" + issue + ".html";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    flash("HTMLを書き出しました（index.html として差し替え可）");
  }

  // ================= 🚀 公開（GitHubへ直接コミット→Pages反映） =================
  // 公開先パスは開いているページから自動判定（各号は /kyodo-news/{month}/index.html）
  var _p = location.pathname.replace(/^\/kyodo-news\//, "").replace(/index\.html$/, "").replace(/\/$/, "");
  var GH = { owner: "MASKBOUND", repo: "kyodo-news", path: (_p ? _p + "/" : "") + "index.html", branch: "main" };
  var LSKEY_TOKEN = "kyodo_gh_token";
  function b64utf8(str) { return btoa(unescape(encodeURIComponent(str))); }
  function getToken() {
    var t = localStorage.getItem(LSKEY_TOKEN);
    if (!t) {
      t = prompt(
        "GitHubのトークンを入力してください（初回のみ・この端末に保存）。\n" +
        "推奨: Fine-grained token を " + GH.owner + "/" + GH.repo + " のみ、Contents=Read and write で発行。\n" +
        "発行: github.com → Settings → Developer settings → Personal access tokens");
      if (t) { t = t.trim(); localStorage.setItem(LSKEY_TOKEN, t); }
    }
    return t;
  }
  function ghHeaders(token) {
    return { "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  }
  function publish() {
    var token = getToken(); if (!token) return;
    var api = "https://api.github.com/repos/" + GH.owner + "/" + GH.repo + "/contents/" + GH.path;
    flash("公開中… GitHubへ送信しています");
    // 現在のsha取得 → PUT
    fetch(api + "?ref=" + GH.branch, { headers: ghHeaders(token) })
      .then(function (r) { return r.status === 404 ? { sha: undefined } : r.json(); })
      .then(function (info) {
        var body = {
          message: "電子版を更新（" + issue + "・ブラウザ編集）",
          content: b64utf8(getCleanHTML()),
          branch: GH.branch
        };
        if (info && info.sha) body.sha = info.sha;
        return fetch(api, { method: "PUT", headers: ghHeaders(token), body: JSON.stringify(body) });
      })
      .then(function (r) {
        if (r.ok) { flash("✓ 公開しました！ 30〜60秒ほどで本番サイトに反映されます"); return; }
        if (r.status === 401 || r.status === 403) {
          localStorage.removeItem(LSKEY_TOKEN);
          flash("認証エラー：トークンが無効/権限不足です。保存を消したので、もう一度お試しください");
        } else {
          r.json().then(function (e) { flash("公開に失敗: " + (e && e.message ? e.message : r.status)); })
            .catch(function () { flash("公開に失敗: HTTP " + r.status); });
        }
      })
      .catch(function (e) { flash("通信エラー: " + e.message); });
  }

  // ---- 小さな通知 ----
  var timer = null;
  function flash(msg) {
    var bar = document.getElementById("editbar");
    var s = document.getElementById("ed-status");
    if (!s) { s = document.createElement("span"); s.id = "ed-status"; if (bar) bar.appendChild(s); }
    if (!s) { console.log(msg); return; }
    s.textContent = "　" + msg;
    clearTimeout(timer);
    timer = setTimeout(function () { s.textContent = ""; }, 4000);
  }

  // ================= 縁の余白(上下左右)調整 =================
  var LSKEY_MARGIN = "kyodo_margin_" + issue;
  var MG = { t: 10, b: 10, l: 9, r: 9 };
  function applyMargins() {
    pages.forEach(function (p) {
      p.style.setProperty("--mt", MG.t + "mm");
      p.style.setProperty("--mb", MG.b + "mm");
      p.style.setProperty("--ml", MG.l + "mm");
      p.style.setProperty("--mr", MG.r + "mm");
    });
  }
  function loadMargins() {
    try { var s = JSON.parse(localStorage.getItem(LSKEY_MARGIN) || "null"); if (s) MG = s; } catch (e) {}
    ["t", "b", "l", "r"].forEach(function (k) { var el = document.getElementById("mg-" + k); if (el) el.value = MG[k]; });
    applyMargins();
  }
  function onMarginInput() {
    ["t", "b", "l", "r"].forEach(function (k) {
      var el = document.getElementById("mg-" + k);
      if (el) { var v = parseFloat(el.value); if (!isNaN(v)) MG[k] = v; }
    });
    applyMargins();
  }
  function saveMargins() { localStorage.setItem(LSKEY_MARGIN, JSON.stringify(MG)); }

  // ================= 書式（色付きボックス・色反転・色指定） =================
  var selEl = null;
  var SEL_UNIT = "h1,h2,h3,h4,p,li,figure,article,.box,.sect-head,.report,.grant,.kpi,figcaption";
  function markSelected(el) {
    if (selEl) selEl.classList.remove("ed-selected");
    selEl = el;
    if (selEl) selEl.classList.add("ed-selected");
  }
  function pickTarget(e) {
    if (!editing) return;
    var el = e.target.closest && e.target.closest(SEL_UNIT);
    if (el) markSelected(el);
  }
  function needSel() {
    if (!selEl) { flash("先に対象（見出し・段落・ブロック等）をクリックで選んでください"); return false; }
    return true;
  }
  function fmtBand() {           // 色反転の帯（背景色＋白文字）
    if (!needSel()) return;
    var bg = document.getElementById("fmt-bg").value;
    var fg = document.getElementById("fmt-fg").value;
    selEl.style.background = bg; selEl.style.color = fg;
    selEl.style.padding = "2mm 3mm"; selEl.style.borderRadius = "2mm";
    selEl.style.display = "block";
    flash("色帯を適用しました");
  }
  function fmtBox() {            // 枠囲み
    if (!needSel()) return;
    var bg = document.getElementById("fmt-bg").value;
    selEl.style.border = "1.5px solid " + bg; selEl.style.borderRadius = "2mm";
    selEl.style.padding = "3mm";
    flash("枠を適用しました");
  }
  function fmtClear() {
    if (!needSel()) return;
    ["background", "color", "padding", "border", "borderRadius"].forEach(function (k) { selEl.style[k] = ""; });
    flash("書式をクリアしました");
  }
  function onBg() { if (needSel()) selEl.style.background = document.getElementById("fmt-bg").value; }
  function onFg() { if (needSel()) selEl.style.color = document.getElementById("fmt-fg").value; }

  // ================= 段組(2/3) =================
  var LSKEY_COLS = "kyodo_cols_" + issue;
  function applyCols(n) {
    pages.forEach(function (p) { p.style.setProperty("--cols", n); });
    document.querySelectorAll("[data-cols]").forEach(function (b) {
      b.classList.toggle("ed-primary", b.getAttribute("data-cols") === String(n));
    });
  }
  function setCols(n) { applyCols(n); localStorage.setItem(LSKEY_COLS, n); fitFill(); }
  function loadCols() { var n = localStorage.getItem(LSKEY_COLS); if (n) applyCols(n); }

  // ===== 文字サイズ手動調整（自動フィットを上書き・ピン留め） =====
  var LSKEY_FITM = "kyodo_fitm_" + issue;
  function applyManualFit(v) { pages.forEach(function (p) { p.style.setProperty("--fit", v); }); }
  function fontStep(delta) {
    if (delta === 0) { localStorage.removeItem(LSKEY_FITM); fitFill(); flash("文字サイズを自動に戻しました"); return; }
    var cur = parseFloat(localStorage.getItem(LSKEY_FITM)) ||
              parseFloat(pages[0] && pages[0].style.getPropertyValue("--fit")) || 1;
    var v = Math.max(0.6, Math.min(2.2, cur + delta * 0.06));
    v = Math.round(v * 1000) / 1000;
    applyManualFit(v); localStorage.setItem(LSKEY_FITM, v);
    flash("文字サイズ " + Math.round(v * 100) + "%（手動）");
  }

  // ===== 画像：大きさ・切り抜き位置の編集 =====
  var curImg = null;
  function selectImg(img) {
    if (curImg) curImg.classList.remove("ed-imgsel");
    curImg = img; if (curImg) curImg.classList.add("ed-imgsel");
  }
  // ===== 記事を「大きく(特集)」/「標準」に =====
  function curArticle() {
    var el = (selEl && selEl.closest && selEl.closest("article")) ||
             (curImg && curImg.closest && curImg.closest("article"));
    return el;
  }
  function featArticle(on) {
    var a = curArticle();
    if (!a) { flash("先に大きくしたい記事をクリックで選んでください"); return; }
    a.classList.toggle("hero-article", on === "on");
    fitFill();
    flash(on === "on" ? "記事を特集(大)にしました" : "記事を標準に戻しました");
  }

  function imgAction(kind) {
    if (!curImg) { flash("先に写真をクリックで選んでください"); return; }
    var h = parseFloat(getComputedStyle(curImg).height) || 120;
    if (kind === "bigger") curImg.style.height = Math.round(h * 1.12) + "px";
    else if (kind === "smaller") curImg.style.height = Math.round(h * 0.9) + "px";
    else if (kind === "crop") {
      var order = ["center", "top", "bottom"];
      var idx = (parseInt(curImg.dataset.crop || "0", 10) + 1) % order.length;
      curImg.dataset.crop = idx;
      curImg.style.objectPosition = order[idx];
      flash("切り抜き位置: " + order[idx]);
    }
  }

  // ===== オートフィット：本文を拡縮し下端まで充填。ただし溢れ（3列目/はみ出し）は絶対に出さない =====
  function overflowing(cols) {
    return cols.scrollWidth > cols.clientWidth + 4 || cols.scrollHeight > cols.clientHeight + 4;
  }
  function fitFill() {
    if (freeOn) return;
    var man = parseFloat(localStorage.getItem(LSKEY_FITM));  // 手動指定があれば優先
    if (!isNaN(man)) { applyManualFit(man); fitPaper(); return; }
    var pel = document.getElementById("paper");
    var savedZoom = pel ? pel.style.zoom : "";
    if (pel) pel.style.zoom = 1;                 // 計測は等倍で
    pages.forEach(function (p) {
      var cols = p.querySelector(".cols"); if (!cols) return;
      var N = parseInt(getComputedStyle(p).getPropertyValue("--cols")) || 2;
      var fixedH = cols.clientHeight;
      // ① 単一列高から初期推定（やや控えめ0.92）
      var fit = parseFloat(p.style.getPropertyValue("--fit")) || 1;
      for (var i = 0; i < 2; i++) {
        p.style.setProperty("--fit", fit);
        var pc = cols.style.columnCount, ph = cols.style.height;
        cols.style.columnCount = "1"; cols.style.height = "auto";
        var T = cols.scrollHeight;
        cols.style.columnCount = pc; cols.style.height = ph;
        if (T <= 0) break;
        fit = Math.max(0.55, Math.min(1.8, fit * (fixedH * N * 0.92) / T));
      }
      p.style.setProperty("--fit", fit);
      // ② 実レイアウトで溢れていたら、収まるまで3%ずつ縮小
      for (var g = 0; g < 26 && overflowing(cols) && fit > 0.55; g++) {
        fit = Math.max(0.55, fit - 0.03);
        p.style.setProperty("--fit", fit);
      }
      // ③ まだ空きがあり溢れていなければ、溢れ直前まで1.5%ずつ拡大
      for (var h = 0; h < 20 && !overflowing(cols) && fit < 1.8; h++) {
        p.style.setProperty("--fit", Math.min(1.8, fit + 0.015));
        if (overflowing(cols)) { p.style.setProperty("--fit", fit); break; }
        fit = Math.min(1.8, fit + 0.015);
      }
      p.style.setProperty("--fit", (Math.round(fit * 1000) / 1000));
    });
    if (pel) pel.style.zoom = savedZoom || "";
    fitPaper();
  }

  // ================= 素材プール（未掲載素材から記事を追加） =================
  var POOL = [];
  try { POOL = JSON.parse((document.getElementById("ed-pool") || {}).textContent || "[]"); } catch (e) { POOL = []; }
  var poolPanel = null;
  function esc(s) { var d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }
  function catColor(t) {
    t = t || "";
    if (/防災|災害|被災|避難|豪雨|地震|牛鬼会議/.test(t)) return ["防災・地域安全", "#c0392b"];
    if (/助成|補助|基金|奨学|給付/.test(t)) return ["助成金", "#2f93a4"];
    if (/講座|イベント|フェス|まつり|体験|公開講座|上映|花火|ひろば/.test(t)) return ["イベント", "#e67e22"];
    if (/子ども|食堂|福祉|看護|寄付|支援/.test(t)) return ["福祉・子ども", "#8e44ad"];
    return ["活動報告", "#5c9a2f"];
  }
  function insertPoolItem(it) {
    var cols = currentCols(); if (!cols) return;
    var cc = catColor(it.title + it.body);
    var art = document.createElement("article");
    art.className = "art"; art.setAttribute("data-ed-new", "1"); art.style.setProperty("--c", cc[1]);
    art.innerHTML = '<span class="cat">' + cc[0] + '</span><h3>' + esc(it.title) + '</h3>' +
      (it.image ? '<figure><img src="' + it.image + '" alt=""></figure>' : '') +
      '<p>' + esc(it.body) + '</p>';
    cols.appendChild(art);
    art.querySelectorAll(TEXT_SEL).forEach(function (t) { t.setAttribute("contenteditable", "true"); });
    var img = art.querySelector("img");
    if (img) { img.addEventListener("click", onImgClick); img.addEventListener("dblclick", onImgDbl); }
    art.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(fitFill, 80);
    flash("素材を記事にしました：「" + it.title + "」");
  }
  function togglePool() {
    if (poolPanel) { poolPanel.remove(); poolPanel = null; return; }
    if (!editing) setEditing(true);
    poolPanel = document.createElement("div"); poolPanel.className = "ed-pool-panel";
    var h = '<div class="pph"><b>📎 未掲載の素材（この月）' + POOL.length + '件</b><button class="ed-btn" id="pp-close">閉じる</button></div>';
    if (!POOL.length) h += '<p style="padding:14px;color:#666">この月の未使用素材はありません。</p>';
    POOL.forEach(function (it, i) {
      var cc = catColor(it.title + it.body);
      h += '<div class="ppi"><span class="ppi-tag" style="background:' + cc[1] + '">' + cc[0] + '</span>' +
        (it.image ? '<img src="' + it.image + '">' : '') +
        '<div class="ppi-b"><b>' + esc(it.title) + '</b><p>' + esc(it.body) + '</p>' +
        '<button class="ed-btn ed-primary" data-pi="' + i + '">＋この記事を入れる</button></div></div>';
    });
    poolPanel.innerHTML = h; document.body.appendChild(poolPanel);
    poolPanel.querySelector("#pp-close").addEventListener("click", togglePool);
    poolPanel.querySelectorAll("[data-pi]").forEach(function (btn) {
      btn.addEventListener("click", function () { insertPoolItem(POOL[parseInt(btn.getAttribute("data-pi"), 10)]); });
    });
  }

  // ================= 見出しAI候補から選ぶ =================
  var HLS = [];
  try { HLS = JSON.parse((document.getElementById("ed-headlines") || {}).textContent || "[]"); } catch (e) { HLS = []; }
  var hlPanel = null;
  function toggleHeadlines() {
    if (hlPanel) { hlPanel.remove(); hlPanel = null; return; }
    if (!editing) setEditing(true);
    var target = document.querySelector(".lead-headline");
    if (!target) { flash("大見出しが見つかりません"); return; }
    hlPanel = document.createElement("div"); hlPanel.className = "ed-pool-panel";
    var h = '<div class="pph"><b>💡 見出し案（AI）</b><button class="ed-btn" id="hl-close">閉じる</button></div>';
    if (!HLS.length) h += '<p style="padding:14px;color:#666">候補がありません（gen_headlines.py 未実行）。</p>';
    HLS.forEach(function (t, i) {
      h += '<div class="ppi"><div class="ppi-b"><b>' + esc(t) + '</b>' +
        '<button class="ed-btn ed-primary" data-hi="' + i + '">この見出しにする</button></div></div>';
    });
    h += '<div class="ppi"><div class="ppi-b" style="color:#666;font-size:11px">選んだ後も見出しを直接クリックして微調整できます。</div></div>';
    hlPanel.innerHTML = h; document.body.appendChild(hlPanel);
    hlPanel.querySelector("#hl-close").addEventListener("click", toggleHeadlines);
    hlPanel.querySelectorAll("[data-hi]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        target.textContent = HLS[parseInt(btn.getAttribute("data-hi"), 10)];
        setTimeout(fitFill, 60); flash("大見出しを差し替えました");
      });
    });
  }

  // ================= A3 PDF 出力 =================
  function exportPDF() {
    var ok = confirm(
      "A3 PDFで保存します。印刷ダイアログで以下を必ず設定してください:\n\n" +
      "・送信先／プリンター：PDFに保存\n" +
      "・用紙サイズ：A3\n" +
      "・余白：なし（None）\n" +
      "・倍率：100%（「用紙に合わせる」はOFF）\n" +
      "・背景のグラフィック：ON（詳細設定内）\n\n" +
      "OKで印刷ダイアログを開きます。");
    if (!ok) return;
    setTimeout(function () { window.print(); }, 200);
  }

  // ================= Canvaへ保存（案内） =================
  function toCanva() {
    var url = location.href.split("#")[0];
    try { if (navigator.clipboard) navigator.clipboard.writeText(url); } catch (e) {}
    alert(
      "Canvaへ保存する方法\n\n" +
      "【自動・推奨】\n" +
      "1) 💾保存 → ⬇HTML でindex.htmlを書き出し\n" +
      "2) それを公開（リポジトリに差し替え）\n" +
      "3) Claudeに「Canvaへ取り込んで」と伝える\n" +
      "→ 公開URLから版面そのままCanvaに取り込みます\n\n" +
      "【手動】\n" +
      "🖨A3 PDFでPDF化 → Canvaの「アップロード」からデザイン化\n\n" +
      "公開URLをコピーしました:\n" + url
    );
  }

  // ================= 画面WYSIWYGズーム（実物A3を画面幅に合わせて縮小表示） =================
  function fitPaper() {
    var el = document.getElementById("paper"); if (!el) return;
    if (freeOn) { el.style.zoom = 1; return; }   // 自由配置中は等倍（ドラッグ座標のズレ防止）
    var pageW = 297 * 96 / 25.4;                  // 297mm ≈ 1122.5px
    el.style.zoom = Math.min(1, (window.innerWidth - 20) / pageW);
  }
  window.addEventListener("resize", fitPaper);
  window.addEventListener("load", fitFill);   // 画像ロード後に再フィット（溢れ防止）
  // 各画像の読み込み完了でも再フィット（初回のみ・デバウンス）
  var _reft = null;
  colsList.forEach(function (cols) {
    cols.querySelectorAll("img").forEach(function (img) {
      if (!img.complete) img.addEventListener("load", function () {
        clearTimeout(_reft); _reft = setTimeout(fitFill, 120);
      }, { once: true });
    });
  });

  // ---- ボタン配線 ----
  function on(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener("click", fn); }
  on("ed-toggle", function () { setEditing(!editing); });
  on("ed-done", function () { setEditing(false); });
  on("ed-save", save);
  on("ed-export", exportHtml);
  on("ed-reset", reset);
  on("ed-free", function () { if (freeOn) exitFree(); else enterFree(); });
  on("ed-pdf", exportPDF);
  on("ed-canva", toCanva);
  on("ed-publish", publish);
  on("fmt-band", fmtBand);
  on("fmt-box", fmtBox);
  on("fmt-clear", fmtClear);
  var bgEl = document.getElementById("fmt-bg"); if (bgEl) bgEl.addEventListener("input", onBg);
  var fgEl = document.getElementById("fmt-fg"); if (fgEl) fgEl.addEventListener("input", onFg);
  colsList.forEach(function (cols) { cols.addEventListener("click", pickTarget); });
  ["t", "b", "l", "r"].forEach(function (k) {
    var el = document.getElementById("mg-" + k);
    if (el) el.addEventListener("input", onMarginInput);
  });
  document.querySelectorAll("[data-cols]").forEach(function (b) {
    b.addEventListener("click", function () { setCols(b.getAttribute("data-cols")); });
  });
  document.querySelectorAll("[data-fs]").forEach(function (b) {
    b.addEventListener("click", function () { fontStep(parseInt(b.getAttribute("data-fs"), 10)); });
  });
  document.querySelectorAll("[data-img]").forEach(function (b) {
    b.addEventListener("click", function () { imgAction(b.getAttribute("data-img")); });
  });
  document.querySelectorAll("[data-feat]").forEach(function (b) {
    b.addEventListener("click", function () { featArticle(b.getAttribute("data-feat")); });
  });
  loadMargins();
  loadCols();

  // 挿入(追加)ボタン
  Array.prototype.forEach.call(document.querySelectorAll("[data-ins]"), function (btn) {
    btn.addEventListener("click", function () { insertBlock(btn.getAttribute("data-ins")); });
  });

  // 挿入先ページ（最後に触れた列）を追従＋文字編集後に自動フィット
  var _eft = null;
  colsList.forEach(function (cols) {
    ["mousedown", "focusin"].forEach(function (ev) {
      cols.addEventListener(ev, function () { activeCols = cols; });
    });
    cols.addEventListener("focusout", function () {          // 文字の増減後に再フィット（手動サイズ時は無効）
      if (!editing) return; clearTimeout(_eft); _eft = setTimeout(fitFill, 350);
    });
  });
  on("ed-refit", function () {                              // 「整える」＝自動フィットに戻して充填
    localStorage.removeItem(LSKEY_FITM); fitFill(); flash("紙面を整えました（自動フィット）");
  });
  on("ed-pool-btn", togglePool);
  on("ed-hl-btn", toggleHeadlines);
  activeCols = colsList[0] || null;
  fitFill();   // オートフィット→内部でfitPaperも呼ぶ
})();
