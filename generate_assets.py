import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
FONTS = Path(os.environ.get('WINDIR', r'C:\Windows')) / 'Fonts'
PAPER = '#faf9fc'


def brand_icon(size=1024):
    image = Image.new('RGB', (size, size), '#e8dff1')
    drawing = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONTS / 'georgia.ttf'), round(size * .75))
    drawing.text((size * .5, size * .703), 'c', font=font, fill='#6a5089', anchor='ms')
    return image


def main():
    icon = brand_icon()
    for filename, size in [('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180)]:
        icon.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / filename, optimize=True)
    for width, height in [(1206, 2622), (2622, 1206), (1320, 2868), (2868, 1320)]:
        image = Image.new('RGB', (width, height), PAPER)
        drawing = ImageDraw.Draw(image)
        mark_size = 312
        mark = icon.resize((mark_size, mark_size), Image.Resampling.LANCZOS)
        mask = Image.new('L', (mark_size, mark_size), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, mark_size, mark_size), radius=72, fill=255)
        middle = height // 2 - 80
        image.paste(mark, (width // 2 - mark_size // 2, middle - 215), mask)
        title = ImageFont.truetype(str(FONTS / 'georgia.ttf'), 114)
        subtitle = ImageFont.truetype(str(ROOT / 'manrope.ttf'), 39)
        drawing.text((width // 2, middle + 210), 'Cri', font=title, anchor='mm', fill='#302d36')
        drawing.text((width // 2, middle + 330), 'Tu diario de movimiento', font=subtitle, anchor='mm', fill='#7c7785')
        image.save(ROOT / f'launch-{width}x{height}.png', optimize=True)
    print('Generated 3 icons and 4 iPhone launch images.')


if __name__ == '__main__':
    main()