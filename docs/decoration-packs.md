# Decorations, effects & packs

**Avatar decorations** are animated frames drawn around the avatar. **Profile effects** are animated overlays that play over the whole card. Pick them in **Dashboard → Appearance**.

## Built in

OnPresence ships with its own originals (MIT licensed, drawn from code in `tools/originals/build.py`):

| Decorations | Effects |
|---|---|
| Orbit, Aurora Halo, Ember Crown | Starfall, Fireflies, First Snow |

You can also paste any image URL as a decoration, or pick a file from your media library.

## Packs

A pack is a JSON file that adds decorations and effects to the pickers. Import it under **Dashboard → Decoration packs**. Importing adds entries; an entry with an existing `id` replaces it. **Remove imported packs** goes back to the built-in set.

Only import packs whose images you have the right to use.

```json
{
  "decorations": [
    {
      "id": "neon-ring",
      "name": "Neon Ring",
      "description": "Optional text shown in the picker.",
      "category": "my-pack",
      "category_name": "My pack",
      "url": "https://example.com/decorations/neon-ring.png"
    }
  ],
  "profileEffects": [
    {
      "id": "confetti",
      "name": "Confetti",
      "category": "my-pack",
      "category_name": "My pack",
      "thumbnailPreviewSrc": "https://example.com/effects/confetti.png",
      "staticFrameSrc": "https://example.com/effects/confetti-still.png",
      "effects": [
        { "src": "https://example.com/effects/confetti.png", "loop": true, "duration": 0, "start": 0, "loopDelay": 0, "zIndex": 1 }
      ]
    }
  ]
}
```

Rules:

- `id`: letters, digits, `-` and `_`, up to 64 characters.
- Image URLs must be `https://` or a local path (`/uploads/…`, `/img/…`). Anything else is dropped on import.
- A plain array works too: decorations (entries with `url`) or effects (entries with `effects`).

### Effect layers

An effect is one or more image layers stacked over the card (top aligned, scaled to cover the card width).

| Field | Meaning |
|---|---|
| `src` | Image URL (APNG, GIF or WebP) |
| `start` | Delay before the layer appears, in ms |
| `duration` | How long the layer is shown, in ms. With `loop: true`, `0` means "keep it on screen"; use this for files that loop by themselves |
| `loop` | Show the layer again after `duration` + `loopDelay` |
| `loopDelay` | Pause between repeats, in ms |
| `zIndex` | Stacking order between layers |

`reducedMotionSrc` / `staticFrameSrc` are still images used for visitors who prefer reduced motion.

## Making your own

- **Decorations:** square, transparent, 240×240 or larger. The avatar covers the middle circle (83% of the width); draw around it. Animated PNG (APNG) looks best; GIF works but has hard edges.
- **Effects:** transparent, portrait (about 9:16, e.g. 360×640 or 450×800). Keep most of the card free so text stays readable.
- **Size:** aim for under 500 KB per file. Fewer frames (15 fps is plenty), fewer colors and fully transparent empty areas keep files small.
- Tools: any editor that exports APNG (e.g. Aseprite, GIMP with a plugin, or code like `tools/originals/build.py` with Pillow).
- Upload the files to the media library (or any https host) and reference them in a pack, or paste a decoration URL directly in the picker.
