/* 稿件连排台 · 版页状态
 * 持有草稿、版页、确认状态与上一版快照；数据只存浏览器 localStorage，刷新保留。
 */
window.TypeStore = (() => {
  const storageKey = "zfl16-type-composer";
  const SNAPSHOT_LIMIT = 5;

  // 预置稿样：均含书名号《》、句号。与省略号……
  const PRESETS = [
    {
      name: "书船夜话",
      text: "《夜航船》序里写道：天下学问，惟夜航船中最难对付。……张岱录下零星掌故，只为“且勿使僧人伸脚”。《陶庵梦忆》《西湖梦寻》亦然，字字皆旧梦。"
    },
    {
      name: "雨窗夜读",
      text: "雨落在檐前，一声，又一声……翻《东京梦华录》，州桥夜市、樊楼灯火，皆在字里行间。读至“举目则青楼画阁，绣户珠帘”一句，不觉掩卷。……雨还未停，取《梦粱录》再读：钱塘旧事、临安风月，一页一页翻过去，像檐下的雨，落也落不完。灯下人倦，书页微潮，字里行间都是水气。忽忆古人云：“听雨僧庐下。”此情此景，庶几近之。"
    },
    {
      name: "山居短章",
      text: "山中方七日，世上已千年。……晨起汲泉，暮归负薪；案头唯《水经注》一册、残墨半锭。\n夜雨初歇，松风入户。偶得句云：“云深不知处。”……掷笔一笑。"
    }
  ];

  function createDefaultState() {
    return {
      draftText: "", // 已入版稿件
      editText: "", // 编辑缓冲（刷新保留）
      pages: [],
      status: "unchecked", // unchecked=待校验 / confirmed=已确认
      confirmedAt: null,
      confirmedSignature: null,
      settings: { paperSize: "postcard", flow: "horizontal" },
      snapshots: [],
      presetIndex: 0,
      updatedAt: null
    };
  }

  let state = load();

  function load() {
    const fallback = createDefaultState();
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return fallback;
      const parsed = JSON.parse(saved);
      return { ...fallback, ...parsed, settings: { ...fallback.settings, ...(parsed.settings || {}) } };
    } catch {
      return fallback;
    }
  }

  function save() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function signature(text, settings) {
    return JSON.stringify({ text, paper: settings.paperSize, flow: settings.flow });
  }

  function pushSnapshot() {
    state.snapshots.unshift({
      id: crypto.randomUUID(),
      text: state.draftText,
      pages: structuredClone(state.pages),
      settings: { ...state.settings },
      confirmedAt: state.confirmedAt,
      savedAt: new Date().toISOString()
    });
    state.snapshots = state.snapshots.slice(0, SNAPSHOT_LIMIT);
  }

  // 已确认版面一旦发生变更（改一字或改版式），退回待校验并留上一版快照
  function revertIfConfirmed(nextText) {
    if (state.status !== "confirmed") return;
    if (signature(nextText, state.settings) === state.confirmedSignature) return;
    pushSnapshot();
    state.status = "unchecked";
    state.confirmedAt = null;
    state.confirmedSignature = null;
  }

  // 提交排版：校验不过则拒绝，原版页与草稿不变
  function commitLayout(nextText) {
    const layout = window.TypeRules.layoutManuscript(nextText, state.settings.paperSize, state.settings.flow);
    const report = window.TypeRules.validateLayout(nextText, layout);
    if (!report.ok) return { ok: false, report };
    revertIfConfirmed(nextText);
    state.draftText = nextText;
    state.pages = layout.pages;
    state.updatedAt = new Date().toISOString();
    save();
    return { ok: true, report, layout };
  }

  function runTypeset(rawText) {
    const input = window.TypeRules.validateInput(rawText);
    if (!input.ok) return { ok: false, errors: input.errors }; // 拒绝：原版页与草稿不变
    const result = commitLayout(input.text);
    if (!result.ok) {
      return {
        ok: false,
        errors: result.report.checks.filter((check) => !check.ok).map((check) => check.name),
        report: result.report
      };
    }
    return { ok: true, report: result.report };
  }

  function updateSettings(patch) {
    const next = { ...state.settings, ...patch };
    if (next.paperSize === state.settings.paperSize && next.flow === state.settings.flow) {
      return { ok: true, changed: false };
    }
    state.settings = next;
    if (state.draftText) {
      commitLayout(state.draftText); // 版式变更同样触发退回校验与快照
    } else {
      save();
    }
    return { ok: true, changed: true };
  }

  function setEditText(text) {
    state.editText = String(text ?? "");
    save();
  }

  function confirm() {
    if (!state.pages.length) return { ok: false, errors: ["尚未排版，无可确认的版面"] };
    if (state.status === "confirmed") return { ok: false, errors: ["当前版面已确认"] };
    state.status = "confirmed";
    state.confirmedAt = new Date().toISOString();
    state.confirmedSignature = signature(state.draftText, state.settings);
    save();
    return { ok: true };
  }

  function loadPreset(index) {
    const preset = PRESETS[index];
    if (!preset) return { ok: false, errors: ["稿样不存在"] };
    state.presetIndex = index;
    state.editText = preset.text;
    const result = runTypeset(preset.text);
    save();
    return result;
  }

  function restoreSnapshot(id) {
    const snap = state.snapshots.find((item) => item.id === id);
    if (!snap) return { ok: false, errors: ["快照不存在"] };
    if (state.status === "confirmed") pushSnapshot(); // 当前已确认版面也留档
    state.draftText = snap.text;
    state.editText = snap.text;
    state.pages = structuredClone(snap.pages);
    state.settings = { ...snap.settings };
    state.status = "confirmed";
    state.confirmedAt = snap.confirmedAt;
    state.confirmedSignature = signature(snap.text, snap.settings);
    state.updatedAt = new Date().toISOString();
    save();
    return { ok: true };
  }

  // 供界面展示的当前版面校验报告
  function currentReport() {
    if (!state.pages.length) return null;
    const dims = window.TypeRules.getCapacity(state.settings.paperSize, state.settings.flow);
    return window.TypeRules.validateLayout(state.draftText, { pages: state.pages, ...dims });
  }

  function getState() {
    return state;
  }

  // 首次使用自动载入一号稿样，让连排台开箱即有版面
  if (!state.draftText) {
    loadPreset(0);
  }

  return {
    PRESETS,
    getState,
    currentReport,
    runTypeset,
    updateSettings,
    setEditText,
    confirm,
    loadPreset,
    restoreSnapshot
  };
})();
