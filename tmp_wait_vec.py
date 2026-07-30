import time, json, urllib.request, urllib.error, http.cookiejar

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

def status(kb, doc_id):
    body = post('/api/knowledge/document/list', {'kbId': kb, 'pageNo': 1, 'pageSize': 20})
    docs = (body.get('data', {}) or {}).get('records') or body.get('records') or []
    for d in docs:
        if str(d.get('id')) == str(doc_id):
            return d.get('docStatus'), d.get('hasEmbedding'), d.get('pubStatus')
    return None, None, None

def query(collection, q):
    b = post('/api/knowledge/query', {'collection': collection, 'query': q, 'top_k': 3, 'space': SPACE, 'agentId': AGENT})
    return (b.get('data', {}) or {}).get('matches') or b.get('matches') or []

print('BEFORE 1177', status(179, 1177))
post('/api/knowledge/document/doc/generateEmbeddings/1177')
post('/api/knowledge/document/doc/generateEmbeddings/1178')
time.sleep(60)
print('AFTER60 1177', status(179, 1177))
print('AFTER60 1178', status(181, 1178))
print('QUERY_179', [(m.get('title'), m.get('score')) for m in query('广西养老政策知识库', '身份证户口本到社区居委会办理')][:3])
