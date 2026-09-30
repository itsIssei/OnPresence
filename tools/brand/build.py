"""Builds the OnPresence brand SVGs (text converted to paths, so they look the
same everywhere, including GitHub) and renders PNGs with headless Edge/Chrome.

    pip install fonttools brotli
    cd web && npm ci            # for the Sora font files
    python tools/brand/build.py

Output: docs/brand/*.svg and *.png
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "brand"
FONT = ROOT / "web/node_modules/@fontsource-variable/sora/files/sora-latin-wght-normal.woff2"

BG = "#0d0818"
VIOLET_LIGHT = "#c4b5fd"
VIOLET = "#7c3aed"
GREEN = "#22c55e"


def load(weight: int) -> TTFont:
    f = TTFont(FONT)
    return instancer.instantiateVariableFont(f, {"wght": weight})


FONTS = {}


def text_path(text: str, weight: int, size: float, x: float, baseline: float, tracking: float = 0.0, anchor: str = "start"):
    """Returns (svg path d, width) for text set in Sora at the given weight."""
    if weight not in FONTS:
        FONTS[weight] = load(weight)
    font = FONTS[weight]
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    scale = size / upm
    names = [cmap[ord(c)] for c in text]
    width = sum(glyphs[n].width for n in names) * scale + tracking * (len(text) - 1)
    if anchor == "middle":
        x -= width / 2
    elif anchor == "end":
        x -= width
    pen = SVGPathPen(glyphs)
    cursor = x
    for n in names:
        glyphs[n].draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, baseline)))
        cursor += glyphs[n].width * scale + tracking
    return pen.getCommands(), width


def mark(x: float, y: float, size: float, bg: str = "#110b1f", tile: bool = True) -> str:
    """The OnPresence mark (ring + online dot), same shapes as icon.svg."""
    s = size / 64
    tile_el = f'<rect width="64" height="64" rx="16" fill="{bg}"/>' if tile else ""
    return (
        f'<g transform="translate({x} {y}) scale({s})">{tile_el}'
        f'<circle cx="29" cy="29" r="14.5" fill="none" stroke="url(#ring)" stroke-width="7"/>'
        f'<circle cx="45" cy="45" r="10" fill="{bg}"/>'
        f'<circle cx="45" cy="45" r="6.5" fill="{GREEN}"/></g>'
    )


DEFS = f"""<defs>
  <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{VIOLET_LIGHT}"/><stop offset="1" stop-color="{VIOLET}"/></linearGradient>
  <linearGradient id="word" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ddd6fe"/></linearGradient>
  <radialGradient id="glow" cx="0.3" cy="0.2" r="0.9"><stop offset="0" stop-color="{VIOLET}" stop-opacity=".45"/><stop offset=".55" stop-color="{VIOLET}" stop-opacity=".08"/><stop offset="1" stop-color="{VIOLET}" stop-opacity="0"/></radialGradient>
  <radialGradient id="glow2" cx="0.9" cy="1" r="0.6"><stop offset="0" stop-color="{GREEN}" stop-opacity=".14"/><stop offset="1" stop-color="{GREEN}" stop-opacity="0"/></radialGradient>
  <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#fff" fill-opacity=".06"/></pattern>
