import json, urllib.request, urllib.error, http.cookiejar

BASE = 'http://43.138.143.130:9015'
USER = 'admin@nuwax.com'; PASS = '123456'; SPACE = 23
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
opener.open(urllib.request.Request(BASE + '/api/user/passwordLogin',
    data=json.dumps({'phoneOrEmail': USER, 'emailOrPhone': USER, 'username': USER, 'password': PASS}, ensure_ascii=False).encode('utf-8'),
    method='POST', headers={'Content-Type': 'application/json'}))

def post(path, payload):
    req = urllib.request.Request(BASE + path,
        data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        method='POST', headers={'Content-Type': 'application/json'})
    try:
        r = opener.open(req, timeout=60); return json.loads(r.read().decode('utf-8', 'ignore'))
    except urllib.error.HTTPError as e:
        return e.read().decode('utf-8', 'ignore')

# 列出政策库 179 的文档，找 1177 的状态
body = post('/api/knowledge/document/list', {'kbId': 179, 'pageNo': 1, 'pageSize': 20})
docs = (body.get('data', {}) or {}).get('records') or body.get('records') or []
print('LIST179 count=', len(docs))
for d in docs:
    if str(d.get('id')) in ('1177', '1178') or 'zzz_TEST' in str(d.get('name', '')):
        print('DOC', json.dumps(d, ensure_ascii=False)[:500])
