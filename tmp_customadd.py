import json, time, urllib.request, urllib.error, http.cookiejar

BASE = 'http://43.138.143.130:9015'
USER = 'admin@nuwax.com'
PASS = '123456'
SPACE = 23
AGENT = '373'
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

lr = opener.open(urllib.request.Request(
    BASE + '/api/user/passwordLogin',
    data=json.dumps({'phoneOrEmail': USER, 'emailOrPhone': USER, 'username': USER, 'password': PASS}, ensure_ascii=False).encode('utf-8'),
    method='POST', headers={'Content-Type': 'application/json'}))
print('LOGIN', lr.status)

def post(path, payload):
    req = urllib.request.Request(BASE + path,
        data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        method='POST', headers={'Content-Type': 'application/json'})
    try:
        r = opener.open(req, timeout=60)
        return r.status, json.loads(r.read().decode('utf-8', 'ignore'))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'ignore')

def custom_add(kb_id, name, content):
    return post('/api/knowledge/document/customAdd',
                {'kbId': kb_id, 'name': name, 'fileContent': content, 'autoSegmentConfigFlag': True})

def query(collection, q):
    _, body = post('/api/knowledge/query',
        {'collection': collection, 'query': q, 'top_k': 3, 'filter': {}, 'min_score': 0, 'spaceId': SPACE, 'agentId': AGENT})
    return (body.get('data', {}) or {}).get('matches') or body.get('matches') or []

# 政策库 179
r = custom_add(179, f'zzz_TEST_179_{int(time.time())}',
               '广西高龄津贴：年满80周岁可申领高龄津贴，需身份证户口本银行卡到社区居委会办理。')
print('ADD179', r[0], str(r[1])[:200])
time.sleep(3)
print('QUERY179', [(m.get('title') or m.get('name'), m.get('score')) for m in query('广西养老政策知识库', '高龄津贴')][:3])

# 膳食库 181
r2 = custom_add(181, f'zzz_TEST_181_{int(time.time())}',
                '低盐膳食：高血压老人宜食芹菜、海带、黑木耳，每日摄盐不超过5克，少食腌制食品。')
print('ADD181', r2[0], str(r2[1])[:200])
time.sleep(3)
print('QUERY181', [(m.get('title') or m.get('name'), m.get('score')) for m in query('膳食知识库', '高血压低盐饮食')][:3])
