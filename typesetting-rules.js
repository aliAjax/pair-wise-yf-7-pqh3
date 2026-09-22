/* 稿件连排台 · 排版规则
 * 逐字排入、行首行尾禁则、整字回退、分页与校验。
 * 纯函数，不碰 DOM 与存储。
 */
window.ComposerRules = (() => {
  const PAPER_SPECS = {
    postcard: { key: "postcard", label: "明信片", cols: 16, rows: 10 },
    bookmark: { key: "bookmark", label: "书签", cols: 7, rows: 18 },
    square: { key: "square", label: "方形小笺", cols: 12, rows: 12 }
  };

  // 开启标点：不得悬于行尾
  const OPENING_PUNCT = new Set(Array.from("《〈「『【〔〖（［｛“‘"));
  // 收束标点：不得落在行首
  const CLOSING_PUNCT = new Set(Array.from("》〉」』】〕〗）］｝”’。，、；：？！·"));
  // 省略号、破折号：两两成组，不可拆分跨行
  const ATOMIC_CHARS = new Set(["…", "—"]);

  function tokenize(text) {
    const chars = Array.from(String(text ?? ""));
    const tokens = [];
    let index = 0;
    let i = 0;
    while (i < chars.length) {
      const ch = chars[i];
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && chars[i + 1] === "\n") i += 1;
        tokens.push({ id: index, text: "\n", width: 0, kind: "break" });
        index += 1;
        i += 1;
        continue;
      }
      if (ATOMIC_CHARS.has(ch)) {
        let run = "";
        while (chars[i] === ch) {
          run += ch;
          i += 1;
        }
        while (run.length >= 2) {
          tokens.push({ id: index, text: run.slice(0, 2), width: 2, kind: "atomic", atomic: true });
          index += 1;
          run = run.slice(2);
        }
        if (run.length === 1) {
          // 落单的省略号/破折号按收束标点处理，不得落在行首
          tokens.push({ id: index, text: run, width: 1, kind: "punct", closing: true });
          index += 1;
        }
        continue;
      }
      const opening = OPENING_PUNCT.has(ch);
      const closing = CLOSING_PUNCT.has(ch);
      tokens.push({
        id: index,
        text: ch,
        width: 1,
        kind: opening || closing ? "punct" : "char",
        opening,
        closing
      });
      index += 1;
      i += 1;
    }
    return tokens;
  }

  // 行满遇上收束标点：从行尾逐字回退，直到
  // 余下行尾不是开启标点、新行行首不是收束标点、且新行不超宽。
  // 返回被退下的整字序列；无解时返回 null（由调用方改为行尾悬挂）。
  function collectBacktrack(line, token, capacity) {
    const rest = line.slice();
    const carried = [];
    const carriedWidth = () => carried.reduce((sum, item) => sum + item.width, 0);
    const satisfied = () =>
      rest.length > 0 &&
      carried.length > 0 &&
      !rest[rest.length - 1].opening &&
      !carried[0].closing &&
      carriedWidth() + token.width <= capacity;
    while (!satisfied() && rest.length > 0) {
      carried.unshift(rest.pop());
      if (carriedWidth() + token.width > capacity) break;
    }
    if (!satisfied()) return null;
    line.length = 0;
    line.push(...rest);
    return carried;
  }

  function layoutWithSpec(text, spec, flowMode) {
    const horizontal = flowMode !== "vertical";
    const capacity = horizontal ? spec.cols : spec.rows;
    const linesPerPage = horizontal ? spec.rows : spec.cols;
    const tokens = tokenize(text);
    const lines = [];
    const events = [];
    let line = [];

    const widthOf = (list) => list.reduce((sum, item) => sum + item.width, 0);
    const pushLine = () => {
      if (line.length > 0) lines.push(line);
      line = [];
    };

    for (const token of tokens) {
      if (token.kind === "break") {
        pushLine();
        continue;
      }

      if (widthOf(line) + token.width <= capacity) {
        line.push(token);
        // 行尾不悬开启标点：放满一行的恰是开启标点，整字回退到下一行
        if (token.opening && widthOf(line) === capacity) {
          line.pop();
          pushLine();
          line.push(token);
          token.retreated = true;
          events.push({ type: "backtrack", reason: "opening-at-tail", tokenId: token.id, lineIndex: lines.length });
        }
        continue;
      }

      if (token.closing) {
        // 行首不出现收束标点：整字回退重排
        const carried = collectBacktrack(line, token, capacity);
        if (carried) {
          pushLine();
          carried.forEach((item) => {
            item.retreated = true;
          });
          line = carried.concat(token);
          events.push({
            type: "backtrack",
            reason: "closing-at-head",
            tokenId: token.id,
            carried: carried.length,
            lineIndex: lines.length
          });
        } else {
          // 回退无解（如整行皆为标点），允许收束标点悬挂行尾并记警告
          token.hanging = true;
          line.push(token);
          events.push({ type: "hang", tokenId: token.id, lineIndex: lines.length });
        }
        continue;
      }

      pushLine();
      line.push(token);
    }
    pushLine();

    // 整页放不下才另起版页：每页排满 linesPerPage 行再分页
    const pages = [];
    for (let i = 0; i < lines.length; i += linesPerPage) {
      pages.push(lines.slice(i, i + linesPerPage));
    }

    return { paperKey: spec.key || "custom", flowMode: horizontal ? "horizontal" : "vertical", capacity, linesPerPage, tokens, lines, pages, events };
  }

  function layoutText(text, paperKey, flowMode) {
    const spec = PAPER_SPECS[paperKey] || PAPER_SPECS.postcard;
    return layoutWithSpec(text, spec, flowMode);
  }

  function verifyLayout(layout, sourceText) {
    const violations = [];
    const warnings = [];

    // 保留原字序和全部字符：排入结果逐字比对原稿
    const placed = layout.lines
      .flat()
      .filter((token) => token.kind !== "break")
      .map((token) => token.text)
      .join("");
    const source = tokenize(sourceText)
      .filter((token) => token.kind !== "break")
      .map((token) => token.text)
      .join("");
    if (placed !== source) {
      violations.push({ type: "integrity", message: "排入字符与原稿不一致，字序或字符有缺失。" });
    }

    layout.lines.forEach((line, index) => {
      if (!line.length) return;
      const where = `第${index + 1}行`;
      const first = line[0];
      const last = line[line.length - 1];
      if (first.closing) {
        violations.push({ type: "head-closing", line: index, message: `${where}行首出现收束标点「${first.text}」。` });
      }
      if (last.opening) {
        violations.push({ type: "tail-opening", line: index, message: `${where}行尾悬着开启标点「${last.text}」。` });
      }
      const hanging = line.filter((token) => token.hanging);
      const hangWidth = hanging.reduce((sum, token) => sum + token.width, 0);
      const width = line.reduce((sum, token) => sum + token.width, 0);
      if (width - hangWidth > layout.capacity) {
        violations.push({ type: "overflow", line: index, message: `${where}超出每行${layout.capacity}字容量。` });
      }
      hanging.forEach((token) => {
        warnings.push({ type: "hang", line: index, message: `${where}「${token.text}」回退无解，悬挂于行尾。` });
      });
    });

    layout.pages.forEach((page, pageIndex) => {
      if (page.length > layout.linesPerPage) {
        violations.push({ type: "page-overflow", page: pageIndex, message: `第${pageIndex + 1}页超出${layout.linesPerPage}行容量。` });
      }
    });

    const stats = {
      chars: Array.from(String(sourceText ?? "").replace(/\r?\n/g, "")).length,
      lines: layout.lines.length,
      pages: layout.pages.length,
      backtracks: layout.events.filter((event) => event.type === "backtrack").length,
      hangs: layout.events.filter((event) => event.type === "hang").length
    };

    return { ok: violations.length === 0, violations, warnings, stats };
  }

  return { PAPER_SPECS, OPENING_PUNCT, CLOSING_PUNCT, tokenize, layoutText, layoutWithSpec, verifyLayout };
})();
