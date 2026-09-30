"""Renders the bundled "OnPresence originals": animated avatar decorations and
profile effects (APNG), plus the catalog entries that list them.

    pip install pillow numpy
    python tools/originals/build.py

Output:
    web/public/img/decorations/<id>.png   240x240 APNG, loops
    web/public/img/effects/<id>.png       360x640 APNG, loops
    web/public/img/effects/<id>-still.png still frame (reduced motion)
    web/public/data/decorations.json      catalog entries
    web/public/data/effects.json

Everything is drawn from code here, so the artwork is original and MIT
licensed with the rest of the project.
"""

import colorsys
import json
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "web" / "public"
FPS = 15


class Canvas:
    """Additive light canvas. Splats accumulate premultiplied color; the
    result maps accumulated light to alpha with a soft exponential curve."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.rgb = np.zeros((h, w, 3), np.float32)
        self.a = np.zeros((h, w), np.float32)
        self.yy, self.xx = np.mgrid[0:h, 0:w].astype(np.float32)

    def add(self, alpha, color):
        c = np.asarray(color, np.float32) / 255
        self.a += alpha
        self.rgb += alpha[..., None] * c

    def glow(self, x, y, radius, color, strength=1.0):
        r = int(radius * 3) + 2
        x0, x1 = max(0, int(x) - r), min(self.w, int(x) + r + 1)
        y0, y1 = max(0, int(y) - r), min(self.h, int(y) + r + 1)
        if x0 >= x1 or y0 >= y1:
            return
        dx = self.xx[y0:y1, x0:x1] - x
        dy = self.yy[y0:y1, x0:x1] - y
        a = strength * np.exp(-(dx * dx + dy * dy) / (2 * radius * radius))
        c = np.asarray(color, np.float32) / 255
        self.a[y0:y1, x0:x1] += a
        self.rgb[y0:y1, x0:x1] += a[..., None] * c

    def image(self, gain=1.0):
        a = 1 - np.exp(-self.a * gain)
        rgb = self.rgb / np.maximum(self.a, 1e-6)[..., None]
        rgb = np.clip(rgb * 255, 0, 255)
        alpha = np.clip(a * 255, 0, 255)
        # Smaller files: drop nearly invisible light and round the channels,
        # so frames compress well (the difference is not visible).
        alpha[alpha < 10] = 0
        alpha = np.round(alpha / 6) * 6
        rgb = np.round(rgb / 12) * 12
        rgb[alpha == 0] = 0
        out = np.dstack([np.clip(rgb, 0, 255), np.clip(alpha, 0, 255)]).astype(np.uint8)
        return Image.fromarray(out, "RGBA")


def hsv(h, s, v):
    r, g, b = colorsys.hsv_to_rgb(h % 1, s, v)
    return (r * 255, g * 255, b * 255)


def save_apng(frames, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=1000 // FPS, loop=0, disposal=1, blend=0, optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")


# ---------------------------------------------------------------- decorations
# 240x240 overlays drawn at 120% of the avatar size: the avatar covers the middle
# circle (radius 100), the decoration sits around it.

S = 240
C = S / 2


def ring_alpha(cv, r, width, weight=None):
    d = np.hypot(cv.xx - C, cv.yy - C) - r
    a = np.exp(-(d / width) ** 2)
    if weight is not None:
        a *= weight
    return a


def angle_grid(cv):
    return np.arctan2(cv.yy - C, cv.xx - C)


def deco_orbit(n=30):
    rnd = random.Random(1)
    sparkles = [(rnd.uniform(0, 2 * math.pi), rnd.uniform(104, 118), rnd.random()) for _ in range(14)]
    frames = []
    for f in range(n):
        t = f / n
        cv = Canvas(S, S)
        cv.add(ring_alpha(cv, 108, 1.6) * 0.9, (196, 181, 253))
        cv.add(ring_alpha(cv, 114, 5) * 0.12, (167, 139, 250))
        for k, (color, speed, r) in enumerate([((103, 232, 249), 1, 108), ((244, 114, 182), -1, 108)]):
            a0 = 2 * math.pi * (t * speed) + k * math.pi
            for trail in range(10):
                a = a0 - speed * trail * 0.07
                x, y = C + r * math.cos(a), C + r * math.sin(a)
                cv.glow(x, y, 3.2 - trail * 0.2, color, 1.6 * (1 - trail / 10) ** 2)
            cv.glow(C + r * math.cos(a0), C + r * math.sin(a0), 7, color, 0.8)
            cv.glow(C + r * math.cos(a0), C + r * math.sin(a0), 2.2, (255, 255, 255), 2.5)
        for a, r, ph in sparkles:
            tw = max(0.0, math.sin(2 * math.pi * (t * 2 + ph)))
            cv.glow(C + r * math.cos(a), C + r * math.sin(a), 1.3, (255, 255, 255), 1.8 * tw ** 3)
        frames.append(cv.image())
    return frames


def deco_aurora(n=30):
    frames = []
    for f in range(n):
        t = f / n
        cv = Canvas(S, S)
        th = angle_grid(cv)
        wave = 1 + 0.35 * np.sin(3 * th - 2 * math.pi * t) + 0.2 * np.sin(5 * th + 4 * math.pi * t)
        d = np.hypot(cv.xx - C, cv.yy - C) - 109
        a = np.exp(-(d / (4.5 * wave)) ** 2) * 0.9
        hue = (th / (2 * math.pi) + t) % 1
        # aurora palette: teal -> violet -> pink around the ring
        h = 0.45 + 0.45 * (0.5 + 0.5 * np.sin(2 * math.pi * hue))
        rgb = np.stack(np.vectorize(lambda x: colorsys.hsv_to_rgb(x, 0.6, 1.0))(h), axis=-1) * 255
        cv.a += a
        cv.rgb += a[..., None] * rgb / 255
        glow = np.exp(-((d - 4) / 12) ** 2) * 0.18
        cv.a += glow
        cv.rgb += glow[..., None] * rgb / 255
        for k in range(3):
            ang = 2 * math.pi * (t + k / 3)
            cv.glow(C + 109 * math.cos(ang), C + 109 * math.sin(ang), 2.4, (255, 255, 255), 1.8)
        frames.append(cv.image())
    return frames


def deco_ember(n=30):
    rnd = random.Random(3)
    embers = [(rnd.uniform(-2.55, -0.6), rnd.random(), rnd.uniform(14, 34), rnd.uniform(1.2, 2.6)) for _ in range(46)]
    frames = []
    for f in range(n):
        t = f / n
        cv = Canvas(S, S)
        th = angle_grid(cv)
        top = np.clip(-np.sin(th), 0, 1) ** 1.5  # strongest at the top
        flicker = 0.85 + 0.15 * np.sin(9 * th + 2 * math.pi * t * 3)
        cv.add(ring_alpha(cv, 106, 3.5, top * flicker) * 1.1, (251, 146, 60))
        cv.add(ring_alpha(cv, 106, 1.4) * 0.5, (254, 215, 170))
        cv.add(ring_alpha(cv, 112, 9, top) * 0.25, (239, 68, 68))
        for ang, ph, rise, size in embers:
            p = (t + ph) % 1
            r = 106 + p * rise
            a = ang + 0.08 * math.sin(2 * math.pi * (p + ph))
            x, y = C + r * math.cos(a), C + r * math.sin(a) - p * 10
            life = math.sin(math.pi * p)
            color = (255, int(200 - 130 * p), int(90 - 70 * p))
            cv.glow(x, y, size * (1 - 0.4 * p), color, 1.4 * life)
        frames.append(cv.image())
    return frames


# ---------------------------------------------------------------- profile effects
# 360x640 overlays, shown over the card with object-fit: cover (top aligned).

EW, EH = 360, 640


def fx_starfall(n=45):
    rnd = random.Random(5)
    stars = [(rnd.uniform(0, EW), rnd.uniform(0, EH * 0.75), rnd.random(), rnd.uniform(0.8, 1.6)) for _ in range(34)]
    shooters = [(rnd.uniform(EW * 0.2, EW * 1.2), rnd.uniform(-40, EH * 0.3), i / 4 + rnd.uniform(0, 0.1)) for i in range(4)]
    frames = []
    for f in range(n):
        t = f / n
        cv = Canvas(EW, EH)
        for x, y, ph, s in stars:
            tw = 0.5 + 0.5 * math.sin(2 * math.pi * (t * 2 + ph))
            cv.glow(x, y, s, (224, 231, 255), 1.2 * tw ** 2)
        for x0, y0, ph in shooters:
            p = (t - ph) % 1
            if p > 0.35:
                continue
            q = p / 0.35
            hx, hy = x0 - q * 320, y0 + q * 220
            fade = math.sin(math.pi * q)
            for k in range(80):
                cv.glow(hx + k * 1.4, hy - k * 0.97, 1.5 - k * 0.012, (199, 210, 254), 0.9 * fade * (1 - k / 80) ** 1.5)
            cv.glow(hx, hy, 2.4, (255, 255, 255), 2.4 * fade)
        frames.append(cv.image())
    return frames


def fx_fireflies(n=45):
    rnd = random.Random(8)
    flies = []
    for _ in range(24):
        flies.append((rnd.uniform(20, EW - 20), rnd.uniform(EH * 0.3, EH - 30), rnd.uniform(10, 26), rnd.choice([1, 2]), rnd.random(), rnd.uniform(2, 3.4)))
    frames = []
    for f in range(n):
        t = f / n
        cv = Canvas(EW, EH)
        for x, y, amp, k, ph, s in flies:
            a = 2 * math.pi * (t * k + ph)
            px, py = x + amp * math.sin(a), y + amp * 0.6 * math.sin(2 * a + ph * 6)
            pulse = 0.5 + 0.5 * math.sin(2 * math.pi * (t * 2 + ph))
            cv.glow(px, py, s * 3, (190, 242, 100), 0.35 * pulse)
            cv.glow(px, py, s * 0.8, (254, 249, 195), 2.2 * pulse)
        frames.append(cv.image())
    return frames


def fx_snow(n=45):
    rnd = random.Random(11)
    flakes = [(rnd.uniform(0, EW), rnd.uniform(0, EH), rnd.choice([1, 1, 2]), rnd.random(), rnd.uniform(0.9, 2.6)) for _ in range(70)]
    frames = []
    for f in range(n):
        t = f / n
        cv = Canvas(EW, EH)
        for x, y0, speed, ph, s in flakes:
            y = (y0 + t * EH * speed * 0.5) % (EH + 20) - 10
            x2 = x + 8 * math.sin(2 * math.pi * (t * speed + ph))
            cv.glow(x2, y, s, (240, 249, 255), 1.3 * (0.6 + 0.4 * (s / 2.6)))
        frames.append(cv.image())
    return frames


# ---------------------------------------------------------------- catalog

DECORATIONS = [
    ("orbit", "Orbit", "Two comets circling your avatar.", deco_orbit),
    ("aurora-halo", "Aurora Halo", "A shifting ring of northern lights.", deco_aurora),
    ("ember-crown", "Ember Crown", "Embers rising from a warm glow.", deco_ember),
]

EFFECTS = [
    ("starfall", "Starfall", "Twinkling stars and shooting stars across the card.", fx_starfall),
    ("fireflies", "Fireflies", "Soft glowing fireflies drifting over the card.", fx_fireflies),
    ("first-snow", "First Snow", "Gentle snow falling over the card.", fx_snow),
]

CATEGORY = {"category": "custom", "category_name": "OnPresence originals"}


def main():
    decos = []
    for id_, name, desc, fn in DECORATIONS:
        path = PUBLIC / "img" / "decorations" / f"{id_}.png"
        save_apng(fn(), path)
        decos.append({"id": id_, "name": name, "description": desc, **CATEGORY, "url": f"/img/decorations/{id_}.png"})

    effects = []
    for id_, name, desc, fn in EFFECTS:
        frames = fn()
        path = PUBLIC / "img" / "effects" / f"{id_}.png"
        save_apng(frames, path)
        still = PUBLIC / "img" / "effects" / f"{id_}-still.png"
        frames[len(frames) // 3].save(still, optimize=True)
        src = f"/img/effects/{id_}.png"
        effects.append({
            "id": id_, "name": name, "title": name, "description": desc, **CATEGORY,
            "thumbnailPreviewSrc": src,
            "staticFrameSrc": f"/img/effects/{id_}-still.png",
            "reducedMotionSrc": f"/img/effects/{id_}-still.png",
            # duration 0 = the file loops by itself; keep it shown.
            "effects": [{"src": src, "loop": True, "duration": 0, "start": 0, "loopDelay": 0, "zIndex": 1}],
        })

    data = PUBLIC / "data"
    (data / "decorations.json").write_text(json.dumps(decos, indent=2) + "\n", encoding="utf-8", newline="\n")
    (data / "effects.json").write_text(json.dumps(effects, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("wrote web/public/data/decorations.json and effects.json")


if __name__ == "__main__":
    main()
