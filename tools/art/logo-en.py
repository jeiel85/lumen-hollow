"""코덱스가 검은 바탕에 그린 로고 → 투명 WebP. 알파 = 가장 밝은 채널(바닥 잡음 8 이하는 0), 색 = 원색/알파.
기존 로고(art/logo-*.webp)의 내용 상자 크기·자리에 맞춰 넣는다."""
import sys
import numpy as np
from PIL import Image

S = sys.argv[1]
REPO = sys.argv[2]


def to_alpha(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    alpha = a.max(axis=2)
    alpha[alpha <= 8] = 0
    rgb = np.zeros_like(a)
    nz = alpha > 0
    rgb[nz] = np.clip(a[nz] / alpha[nz, None] * 255.0, 0, 255)
    out = np.dstack([rgb, alpha]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def bbox(im, thr=24):
    a = np.asarray(im)[:, :, 3]
    ys, xs = np.where(a > thr)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


for name in ['wide', 'stack']:
    ref = Image.open(f'{REPO}/art/logo-{name}.webp').convert('RGBA')
    rx0, ry0, rx1, ry1 = bbox(ref)
    gen = to_alpha(f'{S}/gen-{name}.png')
    gx0, gy0, gx1, gy1 = bbox(gen)
    pad = 24  # 빛 번짐이 잘리지 않게 여유
    crop = gen.crop((max(0, gx0 - pad), max(0, gy0 - pad), min(gen.width, gx1 + pad), min(gen.height, gy1 + pad)))
    cw, ch = gx1 - gx0, gy1 - gy0
    s = min((rx1 - rx0) / cw, (ry1 - ry0) / ch)
    crop = crop.resize((round(crop.width * s), round(crop.height * s)), Image.LANCZOS)
    canvas = Image.new('RGBA', ref.size, (0, 0, 0, 0))
    cx = (rx0 + rx1) / 2 - crop.width / 2
    cy = (ry0 + ry1) / 2 - crop.height / 2
    canvas.alpha_composite(crop, (max(0, round(cx)), max(0, round(cy))))
    canvas.save(f'{REPO}/art/logo-{name}-en.webp', 'WEBP', quality=90, method=6)
    prev = Image.new('RGBA', ref.size, (10, 18, 20, 255))
    prev.alpha_composite(canvas)
    prev.convert('RGB').save(f'{S}/final-{name}.jpg', quality=85)
    print(name, ref.size, 'ref box', (rx0, ry0, rx1, ry1), 'scale', round(s, 3))
