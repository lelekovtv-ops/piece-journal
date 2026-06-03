/* piece journal — flip notebook engine
 *
 * Data model: each journal entry is a markdown file in /entries with simple
 * frontmatter (date, author, title). The site lists that folder via the
 * GitHub Contents API (one call), fetches each file from the raw CDN, and
 * lays everything out across handwritten pages with a page-turn animation.
 *
 * No backend, no secrets. Agents add an entry by dropping a file in /entries
 * and committing. Alex writes through the in-app composer, which saves a local
 * draft and opens a pre-filled GitHub "new file" page for a one-click commit.
 */

"use strict";

/* ------------------------------------------------------------------ config */

// When hosted on *.github.io the owner/repo/branch are detected from the URL,
// so this stays empty in normal use. Fill it only to point the journal at a
// repo other than the one serving the page.
const MANUAL = { owner: "", repo: "", branch: "main" };

const PAGE = {
  contentW: 612, // must match .content geometry in styles.css
  contentH: 836,
  lineH: 40,
};

const AUTHOR_INK = {
  alex: "var(--ink-alex)",
  claude: "var(--ink-claude)",
  codex: "var(--ink-codex)",
};

// Fallback content shown when the journal is opened locally (file://) or before
// any real entries exist in the repo. Real /entries files override these.
const SEED_ENTRIES = [
  {
    id: "seed-welcome",
    date: "2026-06-03",
    author: "alex",
    title: "Завёл журнал",
    body:
      "Сделали отдельный блокнот, чтобы записывать простыми словами, что мы делаем по piece.\n\n" +
      "Идея простая: коротко, по-человечески, без терминов. Что сделали, что нашли, что поняли.\n\n" +
      "Листается как настоящие страницы — стрелками, свайпом или кнопками по бокам.",
  },
  {
    id: "seed-how",
    date: "2026-06-03",
    author: "claude",
    title: "Как сюда писать",
    body:
      "Два простых способа:\n\n" +
      "- Нажать кнопку **«Записать»** внизу справа, написать пару строк и сохранить.\n" +
      "- Или агенты кладут файл в папку *entries* — и запись сама появляется на новой странице.\n\n" +
      "Каждая запись подписана автором своим цветом чернил.",
  },
];

/* ------------------------------------------------------------- repo detect */

function detectRepo() {
  if (MANUAL.owner && MANUAL.repo) return { ...MANUAL };
  const host = location.hostname;
  if (host.endsWith("github.io")) {
    const owner = host.split(".")[0];
    const parts = location.pathname.split("/").filter(Boolean);
    const repo = parts.length ? parts[0] : `${owner}.github.io`;
    return { owner, repo, branch: "main" };
  }
  return null;
}

const REPO = detectRepo();

/* --------------------------------------------------------- markdown (mini) */

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeUrl(url) {
  return /^(https?:|mailto:)/i.test(url) ? url : "#";
}

function inline(text) {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  t = t.replace(/_([^_]+)_/g, "<em>$1</em>");
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    return `<a href="${safeUrl(url)}" target="_blank" rel="noopener">${label}</a>`;
  });
  return t;
}

// Returns an array of small DOM blocks so the paginator can place them one by
// one and break a long entry across pages at block boundaries.
function markdownBlocks(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  const para = [];
  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement("p");
    p.innerHTML = para.map(inline).join("<br>");
    blocks.push(p);
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { flushPara(); i++; continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushPara();
      const el = document.createElement(`h${h[1].length}`);
      el.innerHTML = inline(h[2]);
      blocks.push(el);
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const bq = document.createElement("blockquote");
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      bq.innerHTML = buf.map(inline).join("<br>");
      blocks.push(bq);
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+\.\s+/.test(line);
      const list = document.createElement(ordered ? "ol" : "ul");
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const li = document.createElement("li");
        li.innerHTML = inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        list.appendChild(li);
        i++;
      }
      blocks.push(list);
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

/* ------------------------------------------------------------ entry loading */

function parseFrontmatter(raw, fallbackId) {
  let date = "", author = "alex", title = "", body = raw;
  const fm = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (fm) {
    body = fm[2];
    for (const l of fm[1].split("\n")) {
      const m = l.match(/^(\w+)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (key === "date") date = val;
      else if (key === "author") author = val.toLowerCase();
      else if (key === "title") title = val;
    }
  }
  return { id: fallbackId, date, author: author || "alex", title, body: body.trim() };
}

const cache = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
  },
};

