"""Generates the demo persona used for screenshots and "try it" installs:

    web/public/img/demo/*.svg      artwork (all original, safe to redistribute)
    docs/demo/demo-content.json    load it in Dashboard -> Security & data -> Restore from JSON

    python tools/demo/build.py
"""

import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IMG = ROOT / "web/public/img/demo"
OUT = ROOT / "docs/demo"
rnd = random.Random(7)


def write(name: str, svg: str) -> str:
    (IMG / name).write_text(svg, encoding="utf-8", newline="\n")
    return f"/img/demo/{name}"


def grad(id_: str, a: str, b: str, vertical=True) -> str:
    x2, y2 = ("0", "1") if vertical else ("1", "1")
    return f'<linearGradient id="{id_}" x1="0" y1="0" x2="{x2}" y2="{y2}"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>'


def stars(w, h, n, maxy=None):
    maxy = maxy or h
    return "".join(f'<circle cx="{rnd.uniform(0, w):.0f}" cy="{rnd.uniform(0, maxy):.0f}" r="{rnd.uniform(0.6, 2):.1f}" fill="#fff" opacity="{rnd.uniform(.3, .9):.2f}"/>' for _ in range(n))


def mountains(w, h, base, color, peaks, jitter):
    pts = [(0, h)]
    for i in range(peaks + 1):
        x = w * i / peaks
        y = base - rnd.uniform(0, jitter) if i % 2 else base + rnd.uniform(0, jitter / 3)
        pts.append((x, y))
    pts.append((w, h))
    return f'<polygon points="{" ".join(f"{x:.0f},{y:.0f}" for x, y in pts)}" fill="{color}"/>'


# ---------------------------------------------------------------- artwork

def cover_landscape(w, h, sky, sun, layers):
    body = f'<defs>{grad("s", *sky)}</defs><rect width="{w}" height="{h}" fill="url(#s)"/>' + stars(w, h, 30, h * .5)
    body += f'<circle cx="{w * .68:.0f}" cy="{h * .42:.0f}" r="{min(w, h) * .2:.0f}" fill="{sun}" opacity=".9"/>'
    for i, c in enumerate(layers):
        body += mountains(w, h, h * (.55 + i * .14), c, 6 + i * 2, h * (.28 - i * .06))
    return body


def cover_city(w, h, sky, neon):
    body = f'<defs>{grad("s", *sky)}</defs><rect width="{w}" height="{h}" fill="url(#s)"/>' + stars(w, h, 20, h * .4)
    x = 0
    while x < w:
        bw = rnd.uniform(w * .05, w * .12)
        bh = rnd.uniform(h * .3, h * .75)
        body += f'<rect x="{x:.0f}" y="{h - bh:.0f}" width="{bw:.0f}" height="{bh:.0f}" fill="#0b0716"/>'
        for wy in range(int(h - bh + 8), h - 6, 12):
            for wx in range(int(x + 4), int(x + bw - 4), 9):
                if rnd.random() < .35:
                    body += f'<rect x="{wx}" y="{wy}" width="4" height="5" fill="{rnd.choice(neon)}" opacity=".85"/>'
        x += bw + 2
    body += f'<rect y="{h * .88:.0f}" width="{w}" height="3" fill="{neon[0]}" opacity=".8"/>'
    return body


def cover_ocean(w, h, sky, sea, moon):
    body = f'<defs>{grad("s", *sky)}{grad("o", *sea)}</defs><rect width="{w}" height="{h}" fill="url(#s)"/>' + stars(w, h, 40, h * .55)
    body += f'<circle cx="{w * .3:.0f}" cy="{h * .3:.0f}" r="{min(w, h) * .14:.0f}" fill="{moon}"/>'
    body += f'<rect y="{h * .6:.0f}" width="{w}" height="{h * .4:.0f}" fill="url(#o)"/>'
    for i in range(7):
        y = h * .62 + i * h * .055
        d = f"M0 {y:.0f}" + "".join(f" Q{x + 15:.0f} {y - 5:.0f} {x + 30:.0f} {y:.0f}" for x in range(0, w, 30))
        body += f'<path d="{d}" fill="none" stroke="#fff" stroke-opacity="{.25 - i * .03:.2f}" stroke-width="2"/>'
    return body


