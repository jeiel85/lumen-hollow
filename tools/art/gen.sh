#!/bin/bash
# 코덱스 이미지 생성 한 장: gen.sh <이름> <프롬프트 파일> [참고 이미지...]
# 결과는 raw/<이름>.png, 코덱스 출력은 logs/<이름>.log
set -u
ART="$(cd "$(dirname "$0")" && pwd -W)"
name=$1; pf=$2; shift 2
mkdir -p "$ART/raw" "$ART/logs"
refs=()
for r in "$@"; do refs+=(-i "$r"); done
{
  echo "You are producing game art. Use your built-in image generation tool exactly once to create ONE image from the prompt below."
  echo "Pass the prompt to the tool verbatim (you may only add the size/aspect parameter). Do not write files, do not run shell commands or code."
  echo "When the image is generated, reply with the single word: done"
  echo
  echo "PROMPT:"
  cat "$pf"
} > "$ART/logs/$name.prompt.txt"
codex exec --skip-git-repo-check -s read-only -C "$ART" "${refs[@]}" - < "$ART/logs/$name.prompt.txt" > "$ART/logs/$name.log" 2>&1
sid=$(grep -o -m1 'session id: [0-9a-f-]*' "$ART/logs/$name.log" | awk '{print $3}')
dir="$HOME/.codex/generated_images/$sid"
if [ -z "$sid" ] || [ ! -d "$dir" ]; then echo "FAIL $name (session '$sid', 이미지 폴더 없음)"; tail -20 "$ART/logs/$name.log"; exit 1; fi
f=$(ls -t "$dir"/*.png 2>/dev/null | head -1)
[ -n "$f" ] || { echo "FAIL $name (png 없음)"; exit 1; }
cp "$f" "$ART/raw/$name.png"
python -c "from PIL import Image; im=Image.open(r'$ART/raw/$name.png'); print('OK $name', im.size)"
