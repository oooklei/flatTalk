import json, urllib.request, urllib.error, http.cookiejar

BASE = 'http://43.138.143.130:9015'; USER = 'admin@nuwax.com'; PASS = '123456'; SPACE = 23; AGENT = '373'
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

def query(collection, q):
    b = post('/api/knowledge/query', {'collection': collection, 'query': q, 'top_k': 5, 'space': SPACE, 'agentId': AGENT})
    return (b.get('data', {}) or {}).get('matches') or b.get('matches') or []

print('Q_policy', [(m.get('title'), round(m.get('score', 0), 3)) for m in query('广西养老政策知识库', '养老服务人才队伍建设')])
print('Q_diet', [(m.get('title'), round(m.get('score', 0), 3)) for m in query('膳食知识库', 'AI膳食需求')])