def cover_abstract(w, h, a, b, shapes):
    body = f'<defs>{grad("s", a, b, vertical=False)}</defs><rect width="{w}" height="{h}" fill="url(#s)"/>'
    for _ in range(shapes):
        cx, cy, r = rnd.uniform(0, w), rnd.uniform(0, h), rnd.uniform(min(w, h) * .08, min(w, h) * .35)
        kind = rnd.choice(["c", "r", "t"])
        op = rnd.uniform(.12, .35)
        if kind == "c":
            body += f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{r:.0f}" fill="#fff" opacity="{op:.2f}"/>'
        elif kind == "r":
            body += f'<rect x="{cx:.0f}" y="{cy:.0f}" width="{r:.0f}" height="{r:.0f}" transform="rotate({rnd.uniform(0, 90):.0f} {cx:.0f} {cy:.0f})" fill="#fff" opacity="{op:.2f}"/>'
        else:
            body += f'<polygon points="{cx:.0f},{cy - r:.0f} {cx + r:.0f},{cy + r:.0f} {cx - r:.0f},{cy + r:.0f}" fill="none" stroke="#fff" stroke-width="3" opacity="{op + .2:.2f}"/>'
    return body


def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" preserveAspectRatio="xMidYMid slice">{body}</svg>\n'


def avatar():
    """A pixel-art fox, fitting a pixel artist persona."""
    art = [
        "..o......o..",
        ".ooo....ooo.",
        ".oOoo..ooOo.",
        ".oooooooooo.",
        "oooooooooooo",
        "oowwooooowwo",
        "oowkooooowko",
        "ooooowwooooo",
        ".ooowwwwooo.",
        "..owwkkwwo..",
        "...owwwwo...",
        "....oooo....",
    ]
    colors = {"o": "#fb923c", "O": "#fed7aa", "w": "#fff7ed", "k": "#1c1917"}
    px = 16
    off = (256 - px * 12) // 2
    body = f'<defs>{grad("bg", "#7c3aed", "#1e1b4b")}</defs><rect width="256" height="256" fill="url(#bg)"/>'
    body += '<circle cx="128" cy="140" r="104" fill="#fff" opacity=".06"/>'
    for y, row in enumerate(art):
        for x, c in enumerate(row):
            if c in colors:
                body += f'<rect x="{off + x * px}" y="{off + 8 + y * px}" width="{px}" height="{px}" fill="{colors[c]}"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" shape-rendering="crispEdges">{body}</svg>\n'


def banner():
    w, h = 900, 300
    body = f'<defs>{grad("s", "#4c1d95", "#0f172a")}</defs><rect width="{w}" height="{h}" fill="url(#s)"/>' + stars(w, h, 70)
    for i in range(5):
        body += f'<circle cx="{w * .8:.0f}" cy="{h * .1:.0f}" r="{60 + i * 55}" fill="none" stroke="#c4b5fd" stroke-opacity="{.25 - i * .04:.2f}" stroke-width="2"/>'
    body += mountains(w, h, h * .8, "#1e1238", 10, 60)
    return svg(w, h, body)


def build_images():
    IMG.mkdir(parents=True, exist_ok=True)
    g = {}
    g["starfall"] = write("game-starfall-drift.svg", svg(460, 215, cover_landscape(460, 215, ("#1e1b4b", "#be185d"), "#fde68a", ["#3b0764", "#1e1038", "#0c0717"])))
    g["lantern"] = write("game-hollow-lantern.svg", svg(460, 215, cover_ocean(460, 215, ("#0f172a", "#1e3a8a"), ("#1e3a8a", "#020617"), "#fef3c7")))
    g["courier"] = write("game-neon-courier.svg", svg(460, 215, cover_city(460, 215, ("#312e81", "#db2777"), ["#22d3ee", "#f0abfc", "#fde047"])))
    g["tide"] = write("game-tidebreaker.svg", svg(460, 215, cover_abstract(460, 215, "#0e7490", "#1e3a8a", 9)))
    m = {}
    m["moonlit"] = write("anime-moonlit-academy.svg", svg(300, 450, cover_ocean(300, 450, ("#1e1b4b", "#6d28d9"), ("#312e81", "#0c0a1f"), "#fae8ff")))
    m["petal"] = write("anime-iron-petal.svg", svg(300, 450, cover_abstract(300, 450, "#be123c", "#4c0519", 10)))
    m["clockwork"] = write("manga-clockwork-sky.svg", svg(300, 450, cover_landscape(300, 450, ("#0c4a6e", "#f59e0b"), "#fff7ed", ["#334155", "#1e293b", "#0f172a"])))
    m["ember"] = write("manga-ember-road.svg", svg(300, 450, cover_city(300, 450, ("#7c2d12", "#f97316"), ["#fde68a", "#fca5a5"])))
    p = {}
    p["night"] = write("music-night-drive.svg", svg(400, 400, cover_city(400, 400, ("#1e1b4b", "#7c3aed"), ["#a5f3fc", "#f0abfc"])))
    p["lofi"] = write("music-rainy-lofi.svg", svg(400, 400, cover_ocean(400, 400, ("#334155", "#64748b"), ("#475569", "#0f172a"), "#e2e8f0")))
    r = {}
    r["palette"] = write("project-pixel-palette.svg", svg(800, 300, cover_abstract(800, 300, "#7c3aed", "#db2777", 14)))
    r["bot"] = write("project-lobby-bot.svg", svg(800, 300, cover_abstract(800, 300, "#0d9488", "#1e3a8a", 12)))
    r["host"] = write("ref-cloudlet.svg", svg(800, 300, cover_landscape(800, 300, ("#0c4a6e", "#22d3ee"), "#f0fdfa", ["#155e75", "#164e63", "#083344"])))
    return write("avatar.svg", avatar()), write("banner.svg", banner()), g, m, p, r


