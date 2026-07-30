#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 knowledge_docs 政策文件上传到 43 远程女娲知识库并解析。
  - knowledge_docs/ (除 ai膳食)         -> 广西养老政策知识库 (kbId=179)
  - knowledge_docs/ai膳食 (政策/营养文件) -> 膳食知识库 (kbId=181)

使用女娲平台正确 API:
  - POST /api/knowledge/document/customAdd  { kbId, name, fileContent, autoSegmentConfigFlag:true }
    (文本接口，平台自动切片+向量化；docx/xlsx 本地用 python-docx/openpyxl 转文本)
  - POST /api/knowledge/document/doc/generateEmbeddings/{docId}  (重试触发向量化)
  - POST /api/knowledge/query  验证可搜
"""
import os, sys, json, time, glob, urllib.request, urllib.error, http.cookiejar

BASE = os.environ.get('FLATTALK_KB_BASE_URL', 'http://43.138.143.130:9015')
USER = os.environ.get('FLATTALK_KB_USERNAME', 'admin@nuwax.com')
PASS = os.environ.get('FLATTALK_KB_PASSWORD', '123456')
SPACE = int(os.environ.get('FLATTALK_KB_SPACE', '23'))
AGENT = os.environ.get('FLATTALK_KB_AGENT_ID', '373')

ROOT = r'd:\GuiCare\knowledge_docs'
POLICY_KB = 179
DIET_KB = 181
DIET_EXCLUDE = {'后端认证接口规范.md', '数据库表结构与接口文档.md', '202607071156.csv', '202607071156.xlsx'}

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def api_post(path, payload=None, timeout=120):
    data = json.dumps(payload or {}, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(BASE + path, data=data, method='POST',
                                 headers={'Content-Type': 'application/json'})
    try:
        r = opener.open(req, timeout=timeout)
        return r.status, json.loads(r.read().decode('utf-8', 'ignore'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8', 'ignore'))
        except Exception:
            return e.code, {'message': e.reason}
    except Exception as e:
        return -1, {'message': str(e)}

def login():
    st, b = api_post('/api/user/passwordLogin', {
        'phoneOrEmail': USER, 'emailOrPhone': USER, 'username': USER, 'password': PASS})
    if st != 200 or not (b.get('data') or b.get('success')):
        raise RuntimeError(f'login failed: {st} {b}')
    print('[login] ok')

def extract_docx(path):
    import docx
    d = docx.Document(path)
    parts = [p.text for p in d.paragraphs if p.text.strip()]
    for t in d.tables:
        for row in t.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                parts.append(' | '.join(cells))
    return '\n'.join(parts)

def extract_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    out = []
    for ws in wb.worksheets:
        out.append(f'# 表：{ws.title}')
        for row in ws.iter_rows(values_only=True):
            cells = [str(c).strip() for c in row if c is not None and str(c).strip()]
            if cells:
                out.append(' | '.join(cells))
    return '\n'.join(out)

def extract_file(path):
    low = path.lower()
    if low.endswith('.docx'):
        return extract_docx(path)
    if low.endswith('.xlsx') or low.endswith('.xls'):
        return extract_xlsx(path)
    if low.endswith('.txt') or low.endswith('.md'):
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
    return None

def custom_add(kb_id, name, content):
    return api_post('/api/knowledge/document/customAdd', {
        'kbId': kb_id, 'name': name, 'fileContent': content, 'autoSegmentConfigFlag': True})

def trigger_embed(doc_id):
    return api_post(f'/api/knowledge/document/doc/generateEmbeddings/{doc_id}')

def doc_status(kb_id, doc_id):
    st, b = api_post('/api/knowledge/document/list', {'kbId': kb_id, 'pageNo': 1, 'pageSize': 50})
    docs = (b.get('data', {}) or {}).get('records') or b.get('records') or []
    for d in docs:
        if str(d.get('id')) == str(doc_id):
            return d.get('docStatus'), d.get('hasEmbedding'), d.get('pubStatus')
    return None, None, None

def query_collection(collection, q):
    st, b = api_post('/api/knowledge/query', {
        'collection': collection, 'query': q, 'top_k': 3, 'space': SPACE, 'agentId': AGENT})
    return (b.get('data', {}) or {}).get('matches') or b.get('matches') or []

def iter_policy_files():
    for root, dirs, files in os.walk(ROOT):
        if 'ai膳食' in root.replace('\\', '/').split('/'):
            continue
        for f in files:
            low = f.lower()
            if low.endswith(('.docx', '.xlsx', '.xls', '.txt', '.md')):
                yield os.path.join(root, f), POLICY_KB, '广西养老政策知识库'

def iter_diet_files():
    d = os.path.join(ROOT, 'ai膳食')
    for f in sorted(os.listdir(d)):
        if f in DIET_EXCLUDE:
            continue
        low = f.lower()
        if low.endswith(('.docx', '.xlsx', '.xls')):
            yield os.path.join(d, f), DIET_KB, '膳食知识库'

def main():
    login()
    uploaded = []
    targets = list(iter_policy_files()) + list(iter_diet_files())
    print(f'[collect] {len(targets)} files to upload')
    for path, kb_id, kb_name in targets:
        try:
            content = extract_file(path)
        except Exception as e:
            print(f'[skip] {path}: extract error {e}')
            continue
        if not content or len(content.strip()) < 20:
            print(f'[skip] {path}: empty/too short')
            continue
        name = os.path.basename(path)
        st, b = custom_add(kb_id, name, content)
        ok = (st == 200 and b.get('code') in (None, '0000', 0, '0')) or b.get('success')
        if not ok:
            print(f'[FAIL] {kb_name}/{name}: {st} {b}')
            continue
        doc_id = b.get('data') or b.get('id') or b.get('docId')
        uploaded.append((kb_name, name, doc_id))
        print(f'[UPLOAD] {kb_name}/{name} -> docId={doc_id} (chars={len(content)})')
        # 重试触发向量化
        trigger_embed(doc_id)
    # 汇总（向量化状态异步，交由复查脚本统一确认）
    print('\n==== UPLOAD SUMMARY ====')
    print(f'uploaded={len(uploaded)} (all triggered embedding)')
    for kb_name, name, doc_id in uploaded:
        print(f'  {kb_name} | {name} | docId={doc_id}')

if __name__ == '__main__':
    main()
