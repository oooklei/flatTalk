import json, time, urllib.request, urllib.error, http.cookiejar

BASE = 'http://43.138.143.130:9015'
USER = 'admin@nuwax.com'; PASS = '123456'; SPACE = 23; AGENT = '373'
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
opener.open(urllib.request.Request(BASE + '/api/user/passwordLogin',
    data=json.dumps({'phoneOrEmail': USER, 'emailOrEmail': USER, 'username': USER, 'password': PASS}, ensure_ascii=False).encode('utf-8'),
    method='POST', headers={'Content-Type': 'application/json'}))

def post(path, payload):
    req = urllib.request.Request(BASE + path,
        data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        method='POST', headers={'Content-Type': 'application/json'})
    try:
        r = opener.open(req, timeout=60); return json.loads(r.read().decode('utf-8', 'ignore'))
    except urllib.error.HTTPError as e:
        return e.read().decode('utf-8', 'ignore')

def query(collection, q):
    body = post('/api/knowledge/query', {'collection': collection, 'query': q, 'top_k': 3, 'filter': {}, 'min_score': 0, 'spaceId': SPACE, 'agentId': AGENT})
    return (body.get('data', {}) or {}).get('matches') or body.get('matches') or []

# 1. query 预存内容（验证接口）
print('PRE_QUERY_179', [(m.get('title') or m.get('name'), round(m.get('score', 0), 3)) for m in query('广西养老政策知识库', '养老政策')][:3])
# 2. 新文档状态
print('STATUS_docId', post('/api/knowledge/document/queryDocStatus', {'docId': 1177}))
print('STATUS_id', post('/api/knowledge/document/queryDocStatus', {'id': 1177}))
