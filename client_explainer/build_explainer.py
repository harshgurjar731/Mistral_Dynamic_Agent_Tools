"""Build the Composer explainer into one self-contained HTML file.

usage: python build_explainer.py [fragment_out]
  writes TCS_Composer_Explainer.html (full document, opens offline from disk)
  and, when fragment_out is given, the same page without <html>/<head> for hosting as an artifact.
"""
import base64, json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC, SHOTS, DATA = HERE / "src", HERE / "screenshots", HERE / "data"


def b64(path: Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def build() -> str:
    data = {
        "plan": json.loads((DATA / "plan_run.json").read_text(encoding="utf-8")),
        "agent": json.loads((DATA / "agent_run.json").read_text(encoding="utf-8")),
        "workflow": json.loads((DATA / "invoice_workflow.json").read_text(encoding="utf-8")),
    }
    imgs = {p.stem: b64(p, "image/webp") for p in sorted(SHOTS.glob("*.webp"))}
    page = (SRC / "template.html").read_text(encoding="utf-8")
    js_json = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    parts = {
        "/*__LOGO__*/": b64(SHOTS / "tcs_white.png", "image/png"),
        "/*__DATA__*/": f"const DATA = {js_json(data)};",
        "/*__IMG__*/": f"const IMG = {js_json(imgs)};",
        "/*__CONTENT__*/": (SRC / "content.js").read_text(encoding="utf-8"),
        "/*__JOURNEYS__*/": (SRC / "journeys.js").read_text(encoding="utf-8"),
        "/*__APP__*/": (SRC / "app.js").read_text(encoding="utf-8"),
    }
    for k, v in parts.items():
        if k not in page:
            raise SystemExit(f"placeholder {k} missing from template")
        page = page.replace(k, v)
    return page


def full_document(fragment: str) -> str:
    head_end = fragment.index("</style>") + len("</style>")
    head, body = fragment[:head_end], fragment[head_end:]
    return ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
            f"{head}\n</head>\n<body>\n{body}\n</body>\n</html>\n")


if __name__ == "__main__":
    frag = build()
    out = HERE / "TCS_Composer_Explainer.html"
    out.write_text(full_document(frag), encoding="utf-8")
    print(f"{out.name}: {out.stat().st_size / 1e6:.2f} MB")
    if len(sys.argv) > 1:
        f = Path(sys.argv[1])
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(frag, encoding="utf-8")
        print(f"{f}: {f.stat().st_size / 1e6:.2f} MB")
