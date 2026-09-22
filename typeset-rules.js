/* 稿件连排台 · 排版规则引擎
 * 纯函数模块：字符分类、逐字排入、避头尾（整字回退重排）、分页与校验。
 * 不接触 DOM 与本地存储。
 */
window.TypeRules = (() => {
  // 开启标点：不得悬于行尾
  const OPEN_PUNCT = new Set([...`《（【「『〈〔［｛〖“‘`]);
  // 收束标点：不得出现在行首
  const CLOSE_PUNCT = new Set([...`》）】」』〉〕］｝〗”。，、；：？！‰′″’`]);
  // 连字符号：省略号、破折号等成对出现，不可拆行
  const GLUE_CHARS = new Set([...`…‥—―–`]);

  const PAPERS = {
    postcard: { cols: 16, rows: 10, label: "明信片" },
    bookmark: { cols: 7, rows: 18, label: "书签" },
    square: { cols: 12, rows: 12, label: "方形小笺" }
  };

  const FLOW_LABELS = { horizontal: "横排", vertical: "竖排" };

  function normalizeText(text) {
    return String(text ?? "").replace(/\r\n?/g, "\n");
  }

  function isOpenPunct(ch) {
    return OPEN_PUNCT.has(ch);
  }

  function isClosePunct(ch) {
    return CLOSE_PUNCT.has(ch);
  }

  function isGlueChar(ch) {
    return GLUE_CHARS.has(ch);
  }

  // 纸张 + 横竖排 → 每行字数与每页行数（竖排时行列互换）
  function getCapacity(paperKey, flow) {
    const paper = PAPERS[paperKey] || PAPERS.postcard;
    return flow === "vertical"
      ? { capacity: paper.rows, linesPerPage: paper.cols, paper }
      : { capacity: paper.cols, linesPerPage: paper.rows, paper };
  }

  // 判断在 prev 与 next 之间断行是否合规
  function canBreakBetween(prev, next) {
    if (prev === undefined || next === undefined) return true;
    if (isOpenPunct(prev)) return false; // 行尾不悬开启标点
    if (isClosePunct(next)) return false; // 行首不出现收束标点
    if (isGlueChar(prev) && isGlueChar(next)) return false; // 省略号等不拆行
    return true;
  }

  // 单段逐字排入：行满即断；冲突时整字回退至最近合规断点再重排
  function layoutParagraph(chars, capacity) {
    const lines = [];
    let start = 0;
    while (start < chars.length) {
      if (chars.length - start <= capacity) {
        lines.push(chars.slice(start).join(""));
        break;
      }
      let end = start + capacity;
      while (end > start + 1 && !canBreakBetween(chars[end - 1], chars[end])) {
        end -= 1; // 整字回退
      }
      lines.push(chars.slice(start, end).join(""));
      start = end;
    }
    return lines;
  }

  // 整稿连排：保留原字序与全部字符；一页排满才另起版页
  function layoutManuscript(text, paperKey, flow) {
    const normalized = normalizeText(text);
    const dims = getCapacity(paperKey, flow);
    const lines = [];
    normalized.split("\n").forEach((paragraph) => {
      const chars = [...paragraph];
      if (chars.length === 0) {
        lines.push(""); // 空段留空行
        return;
      }
      lines.push(...layoutParagraph(chars, dims.capacity));
    });
    const pages = [];
    for (let i = 0; i < lines.length; i += dims.linesPerPage) {
      pages.push(lines.slice(i, i + dims.linesPerPage));
    }
    return { pages, capacity: dims.capacity, linesPerPage: dims.linesPerPage, lineCount: lines.length };
  }

  // 录入校验：空稿拒绝
  function validateInput(text) {
    const normalized = normalizeText(text);
    const errors = [];
    const hasInk = [...normalized.replaceAll("\n", "")].some((ch) => ch.trim());
    if (!hasInk) errors.push("稿件为空或只有空白，无法排版");
    return { ok: errors.length === 0, errors, text: normalized };
  }

  // 版面校验：字符保全、避头尾、连字符号、容量
  function validateLayout(text, layout) {
    const normalized = normalizeText(text);
    const { pages, capacity, linesPerPage } = layout;
    const lines = pages.flat();
    const checks = [];

    const expected = normalized.replaceAll("\n", "");
    const actual = lines.join("");
    checks.push({
      key: "preserve",
      name: "保留原字序与全部字符",
      ok: actual === expected,
      detail: actual === expected ? `${[...expected].length} 字全数入版` : "入版字面与稿件不一致"
    });

    const badHeads = [];
    lines.forEach((line, index) => {
      const first = [...line][0];
      if (first && isClosePunct(first)) badHeads.push(index + 1);
    });
    checks.push({
      key: "head",
      name: "行首无收束标点",
      ok: badHeads.length === 0,
      detail: badHeads.length === 0 ? "全部行首合规" : `第 ${badHeads.join("、")} 行违规`
    });

    const badTails = [];
    lines.forEach((line, index) => {
      const chars = [...line];
      const last = chars[chars.length - 1];
      if (last && isOpenPunct(last)) badTails.push(index + 1);
    });
    checks.push({
      key: "tail",
      name: "行尾不悬开启标点",
      ok: badTails.length === 0,
      detail: badTails.length === 0 ? "全部行尾合规" : `第 ${badTails.join("、")} 行违规`
    });

    const splitGlue = [];
    for (let i = 0; i < lines.length - 1; i += 1) {
      const tail = [...lines[i]].at(-1);
      const head = [...lines[i + 1]][0];
      if (tail && head && isGlueChar(tail) && isGlueChar(head)) splitGlue.push(i + 1);
    }
    checks.push({
      key: "glue",
      name: "省略号等连字符号未拆行",
      ok: splitGlue.length === 0,
      detail: splitGlue.length === 0 ? "连字符号均完整" : `第 ${splitGlue.join("、")} 行后被拆开`
    });

    const overLines = lines.filter((line) => [...line].length > capacity).length;
    const overPages = pages.filter((page) => page.length > linesPerPage).length;
    checks.push({
      key: "capacity",
      name: "行、页容量不超限",
      ok: overLines === 0 && overPages === 0,
      detail:
        overLines === 0 && overPages === 0
          ? `每行 ≤ ${capacity} 字，每页 ≤ ${linesPerPage} 行`
          : "存在超容量行或版页"
    });

    return { ok: checks.every((check) => check.ok), checks };
  }

  return {
    PAPERS,
    FLOW_LABELS,
    normalizeText,
    isOpenPunct,
    isClosePunct,
    isGlueChar,
    getCapacity,
    layoutManuscript,
    validateInput,
    validateLayout
  };
})();
