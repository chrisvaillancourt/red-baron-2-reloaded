#!/bin/zsh
# Final key-art renders (Cycles, Metal): public/art/{title,menu-aerodrome,briefing-desk,debrief-sky}.jpg
# Usage: tools/blender/render_art.sh [samples] [scene...]
here=${0:A:h}
samples=${1:-160}
shift 2>/dev/null
scenes=("$@"); (( ${#scenes} )) || scenes=(title aerodrome desk debrief)
node --experimental-strip-types $here/../export-aircraft-json.ts || exit 1
for s in $scenes; do
  echo "== $s"
  blender --background --factory-startup --python-exit-code 1 --python $here/art.py -- --scene $s --res 1920 --samples $samples 2>&1 | grep -E "RENDERED|Error|Traceback"
done
