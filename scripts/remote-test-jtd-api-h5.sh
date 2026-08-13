#!/bin/bash
curl -sk -X POST 'https://lvjutest.jtdcn.cn/jtd-applet/ai/sojourn/searchProducts' \
  -H 'Content-Type: application/json' \
  -H 'X-AI-App-Id: ai_test_app' \
  -H 'X-AI-App-Secret: XF0OWMyGqoRDC6_QNCYTHMMdUfEGWQV6UtuZ74RFQ0I' \
  -d '{"tenantId":"042788","productDomain":"sojourn_route","pageSize":3}' \
  > /tmp/jtd_api.json 2>&1

python3 << 'PYEOF'
import json
with open('/tmp/jtd_api.json') as f:
    raw = f.read()
try:
    d = json.loads(raw)
except:
    print('NOT JSON, first 200 chars:', raw[:200])
    exit()

# Print structure
print('Top keys:', list(d.keys()))
data = d.get('data')
print('data type:', type(data).__name__)
if isinstance(data, dict):
    print('data keys:', list(data.keys()))
    items = data.get('list') or data.get('records') or []
elif isinstance(data, list):
    items = data
else:
    items = []

print(f'items count: {len(items)}')
for i in items[:3]:
    name = i.get('productName','')
    pid = i.get('productId','')
    # Check all keys that might contain h5/url
    url_keys = {k:v for k,v in i.items() if 'h5' in k.lower() or 'url' in k.lower() or 'handoff' in k.lower()}
    print(f'\n  {name} ({pid})')
    if url_keys:
        for k,v in url_keys.items():
            print(f'    {k}: {v}')
    else:
        print(f'    (no h5/url keys)')
        print(f'    all keys: {list(i.keys())}')
PYEOF