</defs>"""


def svg(w: int, h: int, body: str) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{DEFS}{body}</svg>\n'


def background(w: int, h: int, radius: int = 0) -> str:
    return (
        f'<rect width="{w}" height="{h}" rx="{radius}" fill="{BG}"/>'
        f'<rect width="{w}" height="{h}" rx="{radius}" fill="url(#dots)"/>'
        f'<rect width="{w}" height="{h}" rx="{radius}" fill="url(#glow)"/>'
        f'<rect width="{w}" height="{h}" rx="{radius}" fill="url(#glow2)"/>'
    )


def wordmark(dark_text: bool) -> str:
    d, w = text_path("OnPresence", 700, 56, 84, 55, tracking=-1)
    fill = "#150d26" if dark_text else "url(#word)"
    width = int(84 + w + 8)
    return svg(width, 80, mark(0, 4, 72) + f'<path d="{d}" fill="{fill}"/>')


def chip(x: float, y: float, label: str) -> tuple[str, float]:
    d, w = text_path(label, 500, 20, x + 18, y + 27)
    width = w + 36
    return (
        f'<rect x="{x}" y="{y}" width="{width:.1f}" height="40" rx="20" fill="#ffffff" fill-opacity=".06" stroke="#ffffff" stroke-opacity=".12"/>'
        f'<path d="{d}" fill="#e9e3ff"/>'
    ), width


def banner() -> str:
    w, h = 1280, 320
    title, tw = text_path("OnPresence", 700, 84, 0, 0, tracking=-2)
    left = (w - (120 + 28 + tw)) / 2
    title, _ = text_path("OnPresence", 700, 84, left + 148, 178, tracking=-2)
    tag, _ = text_path("Your online presence and showcase, self-hosted.", 400, 28, w / 2, 246, anchor="middle")
    return svg(w, h, background(w, h, 24) + mark(left, 88, 120) + f'<path d="{title}" fill="url(#word)"/><path d="{tag}" fill="#b9aee0"/>')


def social() -> str:
    w, h = 1280, 640
    body = background(w, h)
    body += mark(96, 150, 132)
    title, _ = text_path("OnPresence", 700, 96, 262, 250, tracking=-2)
    body += f'<path d="{title}" fill="url(#word)"/>'
    for i, line in enumerate(["A profile card and hobby display case", "you host yourself."]):
        d, _ = text_path(line, 400, 38, 100, 350 + i * 52)
        body += f'<path d="{d}" fill="#c9bff0"/>'
    x = 100.0
    for label in ["Avatar decorations", "Live presence", "Display case", "2FA", "One binary"]:
        el, cw = chip(x, 486, label)
        body += el
        x += cw + 12
    # A small card silhouette on the right as a hint of the product.
    body += (
        '<g transform="translate(930 110) rotate(4)">'
        '<rect width="260" height="360" rx="28" fill="#1a1230" stroke="#ffffff" stroke-opacity=".12"/>'
        f'<rect width="260" height="96" rx="28" fill="{VIOLET}" fill-opacity=".55"/><rect y="60" width="260" height="36" fill="#1a1230"/>'
        f'<circle cx="130" cy="96" r="46" fill="#2e1f4d" stroke="url(#ring)" stroke-width="6"/>'
        f'<circle cx="162" cy="128" r="11" fill="#1a1230"/><circle cx="162" cy="128" r="7" fill="{GREEN}"/>'
        '<rect x="70" y="170" width="120" height="16" rx="8" fill="#fff" fill-opacity=".85"/>'
        '<rect x="95" y="196" width="70" height="10" rx="5" fill="#fff" fill-opacity=".35"/>'
        '<rect x="40" y="226" width="180" height="8" rx="4" fill="#fff" fill-opacity=".2"/>'
        '<rect x="60" y="242" width="140" height="8" rx="4" fill="#fff" fill-opacity=".2"/>'
        '<rect x="24" y="280" width="212" height="52" rx="14" fill="#fff" fill-opacity=".06"/>'
        f'<rect x="38" y="292" width="28" height="28" rx="7" fill="{VIOLET_LIGHT}" fill-opacity=".7"/>'
        '<rect x="78" y="296" width="100" height="8" rx="4" fill="#fff" fill-opacity=".6"/>'
        '<rect x="78" y="310" width="70" height="7" rx="3.5" fill="#fff" fill-opacity=".3"/>'
        '</g>'
    )
    return svg(w, h, body)


def find_browser() -> str | None:
    for p in [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]:
        if os.path.exists(p):
            return p
    return shutil.which("chromium") or shutil.which("google-chrome") or shutil.which("msedge")


def render(browser: str, svg_file: Path, w: int, h: int, scale: int = 1):
    html = svg_file.with_suffix(".render.html")
    html.write_text(f'<html><body style="margin:0;background:transparent"><img src="{svg_file.name}" width="{w}" height="{h}" style="display:block"></body></html>')
    png = svg_file.with_suffix(".png")
    png.unlink(missing_ok=True)
    # A separate profile, or a running browser swallows the headless call.
    profile = tempfile.mkdtemp(prefix="brand-browser-")
    subprocess.run(
        [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", f"--user-data-dir={profile}",
         f"--force-device-scale-factor={scale}", f"--window-size={w},{h}", f"--screenshot={png}", html.as_uri()],
        check=True, capture_output=True,
    )
    # Edge on Windows hands off to a child process and returns early; wait.
    for _ in range(60):
        if png.exists() and png.stat().st_size > 0:
            break
        time.sleep(0.5)
    time.sleep(0.5)
    html.unlink()
    shutil.rmtree(profile, ignore_errors=True)
    if not png.exists():
        raise SystemExit(f"browser did not write {png}")
    print("wrote", png.relative_to(ROOT))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "wordmark-dark.svg": wordmark(dark_text=False),   # for dark backgrounds
        "wordmark-light.svg": wordmark(dark_text=True),   # for light backgrounds
        "banner.svg": banner(),
        "social-preview.svg": social(),
        "icon.svg": (ROOT / "web/public/img/brand/icon.svg").read_text(),
    }
    for name, content in files.items():
        (OUT / name).write_text(content, encoding="utf-8", newline="\n")
        print("wrote", (OUT / name).relative_to(ROOT))
    browser = find_browser()
    if not browser:
        print("no Chrome/Edge found; skipped PNG rendering", file=sys.stderr)
        return
    render(browser, OUT / "banner.svg", 1280, 320)
    render(browser, OUT / "social-preview.svg", 1280, 640)
    render(browser, OUT / "icon.svg", 512, 512)


if __name__ == "__main__":
    main()
