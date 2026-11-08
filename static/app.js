/* ========================================================================
   番迹 · Anime Archive — 前端应用
   纯原生 JavaScript，无第三方依赖。
   ======================================================================== */

(() => {
  "use strict";

  const STATUS = {
    completed: { label: "已看完", icon: "icon-check" },
    watching: { label: "在看", icon: "icon-play" },
    planned: { label: "想看", icon: "icon-clock" },
    dropped: { label: "弃番", icon: "icon-close" },
  };

  const RATING_TEXT = ["未评分", "一般", "还行", "不错", "很好看", "神作"];
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_GIF_BYTES = 6 * 1024 * 1024;

  const SETTINGS_KEY = "fanji.settings.v1";
  const SETTINGS_SCHEMA = {
    paper: ["cream", "kraft", "grid"],
    density: ["comfortable", "compact"],
    notes: ["show", "hide"],
    motion: ["full", "reduced"],
    defaultSort: ["recent", "rating", "title", "finishedYear", "episodes"],
  };
  const DEFAULT_SETTINGS = {
    paper: "cream",
    density: "comfortable",
    notes: "show",
    motion: "full",
    defaultSort: "recent",
  };

  const state = {
    items: [],
    filter: "all",
    query: "",
    searchTerms: [],
    searchTimer: 0,
    sort: "recent",
    editingId: null,
    editingAccent: null,
    coverData: null,
    coverRemoved: false,
    rating: 0,
    submitting: false,
    loading: true,
    loadError: false,
    demoLoading: false,
    pendingDelete: null,
    pendingImport: null,
    pendingImportFile: null,
    pendingBackupName: null,
    yearReviewYear: null,
    confirmMode: null,
    confirmBusy: false,
    lastFocus: null,
    emptyMode: "empty",
    settings: { ...DEFAULT_SETTINGS },
    cinema: {
      playlist: [],
      index: 0,
      playing: false,
      started: false,
      timer: null,
      duration: 5,
      shuffle: false,
      musicEnabled: true,
      volume: 0.7,
      muted: false,
      music: null,
      closing: false,
      lastQuoteSlot: 0,
    },
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const els = {
    grid: $("#grid"),
    emptyState: $("#emptyState"),
    emptyTitle: $("#emptyTitle"),
    emptyText: $("#emptyText"),
    emptyBubble: $("#emptyBubble"),
    emptyAddBtn: $("#emptyAddBtn"),
    emptyDemoBtn: $("#emptyDemoBtn"),
    resultCount: $("#resultCount"),
    searchBox: $("#searchBox"),
    searchInput: $("#searchInput"),
    searchClear: $("#searchClear"),
    searchKbd: $("#searchKbd"),
    sortSelect: $("#sortSelect"),
    filterBar: $("#filterBar"),
    demoChip: $("#demoChip"),
    demoBtn: $("#demoBtn"),
    addBtn: $("#addBtn"),
    heroAddBtn: $("#heroAddBtn"),
    collection: $("#collection"),
    formModal: $("#formModal"),
    detailModal: $("#detailModal"),
    confirmModal: $("#confirmModal"),
    form: $("#animeForm"),
    formTitle: $("#formTitle"),
    formEyebrow: $("#formEyebrow"),
    titleInput: $("#titleInput"),
    altTitleInput: $("#altTitleInput"),
    finishedYearInput: $("#finishedYearInput"),
    watchedInput: $("#watchedInput"),
    totalInput: $("#totalInput"),
    tagsInput: $("#tagsInput"),
    notesInput: $("#notesInput"),
    statusSegmented: $("#statusSegmented"),
    starPicker: $("#starPicker"),
    ratingText: $("#ratingText"),
    clearRatingBtn: $("#clearRatingBtn"),
    coverDrop: $("#coverDrop"),
    coverInput: $("#coverInput"),
    coverPreview: $("#coverPreview"),
    coverPlaceholder: $("#coverPlaceholder"),
    chooseCoverBtn: $("#chooseCoverBtn"),
    removeCoverBtn: $("#removeCoverBtn"),
    formError: $("#formError"),
    saveBtn: $("#saveBtn"),
    detailContent: $("#detailContent"),
    confirmTitle: $("#confirmTitle"),
    confirmText: $("#confirmText"),
    confirmOk: $("#confirmOk"),
    confirmCancel: $("#confirmCancel"),
    importTrigger: $("#importTrigger"),
    importInput: $("#importInput"),
    backupBtn: $("#backupBtn"),
    backupModal: $("#backupModal"),
    backupList: $("#backupList"),
    backupListMeta: $("#backupListMeta"),
    backupDownloadBtn: $("#backupDownloadBtn"),
    backupCreateBtn: $("#backupCreateBtn"),
    backupRestoreFileBtn: $("#backupRestoreFileBtn"),
    backupFileInput: $("#backupFileInput"),
    backupRefreshBtn: $("#backupRefreshBtn"),
    yearReviewBtn: $("#yearReviewBtn"),
    yearReviewBtnFooter: $("#yearReviewBtnFooter"),
    yearReviewModal: $("#yearReviewModal"),
    yearReviewBody: $("#yearReviewBody"),
    toastRoot: $("#toastRoot"),
    playModeBtn: $("#playModeBtn"),
    cinema: $("#cinema"),
    cinemaBgQuote: $("#cinemaBgQuote"),
    cinemaGhostQuote: $("#cinemaGhostQuote"),
    cinemaDust: $("#cinemaDust"),
    cinemaIndex: $("#cinemaIndex"),
    cinemaIntro: $("#cinemaIntro"),
    cinemaStage: $("#cinemaStage"),
    cinemaIntroMeta: $("#cinemaIntroMeta"),
    cinemaCloseIntro: $("#cinemaCloseIntro"),
    cinemaDuration: $("#cinemaDuration"),
    cinemaShuffle: $("#cinemaShuffle"),
    cinemaMusic: $("#cinemaMusic"),
    cinemaStart: $("#cinemaStart"),
    cinemaSlide: $("#cinemaSlide"),
    cinemaCounter: $("#cinemaCounter"),
    cinemaPrev: $("#cinemaPrev"),
    cinemaPlay: $("#cinemaPlay"),
    cinemaNext: $("#cinemaNext"),
    cinemaMute: $("#cinemaMute"),
    cinemaVolume: $("#cinemaVolume"),
    cinemaExit: $("#cinemaExit"),
    cinemaExitTop: $("#cinemaExitTop"),
    cinemaProgressBar: $("#cinemaProgressBar"),
    cinemaAudio: $("#cinemaAudio"),
    musicName: $("#musicName"),
    musicMeta: $("#musicMeta"),
    musicUploadBtn: $("#musicUploadBtn"),
    musicRemoveBtn: $("#musicRemoveBtn"),
    musicInput: $("#musicInput"),
    shareBtn: $("#shareBtn"),
    shareBtnMobile: $("#shareBtnMobile"),
    shareModal: $("#shareModal"),
    shareIntro: $("#shareIntro"),
    shareLoading: $("#shareLoading"),
    shareResult: $("#shareResult"),
    shareErrorBox: $("#shareErrorBox"),
    shareErrorText: $("#shareErrorText"),
    shareStartBtn: $("#shareStartBtn"),
    shareRetryBtn: $("#shareRetryBtn"),
    shareLink: $("#shareLink"),
    shareCode: $("#shareCode"),
    shareExpiryText: $("#shareExpiryText"),
    shareCopyBtn: $("#shareCopyBtn"),
    shareStopBtn: $("#shareStopBtn"),
    settingsBtn: $("#settingsBtn"),
    settingsBtnTop: $("#settingsBtnTop"),
    settingsModal: $("#settingsModal"),
    settingsBody: $("#settingsBody"),
    settingsSortSelect: $("#settingsSortSelect"),
    settingsResetBtn: $("#settingsResetBtn"),
  };

  // ------------------------------------------------------------------
  // 工具
  // ------------------------------------------------------------------

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));

  const safeAccent = (value) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#8b5cf6";

  const icon = (name, cls = "") => `<svg class="icon ${cls}" aria-hidden="true"><use href="#${name}"/></svg>`;

  const numberValue = (input) => {
    const value = parseInt(input.value, 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };

  const byRecent = (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""));

  const fmtDate = (iso) => {
    const date = new Date(iso || "");
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
  };

  const fmtNumber = (value) => new Intl.NumberFormat("zh-CN").format(value || 0);

  function initialOf(title) {
    const chars = Array.from(String(title || "").trim());
    return chars[0] || "?";
  }

  async function api(path, options = {}) {
    const config = { ...options };
    if (config.body) {
      config.headers = { "Content-Type": "application/json", ...(config.headers || {}) };
    }
    let response;
    try {
      response = await fetch(path, config);
    } catch (error) {
      throw new Error("无法连接本地服务，请确认启动窗口仍在运行");
    }
    let data = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try { data = await response.json(); } catch { data = null; }
    }
    if (!response.ok) {
      throw new Error((data && data.error) || `请求失败（${response.status}）`);
    }
    return data;
  }

  function toast(message, type = "success", duration = 2800) {
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    const iconName = type === "error" ? "icon-close" : type === "info" ? "icon-sparkle" : "icon-check";
    node.innerHTML = icon(iconName) + "<span></span>";
    node.querySelector("span").textContent = message;
    els.toastRoot.appendChild(node);
    while (els.toastRoot.children.length > 3) {
      els.toastRoot.firstElementChild.remove();
    }
    window.setTimeout(() => {
      node.classList.add("leaving");
      window.setTimeout(() => node.remove(), 260);
    }, duration);
  }

  // ------------------------------------------------------------------
  // 读取与渲染
  // ------------------------------------------------------------------

  async function loadItems(options = {}) {
    try {
      const data = await api("/api/anime");
      state.items = Array.isArray(data && data.items) ? data.items : [];
      state.loadError = false;
      state.loading = false;
      renderAll();
      if (options.toast) toast(options.toast);
    } catch (error) {
      state.loading = false;
      state.loadError = true;
      state.items = [];
      renderAll();
      toast(error.message, "error", 5200);
    }
  }

  function counts() {
    const result = { all: state.items.length, completed: 0, watching: 0, planned: 0, dropped: 0 };
    for (const item of state.items) {
      if (item.status in result) result[item.status] += 1;
    }
    return result;
  }

  function renderAll() {
    renderStats();
    renderFilters();
    renderCollection();
    renderChrome();
  }

  function renderStats() {
    const total = state.items.length;
    const completed = state.items.filter((item) => item.status === "completed").length;
    const episodes = state.items.reduce((sum, item) => sum + (Number(item.episodesWatched) || 0), 0);
    const rated = state.items.filter((item) => Number(item.rating) > 0);
    const average = rated.length
      ? (rated.reduce((sum, item) => sum + Number(item.rating), 0) / rated.length).toFixed(1)
      : "—";
    const rate = total ? Math.round((completed / total) * 100) : 0;

    setText('[data-stat="total"]', fmtNumber(total));
    setText('[data-stat="completed"]', fmtNumber(completed));
    setText('[data-stat="episodes"]', fmtNumber(episodes));
    setText('[data-stat="rating"]', average);
    setText("#completionRate", `${rate}%`);
    const bar = $("#completionBar");
    if (bar) bar.style.width = `${rate}%`;

    const quote = $(".stats-quote");
    if (quote) {
      let text = "“每一部看完的番，都是一段被保存下来的时间。”";
      if (total > 0 && completed === total) text = "“全都看完了。那么，下一部看什么？”";
      else if (total > 0 && rate >= 60) text = "“这本手帐，正在被你一页页填满。”";
      else if (total > 0 && counts().watching > 0) text = "“还有故事正在进行中。”";
      quote.textContent = text;
    }
  }

  function setText(selector, text) {
    const node = $(selector);
    if (node) node.textContent = text;
  }

  function renderFilters() {
    const data = counts();
    $$("[data-count]").forEach((node) => {
      const key = node.dataset.count;
      node.textContent = String(data[key] ?? 0);
    });
    $$(".filter-pill").forEach((pill) => {
      const active = pill.dataset.filter === state.filter;
      pill.classList.toggle("is-active", active);
      pill.setAttribute("aria-selected", String(active));
    });
  }

  // 搜索语法：空格分隔多个关键词（全部命中），支持 "引号短语"
  // 与字段限定 title: / tag: / note: / year:（也接受中文冒号）。
  function parseSearchQuery(raw) {
    const text = String(raw || "")
      .replace(/[\u3000\s]+/g, " ")
      .replace(/：/g, ":")
      .trim();
    if (!text) return [];
    const terms = [];
    const pattern = /(title|tag|note|year):("([^"]*)"|(\S+))|"([^"]*)"|(\S+)/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const field = match[1] ? match[1].toLowerCase() : "";
      const value = (field ? (match[3] ?? match[4] ?? "") : (match[5] ?? match[6] ?? "")).trim();
      if (!value) continue;
      // 只输入了 "tag:" 这类未完成的前缀时不当作关键词。
      if (!field && /^(title|tag|note|year):$/i.test(value)) continue;
      terms.push({ field, value: value.toLowerCase(), raw: value });
    }
    return terms;
  }

  function searchFieldsOf(item) {
    const title = [item.title, item.altTitle].filter(Boolean).join(" ").toLowerCase();
    return {
      title,
      tag: (Array.isArray(item.tags) ? item.tags : []).join(" ").toLowerCase(),
      note: String(item.notes || "").toLowerCase(),
      year: item.finishedYear ? String(item.finishedYear) : "",
    };
  }

  // 每个关键词都要命中；返回得分（越大越相关），-1 表示不匹配。
  function searchScoreOf(item, terms) {
    const fields = searchFieldsOf(item);
    let score = 0;
    for (const term of terms) {
      if (term.field === "year") {
        if (fields.year !== term.value) return -1;
        score += 3;
        continue;
      }
      if (term.field) {
        const pool = fields[term.field] || "";
        if (!pool.includes(term.value)) return -1;
        score += term.field === "title" ? 5 : term.field === "tag" ? 3 : 2;
        continue;
      }
      if (fields.title.includes(term.value)) score += fields.title.startsWith(term.value) ? 6 : 4;
      else if (fields.tag.includes(term.value)) score += 3;
      else if (fields.note.includes(term.value)) score += 2;
      else if (fields.year.includes(term.value)) score += 1;
      else return -1;
    }
    return score;
  }

  // 在文字里高亮命中的关键词（先转义再包 mark，避免注入）。
  function highlightHtml(value, field) {
    const text = String(value ?? "");
    const terms = state.searchTerms.filter((term) => !term.field || term.field === field);
    if (!text || !terms.length) return escapeHtml(text);
    const lower = text.toLowerCase();
    if (lower.length !== text.length) return escapeHtml(text);
    const needles = Array.from(new Set(terms.map((term) => term.value))).filter(Boolean);
    const ranges = [];
    for (const needle of needles) {
      let from = 0;
      while (from <= lower.length - needle.length) {
        const at = lower.indexOf(needle, from);
        if (at < 0) break;
        ranges.push([at, at + needle.length]);
        from = at + needle.length;
      }
    }
    if (!ranges.length) return escapeHtml(text);
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [start, end] of ranges) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    let html = "";
    let cursor = 0;
    for (const [start, end] of merged) {
      html += escapeHtml(text.slice(cursor, start));
      html += `<mark class="search-hit">${escapeHtml(text.slice(start, end))}</mark>`;
      cursor = end;
    }
    return html + escapeHtml(text.slice(cursor));
  }

  function syncSearchChrome() {
    const active = Boolean(state.query.trim());
    if (els.searchClear) els.searchClear.hidden = !active;
    if (els.searchKbd) els.searchKbd.hidden = active;
    els.searchInput.setAttribute("aria-label", active ? `搜索：${state.query.trim()}` : "搜索作品");
  }

  function scheduleSearchRender() {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      state.searchTimer = 0;
      renderCollection();
    }, 140);
  }

  function setSearchQuery(value, options = {}) {
    state.query = String(value ?? "");
    if (els.searchInput.value !== state.query) els.searchInput.value = state.query;
    window.clearTimeout(state.searchTimer);
    state.searchTimer = 0;
    syncSearchChrome();
    if (options.render !== false) renderCollection();
  }

  function filteredSorted() {
    const terms = parseSearchQuery(state.query);
    state.searchTerms = terms;
    let items = state.items.slice();
    if (state.filter !== "all") {
      items = items.filter((item) => item.status === state.filter);
    }
    let entries = items.map((item) => ({
      item,
      score: terms.length ? searchScoreOf(item, terms) : 0,
    }));
    if (terms.length) entries = entries.filter((entry) => entry.score >= 0);
    switch (state.sort) {
      case "rating":
        entries.sort((a, b) => (Number(b.item.rating) || 0) - (Number(a.item.rating) || 0) || byRecent(a.item, b.item));
        break;
      case "title":
        entries.sort((a, b) => String(a.item.title).localeCompare(String(b.item.title), "zh-Hans-CN", { sensitivity: "base" }));
        break;
      case "finishedYear":
        entries.sort((a, b) => (Number(b.item.finishedYear) || 0) - (Number(a.item.finishedYear) || 0) || byRecent(a.item, b.item));
        break;
      case "episodes":
        entries.sort((a, b) => (Number(b.item.episodesWatched) || 0) - (Number(a.item.episodesWatched) || 0) || byRecent(a.item, b.item));
        break;
      default:
        // 搜索时默认按相关度排序，其余排序方式尊重用户选择。
        entries.sort((a, b) => terms.length
          ? (b.score - a.score || byRecent(a.item, b.item))
          : byRecent(a.item, b.item));
    }
    return entries.map((entry) => entry.item);
  }

  function renderCollection() {
    const items = filteredSorted();
    const terms = state.searchTerms;
    let countText;
    if (!state.items.length) countText = "等待第一部作品";
    else if (terms.length) countText = items.length ? `找到 ${items.length} 部作品` : "没有找到匹配的作品";
    else if (state.filter !== "all") countText = `筛选出 ${items.length} 部作品`;
    else countText = `共 ${items.length} 部作品`;
    els.resultCount.textContent = countText;
    syncSearchChrome();

    els.grid.innerHTML = items.map((item, index) => cardHtml(item, index)).join("");
    els.grid.hidden = items.length === 0;
    renderEmpty(items);

    bindImageFallbacks(els.grid);
    window.requestAnimationFrame(() => {
      $$(".anime-card", els.grid).forEach((card) => card.classList.add("is-ready"));
    });
  }

  function renderEmpty(items) {
    const show = items.length === 0;
    els.emptyState.hidden = !show;
    if (!show) return;

    const setButton = (button, label, iconName) => {
      button.innerHTML = icon(iconName) + `<span>${escapeHtml(label)}</span>`;
    };

    if (state.loadError) {
      state.emptyMode = "error";
      els.emptyBubble.innerHTML = "まだ繋がらない…<b>手帐打不开</b>";
      els.emptyTitle.textContent = "手帐暂时打不开";
      els.emptyText.innerHTML = location.protocol === "file:"
        ? "请通过启动器打开：双击 start.bat，<br>或在文件夹中运行 python app.py。"
        : "本地服务似乎暂时没有响应，<br>请确认启动窗口还在运行，然后重新加载。";
      els.emptyAddBtn.hidden = true;
      els.emptyDemoBtn.hidden = false;
      setButton(els.emptyDemoBtn, "重新加载", "icon-sparkle");
      return;
    }

    if (!state.items.length) {
      state.emptyMode = "empty";
      els.emptyBubble.innerHTML = "まだ空っぽ…<b>还没有收藏哦</b>";
      els.emptyTitle.textContent = "手帐还是空的";
      els.emptyText.innerHTML = "把看过的故事贴进来，<br>从名字和一张封面开始。";
      els.emptyAddBtn.hidden = false;
      els.emptyDemoBtn.hidden = false;
      setButton(els.emptyAddBtn, "添加动漫", "icon-plus");
      setButton(els.emptyDemoBtn, "载入示例", "icon-sparkle");
      return;
    }

    state.emptyMode = "filter";
    els.emptyBubble.innerHTML = "まだまだ！<b>再翻翻看</b>";
    els.emptyTitle.textContent = state.searchTerms.length ? "没有找到这一页" : "没有翻到这一页";
    els.emptyText.innerHTML = state.searchTerms.length
      ? `没有找到和「${escapeHtml(state.query.trim())}」匹配的作品。<br>换个词，或用空格分隔多个关键词；tag: / year: 可精确查找。`
      : "这个分类下还没有作品，<br>去看看其他收藏吧。";
    els.emptyAddBtn.hidden = false;
    els.emptyDemoBtn.hidden = true;
    setButton(els.emptyAddBtn, state.searchTerms.length ? "清除搜索" : "清除筛选条件", "icon-search");
  }

  function cardHtml(item, index) {
    const status = STATUS[item.status] || STATUS.completed;
    const accent = safeAccent(item.accent);
    const cover = item.coverUrl
      ? `<img src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.title)} 封面" loading="lazy" data-cover>`
      : "";
    const tags = (Array.isArray(item.tags) ? item.tags : []).slice(0, 4)
      .map((tag) => `<button class="tag tag-btn" type="button" data-tag-search="${escapeHtml(tag)}"
        aria-label="按标签「${escapeHtml(tag)}」搜索" title="按这个标签搜索">${highlightHtml(tag, "tag")}</button>`).join("");
    const watched = Number(item.episodesWatched) || 0;
    const total = Number(item.episodesTotal) || 0;
    const progress = total > 0 ? Math.min(100, Math.round((watched / total) * 100)) : (watched > 0 ? 100 : 0);
    const episodeLabel = total > 0
      ? `${watched}/${total} 集`
      : watched > 0
        ? `已看 ${watched} 集`
        : "集数未记录";
    const meta = [
      item.finishedYear ? `${highlightHtml(String(item.finishedYear), "year")} 年` : "",
      total > 0 ? `全 ${total} 集` : "",
    ].filter(Boolean).join(`<span class="sep">·</span>`) || "信息待补充";
    const score = Number(item.rating) > 0
      ? `<span class="cover-score">${icon("icon-star")}${Number(item.rating)}</span>`
      : "";
    const demo = item.demo ? `<span class="demo-flag">SAMPLE</span>` : "";
    const done = item.status === "completed" ? `<span class="done-stamp" aria-hidden="true">済</span>` : "";
    const notes = item.notes ? `<p class="card-notes">${highlightHtml(item.notes, "note")}</p>` : "";
    const fallbackLabel = item.altTitle ? highlightHtml(item.altTitle, "title") : "ANIME ARCHIVE";
    const cardNo = String(index + 1).padStart(2, "0");

    return `
      <article class="anime-card" data-id="${escapeHtml(item.id)}" style="--accent:${accent};--i:${index}">
        <button class="cover ${item.coverUrl ? "" : "no-cover"}" type="button" data-action="detail"
                aria-label="查看《${escapeHtml(item.title)}》的详情">
          ${cover}
          <div class="cover-fallback" aria-hidden="true">
            <span class="fallback-initial">${escapeHtml(initialOf(item.title))}</span>
            <span class="fallback-small">${fallbackLabel}</span>
          </div>
          <span class="status-badge status-${escapeHtml(item.status)}"><i></i>${escapeHtml(status.label)}</span>
          ${score}
          ${demo}
          ${done}
          <span class="cover-hover">翻开这一页 ${icon("icon-arrow")}</span>
        </button>
        <div class="card-body">
          <div class="card-title-row">
            <h3 class="card-title">${highlightHtml(item.title, "title")}</h3>
            <button class="icon-btn card-edit" type="button" data-action="edit"
                    aria-label="编辑《${escapeHtml(item.title)}》">${icon("icon-edit")}</button>
          </div>
          <p class="card-meta"><span class="card-no">NO.${cardNo}</span>${meta}</p>
          <div class="card-tags">${tags}</div>
          ${notes}
          <div class="card-foot">
            ${starsHtml(Number(item.rating), true)}
            <span class="episode-progress">
              <span class="bar"><span style="width:${progress}%"></span></span>${escapeHtml(episodeLabel)}
            </span>
          </div>
        </div>
      </article>`;
  }

  function starsHtml(rating, compact = false) {
    const safe = Math.max(0, Math.min(5, Number(rating) || 0));
    if (!safe) return `<span class="mini-stars"><span class="empty-label">还没有评分</span></span>`;
    const stars = Array.from({ length: 5 }, (_, index) =>
      `<svg class="icon ${index < safe ? "on" : ""}" aria-hidden="true"><use href="#icon-star"/></svg>`).join("");
    return `<span class="mini-stars" aria-label="${safe} 星">${stars}${compact ? "" : ""}</span>`;
  }

  function bindImageFallbacks(container) {
    $$("img[data-cover]", container).forEach((img) => {
      img.addEventListener("error", () => {
        const cover = img.closest(".cover, .detail-cover, .year-thumb, .year-mini-cover");
        if (cover) {
          cover.classList.add("no-cover");
          cover.classList.remove("has-image");
        }
        img.remove();
      }, { once: true });
    });
  }

  function renderChrome() {
    const hasDemo = state.items.some((item) => item.demo);
    els.demoChip.hidden = !hasDemo;
    els.demoBtn.hidden = state.items.length > 0 || state.loadError;
    els.heroAddBtn.innerHTML = state.items.length
      ? `${icon("icon-plus")}再记录一部`
      : `${icon("icon-plus")}记录第一部动漫`;
    if (els.yearReviewBtn) els.yearReviewBtn.hidden = state.items.length === 0;
    document.title = state.items.length
      ? `番迹 · 动漫手帐 · ${state.items.length} 部收藏`
      : "番迹 · 我的动漫手帐";
  }

  // ------------------------------------------------------------------
  // 详情
  // ------------------------------------------------------------------

  function openDetail(id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;
    const accent = safeAccent(item.accent);
    const status = STATUS[item.status] || STATUS.completed;
    const total = Number(item.episodesTotal) || 0;
    const watched = Number(item.episodesWatched) || 0;
    const progress = total > 0 ? Math.round((watched / total) * 100) : (watched > 0 ? 100 : 0);
    const rating = Math.max(0, Math.min(5, Number(item.rating) || 0));
    const stars = Array.from({ length: 5 }, (_, index) =>
      `<svg class="icon ${index < rating ? "" : "off"}" aria-hidden="true"><use href="#icon-star"/></svg>`).join("");
    const tags = (Array.isArray(item.tags) ? item.tags : []).length
      ? `<div class="detail-tags">${item.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
      : "";
    const notes = item.notes
      ? `<p class="detail-notes">${escapeHtml(item.notes)}</p>`
      : `<p class="detail-notes is-empty">这一页还没有短评… 点「编辑这一页」写点什么吧。</p>`;
    const demo = item.demo ? `<span class="demo-tag">SAMPLE / 示例</span>` : "";
    const cover = item.coverUrl
      ? `<img src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.title)} 封面" data-cover>`
      : "";
    const fallbackLabel = item.altTitle ? item.altTitle : "ANIME ARCHIVE";
    const archiveNo = String(item.id).slice(-6).toUpperCase();
    const finishedYear = Number(item.finishedYear) || 0;

    els.detailContent.innerHTML = `
      <div class="detail-layout" style="--accent:${accent}">
        <div class="detail-poster-col">
          <span class="detail-tape" aria-hidden="true">MY FAVORITE</span>
          <div class="detail-cover ${item.coverUrl ? "has-image" : ""}">
            ${cover}
            <div class="cover-fallback" aria-hidden="true">
              <span class="fallback-initial">${escapeHtml(initialOf(item.title))}</span>
              <span class="fallback-small">${escapeHtml(fallbackLabel)}</span>
            </div>
          </div>
          <div class="detail-side-meta">
            <div class="detail-side-row"><span>收录日期</span><b>${escapeHtml(fmtDate(item.createdAt))}</b></div>
            <div class="detail-side-row"><span>最后更新</span><b>${escapeHtml(fmtDate(item.updatedAt))}</b></div>
            <div class="detail-side-row"><span>档案编号</span><b>#${escapeHtml(archiveNo)}</b></div>
          </div>
        </div>
        <div class="detail-main">
          <p class="detail-kicker">ANIME FILE / #${escapeHtml(archiveNo)}</p>
          <div class="detail-topline">
            <span class="detail-status status-${escapeHtml(item.status)}"><i></i>${escapeHtml(status.label)}</span>
            <span class="detail-year">${finishedYear ? `看完 ${finishedYear} 年` : "看完年份未记录"}</span>
            ${demo}
          </div>
          <h2 class="detail-title" id="detailTitle">${escapeHtml(item.title)}</h2>
          ${item.altTitle ? `<p class="detail-alt">${escapeHtml(item.altTitle)}</p>` : ""}
          <div class="detail-rating">
            <span class="stars" aria-label="${rating} 星">${stars}</span>
            <span>${rating ? `${rating} / 5 · ${RATING_TEXT[rating]}` : "还未评分"}</span>
          </div>
          <div class="detail-stats">
            <div class="detail-stat"><b>${total || "—"}</b><span>总集数</span></div>
            <div class="detail-stat"><b>${watched}</b><span>已看集数</span></div>
            <div class="detail-stat"><b>${total ? `${progress}%` : "—"}</b><span>观看进度</span></div>
            <div class="detail-stat"><b>${finishedYear || "—"}</b><span>看完年份</span></div>
          </div>
          ${tags}
          ${notes}
          <div class="detail-actions">
            <button class="btn btn-primary" type="button" data-action="edit" data-id="${escapeHtml(item.id)}">
              ${icon("icon-edit")}编辑这一页
            </button>
            <button class="btn btn-ghost" type="button" data-action="delete" data-id="${escapeHtml(item.id)}">
              ${icon("icon-trash")}撕掉这页
            </button>
          </div>
        </div>
      </div>`;

    openModal(els.detailModal, ".detail-close");
    bindImageFallbacks(els.detailContent);
  }

  // ------------------------------------------------------------------
  // 新增 / 编辑
  // ------------------------------------------------------------------

  function openForm(id = null) {
    const item = id ? state.items.find((entry) => entry.id === id) : null;
    state.editingId = item ? item.id : null;
    state.editingAccent = item ? item.accent : null;
    state.coverData = null;
    state.coverRemoved = false;
    state.rating = item ? Number(item.rating) || 0 : 0;
    state.submitting = false;

    els.form.reset();
    els.formError.hidden = true;
    els.formError.textContent = "";
    els.titleInput.classList.remove("is-invalid");

    els.formTitle.textContent = item ? "编辑这一页" : "记录一部动漫";
    els.formEyebrow.textContent = item ? "EDIT PAGE / このページを編集" : "NEW PAGE / 新しいページ";
    setSaveLabel(false, Boolean(item));

    if (item) {
      els.titleInput.value = item.title || "";
      els.altTitleInput.value = item.altTitle || "";
      els.finishedYearInput.value = item.finishedYear || "";
      els.watchedInput.value = item.episodesWatched || "";
      els.totalInput.value = item.episodesTotal || "";
      els.tagsInput.value = Array.isArray(item.tags) ? item.tags.join("、") : "";
      els.notesInput.value = item.notes || "";
      const statusInput = $(`input[name="status"][value="${CSS.escape(item.status)}"]`, els.statusSegmented);
      if (statusInput) statusInput.checked = true;
    } else {
      const completed = $('input[name="status"][value="completed"]', els.statusSegmented);
      if (completed) completed.checked = true;
    }

    updateRatingUI();
    refreshCoverUI();
    openModal(els.formModal, "#titleInput");
  }

  function refreshCoverUI() {
    const item = state.editingId ? state.items.find((entry) => entry.id === state.editingId) : null;
    const existingCover = item && !state.coverRemoved ? item.coverUrl : null;
    const src = state.coverData || existingCover;
    if (src) {
      els.coverPreview.src = src;
      els.coverPreview.hidden = false;
      els.coverPlaceholder.hidden = true;
      els.coverDrop.classList.add("has-image");
      els.removeCoverBtn.hidden = false;
    } else {
      els.coverPreview.removeAttribute("src");
      els.coverPreview.hidden = true;
      els.coverPlaceholder.hidden = false;
      els.coverDrop.classList.remove("has-image");
      els.removeCoverBtn.hidden = true;
    }
  }

  function setSaveLabel(loading, editing) {
    els.saveBtn.classList.toggle("is-loading", loading);
    els.saveBtn.disabled = loading;
    els.saveBtn.querySelector(".btn-label").textContent = loading
      ? "保存中…"
      : editing ? "保存修改" : "贴进手帐";
  }

  function updateRatingUI() {
    $$("button[data-star]", els.starPicker).forEach((button) => {
      const value = Number(button.dataset.star);
      button.classList.toggle("is-on", value <= state.rating);
      button.setAttribute("aria-checked", String(value === state.rating));
    });
    els.ratingText.textContent = state.rating ? `${state.rating} 星 · ${RATING_TEXT[state.rating]}` : "未评分";
    els.clearRatingBtn.disabled = state.rating === 0;
  }

  async function handleImageFile(file) {
    if (!file) return;
    const supported = /^image\/(jpeg|png|webp|gif)$/i.test(file.type)
      || /\.(jpe?g|png|webp|gif)$/i.test(file.name || "");
    if (!supported) {
      toast("请选择 JPG、PNG、WebP 或 GIF 图片", "error");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast("图片超过 10MB，请换一张小一点的", "error");
      return;
    }
    try {
      const dataUrl = await optimizeImage(file);
      state.coverData = dataUrl;
      state.coverRemoved = false;
      refreshCoverUI();
    } catch (error) {
      toast(error.message || "图片处理失败，请换一张试试", "error", 3800);
    }
  }

  async function optimizeImage(file) {
    if (file.type === "image/gif") {
      if (file.size > MAX_GIF_BYTES) {
        throw new Error("GIF 超过 6MB，请压缩后再上传");
      }
      return readAsDataUrl(file);
    }

    const source = await loadImageSource(file);
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error("无法读取这张图片");

    const maxEdge = 1500;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器无法处理这张图片");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    if (typeof source.close === "function") source.close();

    let quality = 0.87;
    let dataUrl = canvas.toDataURL("image/webp", quality);
    const webp = dataUrl.startsWith("data:image/webp");
    while (dataUrl.length * 0.75 > 7.4 * 1024 * 1024 && quality > 0.45) {
      quality -= 0.1;
      dataUrl = webp ? canvas.toDataURL("image/webp", quality) : canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length * 0.75 > 8 * 1024 * 1024) {
      throw new Error("图片压缩后仍然太大，请换一张");
    }
    return dataUrl;
  }

  function loadImageSource(file) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(file).catch(() => loadImageElement(file));
    }
    return loadImageElement(file);
  }

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("无法读取这张图片"));
      };
      image.src = url;
    });
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("无法读取这张图片"));
      reader.readAsDataURL(file);
    });
  }

  async function submitForm(event) {
    event.preventDefault();
    if (state.submitting) return;

    const title = els.titleInput.value.trim();
    if (!title) {
      els.titleInput.classList.add("is-invalid");
      els.formError.textContent = "请先填写动漫名称";
      els.formError.hidden = false;
      els.titleInput.focus();
      return;
    }

    const watched = numberValue(els.watchedInput);
    const total = numberValue(els.totalInput);
    const payload = {
      title,
      altTitle: els.altTitleInput.value.trim(),
      status: (document.querySelector('input[name="status"]:checked') || {}).value || "completed",
      rating: state.rating,
      finishedYear: numberValue(els.finishedYearInput),
      episodesWatched: total > 0 ? Math.min(watched, total) : watched,
      episodesTotal: total,
      tags: els.tagsInput.value.split(/[,，、/|]+/).map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
      notes: els.notesInput.value.trim(),
      accent: state.editingAccent || undefined,
    };
    if (state.coverData) payload.coverData = state.coverData;
    else if (state.editingId && state.coverRemoved) payload.removeCover = true;

    const editing = Boolean(state.editingId);
    state.submitting = true;
    els.formError.hidden = true;
    setSaveLabel(true, editing);

    try {
      const data = editing
        ? await api(`/api/anime/${encodeURIComponent(state.editingId)}`, { method: "PUT", body: JSON.stringify(payload) })
        : await api("/api/anime", { method: "POST", body: JSON.stringify(payload) });

      if (editing) {
        state.items = state.items.map((item) => item.id === data.item.id ? data.item : item);
      } else {
        state.items.unshift(data.item);
        state.filter = "all";
        setSearchQuery("", { render: false });
      }
      state.submitting = false;
      setSaveLabel(false, editing);
      closeModal(els.formModal);
      renderAll();
      toast(editing ? "这一页已经更新啦" : `《${data.item.title}》贴进手帐啦`);
      if (!editing) {
        window.setTimeout(() => {
          els.collection.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
      }
    } catch (error) {
      state.submitting = false;
      setSaveLabel(false, editing);
      els.formError.textContent = error.message;
      els.formError.hidden = false;
      toast(error.message, "error", 4200);
    }
  }

  // ------------------------------------------------------------------
  // 删除 / 示例 / 导入
  // ------------------------------------------------------------------

  function openConfirm({ mode, title, text, okLabel }) {
    state.confirmMode = mode;
    state.confirmBusy = false;
    els.confirmTitle.textContent = title;
    els.confirmText.textContent = text;
    els.confirmOk.textContent = okLabel;
    els.confirmOk.disabled = false;
    els.confirmCancel.disabled = false;
    openModal(els.confirmModal, "#confirmCancel");
  }

  function askDelete(id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;
    state.pendingDelete = id;
    openConfirm({
      mode: "delete",
      title: "撕掉这一页？",
      text: `《${item.title}》会从手帐里消失，封面图片也会一并删除。此操作无法撤销。`,
      okLabel: "确认撕掉",
    });
  }

  function askClearDemo() {
    openConfirm({
      mode: "clear-demo",
      title: "清空示例数据？",
      text: "只会移除 6 部示例作品，你自己添加的动漫不会受到影响。",
      okLabel: "清空示例",
    });
  }

  function setConfirmBusy(busy, label) {
    state.confirmBusy = busy;
    els.confirmOk.disabled = busy;
    els.confirmCancel.disabled = busy;
    if (busy) els.confirmOk.textContent = label;
  }

  async function handleConfirm() {
    if (state.confirmBusy) return;
    if (state.confirmMode === "delete") {
      const item = state.items.find((entry) => entry.id === state.pendingDelete);
      setConfirmBusy(true, "撕掉中…");
      try {
        await api(`/api/anime/${encodeURIComponent(state.pendingDelete)}`, { method: "DELETE" });
        state.items = state.items.filter((entry) => entry.id !== state.pendingDelete);
        state.pendingDelete = null;
        closeModal(els.confirmModal, { force: true });
        if (!els.detailModal.hidden) closeModal(els.detailModal);
        renderAll();
        toast(item ? `《${item.title}》已从手帐里撕掉` : "这一页已撕掉");
      } catch (error) {
        setConfirmBusy(false, "确认撕掉");
        toast(error.message, "error", 4200);
      }
      return;
    }

    if (state.confirmMode === "clear-demo") {
      setConfirmBusy(true, "清空中…");
      try {
        await api("/api/demo", { method: "DELETE" });
        state.items = state.items.filter((item) => !item.demo);
        closeModal(els.confirmModal, { force: true });
        renderAll();
        toast("示例数据已清空");
      } catch (error) {
        setConfirmBusy(false, "清空示例");
        toast(error.message, "error", 4200);
      }
      return;
    }

    if (state.confirmMode === "import") {
      if (!state.pendingImport) return;
      setConfirmBusy(true, "导入中…");
      try {
        await api("/api/import", { method: "POST", body: JSON.stringify({ items: state.pendingImport }) });
        state.pendingImport = null;
        closeModal(els.confirmModal, { force: true });
        await loadItems();
        await loadMusic();
        toast("备份已导入，手帐已经恢复啦");
        window.setTimeout(() => els.collection.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
      } catch (error) {
        setConfirmBusy(false, "导入并覆盖");
        toast(error.message, "error", 5200);
      }
      return;
    }

    if (state.confirmMode === "import-zip") {
      const file = state.pendingImportFile;
      if (!file) return;
      setConfirmBusy(true, "恢复中…");
      try {
        const response = await fetch("/api/backup/import", {
          method: "POST",
          headers: { "Content-Type": "application/zip" },
          body: file,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error((data && data.error) || "恢复失败");
        state.pendingImportFile = null;
        closeModal(els.confirmModal, { force: true });
        closeModal(els.backupModal);
        await loadItems();
        await loadMusic();
        toast(`完整备份已恢复，共 ${data.count || state.items.length} 部作品`);
      } catch (error) {
        setConfirmBusy(false, "恢复这份备份");
        toast(error.message, "error", 5200);
      }
      return;
    }

    if (state.confirmMode === "restore-backup") {
      if (!state.pendingBackupName) return;
      setConfirmBusy(true, "恢复中…");
      try {
        const data = await api("/api/backups/restore", {
          method: "POST",
          body: JSON.stringify({ name: state.pendingBackupName }),
        });
        state.pendingBackupName = null;
        closeModal(els.confirmModal, { force: true });
        closeModal(els.backupModal);
        await loadItems();
        await loadMusic();
        toast(`备份已恢复，共 ${data.count || state.items.length} 部作品`);
      } catch (error) {
        setConfirmBusy(false, "确认恢复");
        toast(error.message, "error", 5200);
      }
    }
  }

  async function loadDemo() {
    if (state.demoLoading) return;
    state.demoLoading = true;
    els.demoBtn.disabled = true;
    els.emptyDemoBtn.disabled = true;
    try {
      await api("/api/demo", { method: "POST" });
      await loadItems();
      toast("已载入 6 部示例作品，随便逛逛吧");
      window.setTimeout(() => els.collection.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    } catch (error) {
      toast(error.message, "error", 4200);
    } finally {
      state.demoLoading = false;
      els.demoBtn.disabled = false;
      els.emptyDemoBtn.disabled = false;
    }
  }

  async function handleImportFile(file) {
    if (!file) return;
    if (file.size > 120 * 1024 * 1024) {
      toast("备份文件超过 120MB，无法导入", "error");
      return;
    }
    const isZip = /\.zip$/i.test(file.name || "") || /zip/i.test(file.type || "");
    if (isZip) {
      state.pendingImport = null;
      state.pendingImportFile = file;
      openConfirm({
        mode: "import-zip",
        title: "从完整备份恢复？",
        text: "完整备份会覆盖当前手帐、封面和背景音乐。恢复前会自动再备份一次当前数据；如果只想导入旧版 JSON，请选择 .json 文件。",
        okLabel: "恢复这份备份",
      });
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : parsed && parsed.items;
      if (!Array.isArray(items)) throw new Error("missing items");
      if (items.length > 2000) throw new Error("too many");
      state.pendingImportFile = null;
      state.pendingImport = items;
      openConfirm({
        mode: "import",
        title: "导入这份备份？",
        text: `备份中包含 ${items.length} 部作品。导入后会覆盖当前手帐，导入前会自动留一份完整备份。`,
        okLabel: "导入并覆盖",
      });
    } catch {
      toast("这不是有效的番迹备份文件", "error", 4200);
    }
  }

  // ------------------------------------------------------------------
  // 模态框 / 焦点
  // ------------------------------------------------------------------

  function openModal(modal, focusSelector) {
    if (!modal) return;
    state.lastFocus = document.activeElement;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    syncBodyLock();
    window.setTimeout(() => {
      const target = focusSelector ? $(focusSelector, modal) : null;
      const fallback = modal.querySelector("button, input, select, textarea, [tabindex]");
      (target || fallback || modal).focus({ preventScroll: true });
    }, 60);
  }

  function closeModal(modal, options = {}) {
    if (!modal || modal.hidden) return;
    if (modal === els.formModal && state.submitting) return;
    if (modal === els.confirmModal && state.confirmBusy && !options.force) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    syncBodyLock();
    if (!document.querySelector(".modal:not([hidden])") && state.lastFocus && document.contains(state.lastFocus)) {
      try { state.lastFocus.focus({ preventScroll: true }); } catch { /* noop */ }
    }
  }

  function syncBodyLock() {
    document.body.classList.toggle("is-locked", Boolean(document.querySelector(".modal:not([hidden])")));
  }

  function trapFocus(modal, event) {
    const focusable = $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', modal)
      .filter((node) => node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!modal.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ------------------------------------------------------------------
  // 事件绑定
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // 设置
  // ------------------------------------------------------------------

  function loadSettings() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
    } catch {
      saved = {};
    }
    const next = { ...DEFAULT_SETTINGS };
    for (const [key, allowed] of Object.entries(SETTINGS_SCHEMA)) {
      if (allowed.includes(saved[key])) next[key] = saved[key];
    }
    state.settings = next;
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch {
      /* 隐私模式下忽略，设置只在本次会话生效 */
    }
  }

  function applySettings() {
    const { paper, density, notes, motion } = state.settings;
    const body = document.body;
    body.dataset.paper = paper;
    body.dataset.density = density;
    body.dataset.notes = notes;
    body.dataset.motion = motion;
  }

  function applyDefaultSort() {
    state.sort = state.settings.defaultSort;
    if (els.sortSelect) els.sortSelect.value = state.sort;
  }

  function syncSettingsUI() {
    if (els.settingsBody) {
      $$('input[type="radio"]', els.settingsBody).forEach((input) => {
        input.checked = state.settings[input.name] === input.value;
      });
    }
    if (els.settingsSortSelect) els.settingsSortSelect.value = state.settings.defaultSort;
  }

  function setSetting(key, value) {
    const allowed = SETTINGS_SCHEMA[key];
    if (!allowed || !allowed.includes(value) || state.settings[key] === value) return;
    state.settings[key] = value;
    saveSettings();
    applySettings();
    if (key === "defaultSort") {
      applyDefaultSort();
      renderCollection();
    }
  }

  function openSettings() {
    if (!els.settingsModal) return;
    syncSettingsUI();
    openModal(els.settingsModal);
  }

  function resetSettings() {
    state.settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    applySettings();
    applyDefaultSort();
    syncSettingsUI();
    renderCollection();
    toast("设置已经恢复默认");
  }

  function bindSettingsEvents() {
    [els.settingsBtn, els.settingsBtnTop].forEach((button) => {
      if (button) button.addEventListener("click", openSettings);
    });
    if (els.settingsBody) {
      els.settingsBody.addEventListener("change", (event) => {
        const input = event.target.closest('input[type="radio"]');
        if (input && SETTINGS_SCHEMA[input.name]) setSetting(input.name, input.value);
      });
    }
    if (els.settingsSortSelect) {
      els.settingsSortSelect.addEventListener("change", () => {
        setSetting("defaultSort", els.settingsSortSelect.value);
      });
    }
    if (els.settingsResetBtn) els.settingsResetBtn.addEventListener("click", resetSettings);
  }

  // ------------------------------------------------------------------
  // 回忆放映
  // ------------------------------------------------------------------

  const CINEMA_PREFS_KEY = "fanji.cinema.prefs";

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  function loadCinemaPrefs() {
    let prefs = {};
    try {
      prefs = JSON.parse(localStorage.getItem(CINEMA_PREFS_KEY) || "{}") || {};
    } catch {
      prefs = {};
    }
    const c = state.cinema;
    const duration = Number(prefs.duration);
    c.duration = [4, 5, 6, 8].includes(duration) ? duration : 5;
    c.shuffle = Boolean(prefs.shuffle);
    c.musicEnabled = prefs.musicEnabled !== false;
    const volume = Number(prefs.volume);
    c.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.7;
    c.muted = Boolean(prefs.muted);

    els.cinemaDuration.value = String(c.duration);
    els.cinemaShuffle.checked = c.shuffle;
    els.cinemaVolume.value = String(c.volume);
    updateMuteButton();
  }

  function saveCinemaPrefs() {
    const c = state.cinema;
    try {
      localStorage.setItem(CINEMA_PREFS_KEY, JSON.stringify({
        duration: c.duration,
        shuffle: c.shuffle,
        musicEnabled: c.musicEnabled,
        volume: c.volume,
        muted: c.muted,
      }));
    } catch {
      // 本地存储不可用时不影响放映。
    }
  }

  function updateMuteButton() {
    const use = els.cinemaMute.querySelector("use");
    if (use) use.setAttribute("href", state.cinema.muted ? "#icon-volume-off" : "#icon-volume");
    els.cinemaMute.setAttribute("aria-label", state.cinema.muted ? "取消静音" : "静音");
  }

  function shuffleArray(items) {
    const result = items.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  }

  function cinemaItems() {
    const completed = state.items.filter((item) => item.status === "completed");
    return completed.length ? completed : state.items.slice();
  }

  function updateCinemaIntro() {
    const c = state.cinema;
    const count = c.playlist.length;
    const seconds = count * c.duration;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    const time = minutes
      ? `${minutes} 分 ${String(rest).padStart(2, "0")} 秒`
      : `${rest} 秒`;
    els.cinemaIntroMeta.textContent = count
      ? `${c.listLabel} ${count} 部 · 约 ${time}`
      : "手帐里还没有可以放映的作品";
    els.cinemaStart.disabled = count === 0;
  }

  function setCinemaBackdrop(item) {
    if (!item) return;
    const accent = safeAccent(item.accent);
    els.cinema.style.setProperty("--cinema-accent", accent);
  }

  function initCinemaDust() {
    if (!els.cinemaDust || els.cinemaDust.childElementCount) return;
    for (let index = 0; index < 38; index += 1) {
      const particle = document.createElement("span");
      const bokeh = index % 5 === 0;
      if (bokeh) particle.classList.add("is-bokeh");
      particle.style.setProperty("--x", `${2 + Math.random() * 96}%`);
      particle.style.setProperty("--y", `${8 + Math.random() * 84}%`);
      particle.style.setProperty("--size", `${(bokeh ? 3 + Math.random() * 4 : 1 + Math.random() * 2).toFixed(1)}px`);
      particle.style.setProperty("--duration", `${14 + Math.random() * 20}s`);
      particle.style.setProperty("--delay", `${-Math.random() * 30}s`);
      particle.style.setProperty("--drift", `${-42 + Math.random() * 84}px`);
      particle.style.setProperty("--opacity", (bokeh ? 0.12 + Math.random() * 0.2 : 0.16 + Math.random() * 0.38).toFixed(2));
      els.cinemaDust.appendChild(particle);
    }
  }

  function renderBgQuote(item) {
    const quote = els.cinemaBgQuote;
    const text = String(item.notes || "").trim();
    if (!text) {
      quote.hidden = true;
      quote.classList.remove("is-visible");
      return;
    }

    const excerpt = text.length > 64 ? `${text.slice(0, 64).trim()}…` : text;
    let slot = 1 + Math.floor(Math.random() * 10);
    if (slot === state.cinema.lastQuoteSlot) {
      slot = (slot % 10) + 1;
    }
    state.cinema.lastQuoteSlot = slot;
    const rotation = -8 + Math.round(Math.random() * 16);
    const dx = -9 + Math.round(Math.random() * 18);
    const dy = -7 + Math.round(Math.random() * 14);

    quote.className = `cinema-bg-quote slot-${slot}`;
    quote.style.setProperty("--quote-rot", `${rotation}deg`);
    quote.style.setProperty("--quote-dx", `${dx}px`);
    quote.style.setProperty("--quote-dy", `${dy}px`);
    quote.textContent = `“${excerpt}”`;
    quote.hidden = false;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => quote.classList.add("is-visible"));
    });
  }

  function renderGhostQuote(item) {
    const ghost = els.cinemaGhostQuote;
    const text = String(item.notes || "").replace(/\s+/g, "").trim();
    if (!text) {
      ghost.hidden = true;
      return;
    }
    const compact = Array.from(text).slice(0, 6).join("");
    const leftSlots = [1, 2, 5, 6, 9];
    const side = leftSlots.includes(state.cinema.lastQuoteSlot) ? "ghost-right" : "ghost-left";
    ghost.className = `cinema-ghost-quote ${side}`;
    ghost.style.setProperty("--ghost-top", `${16 + Math.random() * 14}%`);
    ghost.textContent = compact;
    ghost.hidden = false;
  }

  function slideStars(rating) {
    return Array.from({ length: 5 }, (_, index) =>
      `<svg class="icon ${index < rating ? "" : "off"}" aria-hidden="true"><use href="#icon-star"/></svg>`).join("");
  }

  function slideHtml(item, index) {
    const rating = Math.max(0, Math.min(5, Number(item.rating) || 0));
    const tags = (Array.isArray(item.tags) ? item.tags : []).slice(0, 4)
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
    const finished = Number(item.finishedYear) || 0;
    const cover = item.coverUrl
      ? `<img src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.title)} 封面" data-cover>`
      : "";
    const fallbackLabel = item.altTitle ? item.altTitle : "ANIME ARCHIVE";
    const note = item.notes
      ? `<p class="slide-note">${escapeHtml(item.notes)}</p>`
      : `<p class="slide-note no-note">这一页还没有写下短评。</p>`;
    return `
      <div class="slide-poster ${item.coverUrl ? "has-image" : ""}" style="--accent:${safeAccent(item.accent)}">
        ${cover}
        <div class="cover-fallback" aria-hidden="true">
          <span class="fallback-initial">${escapeHtml(initialOf(item.title))}</span>
          <span class="fallback-small">${escapeHtml(fallbackLabel)}</span>
        </div>
        <span class="slide-tape">MEMORY #${String(index + 1).padStart(2, "0")}</span>
      </div>
      <div class="slide-copy">
        <p class="slide-kicker">${finished ? `WATCHED IN ${finished}` : "A STORY I REMEMBER"}</p>
        <h2 class="slide-title">${escapeHtml(item.title)}</h2>
        ${item.altTitle ? `<p class="slide-alt">${escapeHtml(item.altTitle)}</p>` : ""}
        <div class="slide-rating">${slideStars(rating)}<span>${rating ? `${rating} / 5 · ${RATING_TEXT[rating]}` : "未评分"}</span></div>
        ${tags ? `<div class="slide-meta-line">${tags}</div>` : ""}
        ${note}
      </div>`;
  }

  function updatePlayButton() {
    const use = els.cinemaPlay.querySelector("use");
    if (use) use.setAttribute("href", state.cinema.playing ? "#icon-pause" : "#icon-play");
    els.cinemaPlay.setAttribute("aria-label", state.cinema.playing ? "暂停" : "播放");
    els.cinemaStage.classList.toggle("is-paused", !state.cinema.playing);
  }

  function restartProgress() {
    const bar = els.cinemaProgressBar;
    bar.classList.remove("is-running", "is-paused");
    bar.style.animationDuration = `${state.cinema.duration}s`;
    void bar.offsetWidth;
    bar.classList.add("is-running");
    if (!state.cinema.playing) bar.classList.add("is-paused");
  }

  function clearCinemaTimer() {
    if (state.cinema.timer) {
      window.clearTimeout(state.cinema.timer);
      state.cinema.timer = null;
    }
  }

  function scheduleAdvance() {
    clearCinemaTimer();
    if (!state.cinema.playing) return;
    state.cinema.timer = window.setTimeout(() => nextSlide(1), state.cinema.duration * 1000);
  }

  function showSlide() {
    const c = state.cinema;
    if (!c.playlist.length) return;
    const item = c.playlist[c.index];
    setCinemaBackdrop(item);
    renderBgQuote(item);
    renderGhostQuote(item);
    els.cinemaIndex.textContent = String(c.index + 1).padStart(2, "0");
    els.cinemaIndex.hidden = false;
    els.cinemaSlide.innerHTML = slideHtml(item, c.index);
    els.cinemaCounter.textContent = `${String(c.index + 1).padStart(2, "0")} / ${String(c.playlist.length).padStart(2, "0")}`;
    bindImageFallbacks(els.cinemaSlide);

    const nextItem = c.playlist[(c.index + 1) % c.playlist.length];
    if (nextItem && nextItem.coverUrl) {
      const preload = new Image();
      preload.src = nextItem.coverUrl;
    }

    restartProgress();
    scheduleAdvance();
  }

  function setCinemaPlaying(playing) {
    const c = state.cinema;
    c.playing = playing;
    updatePlayButton();
    if (playing) {
      restartProgress();
      syncAudio();
      scheduleAdvance();
    } else {
      clearCinemaTimer();
      els.cinemaAudio.pause();
      els.cinemaProgressBar.classList.add("is-paused");
    }
  }

  function nextSlide(delta) {
    const c = state.cinema;
    if (!c.playlist.length) return;
    c.index = (c.index + delta + c.playlist.length) % c.playlist.length;
    showSlide();
  }

  function syncAudio() {
    const c = state.cinema;
    const audio = els.cinemaAudio;
    audio.volume = c.volume;
    audio.muted = c.muted;
    if (!c.musicEnabled || !c.music) {
      audio.pause();
      return;
    }
    if (c.started && c.playing) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }

  function applyMusic() {
    const c = state.cinema;
    const music = c.music;
    const hasMusic = Boolean(music);
    els.musicName.textContent = hasMusic ? music.name : "还没有背景音乐";
    els.musicMeta.textContent = hasMusic
      ? `${formatBytes(music.size)} · 保存在本机`
      : "上传一首自己收藏的曲子，放映时循环播放";
    els.musicRemoveBtn.hidden = !hasMusic;
    els.cinemaMusic.disabled = !hasMusic;
    els.cinemaMute.disabled = !hasMusic;
    els.cinemaVolume.disabled = !hasMusic;

    if (hasMusic) {
      if (els.cinemaAudio.getAttribute("src") !== music.url) {
        els.cinemaAudio.src = music.url;
      }
      els.cinemaMusic.checked = c.musicEnabled;
    } else {
      c.musicEnabled = false;
      els.cinemaMusic.checked = false;
      els.cinemaAudio.pause();
      els.cinemaAudio.removeAttribute("src");
      els.cinemaAudio.load();
    }
    updateMuteButton();
    syncAudio();
  }

  async function loadMusic() {
    try {
      const data = await api("/api/music");
      state.cinema.music = data && data.music ? data.music : null;
      applyMusic();
    } catch {
      // 没有音乐服务时静默降级。
    }
  }

  async function uploadMusic(file) {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      toast("音乐太大了，最大支持 30MB", "error");
      return;
    }
    const allowed = /^audio\//i.test(file.type) || /\.(mp3|wav|ogg|m4a)$/i.test(file.name || "");
    if (!allowed) {
      toast("请选择 MP3、WAV、OGG 或 M4A 音乐", "error");
      return;
    }
    const fallbackTypes = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4" };
    const ext = String(file.name || "").split(".").pop().toLowerCase();
    const contentType = file.type || fallbackTypes[ext] || "application/octet-stream";
    const original = els.musicUploadBtn.innerHTML;
    els.musicUploadBtn.disabled = true;
    els.musicUploadBtn.innerHTML = `${icon("icon-upload")}上传中…`;
    try {
      const response = await fetch(`/api/music?name=${encodeURIComponent(file.name || "背景音乐")}`, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: file,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error((data && data.error) || "上传失败");
      state.cinema.music = data.music;
      state.cinema.musicEnabled = true;
      saveCinemaPrefs();
      applyMusic();
      toast("背景音乐已上传");
    } catch (error) {
      toast(error.message || "背景音乐上传失败", "error", 4200);
    } finally {
      els.musicUploadBtn.disabled = false;
      els.musicUploadBtn.innerHTML = original;
      els.musicInput.value = "";
    }
  }

  async function removeMusic() {
    if (!state.cinema.music) return;
    if (!window.confirm("移除这首背景音乐？")) return;
    try {
      await api("/api/music", { method: "DELETE" });
      state.cinema.music = null;
      state.cinema.musicEnabled = false;
      saveCinemaPrefs();
      applyMusic();
      toast("背景音乐已移除");
    } catch (error) {
      toast(error.message, "error", 4200);
    }
  }

  function openCinema() {
    const items = cinemaItems();
    const c = state.cinema;
    if (!items.length) {
      toast("先记录一部动漫，再开始放映吧", "info");
      return;
    }
    loadCinemaPrefs();
    c.playlist = items.slice();
    c.index = 0;
    c.started = false;
    c.playing = false;
    c.closing = false;
    c.listLabel = items.some((item) => item.status === "completed") ? "已看完" : "收藏";
    clearCinemaTimer();
    els.cinemaAudio.pause();

    els.cinema.hidden = false;
    els.cinema.setAttribute("aria-hidden", "false");
    document.body.classList.add("cinema-open");
    els.cinemaBgQuote.hidden = true;
    els.cinemaBgQuote.classList.remove("is-visible");
    els.cinemaGhostQuote.hidden = true;
    els.cinemaIndex.hidden = true;
    els.cinemaIntro.hidden = false;
    els.cinemaStage.hidden = true;
    els.cinemaStage.classList.remove("is-paused");
    els.cinemaProgressBar.classList.remove("is-running", "is-paused");
    setCinemaBackdrop(items[0]);
    initCinemaDust();
    updateCinemaIntro();
    applyMusic();
    loadMusic();
    window.setTimeout(() => els.cinemaStart.focus({ preventScroll: true }), 80);
  }

  async function requestCinemaFullscreen() {
    try {
      await els.cinema.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // 全屏被拒绝时仍然使用铺满窗口的放映层。
    }
  }

  function startCinema() {
    const c = state.cinema;
    if (!c.playlist.length) return;
    loadCinemaPrefs();
    if (c.shuffle) c.playlist = shuffleArray(c.playlist);
    c.index = 0;
    c.started = true;
    c.playing = true;
    c.closing = false;
    els.cinemaIntro.hidden = true;
    els.cinemaStage.hidden = false;
    els.cinemaStage.classList.remove("is-paused");
    updatePlayButton();
    requestCinemaFullscreen();
    syncAudio();
    showSlide();
  }

  function exitCinema() {
    if (els.cinema.hidden) return;
    const c = state.cinema;
    c.closing = true;
    c.playing = false;
    c.started = false;
    clearCinemaTimer();
    els.cinemaAudio.pause();
    els.cinemaProgressBar.classList.remove("is-running", "is-paused");
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    els.cinema.hidden = true;
    els.cinema.setAttribute("aria-hidden", "true");
    document.body.classList.remove("cinema-open");
    els.cinemaBgQuote.hidden = true;
    els.cinemaBgQuote.classList.remove("is-visible");
    els.cinemaGhostQuote.hidden = true;
    els.cinemaIndex.hidden = true;
    els.cinemaIntro.hidden = false;
    els.cinemaStage.hidden = true;
    els.cinemaSlide.innerHTML = "";
    window.setTimeout(() => {
      c.closing = false;
      els.playModeBtn.focus({ preventScroll: true });
    }, 120);
  }

  function handleCinemaKey(event) {
    if (els.cinema.hidden) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      exitCinema();
      return true;
    }
    if (!state.cinema.started) return true;
    if (event.target.closest("input, select, textarea, button") && event.key !== "f" && event.key !== "F") {
      return false;
    }
    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      setCinemaPlaying(!state.cinema.playing);
      return true;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      nextSlide(-1);
      return true;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      nextSlide(1);
      return true;
    }
    if (event.key === "m" || event.key === "M") {
      event.preventDefault();
      state.cinema.muted = !state.cinema.muted;
      updateMuteButton();
      saveCinemaPrefs();
      syncAudio();
      return true;
    }
    if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else requestCinemaFullscreen();
      return true;
    }
    return false;
  }

  function bindCinemaEvents() {
    els.playModeBtn.addEventListener("click", openCinema);
    els.cinemaCloseIntro.addEventListener("click", exitCinema);
    els.cinemaExitTop.addEventListener("click", exitCinema);
    els.cinemaExit.addEventListener("click", exitCinema);
    els.cinemaStart.addEventListener("click", startCinema);
    els.cinemaPlay.addEventListener("click", () => setCinemaPlaying(!state.cinema.playing));
    els.cinemaPrev.addEventListener("click", () => nextSlide(-1));
    els.cinemaNext.addEventListener("click", () => nextSlide(1));

    els.cinemaDuration.addEventListener("change", () => {
      state.cinema.duration = Number(els.cinemaDuration.value) || 5;
      saveCinemaPrefs();
      updateCinemaIntro();
      if (state.cinema.started) {
        restartProgress();
        scheduleAdvance();
      }
    });
    els.cinemaShuffle.addEventListener("change", () => {
      state.cinema.shuffle = els.cinemaShuffle.checked;
      saveCinemaPrefs();
    });
    els.cinemaMusic.addEventListener("change", () => {
      state.cinema.musicEnabled = els.cinemaMusic.checked;
      saveCinemaPrefs();
      syncAudio();
    });
    els.cinemaMute.addEventListener("click", () => {
      state.cinema.muted = !state.cinema.muted;
      updateMuteButton();
      saveCinemaPrefs();
      syncAudio();
    });
    els.cinemaVolume.addEventListener("input", () => {
      state.cinema.volume = Number(els.cinemaVolume.value);
      state.cinema.muted = false;
      updateMuteButton();
      saveCinemaPrefs();
      syncAudio();
    });

    els.musicUploadBtn.addEventListener("click", () => els.musicInput.click());
    els.musicInput.addEventListener("change", () => {
      const file = els.musicInput.files && els.musicInput.files[0];
      uploadMusic(file);
    });
    els.musicRemoveBtn.addEventListener("click", removeMusic);

    document.addEventListener("fullscreenchange", () => {
      if (els.cinema.hidden) return;
      if (!document.fullscreenElement && state.cinema.started && !state.cinema.closing) {
        exitCinema();
      }
    });
  }


  let shareInfo = null;
  let shareTicker = null;

  function showSharePanel(panel) {
    els.shareIntro.hidden = panel !== "intro";
    els.shareLoading.hidden = panel !== "loading";
    els.shareResult.hidden = panel !== "result";
    els.shareErrorBox.hidden = panel !== "error";
  }

  function stopShareTicker() {
    if (shareTicker) {
      window.clearInterval(shareTicker);
      shareTicker = null;
    }
  }

  function updateShareExpiry() {
    if (!shareInfo || !shareInfo.expiresAt) return;
    const expires = Date.parse(shareInfo.expiresAt);
    const left = expires - Date.now();
    if (!Number.isFinite(expires) || left <= 0) {
      els.shareExpiryText.textContent = "这条链接已经过期，请停止后重新生成。";
      return;
    }
    const date = new Intl.DateTimeFormat("zh-CN", {
      month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(expires));
    const hours = Math.max(1, Math.ceil(left / 3600000));
    const warning = shareInfo.warning ? ` · ${shareInfo.warning}` : "";
    els.shareExpiryText.textContent = `有效至 ${date} · 约 ${hours} 小时后失效${warning}`;
  }

  function renderShareActive(info) {
    shareInfo = info;
    els.shareLink.value = info.link || "";
    els.shareCode.textContent = info.code || "------";
    showSharePanel("result");
    updateShareExpiry();
    stopShareTicker();
    shareTicker = window.setInterval(updateShareExpiry, 30000);
  }

  function renderShareIntro() {
    shareInfo = null;
    stopShareTicker();
    showSharePanel("intro");
  }

  function showShareError(message) {
    stopShareTicker();
    showSharePanel("error");
    els.shareErrorText.textContent = message || "请检查网络后重试。";
  }

  async function openShare() {
    renderShareIntro();
    openModal(els.shareModal, "#shareStartBtn");
    try {
      const info = await api("/api/share/status");
      if (info && info.active) {
        renderShareActive(info);
      }
    } catch (error) {
      showShareError(error.message || "无法读取分享状态");
    }
  }

  async function startShare() {
    if (!els.shareStartBtn || els.shareStartBtn.disabled) return;
    els.shareStartBtn.disabled = true;
    showSharePanel("loading");
    try {
      const info = await api("/api/share/start", { method: "POST" });
      if (!info || !info.active) throw new Error("分享服务没有返回有效链接");
      renderShareActive(info);
      toast("临时分享链接已生成");
    } catch (error) {
      showShareError(error.message || "临时链接生成失败");
    } finally {
      els.shareStartBtn.disabled = false;
    }
  }

  async function stopShare() {
    if (!window.confirm("停止分享？朋友手里的链接会立即失效。")) return;
    els.shareStopBtn.disabled = true;
    try {
      await api("/api/share/stop", { method: "POST" });
      renderShareIntro();
      toast("分享已停止");
    } catch (error) {
      toast(error.message, "error", 4200);
    } finally {
      els.shareStopBtn.disabled = false;
    }
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("copy failed");
  }

  async function copyShare() {
    if (!shareInfo || !shareInfo.link) return;
    const text = `番迹 · 只读分享\n${shareInfo.link}\n访问码：${shareInfo.code}\n24 小时内有效，需要保持分享者的电脑开启。`;
    try {
      await copyText(text);
      toast("链接和访问码已复制");
    } catch {
      toast("复制失败，请手动选中链接", "error", 4200);
    }
  }

  function bindShareEvents() {
    els.shareBtn.addEventListener("click", openShare);
    els.shareBtnMobile.addEventListener("click", openShare);
    els.shareStartBtn.addEventListener("click", startShare);
    els.shareRetryBtn.addEventListener("click", startShare);
    els.shareStopBtn.addEventListener("click", stopShare);
    els.shareCopyBtn.addEventListener("click", copyShare);
    els.shareLink.addEventListener("focus", () => els.shareLink.select());
    els.shareModal.addEventListener("click", (event) => {
      if (event.target.closest("[data-close]")) stopShareTicker();
    });
  }


  // ------------------------------------------------------------------
  // 年度总结
  // ------------------------------------------------------------------

  function reviewYears() {
    const years = new Set();
    state.items.forEach((item) => {
      const year = Number(item.finishedYear) || 0;
      if (year >= 1900 && year <= 2100) years.add(year);
    });
    return Array.from(years).sort((a, b) => b - a);
  }

  function reviewData(year) {
    const years = reviewYears();
    const items = state.items.filter((item) => Number(item.finishedYear) === Number(year));
    const rated = items.filter((item) => Number(item.rating) > 0);
    const episodes = items.reduce((sum, item) => sum + (Number(item.episodesWatched) || 0), 0);
    const average = rated.length
      ? (rated.reduce((sum, item) => sum + Number(item.rating), 0) / rated.length).toFixed(1)
      : "—";
    const highest = rated.length ? Math.max(...rated.map((item) => Number(item.rating))) : 0;
    const tagCounts = new Map();
    items.forEach((item) => {
      (Array.isArray(item.tags) ? item.tags : []).forEach((tag) => {
        if (!tag) return;
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
    });
    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
      .slice(0, 10);
    const ratingCounts = [0, 0, 0, 0, 0];
    rated.forEach((item) => { ratingCounts[Math.max(1, Math.min(5, Number(item.rating))) - 1] += 1; });
    const topWorks = items.slice().sort((a, b) =>
      (Number(b.rating) || 0) - (Number(a.rating) || 0)
      || String(a.title).localeCompare(String(b.title), "zh-CN")).slice(0, 5);
    const completed = items.filter((item) => item.status === "completed").length;
    return {
      year: Number(year), years, items, rated, episodes, average, highest,
      topTags, ratingCounts, topWorks, completed,
      index: years.indexOf(Number(year)),
    };
  }

  function yearCover(item, className = "year-thumb") {
    const cover = item.coverUrl
      ? `<img src="${escapeHtml(item.coverUrl)}" alt="" loading="lazy" data-cover>`
      : "";
    const label = item.altTitle || "ANIME ARCHIVE";
    return `<span class="${className} ${item.coverUrl ? "has-image" : "no-cover"}">
      ${cover}
      <span class="cover-fallback" aria-hidden="true">
        <span class="fallback-initial">${escapeHtml(initialOf(item.title))}</span>
        <span class="fallback-small">${escapeHtml(label)}</span>
      </span>
    </span>`;
  }

  function yearReviewHtml(data) {
    const { year, years, items, episodes, average, highest, topTags, ratingCounts, topWorks, completed } = data;
    const topTagHtml = topTags.length
      ? topTags.map(([tag, count]) => `<span class="year-tag">${escapeHtml(tag)}<b>${count}</b></span>`).join("")
      : `<span class="year-muted">还没有记录标签</span>`;
    const maxRating = Math.max(1, ...ratingCounts);
    const ratingRows = [5, 4, 3, 2, 1].map((star) => {
      const count = ratingCounts[star - 1];
      return `<div class="year-rating-row">
        <span>${star} 星</span>
        <span class="year-rating-track"><i style="width:${Math.round((count / maxRating) * 100)}%"></i></span>
        <b>${count}</b>
      </div>`;
    }).join("");
    const topHtml = topWorks.length
      ? topWorks.map((item, index) => `
          <li data-open-item="${escapeHtml(item.id)}">
            <span class="year-rank">${String(index + 1).padStart(2, "0")}</span>
            ${yearCover(item, "year-thumb small")}
            <span class="year-top-copy">
              <b>${escapeHtml(item.title)}</b>
              <span>${item.rating ? `${item.rating} / 5 · ${RATING_TEXT[Number(item.rating)]}` : "未评分"}</span>
              ${item.notes ? `<em>${escapeHtml(String(item.notes).slice(0, 52))}${String(item.notes).length > 52 ? "…" : ""}</em>` : ""}
            </span>
          </li>`).join("")
      : `<li class="year-empty">这一年还没有记录作品。</li>`;
    const allHtml = items.map((item) => `
      <button class="year-mini" type="button" data-open-item="${escapeHtml(item.id)}">
        ${yearCover(item, "year-mini-cover")}
        <span>${escapeHtml(item.title)}</span>
      </button>`).join("");

    return `
      <div class="year-head">
        <div>
          <p class="year-kicker">YEAR IN REVIEW / 年度总结</p>
          <h2 id="yearReviewTitle">把这一年，重新翻一遍。</h2>
        </div>
        <span class="year-head-stamp">${year}</span>
      </div>

      <div class="year-switcher">
        <button type="button" data-year-nav="-1" ${data.index <= 0 ? "disabled" : ""} aria-label="上一年">${icon("icon-prev")}</button>
        <div><span>YEAR</span><b>${year}</b><small>${data.index + 1} / ${years.length}</small></div>
        <button type="button" data-year-nav="1" ${data.index >= years.length - 1 ? "disabled" : ""} aria-label="下一年">${icon("icon-next")}</button>
      </div>

      <div class="year-hero">
        <div class="year-hero-copy">
          <p>这一年，我把看过的故事重新数了一遍。</p>
          <h3>一共 <em>${items.length}</em> 部，<br><em>${episodes}</em> 集陪伴。</h3>
          <span>已看完 ${completed} 部 · 平均 ${average} 分 · 最高 ${highest || "—"} 分</span>
        </div>
        <div class="year-seal" aria-hidden="true">
          <span>MY ANIME</span>
          <b>${year}</b>
          <small>年度手帐</small>
        </div>
      </div>

      <div class="year-stat-grid">
        <div class="year-stat"><b>${items.length}</b><span>部作品</span></div>
        <div class="year-stat"><b>${episodes}</b><span>集动画</span></div>
        <div class="year-stat"><b>${average}</b><span>平均分</span></div>
        <div class="year-stat"><b>${topTags.length}</b><span>个关键词</span></div>
      </div>

      <div class="year-columns">
        <section class="year-card">
          <p class="year-card-kicker">KEYWORDS</p>
          <h3>年度关键词</h3>
          <div class="year-tags">${topTagHtml}</div>
        </section>
        <section class="year-card">
          <p class="year-card-kicker">RATINGS</p>
          <h3>评分分布</h3>
          <div class="year-rating">${ratingRows}</div>
        </section>
      </div>

      <section class="year-card year-top-section">
        <p class="year-card-kicker">HIGHLIGHTS</p>
        <h3>年度高分</h3>
        <ol class="year-top-list">${topHtml}</ol>
      </section>

      <section class="year-card">
        <p class="year-card-kicker">ALL MEMORIES</p>
        <h3>这一年看过</h3>
        <div class="year-mini-grid">${allHtml || `<p class="year-muted">这一年还没有记录作品。</p>`}</div>
      </section>

      <div class="year-actions">
        <button class="btn btn-primary" id="yearPosterBtn" type="button">${icon("icon-image")}预览年度海报</button>
        <button class="btn btn-ghost" id="yearCopyBtn" type="button">${icon("icon-copy")}复制年度文案</button>
      </div>
      <p class="year-footnote">年度总结按「看完年份」统计 · 生成于番迹</p>`;
  }

  function renderYearReview() {
    const years = reviewYears();
    if (!years.length) return;
    if (!years.includes(Number(state.yearReviewYear))) state.yearReviewYear = years[0];
    const data = reviewData(state.yearReviewYear);
    els.yearReviewBody.innerHTML = yearReviewHtml(data);
    bindImageFallbacks(els.yearReviewBody);
  }

  function openYearReview() {
    const years = reviewYears();
    if (!years.length) {
      toast("还没有填写看完年份，先在编辑页补上吧", "info");
      return;
    }
    if (!years.includes(Number(state.yearReviewYear))) state.yearReviewYear = years[0];
    openModal(els.yearReviewModal, ".year-close");
    renderYearReview();
  }

  async function copyYearCaption(data) {
    const top = data.topWorks.slice(0, 3).map((item) => `《${item.title}》`).join("、");
    const text = `我的 ${data.year} 动漫年度总结：${data.items.length} 部 / ${data.episodes} 集，平均 ${data.average} 分。${top ? `年度高分：${top}。` : ""}#番迹`;
    try {
      await copyText(text);
      toast("年度文案已复制");
    } catch {
      toast("复制失败，请手动选中文案", "error", 4200);
    }
  }

  function previewYearPoster(data) {
    if (!window.FanjiPoster) {
      toast("年度海报组件没有加载，请刷新页面", "error");
      return;
    }
    window.FanjiPoster.preview(data, { toast, openModal, closeModal });
  }

  function bindYearReviewEvents() {
    [els.yearReviewBtn, els.yearReviewBtnFooter].forEach((button) => {
      if (button) button.addEventListener("click", openYearReview);
    });
    els.yearReviewBody.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-year-nav]");
      if (nav) {
        const years = reviewYears();
        const next = years[years.indexOf(Number(state.yearReviewYear)) + Number(nav.dataset.yearNav)];
        if (next) {
          state.yearReviewYear = next;
          renderYearReview();
          els.yearReviewBody.scrollTop = 0;
        }
        return;
      }
      const item = event.target.closest("[data-open-item]");
      if (item) {
        closeModal(els.yearReviewModal);
        openDetail(item.dataset.openItem);
        return;
      }
      if (event.target.closest("#yearPosterBtn")) {
        previewYearPoster(reviewData(state.yearReviewYear));
        return;
      }
      if (event.target.closest("#yearCopyBtn")) {
        copyYearCaption(reviewData(state.yearReviewYear));
      }
    });
  }


  function bindBackupEvents() {
    els.backupBtn.addEventListener("click", openBackup);
    const headerBackup = $("#backupHeaderBtn");
    if (headerBackup) headerBackup.addEventListener("click", openBackup);
    els.backupRefreshBtn.addEventListener("click", loadBackupList);
    els.backupCreateBtn.addEventListener("click", createLocalBackup);
    els.backupDownloadBtn.addEventListener("click", downloadFullBackup);
    els.backupRestoreFileBtn.addEventListener("click", () => els.backupFileInput.click());
    els.backupFileInput.addEventListener("change", () => {
      const file = els.backupFileInput.files && els.backupFileInput.files[0];
      els.backupFileInput.value = "";
      handleImportFile(file);
    });
    els.backupList.addEventListener("click", (event) => {
      const restore = event.target.closest("[data-restore]");
      if (!restore) return;
      askRestoreBackup(restore.dataset.restore, restore.dataset.count || "");
    });
  }

  function formatBackupReason(reason) {
    const labels = {
      auto: ["自动备份", "auto"],
      manual: ["手动备份", ""],
      download: ["下载时备份", ""],
      "before-import": ["导入前", "safety"],
      "before-restore": ["恢复前", "safety"],
    };
    return labels[reason] || [reason || "完整备份", ""];
  }

  function formatBackupDate(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(date);
  }

  function renderBackupList(backups) {
    els.backupListMeta.textContent = backups.length
      ? `${backups.length} 份完整备份`
      : "还没有本机备份";
    if (!backups.length) {
      els.backupList.innerHTML = `<div class="backup-empty">还没有备份。点「立即备份到本机」或等自动备份。</div>`;
      return;
    }
    els.backupList.innerHTML = backups.map((backup) => {
      const [label, className] = formatBackupReason(backup.reason);
      const music = backup.hasMusic ? "含背景音乐" : "无背景音乐";
      return `
        <div class="backup-row">
          <span class="backup-row-icon"><svg class="icon"><use href="#icon-bookmark"/></svg></span>
          <div class="backup-row-main">
            <b>${escapeHtml(formatBackupDate(backup.createdAt))}</b>
            <span>
              <span class="backup-reason ${className}">${escapeHtml(label)}</span>
              ${escapeHtml(String(backup.count || 0))} 部 · ${escapeHtml(formatBytes(backup.size))} · ${music}
            </span>
          </div>
          <div class="backup-row-actions">
            <button type="button" data-restore="${escapeHtml(backup.name)}" data-count="${backup.count || 0}">恢复</button>
            <a href="${escapeHtml(backup.downloadUrl)}" download>下载</a>
          </div>
        </div>`;
    }).join("");
  }

  async function loadBackupList() {
    els.backupListMeta.textContent = "正在读取…";
    els.backupList.innerHTML = "";
    try {
      const data = await api("/api/backups");
      renderBackupList(Array.isArray(data.backups) ? data.backups : []);
    } catch (error) {
      els.backupListMeta.textContent = "读取失败";
      els.backupList.innerHTML = `<div class="backup-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  function openBackup() {
    openModal(els.backupModal, "#backupDownloadBtn");
    loadBackupList();
  }

  async function createLocalBackup() {
    if (els.backupCreateBtn.disabled) return;
    els.backupCreateBtn.disabled = true;
    const original = els.backupCreateBtn.innerHTML;
    els.backupCreateBtn.innerHTML = `${icon("icon-bookmark")}备份中…`;
    try {
      await api("/api/backups/create", { method: "POST" });
      await loadBackupList();
      toast("已在本机留一份完整备份");
    } catch (error) {
      toast(error.message, "error", 5200);
    } finally {
      els.backupCreateBtn.disabled = false;
      els.backupCreateBtn.innerHTML = original;
    }
  }

  async function downloadFullBackup() {
    if (els.backupDownloadBtn.disabled) return;
    els.backupDownloadBtn.disabled = true;
    try {
      const response = await fetch("/api/backup/export");
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error((data && data.error) || `下载失败（${response.status}）`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match ? match[1] : `fanji-full-backup-${Date.now()}.zip`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      await loadBackupList();
      toast("完整备份已下载，包含封面和背景音乐");
    } catch (error) {
      toast(error.message, "error", 5200);
    } finally {
      els.backupDownloadBtn.disabled = false;
    }
  }

  function askRestoreBackup(name, count) {
    if (!name) return;
    state.pendingBackupName = name;
    openConfirm({
      mode: "restore-backup",
      title: "恢复这份备份？",
      text: `会用这份备份覆盖当前手帐${count ? `（${count} 部作品）` : ""}、封面和背景音乐。恢复前会自动再备份一次当前数据。`,
      okLabel: "确认恢复",
    });
  }


  function bindEvents() {
    bindCinemaEvents();
    bindShareEvents();
    bindBackupEvents();
    bindYearReviewEvents();
    bindSettingsEvents();
    els.addBtn.addEventListener("click", () => openForm());
    els.heroAddBtn.addEventListener("click", () => openForm());
    els.demoBtn.addEventListener("click", loadDemo);
    els.emptyDemoBtn.addEventListener("click", () => {
      if (state.emptyMode === "error") {
        window.location.reload();
      } else if (state.emptyMode === "filter") {
        resetFilters();
      } else {
        loadDemo();
      }
    });
    els.emptyAddBtn.addEventListener("click", () => {
      if (state.emptyMode === "filter") resetFilters();
      else openForm();
    });

    els.grid.addEventListener("click", (event) => {
      const tagButton = event.target.closest("[data-tag-search]");
      if (tagButton) {
        const tag = String(tagButton.dataset.tagSearch || "").trim();
        if (tag) setSearchQuery(`tag:"${tag.replace(/"/g, "")}"`);
        return;
      }
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) return;
      const card = event.target.closest(".anime-card");
      const id = actionEl.dataset.id || (card && card.dataset.id);
      if (!id) return;
      const action = actionEl.dataset.action;
      if (action === "detail") openDetail(id);
      else if (action === "edit") openForm(id);
    });

    els.detailContent.addEventListener("click", (event) => {
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) return;
      const id = actionEl.dataset.id;
      if (!id) return;
      if (actionEl.dataset.action === "edit") {
        closeModal(els.detailModal);
        window.setTimeout(() => openForm(id), 120);
      } else if (actionEl.dataset.action === "delete") {
        askDelete(id);
      }
    });

    els.searchInput.addEventListener("input", (event) => {
      if (event.isComposing) return;
      state.query = els.searchInput.value;
      syncSearchChrome();
      scheduleSearchRender();
    });
    els.searchInput.addEventListener("compositionend", () => {
      state.query = els.searchInput.value;
      syncSearchChrome();
      scheduleSearchRender();
    });
    if (els.searchBox) {
      els.searchBox.addEventListener("click", (event) => {
        if (event.target.closest(".search-clear")) return;
        els.searchInput.focus();
      });
    }
    if (els.searchClear) {
      els.searchClear.addEventListener("click", (event) => {
        event.preventDefault();
        setSearchQuery("");
        els.searchInput.focus();
      });
    }
    els.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setSearchQuery("");
        els.searchInput.blur();
      }
    });

    els.sortSelect.addEventListener("change", () => {
      state.sort = els.sortSelect.value;
      renderCollection();
    });

    els.filterBar.addEventListener("click", (event) => {
      const pill = event.target.closest("[data-filter]");
      if (!pill) return;
      state.filter = pill.dataset.filter;
      renderFilters();
      renderCollection();
    });

    els.demoChip.addEventListener("click", askClearDemo);
    els.form.addEventListener("submit", submitForm);

    els.titleInput.addEventListener("input", () => {
      els.titleInput.classList.remove("is-invalid");
      if (els.formError.hidden === false) {
        els.formError.hidden = true;
      }
    });

    $$("button[data-star]", els.starPicker).forEach((button) => {
      button.addEventListener("click", () => {
        state.rating = Number(button.dataset.star);
        updateRatingUI();
      });
    });
    els.clearRatingBtn.addEventListener("click", () => {
      state.rating = 0;
      updateRatingUI();
    });

    // 封面：点击、键盘、拖拽、粘贴
    els.coverDrop.addEventListener("click", () => els.coverInput.click());
    els.coverDrop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        els.coverInput.click();
      }
    });
    els.chooseCoverBtn.addEventListener("click", () => els.coverInput.click());
    els.coverInput.addEventListener("change", () => {
      const file = els.coverInput.files && els.coverInput.files[0];
      els.coverInput.value = "";
      handleImageFile(file);
    });
    els.removeCoverBtn.addEventListener("click", () => {
      state.coverData = null;
      state.coverRemoved = Boolean(state.editingId);
      refreshCoverUI();
    });

    ["dragenter", "dragover"].forEach((name) => {
      els.coverDrop.addEventListener(name, (event) => {
        event.preventDefault();
        els.coverDrop.classList.add("is-dragging");
      });
    });
    ["dragleave", "drop"].forEach((name) => {
      els.coverDrop.addEventListener(name, (event) => {
        event.preventDefault();
        els.coverDrop.classList.remove("is-dragging");
      });
    });
    els.coverDrop.addEventListener("drop", (event) => {
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      handleImageFile(file);
    });
    document.addEventListener("paste", (event) => {
      if (els.formModal.hidden) return;
      const items = event.clipboardData && event.clipboardData.files;
      if (items && items.length) {
        const file = Array.from(items).find((entry) => entry.type.startsWith("image/"));
        if (file) {
          event.preventDefault();
          handleImageFile(file);
        }
      }
    });

    els.confirmOk.addEventListener("click", handleConfirm);
    els.confirmCancel.addEventListener("click", () => closeModal(els.confirmModal));

    els.importTrigger.addEventListener("click", () => els.importInput.click());
    els.importInput.addEventListener("change", () => {
      const file = els.importInput.files && els.importInput.files[0];
      els.importInput.value = "";
      handleImportFile(file);
    });
    $$(".modal").forEach((modal) => {
      modal.addEventListener("click", (event) => {
        if (event.target.closest("[data-close]")) closeModal(modal);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (!els.cinema.hidden) {
        handleCinemaKey(event);
        return;
      }
      const openModals = $$(".modal:not([hidden])");
      const topModal = openModals[openModals.length - 1];
      if (event.key === "Escape") {
        if (topModal) {
          event.preventDefault();
          closeModal(topModal);
          return;
        }
        if (document.activeElement === els.searchInput && els.searchInput.value) {
          setSearchQuery("");
        }
        return;
      }
      if (event.key === "Tab" && topModal) {
        trapFocus(topModal, event);
        return;
      }
      const typing = event.target.closest("input, textarea, select, [contenteditable='true']");
      if (typing || topModal) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        els.collection.scrollIntoView({ behavior: "smooth", block: "start" });
        window.setTimeout(() => els.searchInput.focus(), 220);
      } else if (event.key === "/" ) {
        event.preventDefault();
        els.searchInput.focus();
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        openForm();
      }
    });
  }

  function resetFilters() {
    state.filter = "all";
    setSearchQuery("", { render: false });
    renderFilters();
    renderCollection();
  }

  // ------------------------------------------------------------------
  // 启动
  // ------------------------------------------------------------------

  function init() {
    loadSettings();
    applySettings();
    applyDefaultSort();
    bindEvents();
    loadCinemaPrefs();
    if (location.protocol === "file:") {
      state.loading = false;
      state.loadError = true;
      renderAll();
      return;
    }
    loadItems();
    loadMusic();
  }

  init();
})();
