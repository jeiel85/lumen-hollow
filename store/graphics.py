"""플레이 스토어 그래픽을 게임 그림에서 만든다(#52).
- graphics/icon-512.png: 앱 아이콘 512×512(정사각형 꽉 채움, 모서리는 Play가 둥글게 깎는다) — icons/maskable-512.png
- graphics/feature-1024x500.png: 대표 그래픽 — 처음 화면 키 아트(art/title-wide.webp) + 로고(art/logo-wide.webp)
사용: 저장소 루트에서 python -X utf8 store/graphics.py
"""
import os
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'store', 'graphics')
os.makedirs(OUT, exist_ok=True)

# 아이콘: 알파 없는 24비트도 되지만 Play 안내대로 32비트 PNG로 저장한다.
icon = Image.open(os.path.join(ROOT, 'icons', 'maskable-512.png')).convert('RGBA')
assert icon.size == (512, 512), icon.size
icon.save(os.path.join(OUT, 'icon-512.png'), optimize=True)

# 대표 그래픽 1024×500: 키 아트를 폭 1024로 줄여 가운데를 자르고(주인공·가로등이 오른쪽에 남게),
# 왼쪽 어두운 하늘에 로고를 얹는다. 글자는 로고뿐이다(Play는 대표 그래픽에 글을 많이 넣지 말라고 권한다).
W, H = 1024, 500
art = Image.open(os.path.join(ROOT, 'art', 'title-wide.webp')).convert('RGB')
scale = W / art.width
art = art.resize((W, round(art.height * scale)), Image.LANCZOS)
top = round((art.height - H) * 0.55)
feature = art.crop((0, top, W, top + H)).convert('RGBA')

# 로고 뒤를 살짝 어둡게 해 읽히게 한다(왼쪽에서 오른쪽으로 옅어지는 그늘).
shade = Image.new('L', (W, H), 0)
for x in range(W):
    a = max(0, 150 - int(x * 150 / (W * 0.55)))
    for y in range(H):
        shade.putpixel((x, y), a)
dark = Image.new('RGBA', (W, H), (6, 10, 12, 255))
feature = Image.composite(dark, feature, shade.filter(ImageFilter.GaussianBlur(20)))

logo = Image.open(os.path.join(ROOT, 'art', 'logo-wide.webp')).convert('RGBA')
lw = 470
logo = logo.resize((lw, round(logo.height * lw / logo.width)), Image.LANCZOS)
feature.alpha_composite(logo, (48, (H - logo.height) // 2 - 10))
feature.convert('RGB').save(os.path.join(OUT, 'feature-1024x500.png'), optimize=True)
print('ok', os.listdir(OUT))
