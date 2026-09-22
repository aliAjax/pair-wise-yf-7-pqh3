/* 稿件连排台 · 界面接入
 * 只负责 DOM 渲染与事件绑定，规则走 ComposerRules，状态走 ComposerStore。
 */
window.ComposerUI = (() => {
  const store = window.ComposerStore;
  const rules = window.ComposerRules;

  const els = {};
  const STATUS_META = {
    draft: { label: "草稿 · 待校验", cls: "draft" },
    pending: { label: "待确认", cls: "pending" },
    confirmed: { label: "已确认", cls: "ok" }
  };
  const REASON_LABELS = {
    text: "改字退回",
    settings: "改版式退回",
    manuscript: "换稿退回",
    restore: "恢复快照退回"
  };

  function init() {
    bindElements();
    bindEvents();
    store.subscribe(render);
    render(store.getView());
  }

  function bindElements() {
    [
      "composerStatusBadge",
      "composerNotice",
      "manuscriptList",
      "manuscriptCount",
      "manuscriptEditor",
      "composerCharCount",
      "composerDirtyHint",
      "composerPaper",
      "composerFlow",
      "typesetBtn",
      "confirmLayoutBtn",
      "rejectLayoutBtn",
      "saveManuscriptBtn",
      "previewTag",
      "pageStage",
      "pageIndicator",
      "prevPageBtn",
      "nextPageBtn",
      "layoutStats",
      "violationList",
      "confirmedInfo",
      "snapshotList"
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    els.manuscriptEditor.addEventListener("input", () => store.setEditorText(els.manuscriptEditor.value));
    els.composerPaper.addEventListener("change", () => store.setSettings({ paperSize: els.composerPaper.value }));
    els.composerFlow.addEventListener("change", () => store.setSettings({ flowMode: els.composerFlow.value }));
    els.typesetBtn.addEventListener("click", () => store.runTypeset());
    els.confirmLayoutBtn.addEventListener("click", () => store.confirmCandidate());
    els.rejectLayoutBtn.addEventListener("click", () => store.rejectCandidate());
    els.saveManuscriptBtn.addEventListener("click", () => {
      const title = window.prompt("稿样名称", Array.from(els.manuscriptEditor.value.trim()).slice(0, 8).join(""));
      if (title !== null) store.saveManuscript(title);
    });
    els.prevPageBtn.addEventListener("click", () => store.setActivePage(store.getView().activePage - 1));
    els.nextPageBtn.addEventListener("click", () => store.setActivePage(store.getView().activePage + 1));

    els.manuscriptList.addEventListener("click", (event) => {
      const loadButton = event.target.closest("[data-load-manuscript]");
      const deleteButton = event.target.closest("[data-delete-manuscript]");
      if (loadButton) store.loadManuscript(loadButton.dataset.loadManuscript);
      if (deleteButton) store.deleteManuscript(deleteButton.dataset.deleteManuscript);
    });

    els.snapshotList.addEventListener("click", (event) => {
      const restoreButton = event.target.closest("[data-restore-snapshot]");
      if (restoreButton) store.restoreSnapshot(restoreButton.dataset.restoreSnapshot);
    });
  }

  function render(view) {
    renderStatus(view);
    renderManuscripts(view);
    renderEditor(view);
    renderActions(view);
    renderPreview(view);
    renderSnapshots(view);
  }

  function renderStatus(view) {
    const meta = STATUS_META[view.status];
    const version = view.status === "confirmed" && view.state.confirmed ? ` · 第${view.state.confirmed.version}版` : "";
    els.composerStatusBadge.textContent = `${meta.label}${version}`;
    els.composerStatusBadge.className = `badge ${meta.cls}`;
    els.composerNotice.textContent = view.notice || "";
  }

  function renderManuscripts(view) {
    const { manuscripts } = view.state;
    els.manuscriptCount.textContent = `${manuscripts.length}篇稿样`;
    els.manuscriptList.innerHTML = manuscripts
      .map((item) => {
        const chars = Array.from(item.text.replace(/\r?\n/g, "")).length;
        const paper = rules.PAPER_SPECS[item.paperSize]?.label || "明信片";
        const flow = item.flowMode === "vertical" ? "竖排" : "横排";
        return `
          <article class="manuscript-item">
            <div class="manuscript-meta">
              <strong>${escapeHtml(item.title)}${item.preset ? '<span class="preset-tag">预置</span>' : ""}</strong>
              <span>${paper} · ${flow} · ${chars}字</span>
            </div>
            <div class="manuscript-actions">
              <button type="button" data-load-manuscript="${item.id}">载入</button>
              ${item.preset ? "" : `<button type="button" data-delete-manuscript="${item.id}">删除</button>`}
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderEditor(view) {
    if (els.manuscriptEditor.value !== view.state.editorText) {
      els.manuscriptEditor.value = view.state.editorText;
    }
    if (els.composerPaper.value !== view.state.settings.paperSize) {
      els.composerPaper.value = view.state.settings.paperSize;
    }
    if (els.composerFlow.value !== view.state.settings.flowMode) {
      els.composerFlow.value = view.state.settings.flowMode;
    }
    const chars = Array.from(view.state.editorText.replace(/\r?\n/g, "")).length;
    els.composerCharCount.textContent = `共 ${chars} 字`;
    const hints = {
      draft: "草稿未排版或已有改动",
      pending: "排版结果待确认",
      confirmed: "草稿与已确认版面一致"
    };
    els.composerDirtyHint.textContent = hints[view.status];
  }

  function renderActions(view) {
    const hasText = Boolean(view.state.editorText.trim());
    const candidate = view.state.candidate;
    els.typesetBtn.disabled = !hasText;
    els.confirmLayoutBtn.disabled = !candidate || !candidate.report.ok;
    els.rejectLayoutBtn.disabled = !candidate;
    els.saveManuscriptBtn.disabled = !hasText;
  }

  function renderPreview(view) {
    if (!view.display) {
      els.previewTag.textContent = "尚未排版";
      els.previewTag.className = "preview-tag";
      els.pageStage.innerHTML = `<p class="empty-state">在左侧载入稿样或编辑正文，点击「排版校验」逐字排入版页。</p>`;
      els.pageIndicator.textContent = "无版页";
      els.prevPageBtn.disabled = true;
      els.nextPageBtn.disabled = true;
      els.layoutStats.textContent = "";
      els.violationList.innerHTML = "";
      return;
    }

    const { layout, report, source } = view.display;
    const horizontal = layout.flowMode !== "vertical";
    const paper = rules.PAPER_SPECS[layout.paperKey]?.label || layout.paperKey;
    els.previewTag.textContent =
      source === "candidate"
        ? `预览：待确认排版（未生效） · ${paper} · ${horizontal ? "横排" : "竖排"}`
        : `预览：已确认版面 · 第${view.state.confirmed.version}版 · ${paper} · ${horizontal ? "横排" : "竖排"}`;
    els.previewTag.className = `preview-tag ${source}`;

    els.pageStage.innerHTML = buildPageGrid(layout, view.activePage);
    els.pageIndicator.textContent = `第 ${view.activePage + 1} / ${view.pageCount} 页`;
    els.prevPageBtn.disabled = view.activePage <= 0;
    els.nextPageBtn.disabled = view.activePage >= view.pageCount - 1;

    const stats = report.stats;
    els.layoutStats.textContent = `共${stats.chars}字 · ${stats.lines}行 · ${stats.pages}页 · 每行${layout.capacity}字 · 每页${layout.linesPerPage}行 · 回退${stats.backtracks}处 · 悬挂${stats.hangs}处`;

    const items = [
      ...report.violations.map((item) => ({ level: "error", message: item.message })),
      ...report.warnings.map((item) => ({ level: "warn", message: item.message }))
    ];
    els.violationList.innerHTML = items.length
      ? items.map((item) => `<p class="violation-item ${item.level}">${escapeHtml(item.message)}</p>`).join("")
      : `<p class="violation-item ok">行首行尾禁则校验通过，原字序与全部字符无缺失。</p>`;
  }

  function buildPageGrid(layout, pageIndex) {
    const horizontal = layout.flowMode !== "vertical";
    const capacity = layout.capacity;
    const linesPerPage = layout.linesPerPage;
    // 预留一格用于展示行尾悬挂的收束标点
    const cols = horizontal ? capacity + 1 : linesPerPage;
    const rows = horizontal ? linesPerPage : capacity + 1;
    const pageLines = layout.pages[pageIndex] || [];
    const occupied = new Map();

    pageLines.forEach((line, lineIndex) => {
      let offset = 0;
      line.forEach((token) => {
        Array.from(token.text).forEach((ch, charIndex) => {
          const pos = offset + charIndex + 1;
          const key = horizontal ? `${lineIndex + 1}:${pos}` : `${pos}:${linesPerPage - lineIndex}`;
          occupied.set(key, { ch, token });
        });
        offset += token.width;
      });
    });

    const cells = [];
    for (let row = 1; row <= rows; row += 1) {
      for (let col = 1; col <= cols; col += 1) {
        const hit = occupied.get(`${row}:${col}`);
        if (!hit) {
          cells.push(`<span class="page-cell empty" style="grid-row:${row};grid-column:${col}"></span>`);
          continue;
        }
        const token = hit.token;
        const cls = [
          "page-cell",
          token.opening ? "opening" : "",
          token.closing ? "closing" : "",
          token.atomic ? "atomic" : "",
          token.retreated ? "retreated" : "",
          token.hanging ? "hanging" : ""
        ]
          .filter(Boolean)
          .join(" ");
        cells.push(`<span class="${cls}" style="grid-row:${row};grid-column:${col}">${escapeHtml(hit.ch)}</span>`);
      }
    }

    return `<div class="page-grid ${horizontal ? "horizontal" : "vertical"}" style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},minmax(0,1fr))">${cells.join("")}</div>`;
  }

  function renderSnapshots(view) {
    const { confirmed, snapshots } = view.state;
    els.confirmedInfo.innerHTML = confirmed
      ? `
        <div class="confirmed-card">
          <strong>第${confirmed.version}版 · 已确认</strong>
          <span>${new Date(confirmed.confirmedAt).toLocaleString("zh-CN")}</span>
          <span>${confirmed.report.stats.chars}字 · ${confirmed.report.stats.pages}页 · ${confirmed.layout.flowMode === "vertical" ? "竖排" : "横排"}</span>
        </div>
      `
      : `<p class="empty">尚无已确认版面。</p>`;

    els.snapshotList.innerHTML = snapshots.length
      ? snapshots
          .map(
            (item) => `
          <article class="snapshot-item">
            <div class="manuscript-meta">
              <strong>第${item.version}版快照</strong>
              <span>${REASON_LABELS[item.reason] || "退回"} · ${new Date(item.savedAt).toLocaleString("zh-CN")}</span>
              <span>${item.report.stats.chars}字 · ${item.report.stats.pages}页</span>
            </div>
            <div class="manuscript-actions">
              <button type="button" data-restore-snapshot="${item.id}">恢复</button>
            </div>
          </article>
        `
          )
          .join("")
      : `<p class="empty">还没有快照。已确认版面被改字后会自动留底。</p>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  return { init };
})();

window.ComposerUI.init();
