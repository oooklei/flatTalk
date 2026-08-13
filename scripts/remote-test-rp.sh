#!/bin/bash
sleep 2
echo "=== route-planning degraded test ==="
curl -sk 'https://localhost:5445/api/map/route-planning?from=25.2619,110.29&to=25.2181,110.0389&via=25.2622,110.298;25.27,110.287;24.7736,110.4887&policy=1' > /tmp/rp.json 2>&1
python3 << 'PYEOF'
import json
with open('/tmp/rp.json') as f:
    d = json.load(f)
print('ok:', d.get('ok'))
print('degraded:', d.get('degraded'))
print('source:', d.get('source'))
print('points:', len(d.get('polyline', [])))
if d.get('degraded') and len(d.get('polyline',[])) >= 2:
    print('✅ 降级直线连线正常')
elif not d.get('degraded') and d.get('source') == 'tencent_map':
    print('✅ 腾讯实时路线正常')
else:
    print('❌ 异常')
PYEOF
