# 처음 화면 그림(art/title-wide.webp·title-tall.webp)의 흐린 미리보기(LQIP)를 만든다. 결과 base64를 style.css의
# .title-art::before(가로)와 세로 화면 묶음의 같은 규칙에 붙여 넣는다. 처음 화면 그림을 바꾸면 이것도 다시 만든다.
#   python -X utf8 tools/art/lqip.py
import base64
import io
import pathlib

from PIL import Image

ART = pathlib.Path(__file__).resolve().parents[2] / 'art'

for name, size in [('title-wide', (32, 18)), ('title-tall', (18, 32))]:
    img = Image.open(ART / f'{name}.webp').convert('RGB').resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'WEBP', quality=60, method=6)
    print(f'{name} ({len(buf.getvalue())} B):')
    print(f'url("data:image/webp;base64,{base64.b64encode(buf.getvalue()).decode()}")')
