#!/bin/sh
# Renders every printed part to stl/ and a preview to png/, plus the ballast DXF.
# Needs OpenSCAD on the PATH (brew install --cask openscad@snapshot --appdir=~/Applications).
set -e
cd "$(dirname "$0")"
O=${OPENSCAD:-openscad}
mkdir -p stl png
for p in carrier pod outrigger micbar pirwedge sled coupon shims; do
  "$O" -q -D "part=\"$p\"" --export-format binstl -o "stl/$p.stl" rig.scad
  "$O" -q -D "part=\"$p\"" -o "png/$p.png" --imgsize=1200,900 --colorscheme=Tomorrow --autocenter --viewall --projection=p --camera=0,0,0,55,0,135,500 rig.scad
  echo "$p"
done
"$O" -q -D 'part="ballast2d"' -o ballast.dxf rig.scad
"$O" -q -D 'part="ballast"' -o png/ballast.png --imgsize=800,800 --colorscheme=Tomorrow --autocenter --viewall --camera=0,0,0,0,0,0,400 rig.scad
# the whole rig from three sides
"$O" -q -o png/assembly-iso.png   --imgsize=1600,1200 --colorscheme=Tomorrow --autocenter --viewall --projection=p --camera=0,0,0,60,0,135,900 rig.scad
"$O" -q -o png/assembly-side.png  --imgsize=1600,1200 --colorscheme=Tomorrow --autocenter --viewall --projection=o --camera=0,0,0,90,0,180,900 rig.scad
"$O" -q -o png/assembly-front.png --imgsize=1600,1200 --colorscheme=Tomorrow --autocenter --viewall --projection=o --camera=0,0,0,90,0,90,900 rig.scad
"$O" -q -o png/assembly-below.png --imgsize=1600,1200 --colorscheme=Tomorrow --autocenter --viewall --projection=p --camera=0,0,0,125,0,120,900 rig.scad
echo done