async function loadFromGitHub() {
  if (!REPO) return null;
  const { owner, repo, branch } = REPO;
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/entries?ref=${branch}`;
  let listing;
  try {
    const res = await fetch(api, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`list ${res.status}`);
    listing = await res.json();
    cache.set("journal:listing", listing);
  } catch (e) {
    listing = cache.get("journal:listing"); // offline / rate-limited fallback
    if (!listing) return null;
  }

  const files = (listing || []).filter(
    (f) => f.type === "file" && f.name.toLowerCase().endsWith(".md")
  );
  if (!files.length) return [];

  const entries = await Promise.all(
    files.map(async (f) => {
      const ck = `journal:file:${f.sha}`;
      let raw = cache.get(ck);
      if (raw == null) {
        try {
          const url = f.download_url ||
            `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/entries/${f.name}`;
          const r = await fetch(url);
          if (!r.ok) throw new Error(`raw ${r.status}`);
          raw = await r.text();
          cache.set(ck, raw);
        } catch {
          return null;
        }
      }
      return parseFrontmatter(raw, f.name);
    })
  );
  return entries.filter(Boolean);
}

function loadDrafts() {
  const drafts = cache.get("journal:drafts") || [];
  return drafts.map((d) => ({ ...d, draft: true }));
}

function byDate(a, b) {
  const d = (a.date || "").localeCompare(b.date || "");
  if (d !== 0) return d;
  return (a.title || "").localeCompare(b.title || "");
}

async function loadEntries() {
  let remote = await loadFromGitHub();
  let base = remote && remote.length ? remote : SEED_ENTRIES.slice();
  const drafts = loadDrafts();

  // de-dup drafts that already landed in the repo (same date+title)
  const known = new Set(base.map((e) => `${e.date}::${e.title}`));
  const freshDrafts = drafts.filter((d) => !known.has(`${d.date}::${d.title}`));

  return [...base, ...freshDrafts].sort(byDate);
}

/* --------------------------------------------------------------- rendering */

function entryHeadEl(entry, continued) {
  const head = document.createElement("div");
  head.className = "entry-head";

  if (continued) {
    const c = document.createElement("div");
    c.className = "continued";
    c.textContent = "…продолжение";
    return c;
  }

  const date = document.createElement("span");
  date.className = "entry-date";
  date.textContent = formatDate(entry.date);
  head.appendChild(date);

  const title = document.createElement("span");
  title.className = "entry-title";
  title.textContent = entry.title || "Без названия";
  head.appendChild(title);

  const chip = document.createElement("span");
  chip.className = "author-chip";
  chip.textContent = authorLabel(entry.author);
  head.appendChild(chip);

  if (entry.draft) {
    const b = document.createElement("span");
    b.className = "draft-badge";
    b.textContent = "черновик";
    head.appendChild(b);

    const del = document.createElement("button");
    del.className = "draft-del";
    del.textContent = "удалить";
    del.addEventListener("click", () => deleteDraft(entry.id));
    head.appendChild(del);
  }
  return head;
}

function authorLabel(a) {
  if (a === "claude") return "Claude";
  if (a === "codex") return "Codex";
  return "Алекс";
}

const MONTHS = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];
function formatDate(iso) {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// Build the flat list of measurable blocks for one entry.
function entryBlocks(entry) {
  const out = [];
  const head = entryHeadEl(entry, false);
  head.dataset.entryStart = "1";
  out.push(head);

  const body = markdownBlocks(entry.body);
  const wrap = document.createElement("div");
  wrap.className = "entry-body";
  for (const b of body) {
    b.classList.add("entry-block");
    out.push(b);
  }
  // tag color on every block of this entry
  const ink = AUTHOR_INK[entry.author] || "var(--ink)";
  for (const node of out) {
    node.style.color = ink;
    node.dataset.entryId = entry.id;
  }
  void wrap;
  return out;
}

/* --------------------------------------------------------------- paginate */

// Pagination by real layout: blocks are appended into an off-screen page that
// is styled exactly like a live page, and we split whenever the content box
// actually overflows. This avoids the rounding/margin drift of math-based
// measuring and is immune to font-load timing.
function paginate(entries) {
  const probe = document.createElement("div");
  probe.className = "page";
  Object.assign(probe.style, {
    position: "absolute",
    left: "-9999px",
    top: "0",
    width: "var(--page-w)",
    height: "var(--page-h)",
    visibility: "hidden",
  });
  const paper = document.createElement("div");
  paper.className = "paper paper--ruled";
  paper.appendChild(spiralEl());
  const content = document.createElement("div");
  content.className = "content ruled";
  paper.appendChild(content);
  probe.appendChild(paper);
  document.body.appendChild(probe);

  const fits = () => content.scrollHeight <= content.clientHeight;

  const pages = [];
  let cur = [];
  const flushPage = () => { if (cur.length) pages.push(cur); cur = []; content.innerHTML = ""; };

  for (let ei = 0; ei < entries.length; ei++) {
    const entry = entries[ei];
    const ink = AUTHOR_INK[entry.author] || "var(--ink)";

    // spacer before an entry (never as the first block on a page)
    if (cur.length) {
      const gap = document.createElement("div");
      gap.className = "entry-gap";
      content.appendChild(gap);
      if (!fits()) { content.removeChild(gap); flushPage(); }
      else cur.push(gap);
    }

    const blocks = entryBlocks(entry);
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      content.appendChild(block);

      if (!fits() && cur.length) {
        content.removeChild(block);
        flushPage();
        // continued marker when an entry spills past a page boundary
        if (bi > 0) {
          const cont = entryHeadEl(entry, true);
          cont.style.color = ink;
          content.appendChild(cont);
          cur.push(cont);
        }
        content.appendChild(block);
      }
      cur.push(block);
    }
  }
  if (cur.length) pages.push(cur);

  document.body.removeChild(probe);
  return pages.length ? pages : [[]];
}

/* ------------------------------------------------------- page DOM builders */

function spiralEl() {
  const s = document.createElement("div");
  s.className = "spiral";
  for (let i = 0; i < 13; i++) {
    const r = document.createElement("div");
    r.className = "ring";
    s.appendChild(r);
  }
  return s;
}

function buildCover(total) {
  const page = document.createElement("div");
  page.className = "page page--cover";
  page.innerHTML = `
    <div class="paper paper--cover">
      <div class="cover-inner">
        <div class="cover-kicker">журнал проекта</div>
        <div class="cover-title">piece</div>
        <div class="cover-sub">что сделали, что нашли,&nbsp;что поняли</div>
        <div class="cover-rule"></div>
        <div class="cover-authors">Алекс · Claude · Codex</div>
        <div class="cover-sticker">том I</div>
        <div class="cover-hint">листай вправо →</div>
      </div>
    </div>`;
  void total;
  return page;
}

function buildContentPage(blocks, pageNo, totalPages) {
  const page = document.createElement("div");
  page.className = "page";

  const paper = document.createElement("div");
  paper.className = "paper paper--ruled";

  paper.appendChild(spiralEl());

  const content = document.createElement("div");
  content.className = "content ruled";
  for (const b of blocks) content.appendChild(b);
  paper.appendChild(content);

  const folio = document.createElement("div");
  folio.className = "folio";
  folio.textContent = `— ${pageNo} —`;
  paper.appendChild(folio);

  const wm = document.createElement("div");
  wm.className = "watermark";
  wm.textContent = "piece";
  paper.appendChild(wm);

  page.appendChild(paper);
  void totalPages;
  return page;
}

function blankPaper() {
  const paper = document.createElement("div");
  paper.className = "paper paper--ruled";
  paper.appendChild(spiralEl());
  const content = document.createElement("div");
  content.className = "content ruled";
  paper.appendChild(content);
  return paper;
}

/* ----------------------------------------------------------- flip engine */

const stage = document.getElementById("stage");
const book = document.getElementById("book");
let pagesEls = [];
let current = 0;
let flipping = false;

function showStatic(idx) {
  stage.innerHTML = "";
  const el = pagesEls[idx];
  el.style.zIndex = "";
  stage.appendChild(el);
}

function goTo(target, dir) {
  if (flipping) return;
  if (target < 0 || target >= pagesEls.length || target === current) return;

  flipping = true;
  const curEl = pagesEls[current];
  const nextEl = pagesEls[target];

  const leaf = document.createElement("div");
  leaf.className = "leaf";
  const front = document.createElement("div");
  front.className = "face face--front";
  const back = document.createElement("div");
  back.className = "face face--back";
  back.appendChild(blankPaper());
  const shade = document.createElement("div");
  shade.className = "shade";

  const turnShadow = document.createElement("div");
  turnShadow.className = "turn-shadow";

  if (dir === "next") {
    stage.innerHTML = "";
    nextEl.style.zIndex = "1";
    stage.appendChild(nextEl);
    stage.appendChild(turnShadow);

    front.appendChild(curEl);
    leaf.append(front, back, shade);
    leaf.style.transform = "rotateX(0deg)";
    stage.appendChild(leaf);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      leaf.classList.add("turning");
      turnShadow.style.opacity = "1";
      leaf.style.transform = "rotateX(-178deg)";
    }));
  } else {
    stage.innerHTML = "";
    curEl.style.zIndex = "1";
    stage.appendChild(curEl);
    stage.appendChild(turnShadow);

    front.appendChild(nextEl);
    leaf.append(front, back, shade);
    leaf.classList.add("turning");
    leaf.style.transform = "rotateX(-178deg)";
    stage.appendChild(leaf);
    turnShadow.style.opacity = "1";

    requestAnimationFrame(() => requestAnimationFrame(() => {
      leaf.classList.remove("turning");
      turnShadow.style.opacity = "0";
      leaf.style.transform = "rotateX(0deg)";
    }));
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    current = target;
    flipping = false;
    showStatic(current);
    updateChrome();
  };
  leaf.addEventListener("transitionend", (e) => {
    if (e.propertyName === "transform") finish();
  });
  setTimeout(finish, 900); // safety net if transitionend is missed
}

function next() { goTo(current + 1, "next"); }
function prev() { goTo(current - 1, "prev"); }

/* --------------------------------------------------------------- chrome */

const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const counter = document.getElementById("counter");
const progress = document.getElementById("progress");

function updateChrome() {
  prevBtn.disabled = current === 0;
  nextBtn.disabled = current === pagesEls.length - 1;
  counter.textContent = current === 0
    ? "обложка"
    : `стр. ${current} из ${pagesEls.length - 1}`;
  [...progress.children].forEach((dot, i) => {
    dot.classList.toggle("active", i === current);
  });
}

function buildProgress() {
  progress.innerHTML = "";
  pagesEls.forEach((_, i) => {
    const dot = document.createElement("div");
    dot.className = "dot";
    dot.title = i === 0 ? "обложка" : `страница ${i}`;
    dot.addEventListener("click", () => {
      if (i === current || flipping) return;
      goTo(i, i > current ? "next" : "prev");
    });
    progress.appendChild(dot);
  });
}

/* --------------------------------------------------------------- scaling */

function fit() {
  const vw = window.innerWidth - 56;
  const vh = window.innerHeight - 56;
  const pageW = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue("--page-w"));
  const pageH = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue("--page-h"));
  const scale = Math.max(0.1, Math.min(vw / pageW, vh / pageH, 1.1));
  book.style.transform = `scale(${scale})`;
}

/* --------------------------------------------------------- input handlers */

function bindInput() {
  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);

  window.addEventListener("keydown", (e) => {
    if (composerOpen()) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
      e.preventDefault(); next();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault(); prev();
    }
  });

  let sx = 0, sy = 0, tracking = false;
  const surface = document.querySelector(".viewport");
  surface.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
  }, { passive: true });
  surface.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < 40 && Math.abs(dy) < 40) return;
    if (Math.abs(dx) > Math.abs(dy)) { dx < 0 ? next() : prev(); }
    else { dy < 0 ? next() : prev(); }
  }, { passive: true });

  window.addEventListener("resize", fit);
}

/* -------------------------------------------------------------- composer */

const backdrop = document.getElementById("composer-backdrop");
const fAuthor = document.getElementById("c-author");
const fTitle = document.getElementById("c-title");
const fBody = document.getElementById("c-body");
const ghBtn = document.getElementById("c-github");

function composerOpen() { return backdrop.classList.contains("open"); }

function openComposer() {
  fTitle.value = "";
  fBody.value = "";
  fAuthor.value = "alex";
  ghBtn.disabled = !REPO;
  ghBtn.title = REPO ? "" : "Сначала опубликуй журнал на GitHub";
  backdrop.classList.add("open");
  setTimeout(() => fTitle.focus(), 50);
}
function closeComposer() { backdrop.classList.remove("open"); }

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function slugify(s) {
  return (s || "zapis")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "zapis";
}

function buildMarkdown(date, author, title, body) {
  return `---\ndate: ${date}\nauthor: ${author}\ntitle: ${title}\n---\n\n${body}\n`;
}

async function saveDraft(openGitHub) {
  const title = fTitle.value.trim();
  const body = fBody.value.trim();
  if (!body && !title) { closeComposer(); return; }

  const author = fAuthor.value;
  const date = todayIso();
  const id = `draft-${date}-${slugify(title)}-${Math.abs(hash(body)).toString(36)}`;

  const drafts = cache.get("journal:drafts") || [];
  drafts.push({ id, date, author, title: title || "Без названия", body });
  cache.set("journal:drafts", drafts);

  if (openGitHub && REPO) {
    const md = buildMarkdown(date, author, title || "Без названия", body);
    const filename = `entries/${date}-${slugify(title)}.md`;
    const url =
      `https://github.com/${REPO.owner}/${REPO.repo}/new/${REPO.branch}` +
      `?filename=${encodeURIComponent(filename)}` +
      `&value=${encodeURIComponent(md)}`;
    window.open(url, "_blank", "noopener");
  }

  closeComposer();
  flash(openGitHub ? "Сохранено · открыл GitHub для коммита" : "Сохранено в черновики");
  await rebuild(true);
}

