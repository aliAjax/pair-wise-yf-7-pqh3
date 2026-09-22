/* 稿件连排台 · 界面接入
 * 渲染稿件、版页、状态徽标、校验报告与快照列表，并接线全部交互。
 */
(() => {
  const store = window.TypeStore;
  const rules = window.TypeRules;

  const els = {
    paper: document.querySelector("#composerPaper"),
    flow: document.querySelector("#composerFlow"),
    preset: document.querySelector("#presetSelect"),
    loadPreset: document.querySelector("#loadPresetBtn"),
    input: document.querySelector("#manuscriptInput"),
    typeset: document.querySelector("#typesetBtn"),
    confirm: document.querySelector("#confirmBtn"),
    message: document.querySelector("#composerMessage"),
    report: document.querySelector("#reportList"),
    statusBadge: document.querySelector("#composerStatusBadge"),
    meta: document.querySelector("#composerMeta"),
    pages: document.querySelector("#pagesStrip"),
    pageStates: document.querySelector("#pageStateList"),
    pageCount: document.querySelector("#pageCountLabel"),
    snapshots: document.querySelector("#snapshotList"),
    charCount: document.querySelector("#composerCharCount")
  };

  function esc(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function inkCount(text) {
    return [...String(text).replaceAll("\n", "")].length;
  }

  function showMessage(text, ok) {
    els.message.textContent = text;
    els.message.className = `message ${ok ? "ok" : "bad"}`;
  }

  function renderControls() {
    const state = store.getState();
    els.paper.value = state.settings.paperSize;
    els.flow.value = state.settings.flow;
    els.preset.value = String(state.presetIndex);
    if (els.input.value !== state.editText) els.input.value = state.editText;
    els.charCount.textContent = `${inkCount(state.editText)} 字`;
  }

  function renderStatus() {
    const state = store.getState();
    const confirmed = state.status === "confirmed";
    const paper = rules.PAPERS[state.settings.paperSize];
    els.statusBadge.textContent = confirmed ? "已确认" : "待校验";
    els.statusBadge.className = `badge ${confirmed ? "ok" : "warn"}`;
    if (!state.pages.length) {
      els.meta.textContent = "尚未排版";
    } else {
      const lineCount = state.pages.reduce((sum, page) => sum + page.length, 0);
      const confirmedAt = confirmed && state.confirmedAt ? ` · 确认于 ${new Date(state.confirmedAt).toLocaleString("zh-CN")}` : "";
      els.meta.textContent = `${paper.label} · ${rules.FLOW_LABELS[state.settings.flow]} · ${inkCount(state.draftText)}字 · ${lineCount}行 · ${state.pages.length}版页${confirmedAt}`;
    }
    els.confirm.disabled = confirmed || !state.pages.length;
  }

  function renderPages() {
    const state = store.getState();
    const paper = rules.PAPERS[state.settings.paperSize];
    const vertical = state.settings.flow === "vertical";
    if (!state.pages.length) {
      els.pages.innerHTML = `<p class="empty">还没有版页，点击“排版校验”开始。</p>`;
      return;
    }
    els.pages.innerHTML = state.pages
      .map((lines, pageIndex) => {
        const cellMap = new Map();
        lines.forEach((line, lineIndex) => {
          [...line].forEach((ch, charIndex) => {
            // 竖排：行即列，自右向左排布；横排：行即行，自左向右
            const row = vertical ? charIndex : lineIndex;
            const col = vertical ? paper.cols - 1 - lineIndex : charIndex;
            cellMap.set(`${row}:${col}`, ch);
          });
        });
        const cells = [];
        for (let row = 0; row < paper.rows; row += 1) {
          for (let col = 0; col < paper.cols; col += 1) {
            const ch = cellMap.get(`${row}:${col}`);
            cells.push(`<span class="cell ${ch ? "used" : ""} ${vertical ? "vertical" : ""}">${ch ? esc(ch) : ""}</span>`);
          }
        }
        return `
          <figure class="sheet-wrap">
            <figcaption>第${pageIndex + 1}版页 · ${lines.length}行 · ${inkCount(lines.join(""))}字</figcaption>
            <div class="sheet ${state.settings.paperSize}" style="grid-template-columns: repeat(${paper.cols}, minmax(0, 1fr)); grid-template-rows: repeat(${paper.rows}, minmax(0, 1fr));">
              ${cells.join("")}
            </div>
          </figure>
        `;
      })
      .join("");
  }

  function renderReport() {
    const report = store.currentReport();
    if (!report) {
      els.report.innerHTML = `<li class="empty">尚未排版。</li>`;
      return;
    }
    els.report.innerHTML = report.checks
      .map(
        (check) => `
        <li class="${check.ok ? "ok" : "bad"}">
          <span class="mark">${check.ok ? "✓" : "✕"}</span>
          <div><strong>${check.name}</strong><span>${check.detail}</span></div>
        </li>
      `
      )
      .join("");
  }

  function renderPageStates() {
    const state = store.getState();
    els.pageCount.textContent = `${state.pages.length}版页`;
    els.pageStates.innerHTML =
      state.pages
        .map(
          (lines, index) => `
          <div class="usage-item">
            <strong>第${index + 1}版页</strong>
            <span>${lines.length}行 · ${inkCount(lines.join(""))}字</span>
          </div>
        `
        )
        .join("") || `<p class="empty">暂无版页。</p>`;
  }

  function renderSnapshots() {
    const state = store.getState();
    els.snapshots.innerHTML =
      state.snapshots
        .map((snap) => {
          const paper = rules.PAPERS[snap.settings.paperSize];
          return `
            <article class="draft-item">
              <strong>已确认版 · ${new Date(snap.savedAt).toLocaleString("zh-CN")}</strong>
              <span>${inkCount(snap.text)}字 · ${snap.pages.length}版页 · ${paper ? paper.label : ""}${rules.FLOW_LABELS[snap.settings.flow] || ""}</span>
              <div class="draft-actions">
                <button type="button" data-restore-snapshot="${snap.id}">恢复此版</button>
              </div>
            </article>
          `;
        })
        .join("") || `<p class="empty">还没有快照。已确认版面被修改时会自动留上一版。</p>`;
  }

  function renderAll() {
    renderControls();
    renderStatus();
    renderPages();
    renderReport();
    renderPageStates();
    renderSnapshots();
  }

  els.typeset.addEventListener("click", () => {
    const result = store.runTypeset(els.input.value);
    if (result.ok) {
      const state = store.getState();
      showMessage(`排版完成，校验通过：${state.pages.length} 版页。`, true);
    } else {
      showMessage(`已拒绝：${result.errors.join("；")}。原版页与草稿保持不变。`, false);
    }
    renderAll();
  });

  els.confirm.addEventListener("click", () => {
    const result = store.confirm();
    showMessage(
      result.ok ? "版面已确认。此后改动一字即退回校验，并自动留上一版快照。" : result.errors.join("；"),
      result.ok
    );
    renderAll();
  });

  els.loadPreset.addEventListener("click", () => {
    const result = store.loadPreset(Number(els.preset.value));
    showMessage(
      result.ok ? "稿样已载入并完成排版校验。" : `已拒绝：${result.errors.join("；")}。原版页与草稿保持不变。`,
      result.ok
    );
    renderAll();
  });

  els.paper.addEventListener("change", () => {
    store.updateSettings({ paperSize: els.paper.value });
    renderAll();
  });

  els.flow.addEventListener("change", () => {
    store.updateSettings({ flow: els.flow.value });
    renderAll();
  });

  els.input.addEventListener("input", () => {
    store.setEditText(els.input.value);
    els.charCount.textContent = `${inkCount(els.input.value)} 字`;
  });

  els.snapshots.addEventListener("click", (event) => {
    const button = event.target.closest("[data-restore-snapshot]");
    if (!button) return;
    const result = store.restoreSnapshot(button.dataset.restoreSnapshot);
    showMessage(result.ok ? "已恢复上一版快照。" : result.errors.join("；"), result.ok);
    renderAll();
  });

  els.preset.innerHTML = store.PRESETS.map((preset, index) => `<option value="${index}">${esc(preset.name)}</option>`).join("");
  renderAll();
})();
