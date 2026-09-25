#!/bin/zsh
# Run from the repo root after `git merge --no-ff <agent-branch>` conflicts in DECISIONS.md
# (or when a merged branch left D-XXX placeholders). Keeps both sides, strips conflict
# markers (incl. zdiff3 base sections), then numbers D-XXX entries sequentially.
# Check the result with `grep -n '^## D-' DECISIONS.md` (the script prints it).
f=DECISIONS.md
# Drop zdiff3 base sections (between ||||||| and =======), then all marker lines.
awk '/^\|\|\|\|\|\|\|/{skip=1; next} /^=======/{skip=0; next} /^(<<<<<<<|>>>>>>>)/{next} !skip{print}' $f > $f.tmp && mv $f.tmp $f
n=$(grep -oE '^## D-[0-9]+' $f | sed 's/## D-//' | sort -n | tail -1)
while grep -q '^## D-XXX' $f; do
  n=$((10#$n + 1)); num=$(printf '%03d' $n)
  awk -v num="$num" '!done && /^## D-XXX/ { sub(/D-XXX( \([a-z-]+\))?/, "D-" num); done=1 } { print }' $f > $f.tmp && mv $f.tmp $f
done
grep -n '^## D-' $f