function deleteDraft(id) {
  const drafts = (cache.get("journal:drafts") || []).filter((d) => d.id !== id);
  cache.set("journal:drafts", drafts);
  flash("Черновик удалён");
  rebuild(true);
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

function bindComposer() {
  document.getElementById("fab").addEventListener("click", openComposer);
  document.getElementById("c-cancel").addEventListener("click", closeComposer);
  document.getElementById("c-save").addEventListener("click", () => saveDraft(false));
  ghBtn.addEventListener("click", () => saveDraft(true));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeComposer();
  });
  window.addEventListener("keydown", (e) => {
    if (composerOpen() && e.key === "Escape") closeComposer();
  });
}

/* ----------------------------------------------------------------- flash */

let flashTimer = null;
function flash(msg) {
  const el = document.getElementById("flash");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ------------------------------------------------------------------ boot */

async function rebuild(keepPosition) {
  const prevIndex = current;
  const entries = await loadEntries();
  const contentPages = paginate(entries);

  pagesEls = [buildCover(contentPages.length)];
  contentPages.forEach((blocks, i) => {
    pagesEls.push(buildContentPage(blocks, i + 1, contentPages.length));
  });

  current = keepPosition ? Math.min(prevIndex, pagesEls.length - 1) : 0;
  buildProgress();
  showStatic(current);
  updateChrome();
  fit();
}

async function init() {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* ignore */ }
  }
  bindInput();
  bindComposer();
  await rebuild(false);
}

init();
