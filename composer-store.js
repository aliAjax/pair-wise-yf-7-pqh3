/* 稿件连排台 · 版页状态
 * 草稿、待确认排版、已确认版面与历史快照的唯一数据源。
 * 数据只存浏览器 localStorage，刷新后保留。
 */
window.ComposerStore = (() => {
  const STORAGE_KEY = "zfl16-manuscript-composer";
  const SNAPSHOT_LIMIT = 10;
  const MANUSCRIPT_LIMIT = 12;

  const PRESET_MANUSCRIPTS = [
    {
      id: "preset-wind",
      preset: true,
      title: "《晚风集》节选",
      paperSize: "postcard",
      flowMode: "horizontal",
      text: "晚风翻过城墙，把《山海经》的最后一页吹得哗哗作响。我合上书本，听见巷口有人喊：“回家吃饭——”声音拖得老长，像一条……像一条看不见的河。母亲在灯下补衣，针脚密得像《齐民要术》里的小字，她说：“别急，日子长着呢。”我点点头，把没写完的句子折好，夹进书页……窗外的槐花落在石阶上，一层白，一层香。我数着更声，一下，两下，直到月亮偏西。"
    },
    {
      id: "preset-rain",
      preset: true,
      title: "雨中山寺",
      paperSize: "bookmark",
      flowMode: "vertical",
      text: "雨落青山外，钟鸣古寺前。行人收伞入山门，见壁上题着《听雨录》三字。老僧不语，只指了指檐角……雨声渐密，如读一页无字的书。我忽然明白：有些路要一个人走，有些话说到一半就好……"
    },
    {
      id: "preset-tea",
      preset: true,
      title: "茶烟小记",
      paperSize: "square",
      flowMode: "vertical",
      text: "茶烟升起的时候，祖母翻开《茶经》，说：“水要沸，心要静。”我点头，看窗外月色漫过台阶。她又说，从前人家一册《茶经》传三代，页脚全是批注……我伸手去翻，指尖碰到岁月的温度。原来所谓传承，不过是把一句话轻轻放进另一个人的掌心。"
    }
  ];

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function defaultState() {
    return {
      manuscripts: PRESET_MANUSCRIPTS.map((item) => ({ ...item })),
      editorText: PRESET_MANUSCRIPTS[0].text,
      settings: { paperSize: PRESET_MANUSCRIPTS[0].paperSize, flowMode: PRESET_MANUSCRIPTS[0].flowMode },
      candidate: null,
      confirmed: null,
      snapshots: [],
      versionCounter: 0,
      activePage: 0,
      notice: "已载入预置稿样，点击「排版校验」开始。"
    };
  }

  let state = loadState();
  const listeners = new Set();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const saved = JSON.parse(raw);
      const base = defaultState();
      const custom = Array.isArray(saved.manuscripts) ? saved.manuscripts.filter((item) => item && !item.preset) : [];
      return {
        ...base,
        ...saved,
        manuscripts: [...base.manuscripts, ...custom],
        settings: { ...base.settings, ...(saved.settings || {}) },
        candidate: saved.candidate || null,
        confirmed: saved.confirmed || null,
        snapshots: Array.isArray(saved.snapshots) ? saved.snapshots : []
      };
    } catch {
      return defaultState();
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时仅保留内存态
    }
  }

  function emit() {
    persist();
    listeners.forEach((fn) => fn(getView()));
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function sameSettings(a, b) {
    return Boolean(a && b && a.paperSize === b.paperSize && a.flowMode === b.flowMode);
  }

  function getStatus() {
    if (state.candidate) return "pending";
    if (state.confirmed) return "confirmed";
    return "draft";
  }

  function getView() {
    const display = state.candidate
      ? { source: "candidate", layout: state.candidate.layout, report: state.candidate.report }
      : state.confirmed
        ? { source: "confirmed", layout: state.confirmed.layout, report: state.confirmed.report }
        : null;
    const pageCount = display ? display.layout.pages.length : 0;
    return {
      state,
      status: getStatus(),
      display,
      pageCount,
      activePage: Math.min(state.activePage, Math.max(0, pageCount - 1)),
      notice: state.notice
    };
  }

  // 草稿或版式一变：待确认排版作废；已确认版面留快照并退回校验
  function invalidateForEdit(reason) {
    let notice = "";
    if (state.candidate && (state.candidate.text !== state.editorText || !sameSettings(state.candidate.settings, state.settings))) {
      state.candidate = null;
      notice = "草稿已改，上一版待确认排版已作废。";
    }
    if (state.confirmed && (state.confirmed.text !== state.editorText || !sameSettings(state.confirmed.settings, state.settings))) {
      const version = state.confirmed.version;
      state.snapshots.unshift({
        id: crypto.randomUUID(),
        version,
        text: state.confirmed.text,
        settings: clone(state.confirmed.settings),
        layout: clone(state.confirmed.layout),
        report: clone(state.confirmed.report),
        savedAt: new Date().toISOString(),
        reason
      });
      state.snapshots = state.snapshots.slice(0, SNAPSHOT_LIMIT);
      state.confirmed = null;
      notice = `草稿已改动，第${version}版已留快照并退回校验。`;
    }
    if (notice) state.notice = notice;
  }

  function setEditorText(text) {
    if (text === state.editorText) return;
    state.editorText = text;
    invalidateForEdit("text");
    emit();
  }

  function setSettings(patch) {
    const next = { ...state.settings, ...patch };
    if (sameSettings(next, state.settings)) return;
    state.settings = next;
    state.activePage = 0;
    invalidateForEdit("settings");
    emit();
  }

  function runTypeset() {
    const text = state.editorText;
    if (!text.trim()) {
      state.notice = "稿件为空，无法排版。";
      emit();
      return null;
    }
    const layout = window.ComposerRules.layoutText(text, state.settings.paperSize, state.settings.flowMode);
    const report = window.ComposerRules.verifyLayout(layout, text);
    state.candidate = {
      id: crypto.randomUUID(),
      text,
      settings: clone(state.settings),
      layout,
      report,
      createdAt: new Date().toISOString()
    };
    state.activePage = 0;
    const stats = report.stats;
    state.notice = report.ok
      ? `排版完成：${stats.chars}字、${stats.lines}行、${stats.pages}页，回退${stats.backtracks}处${stats.hangs ? `、悬挂${stats.hangs}处` : ""}，校验通过，待确认。`
      : `排版完成但校验未通过：${report.violations.length}处违规，请调整稿件或版式。`;
    emit();
    return state.candidate;
  }

  function confirmCandidate() {
    if (!state.candidate) return false;
    if (!state.candidate.report.ok) {
      state.notice = "校验未通过，不能确认版面。";
      emit();
      return false;
    }
    state.versionCounter += 1;
    state.confirmed = {
      ...clone(state.candidate),
      version: state.versionCounter,
      confirmedAt: new Date().toISOString()
    };
    state.candidate = null;
    state.notice = `第${state.versionCounter}版已确认。`;
    emit();
    return true;
  }

  function rejectCandidate() {
    if (!state.candidate) return;
    // 拒绝重排：只丢弃待确认排版，原版页与草稿保持不变
    state.candidate = null;
    state.notice = "已拒绝本次重排，原版页与草稿保持不变。";
    emit();
  }

  function loadManuscript(id) {
    const manuscript = state.manuscripts.find((item) => item.id === id);
    if (!manuscript) return;
    const snapshotsBefore = state.snapshots.length;
    state.editorText = manuscript.text;
    state.settings = { paperSize: manuscript.paperSize, flowMode: manuscript.flowMode };
    state.activePage = 0;
    invalidateForEdit("manuscript");
    const archived = state.snapshots.length > snapshotsBefore ? ` ${state.notice}` : "";
    state.notice = `已载入稿样「${manuscript.title}」，点击「排版校验」开始。${archived}`;
    emit();
  }

  function saveManuscript(title) {
    const text = state.editorText.trim();
    if (!text) return;
    const name = (title || "").trim() || `${Array.from(text).slice(0, 8).join("")}…`;
    const entry = {
      id: crypto.randomUUID(),
      preset: false,
      title: name,
      paperSize: state.settings.paperSize,
      flowMode: state.settings.flowMode,
      text: state.editorText
    };
    const presets = state.manuscripts.filter((item) => item.preset);
    const customs = [entry, ...state.manuscripts.filter((item) => !item.preset)].slice(0, MANUSCRIPT_LIMIT);
    state.manuscripts = [...presets, ...customs];
    state.notice = `已存入稿样「${name}」。`;
    emit();
  }

  function deleteManuscript(id) {
    const target = state.manuscripts.find((item) => item.id === id);
    if (!target || target.preset) return;
    state.manuscripts = state.manuscripts.filter((item) => item.id !== id);
    state.notice = `已删除稿样「${target.title}」。`;
    emit();
  }

  function restoreSnapshot(id) {
    const snapshot = state.snapshots.find((item) => item.id === id);
    if (!snapshot) return;
    state.editorText = snapshot.text;
    state.settings = clone(snapshot.settings);
    state.activePage = 0;
    invalidateForEdit("restore");
    runTypeset();
    state.notice = `已恢复第${snapshot.version}版快照，重新排版待确认。`;
    emit();
  }

  function setActivePage(index) {
    const { pageCount } = getView();
    const next = Math.min(Math.max(0, index), Math.max(0, pageCount - 1));
    if (next === state.activePage) return;
    state.activePage = next;
    emit();
  }

  return {
    subscribe,
    getView,
    setEditorText,
    setSettings,
    runTypeset,
    confirmCandidate,
    rejectCandidate,
    loadManuscript,
    saveManuscript,
    deleteManuscript,
    restoreSnapshot,
    setActivePage
  };
})();
