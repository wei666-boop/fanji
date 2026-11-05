(() => {
  "use strict";

  const STATUS = {
    completed: { label: "已看完", icon: "icon-check" },
    watching: { label: "在看", icon: "icon-clock" },
    planned: { label: "想看", icon: "icon-bookmark" },
    dropped: { label: "弃番", icon: "icon-close" },
  };
  const RATING_TEXT = ["未评分", "一般", "还行", "不错", "很好看", "神作"];

  const state = {
    items: [],
    filter: "all",
    query: "",
    sort: "recent",
    expiresAt: 0,
    loading: true,
    failed: false,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));

  const safeAccent = (value) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#8b5cf6";
  const icon = (name, cls = "") => `<svg class="icon ${cls}" aria-hidden="true"><use href="#${name}"/></svg>`;
  const initialOf = (title) => Array.from(String(title || "").trim())[0] || "?";
  const fmtDate = (iso) => {
    const date = new Date(iso || "");
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
  };
  const fmtNumber = (value) => new Intl.NumberFormat("zh-CN").format(Number(value) || 0);

  function stars(rating, full = true) {
    const safe = Math.max(0, Math.min(5, Number(rating) || 0));
    const icons = Array.from({ length: 5 }, (_, index) =>
      `<svg class="icon ${index < safe ? "on" : ""}" aria-hidden="true"><use href="#icon-star"/></svg>`).join("");
    if (!safe) return `<span class="mini-stars"><span class="empty-label">还没有评分</span></span>`;
    return `<span class="${full ? "mini-stars" : "stars"}" aria-label="${safe} 星">${icons}</span>`;
  }

  function itemSort(a, b) {
    if (state.sort === "rating") return (Number(b.rating) || 0) - (Number(a.rating) || 0);
    if (state.sort === "title") return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
    if (state.sort === "finishedYear") return (Number(b.finishedYear) || 0) - (Number(a.finishedYear) || 0);
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  }

  function visibleItems() {
    const query = state.query.trim().toLowerCase();
    return state.items
      .filter((item) => state.filter === "all" || item.status === state.filter)
      .filter((item) => {
        if (!query) return true;
        return [item.title, item.altTitle, item.notes, ...(Array.isArray(item.tags) ? item.tags : [])]
          .join(" ").toLowerCase().includes(query);
      })
      .sort(itemSort);
  }

  function cardHtml(item, index) {
    const accent = safeAccent(item.accent);
    const status = STATUS[item.status] || STATUS.completed;
    const rating = Math.max(0, Math.min(5, Number(item.rating) || 0));
    const total = Number(item.episodesTotal) || 0;
    const watched = Number(item.episodesWatched) || 0;
    const progress = total > 0 ? Math.min(100, Math.round((watched / total) * 100)) : (watched > 0 ? 100 : 0);
    const episodeLabel = total > 0 ? `${watched}/${total} 集` : watched > 0 ? `已看 ${watched} 集` : "集数未记录";
    const meta = [
      item.finishedYear ? `${item.finishedYear} 年` : "",
      total > 0 ? `全 ${total} 集` : "",
    ].filter(Boolean).join(`<span class="sep">·</span>`) || "信息待补充";
    const cover = item.coverUrl
      ? `<img src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.title)} 封面" loading="lazy" data-cover>`
      : "";
    const fallbackLabel = item.altTitle || "ANIME ARCHIVE";
    const tags = (Array.isArray(item.tags) ? item.tags : []).slice(0, 4)
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
    const notes = item.notes ? `<p class="card-notes">${escapeHtml(item.notes)}</p>` : "";
    const score = rating > 0 ? `<span class="cover-score">${icon("icon-star")}${rating}</span>` : "";
    const done = item.status === "completed" ? `<span class="done-stamp" aria-hidden="true">済</span>` : "";
    const cardNo = String(index + 1).padStart(2, "0");

    return `
      <article class="anime-card" data-id="${escapeHtml(item.id)}" style="--accent:${accent};--i:${index}">
        <button class="cover ${item.coverUrl ? "" : "no-cover"}" type="button" data-action="detail"
                aria-label="查看《${escapeHtml(item.title)}》的详情">
          ${cover}
          <div class="cover-fallback" aria-hidden="true">
            <span class="fallback-initial">${escapeHtml(initialOf(item.title))}</span>
            <span class="fallback-small">${escapeHtml(fallbackLabel)}</span>
          </div>
          <span class="status-badge status-${escapeHtml(item.status)}"><i></i>${escapeHtml(status.label)}</span>
          ${score}
          ${done}
          <span class="cover-hover">翻开这一页 ${icon("icon-arrow")}</span>
        </button>
        <div class="card-body">
          <div class="card-title-row">
            <h3 class="card-title">${escapeHtml(item.title)}</h3>
          </div>
          <p class="card-meta"><span class="card-no">NO.${cardNo}</span>${meta}</p>
          <div class="card-tags">${tags}</div>
          ${notes}
          <div class="card-foot">
            ${stars(rating, true)}
            <span class="episode-progress">
              <span class="bar"><span style="width:${progress}%"></span></span>${escapeHtml(episodeLabel)}
            </span>
          </div>
        </div>
      </article>`;
  }

  function renderCounts() {
    const counts = { all: state.items.length, completed: 0, watching: 0, planned: 0, dropped: 0 };
    state.items.forEach((item) => {
      if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status] += 1;
    });
    $$(".pill-count").forEach((el) => { el.textContent = counts[el.dataset.count] ?? 0; });
    $$(".filter-pill").forEach((pill) => {
      const active = pill.dataset.filter === state.filter;
      pill.classList.toggle("is-active", active);
      pill.setAttribute("aria-selected", String(active));
    });
  }

  function renderStats() {
    const completed = state.items.filter((item) => item.status === "completed").length;
    const episodes = state.items.reduce((sum, item) => sum + (Number(item.episodesWatched) || 0), 0);
    const rated = state.items.filter((item) => Number(item.rating) > 0);
    const avg = rated.length ? (rated.reduce((sum, item) => sum + Number(item.rating), 0) / rated.length) : 0;
    $("#shareTotal").textContent = fmtNumber(state.items.length);
    $("#shareCompleted").textContent = fmtNumber(completed);
    $("#shareEpisodes").textContent = fmtNumber(episodes);
    $("#shareRating").textContent = avg ? avg.toFixed(1) : "—";
  }

  function renderGrid() {
    const list = visibleItems();
    const grid = $("#shareGrid");
    const empty = $("#shareEmpty");
    $("#shareResult").textContent = state.loading
      ? "正在翻手帐…"
      : `共 ${list.length} 部作品${state.filter === "all" && !state.query ? "" : "（已筛选）"}`;
    if (state.loading) {
      grid.innerHTML = "";
      empty.hidden = true;
      return;
    }
    grid.innerHTML = list.map((item, index) => cardHtml(item, index)).join("");
    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.querySelector("h3").textContent = state.items.length ? "没有找到这一页" : "这一页是空的";
      empty.querySelector("p").innerHTML = state.items.length
        ? "换个关键词或筛选条件试试，<br>也许它被贴在别的页上。"
        : "分享者还没有把动漫贴进手帐。";
    }
    bindImageFallbacks(grid);
  }

  function bindImageFallbacks(container) {
    $$("img[data-cover]", container).forEach((img) => {
      img.addEventListener("error", () => {
        const cover = img.closest(".cover, .detail-cover");
        if (cover) {
          cover.classList.add("no-cover");
          cover.classList.remove("has-image");
        }
        img.remove();
      }, { once: true });
    });
  }

  function render() {
    renderCounts();
    renderStats();
    renderGrid();
  }

  // ---- detail ----------------------------------------------------------

  function openDetail(id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;
    const accent = safeAccent(item.accent);
    const status = STATUS[item.status] || STATUS.completed;
    const total = Number(item.episodesTotal) || 0;
    const watched = Number(item.episodesWatched) || 0;
    const progress = total > 0 ? Math.round((watched / total) * 100) : (watched > 0 ? 100 : 0);
    const rating = Math.max(0, Math.min(5, Number(item.rating) || 0));
    const finishedYear = Number(item.finishedYear) || 0;
    const archiveNo = String(item.id).slice(-6).toUpperCase();
    const tags = (Array.isArray(item.tags) ? item.tags : []).length
      ? `<div class="detail-tags">${item.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
      : "";
    const notes = item.notes
      ? `<p class="detail-notes">${escapeHtml(item.notes)}</p>`
      : `<p class="detail-notes is-empty">这一页没有留下短评。</p>`;
    const cover = item.coverUrl
      ? `<img src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.title)} 封面" data-cover>`
      : "";
    const fallbackLabel = item.altTitle || "ANIME ARCHIVE";
    const starIcons = Array.from({ length: 5 }, (_, index) =>
      `<svg class="icon ${index < rating ? "" : "off"}" aria-hidden="true"><use href="#icon-star"/></svg>`).join("");

    $("#shareDetailContent").innerHTML = `
      <div class="detail-layout" style="--accent:${accent}">
        <div class="detail-poster-col">
          <span class="detail-tape" aria-hidden="true">SHARED PAGE</span>
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
            <span class="demo-tag">READ ONLY / 只读</span>
          </div>
          <h2 class="detail-title" id="shareDetailTitle">${escapeHtml(item.title)}</h2>
          ${item.altTitle ? `<p class="detail-alt">${escapeHtml(item.altTitle)}</p>` : ""}
          <div class="detail-rating">
            <span class="stars" aria-label="${rating} 星">${starIcons}</span>
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
          <p class="share-readonly-note">${icon("icon-heart")} 这是只读分享，原手帐不会被修改。</p>
        </div>
      </div>`;
    $("#shareDetailModal").hidden = false;
    document.body.classList.add("share-modal-open");
    bindImageFallbacks($("#shareDetailContent"));
    $(".detail-close").focus({ preventScroll: true });
  }

  function closeDetail() {
    $("#shareDetailModal").hidden = true;
    document.body.classList.remove("share-modal-open");
  }

  // ---- bootstrap -------------------------------------------------------

  function showError(message) {
    $("#shareErrorText").textContent = message;
    $("#shareError").hidden = false;
    state.failed = true;
  }

  async function load() {
    try {
      const response = await fetch("./data", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401 || response.status === 410) {
        showError("分享会话已失效，请让分享者重新生成链接或重新输入访问码。");
        return;
      }
      if (!response.ok) throw new Error("分享内容读取失败");
      const data = await response.json();
      state.items = Array.isArray(data.items) ? data.items : [];
      state.expiresAt = Date.parse(data.expiresAt || "") || 0;
      state.loading = false;
      state.failed = false;
      document.title = `番迹 · ${state.items.length} 部作品的只读分享`;
      updateExpiry();
      render();
    } catch (error) {
      state.loading = false;
      showError("无法读取分享内容，请检查网络后刷新页面。");
    }
  }

  function updateExpiry() {
    if (!state.expiresAt) {
      $("#shareExpiry").innerHTML = `${icon("icon-clock")}临时只读链接`;
      return;
    }
    const left = state.expiresAt - Date.now();
    if (left <= 0) {
      showError("分享链接已经到期，请让分享者重新生成一条。");
      return;
    }
    const text = new Intl.DateTimeFormat("zh-CN", {
      month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(state.expiresAt));
    const hours = Math.max(1, Math.round(left / 3600000));
    $("#shareExpiry").innerHTML = `${icon("icon-clock")}链接有效至 ${escapeHtml(text)} · 约 ${hours} 小时`;
    $("#shareFooterExpiry").textContent = `只读分享 · 有效至 ${text}`;
  }

  function bindEvents() {
    $("#shareSearch").addEventListener("input", (event) => {
      state.query = event.target.value;
      renderGrid();
    });
    $("#shareSort").addEventListener("change", (event) => {
      state.sort = event.target.value;
      renderGrid();
    });
    $("#shareFilterBar").addEventListener("click", (event) => {
      const pill = event.target.closest("[data-filter]");
      if (!pill) return;
      state.filter = pill.dataset.filter;
      renderCounts();
      renderGrid();
    });
    $("#shareGrid").addEventListener("click", (event) => {
      const card = event.target.closest(".anime-card");
      if (!card) return;
      openDetail(card.dataset.id);
    });
    $("#shareDetailModal").addEventListener("click", (event) => {
      if (event.target.closest("[data-close]")) closeDetail();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("#shareDetailModal").hidden) closeDetail();
    });
    window.setInterval(updateExpiry, 60000);
  }

  bindEvents();
  load();
})();
