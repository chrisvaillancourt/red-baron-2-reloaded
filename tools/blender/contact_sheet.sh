#!/bin/zsh
# Build preview contact sheets from tools/blender/out/previews (views a+b per
# aircraft, 4 aircraft per sheet) -> tools/blender/out/sheet_N.png
cd "${0:A:h}/out/previews" || exit 1
font=/System/Library/Fonts/Supplemental/Arial.ttf
ids=(${(f)"$(ls *_a.png | sed 's/_a.png//')"})
n=0; sheet=0; rows=()
for id in $ids; do
  magick ${id}_a.png ${id}_b.png -resize 50% +append -font $font -fill black -pointsize 18 -annotate +8+22 "$id" ../row_$id.png
  rows+=(../row_$id.png); n=$((n+1))
  if (( n % 4 == 0 )); then magick $rows -append ../sheet_$sheet.png; rows=(); sheet=$((sheet+1)); fi
done
(( ${#rows} )) && magick $rows -append ../sheet_$sheet.png
rm -f ../row_*.png
ls ../sheet_*.png
