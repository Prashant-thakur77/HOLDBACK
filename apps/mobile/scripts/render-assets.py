#!/usr/bin/env python3
"""Renders the HOLDBACK brand images from code.

Everything here is drawn from the same geometry as `src/ui/BrandMark.tsx`
(a 96-unit box: a ring of radius 34, three quarters lit, with an arrow head
pointing back at its 12 o'clock end), so the launcher icon, splash, notification
icon and store graphics can never drift from the in-app mark.

Usage: python3 scripts/render-assets.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
INK = (11, 13, 16, 255)
SURFACE = (18, 21, 26, 255)
RAISED = (26, 30, 37, 255)
LUME = (198, 243, 107, 255)
TEXT = (243, 245, 247, 255)
MUTED = (163, 172, 186, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)
SUPERSAMPLE = 4


def draw_mark(size, tint=LUME, track=RAISED, background=CLEAR, scale=1.0):
    """The mark centred on a square canvas. `scale` shrinks it inside the canvas."""
    big = size * SUPERSAMPLE
    image = Image.new('RGBA', (big, big), background)
    draw = ImageDraw.Draw(image)
    unit = big * scale / 96
    offset = (big - 96 * unit) / 2

    def at(x, y):
        return (offset + x * unit, offset + y * unit)

    stroke = round(10 * unit)
    box = [at(48 - 34, 48 - 34), at(48 + 34, 48 + 34)]
    outer = [(box[0][0] - stroke / 2, box[0][1] - stroke / 2), (box[1][0] + stroke / 2, box[1][1] + stroke / 2)]
    if track is not None:
        draw.arc(outer, 0, 360, fill=track, width=stroke)
    # Lit arc: from 12 o'clock clockwise to 9 o'clock.
    draw.arc(outer, 270, 540, fill=tint, width=stroke)

    def dot(x, y):
        cx, cy = at(x, y)
        r = stroke / 2
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=tint)

    dot(14, 48)
    # Arrow head at the 12 o'clock end, pointing back (counter-clockwise).
    head = ((54, 1), (39, 14), (54, 27))
    draw.line([at(x, y) for x, y in head], fill=tint, width=stroke, joint='curve')
    for x, y in head:
        dot(x, y)
    return image.resize((size, size), Image.LANCZOS)


def font(size, bold=True):
    """A system sans-serif for the store banner; falls back to Pillow's built-in font."""
    names = ['DejaVuSans-Bold.ttf', 'LiberationSans-Bold.ttf'] if bold else ['DejaVuSans.ttf', 'LiberationSans-Regular.ttf']
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def banner(width, height):
    image = Image.new('RGBA', (width, height), INK)
    mark = draw_mark(int(height * 0.62))
    image.alpha_composite(mark, (int(width * 0.07), (height - mark.height) // 2))
    draw = ImageDraw.Draw(image)
    left = int(width * 0.07) + mark.width + int(width * 0.05)
    draw.text((left, int(height * 0.30)), 'HOLDBACK', font=font(int(height * 0.17)), fill=TEXT)
    draw.text((left, int(height * 0.54)), 'Every payment gets an undo.', font=font(int(height * 0.065), bold=False), fill=MUTED)
    return image


PREVIEWS = [
    ('Every payment gets an undo.', 'Money waits on-chain for a short window before it arrives.'),
    ('A window sized by evidence.', 'Scam reports, blocklists and on-chain history set its length.'),
    ('Changed your mind? Pull it back.', 'One tap returns the money to your own wallet.'),
    ('Practice in the Scam Dojo.', 'Eight requests. Some honest, some not. Learn the tells.'),
]


def preview(width, height, title, subtitle, lit):
    """A portrait listing card: the mark with `lit` of its ring left, a headline and one line."""
    image = Image.new('RGBA', (width, height), INK)
    big = int(width * 0.56)
    canvas = Image.new('RGBA', (big * SUPERSAMPLE, big * SUPERSAMPLE), CLEAR)
    draw = ImageDraw.Draw(canvas)
    stroke = big * SUPERSAMPLE // 11
    box = [stroke, stroke, big * SUPERSAMPLE - stroke, big * SUPERSAMPLE - stroke]
    draw.arc(box, 0, 360, fill=RAISED, width=stroke)
    draw.arc(box, 270, 270 + 360 * lit, fill=LUME, width=stroke)
    ring = canvas.resize((big, big), Image.LANCZOS)
    image.alpha_composite(ring, ((width - big) // 2, int(height * 0.16)))
    mark = draw_mark(int(big * 0.38), scale=0.86)
    image.alpha_composite(mark, ((width - mark.width) // 2, int(height * 0.16) + (big - mark.height) // 2))

    draw = ImageDraw.Draw(image)
    title_font = font(int(width * 0.052))
    line_font = font(int(width * 0.029), bold=False)
    draw.text((width / 2, height * 0.62), title, font=title_font, fill=TEXT, anchor='mm')
    draw.text((width / 2, height * 0.68), subtitle, font=line_font, fill=MUTED, anchor='mm')
    draw.text((width / 2, height * 0.93), 'HOLDBACK', font=font(int(width * 0.04)), fill=LUME, anchor='mm')
    return image


def save(image, relative):
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)
    print(f'{relative}  {image.width}x{image.height}')


def main():
    # App icon: solid background (stores reject transparency).
    save(draw_mark(1024, background=INK, scale=0.62), 'assets/images/icon.png')
    # Adaptive icon layers: the mark stays inside the 66% safe zone.
    save(draw_mark(1024, track=None, scale=0.50), 'assets/images/adaptive-foreground.png')
    save(draw_mark(1024, tint=WHITE, track=None, scale=0.50), 'assets/images/adaptive-monochrome.png')
    save(draw_mark(512, scale=0.9), 'assets/images/splash-icon.png')
    # Android tints the notification icon itself: white on transparent.
    save(draw_mark(96, tint=WHITE, track=None, scale=0.92), 'assets/images/notification-icon.png')
    # dApp Store listing graphics.
    save(draw_mark(512, background=INK, scale=0.62).convert('RGB'), 'dapp-store/media/icon-512.png')
    save(banner(1200, 600).convert('RGB'), 'dapp-store/media/banner-1200x600.png')
    # Listing previews (9:16). Replace with device screenshots when you have them: see README.
    for index, (title, subtitle) in enumerate(PREVIEWS, start=1):
        lit = 1 - (index - 1) * 0.22
        save(preview(1080, 1920, title, subtitle, lit).convert('RGB'), f'dapp-store/media/preview-{index}.png')


if __name__ == '__main__':
    main()
