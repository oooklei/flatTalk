#!/bin/bash
curl -sk 'https://lvjutest.jtdcn.cn/h5/assets/index-BIMQ04br.js' > /tmp/h5main.js 2>&1

echo "=== pages paths ==="
grep -oP 'pages/[a-z_/]+[a-z]' /tmp/h5main.js | sort -u

echo ""
echo "=== order index redirect? ==="
grep -oP '.{0,60}order/index.{0,60}' /tmp/h5main.js | head -3

echo ""
echo "=== product detail? ==="
grep -oP '.{0,60}product.{0,60}' /tmp/h5main.js | head -5

echo ""
echo "=== pages.json config ==="
grep -oP '"root"\s*:\s*"[^"]*"' /tmp/h5main.js | sort -u
grep -oP '"pagePath"\s*:\s*"[^"]*"' /tmp/h5main.js | sort -u
