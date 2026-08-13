#!/bin/bash
# 测试不同 H5 路由是否需要登录
for route in "pages/sojourn/planner" "pages/list" "pages/sojourn/plan" "pages/index"; do
  CODE=$(curl -sk -o /dev/null -w '%{http_code}' "https://lvjutest.jtdcn.cn/h5/#/$route" 2>&1)
  echo "$route → HTTP $CODE"
done

echo ""
echo "=== 测试 planner 是否需要 orgCode ==="
curl -sk 'https://lvjutest.jtdcn.cn/h5/assets/pages-sojourn-planner*' -o /dev/null -w '%{http_code}' 2>&1
echo ""

# 找 planner JS 文件名
curl -sk 'https://lvjutest.jtdcn.cn/h5/assets/index-BIMQ04br.js' 2>&1 | grep -oP 'pages-sojourn-planner[^"]+' | head -3
