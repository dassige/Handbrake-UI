# Branding: icon, logo and background

The app's icon, logo and background were generated with Gemini from the prompts
in this folder, then prepared for the web by [build-assets.py](build-assets.py).

## Where each image is used

| Image | File | Used in |
| --- | --- | --- |
| Icon | `web/public/favicon.ico` | Browser tab |
| Icon | `web/public/icon-192.png` | Top bar next to the app name, browser notifications, manifest |
| Icon | `web/public/icon-512.png`, `icon-maskable-512.png` | Web manifest: Android "Add to Home Screen" |
| Icon | `web/public/apple-touch-icon.png` | iPhone / iPad "Add to Home Screen" |
| Logo | `web/public/logo.png` | Settings → About, the empty queue, the empty Presets page |
| Background + icon | `docs/branding/banner.jpg` | Top of the README |
| Background + icon | `docs/branding/social-preview.jpg` | GitHub social preview (uploaded by hand: repository Settings → General → Social preview) |

In the dark theme the logo gets a faint light outline (`.brand-logo` in
`web/src/styles.css`), because its black outlines would vanish on the dark panels.

## Rebuilding the files

The source images (straight from Gemini, on white, without transparency) are in
[v2/](v2/). After replacing them, run from the repo root (needs Pillow and NumPy):

```bash
python docs/branding/build-assets.py            # uses docs/branding/v2
python docs/branding/build-assets.py path/to/other/set
```

It cuts the icon and logo out of their white backgrounds, crops the icon to its
tile, makes the full-bleed home-screen versions, shrinks the PNGs to a
256-colour palette and composes the banners.

## Generating new images

Send the three prompts **in the same Gemini chat, in this order**. The later
prompts refer back to the first image, so all three stay in one style.

1. [1-icon.prompt.txt](1-icon.prompt.txt): app icon and favicon. It also
   holds the shared brief: concept, palette, style and the "no text" rules.
2. [2-logo.prompt.txt](2-logo.prompt.txt): the larger, more detailed logo mark.
3. [3-background.prompt.txt](3-background.prompt.txt): a quiet 16:9 background.

The colours match the UI theme in [web/src/styles.css](../../web/src/styles.css)
(`--accent` #d9480f / #ff7a3d, backgrounds #f4f5f7 / #14171c). The images must
not contain text, the app name, or anything that looks like the HandBrake logo:
this project is not affiliated with HandBrake.
