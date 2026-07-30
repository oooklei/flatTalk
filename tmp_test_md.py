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

def custom_add(kb_id, name, content, flag=True):
    return post('/api/knowledge/document/customAdd', {'kbId': kb_id, 'name': name, 'fileContent': content, 'autoSegmentConfigFlag': flag})

def status(kb, doc_id):
    body = post('/api/knowledge/document/list', {'kbId': kb, 'pageNo': 1, 'pageSize': 30})
    docs = (body.get('data', {}) or {}).get('records') or body.get('records') or []
    for d in docs:
        if str(d.get('id')) == str(doc_id):
            return d.get('docStatus'), d.get('hasEmbedding'), d.get('pubStatus')
    return None, None, None

md = '''# 广西高龄津贴政策说明

根据广西壮族自治区老年人福利政策，年满80周岁的老年人可申领高龄津贴。

## 申请条件
具有广西壮族自治区户籍、年满80周岁的老年人可自愿申请高龄津贴。

## 申请材料
申请人需提供身份证、户口本、银行卡及近期免冠照片。

## 办理流程
携带上述材料到户籍所在地社区居委会提交申请，经审核、公示后按月发放至本人银行账户。
'''
r = custom_add(179, f'zzz_MD_{int(time.time())}', md)
print('ADD_MD', r.get('code'), 'docid=', r.get('data'))
docid = r.get('data')
time.sleep(60)
print('STATUS_MD', status(179, docid))
