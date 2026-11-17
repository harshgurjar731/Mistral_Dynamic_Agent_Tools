"""Build the clickable Composer presentation into one self-contained HTML file.

usage: python build_pitch.py [fragment_out]
  writes ../TCS_Composer_Presentation.html (full document, opens offline)
  and, when fragment_out is given, the page without <html>/<head> for hosting as an artifact.
Only screenshots the slides reference are embedded.
"""
import base64, json, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SHOTS = HERE.parent / "screenshots_hd"


def b64(path: Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def build() -> str:
    app = (HERE / "app.js").read_text(encoding="utf-8")
    available = {p.stem for p in SHOTS.glob("*.webp")}
    used = sorted({m for m in re.findall(r'"([a-z0-9_]+)"', app) if m in available})
    imgs = {k: b64(SHOTS / f"{k}.webp", "image/webp") for k in used}
    page = (HERE / "template.html").read_text(encoding="utf-8")
    for k, v in {
        "/*__LOGO__*/": b64(SHOTS / "tcs_white.png", "image/png"),
        "/*__IMG__*/": "const IMG = " + json.dumps(imgs, separators=(",", ":")) + ";",
        "/*__APP__*/": app,
    }.items():
        if k not in page:
            raise SystemExit(f"placeholder {k} missing")
        page = page.replace(k, v)
    print(f"{len(used)} screenshots embedded")
    return page


def full_document(fragment: str) -> str:
    cut = fragment.index("</style>") + len("</style>")
    return ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
            f"{fragment[:cut]}\n</head>\n<body>\n{fragment[cut:]}\n</body>\n</html>\n")


if __name__ == "__main__":
    frag = build()
    out = HERE.parent / "TCS_Composer_Presentation.html"
    out.write_text(full_document(frag), encoding="utf-8")
    print(f"{out.name}: {out.stat().st_size / 1e6:.2f} MB")
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(frag, encoding="utf-8")
        print("fragment written")
