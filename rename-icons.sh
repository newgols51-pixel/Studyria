#!/bin/bash
# Run this once in your GitHub repo root to rename the numbered PNGs
# to the canonical icon names expected by manifest.json and index.html.
# Sizes detected: 72, 96, 128, 144, 152, 192(x2→any+maskable), 384, 512(x3→any+maskable+extra)

# Map by pixel size — adjust source filenames to match YOUR repo's actual names
# (the filenames below match the upload order from the build):
mv 110952.png icon-72.png        2>/dev/null || true
mv 110953.png icon-96.png        2>/dev/null || true
mv 110954.png icon-128.png       2>/dev/null || true
mv 110955.png icon-144.png       2>/dev/null || true
mv 110956.png icon-152.png       2>/dev/null || true
mv 110957.png icon-192.png       2>/dev/null || true
mv 110958.png icon-384.png       2>/dev/null || true
mv 110959.png icon-512.png       2>/dev/null || true
mv 110960.png icon-maskable-192.png  2>/dev/null || true
mv 110961.png icon-maskable-512.png  2>/dev/null || true
# 110951.png is a 512×512 duplicate — keep as icon-512-alt.png or delete
mv 110951.png icon-512-alt.png   2>/dev/null || true

echo "Done. Commit and push all icon-*.png files to your repo root."
