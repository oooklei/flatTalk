import time, json, urllib.request, urllib.error, http.cookiejar

BASE = 'http://43.138.143.130:9015'; USER = 'admin@nuwax.com'; PASS = '123456'; SPACE = 23
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

print('GEN_1177', post('/api/knowledge/document/doc/generateEmbeddings/1177'))
print('GEN_1178', post('/api/knowledge/document/doc/generateEmbeddings/1178'))
time.sleep(25)
for kb in [179, 181]:
    body = post('/api/knowledge/document/list', {'kbId': kb, 'pageNo': 1, 'pageSize': 20})
    docs = (body.get('data', {}) or {}).get('records') or body.get('records') or []
    for d in docs:
        if str(d.get('id')) in ('1177', '1178'):
            print('STATUS', d.get('id'), 'docStatus=', d.get('docStatus'), 'hasEmbedding=', d.get('hasEmbedding'), 'pubStatus=', d.get('pubStatus'))
