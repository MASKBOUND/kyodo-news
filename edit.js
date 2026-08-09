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
})();