# ---------------------------------------------------------------- content

def content(avatar_url, banner_url, g, m, p, r):
    settings = {
        "theme": "violet", "accent_color": "#a78bfa",
        "avatar_decoration": "orbit", "profile_effect": "starfall",
        "card_effect": "none", "background_fx": "embers",
        "card_opacity": 0.72, "card_blur": 18, "avatar_zoom": 100, "avatar_shape": "circle",
        "name_style": "gradient", "card_tilt": True, "name_font": "sora", "gate_font": "sora",
        "name_logo": "", "name_logo_mode": "original", "name_logo_height": 72, "effect_on_hover": False,
        "entry_gate": False, "gate_text": "click to enter", "music_mode": "auto", "default_volume": 10,
        "show_presence": True, "show_view_count": True, "show_credit": True,
        "vault_enabled": True, "vault_title": "Nova's Shelf", "vault_subtitle": "Games, anime and music that shaped my pixels.",
        "vault_badge": "Curated", "vault_icon": "/img/brand/vault.svg", "vault_steam_badge": "", "collection_score": "",
        "sections": ["referrals", "games", "anime", "manga", "music"],
    }
    profile = {
        "name": "Nova", "handle": "@nova.pixels", "title": "Pixel artist & speedrunner",
        "bio": "I draw tiny worlds one pixel at a time, then try to beat them faster than anyone else.\nCommissions open.",
        "avatar_url": avatar_url, "background_url": "", "card_bg_url": banner_url, "audio_url": "", "audio_title": "",
        "discord_id": "", "discord_status": "online", "steam_id": "", "steam_level": "LVL 42",
        "anilist_username": "", "lastfm_username": "", "settings": settings,
    }
    links = [
        {"platform": "github", "label": "GitHub", "url": "https://github.com", "icon": "github"},
        {"platform": "twitch", "label": "Twitch", "url": "https://twitch.tv", "icon": "twitch"},
        {"platform": "youtube", "label": "YouTube", "url": "https://youtube.com", "icon": "youtube"},
        {"platform": "bluesky", "label": "Bluesky", "url": "https://bsky.app", "icon": "bluesky"},
        {"platform": "kofi", "label": "Ko-fi", "url": "https://ko-fi.com", "icon": "kofi"},
    ]
    for i, l in enumerate(links):
        l.update(sort_order=i, is_active=True, clicks=0)
    badges = [
        {"title": "Pixel artist", "subtitle": "10 years of tiny art", "icon": "sparkles", "color": "#c4b5fd"},
        {"title": "Speedrunner", "subtitle": "Any% world record holder (for a week)", "icon": "trophy", "color": "#fbbf24"},
        {"title": "Night owl", "subtitle": "Best work happens at 3 AM", "icon": "moon", "color": "#93c5fd"},
    ]
    for i, b in enumerate(badges):
        b.update(category="", sort_order=i)
    games = [
        {"title": "Starfall Drift", "subtitle": "Arcade racer", "cover_image": g["starfall"], "rating": "9.5/10", "badge": "Speedrun", "badge_type": "masterpiece", "hours_played": 412, "category": "Racing", "review_note": "The drift physics are perfect. My any% route is 18:42.", "is_featured": True},
        {"title": "Hollow Lantern", "subtitle": "Metroidvania", "cover_image": g["lantern"], "rating": "9/10", "badge": "", "badge_type": "good", "hours_played": 96, "category": "Adventure", "review_note": "Moody pixel art that inspired half my portfolio.", "is_featured": False},
        {"title": "Neon Courier", "subtitle": "Rhythm platformer", "cover_image": g["courier"], "rating": "8/10", "badge": "", "badge_type": "good", "hours_played": 58, "category": "Rhythm", "review_note": "", "is_featured": False},
        {"title": "Tidebreaker", "subtitle": "Roguelike", "cover_image": g["tide"], "rating": "6/10", "badge": "", "badge_type": "okay", "hours_played": 21, "category": "Roguelike", "review_note": "Fun runs, grindy meta.", "is_featured": False},
    ]
    media = [
        {"title": "Moonlit Academy", "type": "anime", "cover_image": m["moonlit"], "rating": "10/10", "rank_badge": "#1", "category_badge": "Slice of life", "progress_info": "24/24 eps", "review_note": "Comfort show.", "tags": "school, fantasy", "is_featured": True},
        {"title": "Iron Petal", "type": "anime", "cover_image": m["petal"], "rating": "8.5/10", "rank_badge": "", "category_badge": "Action", "progress_info": "12/12 eps", "review_note": "", "tags": "mecha", "is_featured": False},
        {"title": "Clockwork Sky", "type": "manga", "cover_image": m["clockwork"], "rating": "9/10", "rank_badge": "", "category_badge": "Adventure", "progress_info": "Ch. 88", "review_note": "", "tags": "steampunk", "is_featured": False},
        {"title": "Ember Road", "type": "manhwa", "cover_image": m["ember"], "rating": "8/10", "rank_badge": "", "category_badge": "Drama", "progress_info": "Ch. 120", "review_note": "", "tags": "", "is_featured": False},
    ]
    for x in media:
        x.update(anilist_id=0)
    playlists = [
        {"title": "Night Drive", "subtitle": "Synthwave for late sessions", "type": "playlist", "cover_image": p["night"], "spotify_url": "", "yt_music_url": "", "audio_url": "", "duration": "1h 12m", "artist": "Various artists", "is_featured": True,
         "tracks": [{"track_number": "1", "title": "Midnight Grid", "artist": "Lumen Rider", "duration": "4:12", "audio_url": ""}, {"track_number": "2", "title": "Chrome Horizon", "artist": "Vapor Lane", "duration": "3:48", "audio_url": ""}, {"track_number": "3", "title": "Afterglow", "artist": "Nightline", "duration": "5:03", "audio_url": ""}]},
        {"title": "Rainy Lo-fi", "subtitle": "Drawing background noise", "type": "playlist", "cover_image": p["lofi"], "spotify_url": "", "yt_music_url": "", "audio_url": "", "duration": "48m", "artist": "Various artists", "is_featured": False, "tracks": []},
    ]
    referrals = [
        {"kind": "project", "title": "Pixel Palette", "game_name": "Web tool", "ref_code": "", "ref_url": "https://github.com", "image_url": r["palette"], "description": "Generate retro color palettes from any image.", "reward_text": "", "badge": "New", "display_style": "banner", "is_active": True},
        {"kind": "project", "title": "Lobby Bot", "game_name": "Chat bot", "ref_code": "", "ref_url": "https://github.com", "image_url": r["bot"], "description": "Speedrun race lobbies with split tracking.", "reward_text": "", "badge": "", "display_style": "card", "is_active": True},
        {"kind": "referral", "title": "Cloudlet Hosting", "game_name": "Hosting", "ref_code": "NOVA20", "ref_url": "https://example.com", "image_url": r["host"], "description": "Where this card is hosted.", "reward_text": "20% off your first month", "badge": "", "display_style": "card", "is_active": True},
    ]
    for coll in (games, media, playlists, referrals):
        for i, x in enumerate(coll):
            x["sort_order"] = i
    return {"app": "onpresence", "version": 1, "profile": profile, "links": links, "badges": badges, "games": games,
            "media": media, "playlists": playlists, "referrals": referrals}


def main():
    data = content(*build_images())
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "demo-content.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
    size = sum(f.stat().st_size for f in IMG.iterdir())
    print(f"wrote docs/demo/demo-content.json and {len(list(IMG.iterdir()))} images ({size // 1024} KB)")


if __name__ == "__main__":
    main()
