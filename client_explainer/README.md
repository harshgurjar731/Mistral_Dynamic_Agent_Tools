# Composer client presentation

A clickable sales presentation of the TCS Dynamic Agentic Workflow Composer.

- `TCS_Composer_Presentation.html` is the deliverable. It is self-contained (screenshots embedded) and opens offline from disk.
- `pitch/` holds its source: `app.js` (the 10 tour slides, the 15 feature slides and how they link), `template.html` (layout and styles) and `build_pitch.py`.
- `screenshots_hd/` holds 2x captures from the live Composer, taken on 17 Nov 2026 with personal names and emails blurred.

Rebuild after editing anything in `pitch/` or `screenshots_hd/`:

```
python pitch/build_pitch.py
```

Presenting: ← and → move through the tour; every component, card and chip opens its feature slide, and the bottom bar always leads back. On "How a workflow is built", click a stage to open its sublayers and a sublayer to see what it decided for the invoice example. "See the full planning record" shows the complete planning page for that example. The savings calculator uses example figures to replace with the client's own.

## Earlier version

`TCS_Composer_Explainer.html` (source in `src/`, `data/`, `screenshots/`, built by `build_explainer.py`) is the earlier long-form, level-by-level explainer, kept for reference.
