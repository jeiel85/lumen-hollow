# 패널·버튼·아이콘·로고·키 아트를 게임 자산(game/)으로 가공한다. python -X utf8 menu.py
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from proc import unblend_black, crop_alpha, fit

OUT = 'game'
os.makedirs(OUT, exist_ok=True)


def save(img, name, **kw):
    path = f'{OUT}/{name}'
    img.save(path, 'WEBP', method=6, **kw)
    print(f'{name:22s} {img.size}  {os.path.getsize(path) / 1024:.0f} KB')


# 키 아트(불투명)
save(Image.open('raw/key-wide-b.png').convert('RGB'), 'title-wide.webp', quality=80)
save(Image.open('raw/key-tall-b.png').convert('RGB'), 'title-tall.webp', quality=80)

# 로고(검은 바탕 → 투명)
save(fit(crop_alpha(unblend_black(Image.open('raw/logo-a.png'))), 1240), 'logo-wide.webp', quality=88, alpha_quality=90)
save(fit(crop_alpha(unblend_black(Image.open('raw/logo-stack.png'))), 840), 'logo-stack.webp', quality=88, alpha_quality=90)

# 패널: 9조각(테두리 띠 원본 약 72px/1254 → 640에서 39px)
save(Image.open('raw/panel-a.png').convert('RGB').resize((640, 640), Image.LANCZOS), 'panel.webp', quality=82)


# 버튼: 검은 바탕에서 바깥만 지워 투명하게(안쪽의 어두운 유리는 남긴다)
def cut_button(img, box):
    crop = img.crop(box).convert('RGB')
    lum = np.asarray(crop).max(axis=2)
    mask = Image.fromarray(np.where(lum > 14, 255, 0).astype(np.uint8), 'L')
    # 바깥 검정만 0으로: 네 귀퉁이에서 채우기
    flood = mask.copy()
    for xy in [(0, 0), (flood.width - 1, 0), (0, flood.height - 1), (flood.width - 1, flood.height - 1)]:
        ImageDraw.floodfill(flood, xy, 128)
    alpha = Image.fromarray(np.where(np.asarray(flood) == 128, 0, 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(1.2))
    out = crop.copy()
    out.putalpha(alpha)
    return out


btn = Image.open('raw/button-a.png')
for name, box in [('btn-lit.webp', (22, 98, 1511, 398)), ('btn-dark.webp', (22, 625, 1511, 924))]:
    b = cut_button(btn, box)
    h = 96
    b = b.resize((round(b.width * h / b.height), h), Image.LANCZOS)
    save(b, name, quality=86, alpha_quality=95)

# 아이콘: 4×2 칸
icons = unblend_black(Image.open('raw/icons-a.png'))
names = ['closet', 'journal', 'settings', 'install', 'grid', 'sound', 'online', 'flash']
cw, ch = icons.width // 4, icons.height // 2
for i, n in enumerate(names):
    cell = icons.crop(((i % 4) * cw, (i // 4) * ch, (i % 4 + 1) * cw, (i // 4 + 1) * ch))
    c = crop_alpha(cell, pad_ratio=0.06)
    side = max(c.size)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(c, ((side - c.width) // 2, (side - c.height) // 2))
    save(sq.resize((96, 96), Image.LANCZOS), f'icon-{n}.webp', quality=90, alpha_quality=95)

# 로고 전구 위치(빛 맥동 위치를 CSS에 퍼센트로 쓴다): 가장 밝은 덩어리의 중심
for n in ['logo-wide', 'logo-stack']:
    a = np.asarray(Image.open(f'{OUT}/{n}.webp').convert('RGBA')).astype(float)
    lum = a[..., :3].mean(axis=2) * a[..., 3] / 255
    ys, xs = np.where(lum > np.percentile(lum, 99.7))
    print(n, 'bulb ~', f'{xs.mean() / a.shape[1] * 100:.1f}% {ys.mean() / a.shape[0] * 100:.1f}%')
