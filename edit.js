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
  function onImgClick(e) {
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
        if (on) img.addEventListener("click", onImgClick);
      });
    });

    // ドラッグ並べ替え
    if (on) {
      if (window.Sortable) {
        colsList.forEach(function (cols) {
          sortables.push(window.Sortable.create(cols, {
            animation: 150, handle: false, draggable: "> *",
            ghostClass: "ed-ghost", chosenClass: "ed-chosen",
            filter: "[contenteditable=true]:focus", preventOnFilter: false
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
      var data = { cols: colsList.map(function (c) { return c.innerHTML; }), at: new Date().toISOString() };
      localStorage.setItem(LSKEY, JSON.stringify(data));
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

  // ---- クリーンなHTMLを書き出し（編集UIを除去） ----
  function exportHtml() {
    var clone = document.documentElement.cloneNode(true);
    ["#editbar", "#ed-toggle"].forEach(function (sel) {
      var n = clone.querySelector(sel); if (n) n.remove();
    });
    clone.querySelectorAll('script[src*="Sortable"],script[src="edit.js"],link[href="edit.css"]')
      .forEach(function (n) { n.remove(); });
    clone.querySelectorAll("[contenteditable]").forEach(function (n) { n.removeAttribute("contenteditable"); });
    clone.querySelectorAll(".ed-ghost,.ed-chosen").forEach(function (n) {
      n.classList.remove("ed-ghost", "ed-chosen");
    });
    var body = clone.querySelector("body");
    if (body) body.classList.remove("editing");
    var html = "<!doctype html>\n" + clone.outerHTML;
    var blob = new Blob([html], { type: "text/html" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kyodo_" + issue + ".html";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    flash("HTMLを書き出しました（index.html として差し替え可）");
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

  // ---- ボタン配線 ----
  function on(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener("click", fn); }
  on("ed-toggle", function () { setEditing(!editing); });
  on("ed-done", function () { setEditing(false); });
  on("ed-save", save);
  on("ed-export", exportHtml);
  on("ed-reset", reset);

  // 挿入(追加)ボタン
  Array.prototype.forEach.call(document.querySelectorAll("[data-ins]"), function (btn) {
    btn.addEventListener("click", function () { insertBlock(btn.getAttribute("data-ins")); });
  });

  // 挿入先ページ（最後に触れた列）を追従
  colsList.forEach(function (cols) {
    ["mousedown", "focusin"].forEach(function (ev) {
      cols.addEventListener(ev, function () { activeCols = cols; });
    });
  });
  activeCols = colsList[0] || null;
})();
