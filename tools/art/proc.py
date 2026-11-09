# 코덱스가 만든 원본(raw/)을 게임용 자산(out/)으로 바꾼다.
#   python -X utf8 proc.py logo raw/logo-a.png out/logo-wide.webp 1400
#   python -X utf8 proc.py glow raw/x.png out/x.webp            (검은 바탕의 빛나는 그림 → 투명 배경)
#   python -X utf8 proc.py photo raw/key.png out/key.webp 1920   (불투명 그림, 긴 변 기준 크기)
import sys
from PIL import Image, ImageFilter
import numpy as np


def unblend_black(img, floor=8):
    """검은 바탕에 빛나는 그림을 투명 배경으로: 알파 = 가장 밝은 채널, 색 = 원래 색 / 알파.
    floor 아래의 어두운 잡음(생성 이미지의 검정은 0이 아니다)은 완전히 투명하게 한다."""
    a = np.asarray(img.convert('RGB')).astype(np.float32)
    m = a.max(axis=2)
    alpha = np.clip((m - floor) / (255.0 - floor), 0, 1)
    safe = np.where(m > 0, m, 1)[..., None]
    rgb = np.clip(a / safe * 255.0, 0, 255)  # 가장 밝은 채널이 255가 되게 펴서, 알파와 곱하면 원래 색으로 돌아간다
    out = np.dstack([rgb, alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def crop_alpha(img, pad_ratio=0.04, thresh=6):
    a = np.asarray(img.split()[-1])
    ys, xs = np.where(a > thresh)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    pad = int(max(x1 - x0, y1 - y0) * pad_ratio)
    return img.crop((max(0, x0 - pad), max(0, y0 - pad), min(img.width, x1 + pad), min(img.height, y1 + pad)))


def fit(img, longest):
    s = longest / max(img.size)
    if abs(s - 1) < 1e-3:
        return img
    return img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)


def main():
    mode, src, dst = sys.argv[1:4]
    size = int(sys.argv[4]) if len(sys.argv) > 4 else None
    img = Image.open(src)
    if mode in ('logo', 'glow'):
        out = crop_alpha(unblend_black(img))
        if size:
            out = fit(out, size)
        out.save(dst, 'WEBP', quality=90, method=6, alpha_quality=90)
    elif mode == 'photo':
        out = img.convert('RGB')
        if size:
            out = fit(out, size)
        out.save(dst, 'WEBP', quality=80, method=6)
    else:
        raise SystemExit(f'모르는 방식: {mode}')
    print(dst, out.size)


if __name__ == '__main__':
    main()
