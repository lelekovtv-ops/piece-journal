# журнал piece

A handwritten flip-notebook that lives on GitHub Pages. We log, in plain words,
what was done on the piece project — what we built, what we found, what we
understood. Pages turn like a real notepad; both Alex and the agents write into it.

No backend, no build step, no secrets. Pure static site.

## How it works

- Every entry is a markdown file in [`entries/`](entries) with tiny frontmatter.
- The page lists that folder through the GitHub Contents API (one request) and
  loads each file from the raw CDN, then lays it out across paper pages.
- Opened locally (double-clicked `index.html`), it shows built-in sample pages.
  Once deployed, it reads the real entries from this repo.

## Deploy (one time)

1. Create a public GitHub repo and push these files to the `main` branch.
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch**,
   pick `main` / `/ (root)`, Save.
3. Open `https://<your-username>.github.io/<repo>/`.

The site auto-detects the owner/repo from the `*.github.io` URL — no config to
edit. (To point it at a different repo, fill `MANUAL` at the top of `app.js`.)

## Writing & drawing by hand (directly on the page)

The tool tray (bottom-left) turns the notebook into a real pad:

- **Листать** — flip pages (default).
- **Перо** — click anywhere on a page and write by hand right there; text snaps
  to the ruled lines. Click an existing note to edit it.
- **Фломастер** — draw freehand: circle a word, underline, scribble. Pick one of
  five colors.
- **Ластик** — remove a note or a stroke.
- **↶** undo the last mark · **＋** add a fresh blank page to write on.

Hand-written marks are saved per page in your browser (`localStorage`) — they
stay on this device. Typed entries (below) are the shared, committed journal.

## Writing an entry (typed, shareable)

### The easy way (in the notebook)

Click **«Записать»** (bottom-right), type a couple of lines, then:

- **Сохранить** — saves a local draft, visible immediately on your device.
- **Добавить в журнал на GitHub** — opens a pre-filled "new file" page on
  GitHub; press **Commit** and everyone sees it.

### By hand / for agents

Drop a file in `entries/` named `YYYY-MM-DD-short-title.md`:

```markdown
---
date: 2026-06-03
author: alex      # alex | claude | codex — sets the ink color
title: Короткий заголовок
---

Текст простыми словами. Поддерживается **жирный**, *курсив*,
- списки,
[ссылки](https://example.com) и `код`.
```

Commit it. The new page appears on next load. No manifest to update.

## Local preview

```bash
python3 -m http.server 8137
# open http://localhost:8137
```

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page shell + composer dialog |
| `styles.css` | Paper, handwriting, page-turn animation |
| `app.js` | Entry loading, pagination, flip engine, composer |
| `entries/*.md` | The journal entries (the data) |
