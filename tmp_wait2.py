import json, urllib.request, http.cookiejar

BASE = 'http://43.138.143.130:9015'; USER = 'admin@nuwax.com'; PASS = '123456'
cj = http.cookiejar.CookieJar(); opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
opener.open(urllib.request.Request(BASE + '/api/user/passwordLogin',
    data=json.dumps({'phoneOrEmail': USER, 'emailOrPhone': USER, 'username': USER, 'password': PASS}, ensure_ascii=False).encode('utf-8'),
    method='POST', headers={'Content-Type': 'application/json'}))

def post(path, payload=None):
    data = json.dumps(payload or {}, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(BASE + path, data=data, method='POST', headers={'Content-Type': 'application/json'})
    try:
        r = opener.open(req, timeout=60); return json.loads(r.read().decode('utf-8', 'ignore'))
    except urllib.error.HTTPError as e:
        return e.read().decode('utf-8', 'ignore')

for kb, did in [(179, 1179), (179, 1177), (181, 1178)]:
    body = post('/api/knowledge/document/list', {'kbId': kb, 'pageNo': 1, 'pageSize': 30})
    docs = (body.get('data', {}) or {}).get('records') or body.get('records') or []
    for d in docs:
        if str(d.get('id')) == str(did):
            print(f'{kb}/{did}', d.get('docStatus'), d.get('hasEmbedding'), d.get('pubStatus'))
