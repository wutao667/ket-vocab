#!/usr/bin/env python3
"""生成词匣系列的 PWA 图标。

设计：品牌绿底 (#176b5b) + 白色词卡造型，中间一个品牌字母。
maskable 版本留足安全边距（内容在中心 80% 圆内），避免被系统裁掉。

用法：
  python3 make-icons.py KET    → public/icons/（KET，默认）
  python3 make-icons.py PET    → public/icons/（PET）
字母取应用标识首字母，与 apps.json 的 brandMark 保持一致。
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

APP = (sys.argv[1] if len(sys.argv) > 1 else 'KET').upper()
BRAND_LETTER = APP[0]

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BRAND = (23, 107, 91)      # #176b5b
WHITE = (255, 255, 255)
CREAM = (247, 244, 237)    # #f7f4ed

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_icon(size: int, padding_ratio: float, maskable: bool) -> Image.Image:
    """画一张图标。

    padding_ratio: 内容占画布的比例（maskable 用 0.62，普通用 0.78）
    """
    scale = 4  # 超采样，边缘更干净
    canvas = size * scale
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 背景：maskable 铺满整块（系统自己裁形状）；普通版画圆角矩形
    if maskable:
        d.rectangle([0, 0, canvas, canvas], fill=BRAND)
    else:
        r = int(canvas * 0.22)
        rounded_rect(d, [0, 0, canvas - 1, canvas - 1], r, BRAND)

    # 内容区
    content = int(canvas * padding_ratio)
    left = (canvas - content) // 2
    top = (canvas - content) // 2

    # 词卡：一张竖放的卡片，带一点阴影层次
    card_w = int(content * 0.62)
    card_h = int(content * 0.80)
    card_x = left + (content - card_w) // 2
    card_y = top + (content - card_h) // 2
    card_r = int(card_w * 0.12)

    # 后面一张略微偏移的卡片，做出叠放感
    off = int(card_w * 0.09)
    rounded_rect(
        d,
        [card_x + off, card_y + off, card_x + card_w + off, card_y + card_h + off],
        card_r,
        (255, 255, 255, 70),
    )
    # 前面的主卡片
    rounded_rect(d, [card_x, card_y, card_x + card_w, card_y + card_h], card_r, CREAM)

    # 卡片上的品牌字母
    letter = BRAND_LETTER
    font_size = int(card_h * 0.52)
    try:
        font = ImageFont.truetype(FONT_BOLD, font_size)
    except OSError:
        font = ImageFont.load_default()

    bbox = d.textbbox((0, 0), letter, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = card_x + (card_w - tw) // 2 - bbox[0]
    ty = card_y + (card_h - th) // 2 - bbox[1]
    d.text((tx, ty), letter, font=font, fill=BRAND)

    # 卡片底部两条横线，暗示"词条列表"
    line_w = int(card_w * 0.42)
    line_h = max(2, int(card_h * 0.035))
    line_x = card_x + (card_w - line_w) // 2
    for i, ratio in enumerate((0.80, 0.88)):
        ly = card_y + int(card_h * ratio)
        width = line_w if i == 0 else int(line_w * 0.62)
        lx = card_x + (card_w - width) // 2
        d.rounded_rectangle(
            [lx, ly, lx + width, ly + line_h],
            radius=line_h // 2,
            fill=(23, 107, 91, 120),
        )

    return img.resize((size, size), Image.LANCZOS)


def main():
    # 普通图标
    for size in (192, 512):
        icon = draw_icon(size, padding_ratio=0.74, maskable=False)
        path = OUT / f"icon-{size}.png"
        icon.save(path, "PNG", optimize=True)
        print(f"生成 {path.name} ({path.stat().st_size} bytes)")

    # maskable：内容更小，留安全边距
    for size in (192, 512):
        icon = draw_icon(size, padding_ratio=0.58, maskable=True)
        path = OUT / f"maskable-{size}.png"
        icon.save(path, "PNG", optimize=True)
        print(f"生成 {path.name} ({path.stat().st_size} bytes)")

    # iOS 主屏图标（不支持透明，铺白底）
    apple = draw_icon(180, padding_ratio=0.74, maskable=True)
    apple.save(OUT / "apple-touch-icon.png", "PNG", optimize=True)
    print("生成 apple-touch-icon.png")

    # favicon
    fav = draw_icon(64, padding_ratio=0.80, maskable=False)
    fav.save(OUT / "favicon.png", "PNG", optimize=True)
    print("生成 favicon.png")


if __name__ == "__main__":
    main()
