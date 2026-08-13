#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import os
import re
import urllib.error
import urllib.request
import http.cookiejar
from pathlib import Path

import pdfplumber

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_PATH = PROJECT_ROOT / 'src/skills/health_risk_warning/knowledge/interface_cache/yunzhen-shezhen_index.json'
KNOWLEDGE_DOCS_DIR = PROJECT_ROOT / 'src/skills/health_risk_warning/knowledge_docs'
DATA_DIR = PROJECT_ROOT / 'data/shezhen_reports'

KB_BASE = os.environ.get('FLATTALK_KB_BASE_URL', 'http://43.138.143.130:9015').rstrip('/')
KB_USER = os.environ.get('FLATTALK_KB_USERNAME', 'admin@nuwax.com')
KB_PASS = os.environ.get('FLATTALK_KB_PASSWORD', '123456')
KB_SPACE = int(os.environ.get('FLATTALK_KB_SPACE', '23'))
KB_ID = int(os.environ.get('FLATTALK_HEALTH_RISK_KB_ID', '175'))
KB_COLLECTION = os.environ.get('FLATTALK_HEALTH_RISK_KB_COLLECTION', 'health_risk_warning_business_kb')


DISEASE_NAMES = [
    '精神压力评估',
    '心血管功能评估',
    '中风风险评估',
    '骨质疏松症风险评估',
    '肺结节风险评估',
    '乳腺结节风险评估',
    '甲状腺结节风险评估',
    '脂肪肝风险评估',
    '关节炎、颈椎或腰椎风险评估',
    '肾功能风险评估',
]


def read_cache():
    return json.loads(CACHE_PATH.read_text(encoding='utf-8'))


def write_cache(records):
    CACHE_PATH.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')


def download(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size > 0:
      return
    req = urllib.request.Request(url, headers={'User-Agent': 'flatTalk-yunzhen-pdf-sync/1.0'})
    with urllib.request.urlopen(req, timeout=60) as response:
        target.write_bytes(response.read())


def extract_pdf(pdf_path):
    page_texts = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for i, page in enumerate(pdf.pages, 1):
            text = (page.extract_text() or '').strip()
            page_texts.append({'page': i, 'text': text})
    full_text = '\n\n'.join([f"--- page {p['page']} ---\n{p['text']}" for p in page_texts if p['text']])
    return page_texts, full_text


def between(text, start, end=None):
    s = text.find(start)
    if s < 0:
        return ''
    s += len(start)
    e = text.find(end, s) if end else -1
    return text[s:e if e >= 0 else len(text)].strip()


def find_match(pattern, text, default=''):
    m = re.search(pattern, text, re.S | re.M)
    if not m:
        return default
    return (m.group(1) if m.lastindex else m.group(0)).strip()


def parse_metadata(text):
    page1 = between(text, '--- page 1 ---', '--- page 2 ---')
    lines = [line.strip() for line in page1.splitlines() if line.strip()]
    name = ''
    for i, line in enumerate(lines):
        if '中医人工智能体质检测报告' in line and i + 1 < len(lines):
            name = lines[i + 1]
            break
    return {
        'title': '中医人工智能体质检测报告',
        'issuer': '安徽中医药大学 AI健康云诊',
        'name': name,
        'age': find_match(r'年龄[:：]\s*(\d+)', page1),
        'sex': find_match(r'性别[:：]\s*([男女])', page1),
        'phone': find_match(r'联系电话[:：]\s*([0-9]+)', page1),
        'report_date': find_match(r'报告时间[:：]\s*([0-9-]+)', page1),
    }


def parse_health_summary(text):
    section = between(text, '（一）健康体检结果', '（二）主要表现')
    state = find_match(r'健康状态\s+(.+)', section)
    mechanism = find_match(r'发生机制\s+(.+)', section)
    health_index = find_match(r'(\d+(?:\.\d+)?)\s*分', section)
    status = find_match(r'属于(.+?状态.*?)\n', section)

    overview = []
    for name in DISEASE_NAMES:
        m = re.search(re.escape(name) + r'\s+([轻中高度]+风险)', section)
        if m:
            overview.append({'name': name, 'risk_level': m.group(1)})

    meridian_overview = []
    for line in section.splitlines():
        m = re.search(r'((?:手|足).+?经（偏[虚实]）)\s+(-?\d+(?:\.\d+)?)', line)
        if m:
            meridian_overview.append({'name': m.group(1), 'score': float(m.group(2))})

    return {
        'health_state': state,
        'occurrence_mechanism': mechanism,
        'health_index': float(health_index) if health_index else None,
        'risk_status': status,
        'risk_overview': overview,
        'abnormal_meridian_overview': meridian_overview,
    }


def parse_main_manifestations(text):
    section = between(text, '（二）主要表现', '（三）易患病症')
    return [line.strip('。 ') for line in section.splitlines() if line.strip()]


def parse_disease_details(text):
    section = between(text, '（三）易患病症', '（四）异常经络')
    details = []
    for i, name in enumerate(DISEASE_NAMES):
        next_names = [re.escape(n) + r'\(' for n in DISEASE_NAMES[i + 1:]]
        end_pattern = '|'.join(next_names) if next_names else r'$'
        pattern = re.escape(name) + r'\(([^)]+)\)(.*?)(?=' + end_pattern + r')'
        m = re.search(pattern, section, re.S)
        if not m:
            continue
        block = m.group(2).strip()
        definition = between(block, '', '风险等级')
        expert = between(block, 'AI专家解读', '健康建议')
        advice = between(block, '健康建议')
        details.append({
            'name': name,
            'risk_level': m.group(1).strip(),
            'definition': re.sub(r'\s+', ' ', definition).strip(),
            'ai_expert_interpretation': re.sub(r'\s+', ' ', expert).strip(),
            'health_advice': re.sub(r'\s+', ' ', advice).strip(),
        })
    return details


def parse_meridians(text):
    section = between(text, '（四）异常经络', '（五）病理因素定量评估')
    matches = list(re.finditer(r'((?:手|足).+?经（偏[虚实]）)\s+(-?\d+(?:\.\d+)?)', section))
    out = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(section)
        desc = re.sub(r'\s+', ' ', section[start:end]).strip()
        out.append({'name': m.group(1), 'score': float(m.group(2)), 'interpretation': desc})
    return out


def parse_known_result_standard_table(section, known_values):
    table = {}
    lines = [line.strip() for line in section.splitlines() if line.strip()]
    for key, values in known_values.items():
        line = next((item for item in lines if item.startswith(key + ' ')), '')
        if not line:
            continue
        rest = line[len(key):].strip()
        detected = ''
        standard = ''
        for value in sorted(values, key=len, reverse=True):
            if rest.startswith(value):
                detected = value
                standard = rest[len(value):].strip()
                break
        if not detected:
            parts = rest.split()
            detected = parts[0] if parts else ''
            standard = ' '.join(parts[1:])
        table[key] = {'detected': detected, 'standard': standard}
    return table


def parse_pathology_and_solar_term(text):
    section = between(text, '（五）病理因素定量评估', '二、舌象辨识')
    solar = find_match(r'当前节气[:：]\s*(\S+)\s+患病风险[:：]\s*(\S+)', section)
    risk = ''
    m = re.search(r'当前节气[:：]\s*(\S+)\s+患病风险[:：]\s*(\S+)', section)
    if m:
        solar, risk = m.group(1), m.group(2)
    return {
        'pathology_factor': {
            'level': find_match(r'(湿[ⅠⅡⅢⅣ]级)', section),
            'description': find_match(r'湿[ⅠⅡⅢⅣ]级\s*(.+?)(?:（六）节气风险|$)', section),
        },
        'solar_term_risk': {
            'solar_term': solar,
            'risk': risk,
            'tips': find_match(r'提示[:：]\s*(.+)', section),
        },
    }


def parse_tongue(text):
    start = text.find('二、舌象辨识', text.find('--- page 10 ---'))
    end = text.find('三、面部望诊', start)
    section = text[start:end if end >= 0 else len(text)] if start >= 0 else ''
    known = {
        '舌色': ['淡红舌', '红舌', '淡白舌', '紫舌', '绛舌'],
        '苔色': ['白苔', '黄苔', '灰苔', '黑苔'],
        '舌形': ['齿痕(+)', '正常', '胖大', '瘦薄', '裂纹'],
        '苔质': ['厚苔(↑)', '薄苔', '腻苔', '少苔'],
        '津液': ['润', '燥'],
        '舌下脉络': ['舌下正常', '舌下异常'],
    }
    table = parse_known_result_standard_table(section, known)
    return {
        'image_collection': ['舌面', '舌下'] if '舌面' in section else [],
        'analysis_table': table,
        'tongue_color_area_percent': find_match(r'舌色面积[:：]\s*([0-9.]+%)', section),
        'moss_color_area_percent': find_match(r'苔色面积[:：]\s*([0-9.]+%)', section),
        'abnormal_items': {
            'tooth_marks': {
                'current': find_match(r'齿痕.*?本次（(.+?)）', section),
                'previous': find_match(r'齿痕.*?上次（(.+?)）', section),
                'meaning': find_match(r'【齿痕】(.+?)【病理意义】', section),
                'pathological_meaning': find_match(r'【病理意义】(.+?)(?:苔轻度厚|风险预警)', section),
            },
            'thick_moss': {
                'current': find_match(r'厚薄.*?本次（(.+?)）', section),
                'previous': find_match(r'厚薄.*?上次（(.+?)）', section),
                'meaning': find_match(r'【厚苔】(.+?)【病理意义】', section),
                'pathological_meaning': find_match(r'【病理意义】(.+?)风险预警', section),
            },
        },
        'risk_warning': find_match(r'风险预警\s*(.+)', section),
    }


def parse_face(text):
    start = text.find('三、面部望诊', text.find('--- page 11 ---'))
    end = text.find('四、调理方案', start)
    section = text[start:end if end >= 0 else len(text)] if start >= 0 else ''
    known = {
        '面色': ['面色红黄隐隐，明润含蓄'],
        '光泽': ['少量(↓)', '正常'],
        '五色诊': ['正常色'],
        '两颧红': ['无', '有'],
        '眉间/鼻柱青色': ['无', '有'],
        '眼神': ['少神(↓)', '有神'],
        '黑眼圈': ['轻度(+)', '正常'],
        '目色': ['正常'],
        '鼻褶': ['无', '有'],
        '唇色': ['白(↓)', '正常'],
        '面部皮损': ['无', '有'],
    }
    table = parse_known_result_standard_table(section, known)
    abnormal = {}
    for key in ['光泽', '眼神', '黑眼圈', '唇色']:
        block = find_match(re.escape(key) + r'\s*(【.+?)(?=光泽|眼神|黑眼圈|唇色|四、调理方案|$)', section)
        if block:
            abnormal[key] = re.sub(r'\s+', ' ', block).strip()
    return {
        'image_collection': ['正面象'] if '正面象' in section else [],
        'analysis_table': table,
        'abnormal_items': abnormal,
    }


def parse_regimen(text):
    start = text.find('四、调理方案', text.find('--- page 12 ---'))
    section = text[start:] if start >= 0 else between(text, '四、调理方案')
    return {
        'medicated_food': {
            'raw_text': between(section, '（一）药食调理', '（二）穴位保健'),
            'items': [
                {'name': '佛手橘皮茶', 'category': '茶饮', 'raw_text': find_match(r'【组成】佛手5g.+?佛手橘皮茶', section)},
                {'name': '健脾祛湿方', 'category': '方剂', 'raw_text': find_match(r'【组成】党参6g.+?健脾祛湿方', section)},
                {'name': '二陈汤', 'category': '方剂', 'raw_text': find_match(r'【功效】燥湿化痰.+?二陈汤', section)},
            ],
        },
        'acupoint_healthcare': {
            'selected_points': re.findall(r'天枢穴|丰隆穴|承山穴|脾俞穴|中脘穴', between(section, '（二）穴位保健', '（三）膳食调养')),
            'method': find_match(r'【方法】(.+)', section),
            'raw_text': between(section, '（二）穴位保健', '（三）膳食调养'),
        },
        'dietary_regimen': {
            'recommended_foods': find_match(r'【宜食】(.+?)【忌食】', section),
            'avoid_foods': find_match(r'【忌食】(.+?)(?:山药冬瓜汤|$)', section),
            'recipes': [
                {'name': '山药冬瓜汤', 'raw_text': find_match(r'山药冬瓜汤(.+?)五苓粥', section)},
                {'name': '五苓粥', 'raw_text': find_match(r'五苓粥(.+?)（四）运动保健', section)},
            ],
        },
        'exercise': re.sub(r'\s+', ' ', between(section, '（四）运动保健', '（五）情志起居')).strip(),
        'emotion_and_lifestyle': re.sub(r'\s+', ' ', between(section, '（五）情志起居', '重要声明')).strip(),
        'disclaimer': find_match(r'重要声明[:：](.+)', section),
    }


def build_structured(record, page_texts, full_text, pdf_path, text_path):
    structured = {
        'report_id': record.get('id'),
        'source': 'yunzhen-shezhen-pdf',
        'pdf_url': record.get('pdfUrl') or record.get('signals', {}).get('pdfUrl'),
        'local_pdf_path': str(pdf_path.relative_to(PROJECT_ROOT)).replace('\\', '/'),
        'local_text_path': str(text_path.relative_to(PROJECT_ROOT)).replace('\\', '/'),
        'page_count': len(page_texts),
        'text_pages': len([p for p in page_texts if p['text']]),
        'text_chars': len(full_text),
        'metadata': parse_metadata(full_text),
        'health_analysis': {
            **parse_health_summary(full_text),
            'main_manifestations': parse_main_manifestations(full_text),
            'disease_details': parse_disease_details(full_text),
            'abnormal_meridians': parse_meridians(full_text),
            **parse_pathology_and_solar_term(full_text),
        },
        'tongue_diagnosis': parse_tongue(full_text),
        'face_observation': parse_face(full_text),
        'regimen_plan': parse_regimen(full_text),
        'pages': page_texts,
    }
    return structured


def md_table(rows, columns):
    out = ['|' + '|'.join(columns) + '|', '|' + '|'.join(['---'] * len(columns)) + '|']
    for row in rows:
        out.append('|' + '|'.join(str(row.get(c, '')).replace('\n', ' ') for c in columns) + '|')
    return '\n'.join(out)


def build_markdown(data):
    meta = data['metadata']
    health = data['health_analysis']
    tongue = data['tongue_diagnosis']
    face = data['face_observation']
    regimen = data['regimen_plan']
    lines = [
        f"# 云诊舌诊/面诊 PDF 报告解析：{meta.get('name') or data['report_id']}",
        '',
        '## 元数据',
        f"- 报告ID：{data['report_id']}",
        f"- 姓名：{meta.get('name')}",
        f"- 年龄：{meta.get('age')}",
        f"- 性别：{meta.get('sex')}",
        f"- 联系电话：{meta.get('phone')}",
        f"- 报告日期：{meta.get('report_date')}",
        f"- PDF：{data['pdf_url']}",
        f"- 本地PDF：{data['local_pdf_path']}",
        f"- 本地全文：{data['local_text_path']}",
        f"- 页数：{data['page_count']}；文本页：{data['text_pages']}；文本字符数：{data['text_chars']}",
        '',
        '## 健康体检结果',
        f"- 健康状态：{health.get('health_state')}",
        f"- 发生机制：{health.get('occurrence_mechanism')}",
        f"- 健康指数：{health.get('health_index')}",
        f"- 风险状态：{health.get('risk_status')}",
        '',
        '### 风险概览',
        md_table(health.get('risk_overview', []), ['name', 'risk_level']),
        '',
        '### 主要表现',
        *[f"- {item}" for item in health.get('main_manifestations', [])],
        '',
        '### 易患病症详情',
    ]
    for item in health.get('disease_details', []):
        lines += [
            f"#### {item['name']}（{item['risk_level']}）",
            f"- 定义：{item['definition']}",
            f"- AI专家解读：{item['ai_expert_interpretation']}",
            f"- 健康建议：{item['health_advice']}",
            '',
        ]
    lines += ['### 异常经络']
    for item in health.get('abnormal_meridians', []):
        lines += [f"#### {item['name']} {item['score']}", item['interpretation'], '']
    lines += [
        '### 病理因素与节气风险',
        f"- 病理因素：{health.get('pathology_factor', {}).get('level')}；{health.get('pathology_factor', {}).get('description')}",
        f"- 节气：{health.get('solar_term_risk', {}).get('solar_term')}；患病风险：{health.get('solar_term_risk', {}).get('risk')}",
        f"- 节气提示：{health.get('solar_term_risk', {}).get('tips')}",
        '',
        '## 舌象辨识',
        json.dumps(tongue, ensure_ascii=False, indent=2),
        '',
        '## 面部望诊',
        json.dumps(face, ensure_ascii=False, indent=2),
        '',
        '## 调理方案',
        '### 药食调理',
        regimen.get('medicated_food', {}).get('raw_text', ''),
        '',
        '### 穴位保健',
        regimen.get('acupoint_healthcare', {}).get('raw_text', ''),
        '',
        '### 膳食调养',
        f"- 宜食：{regimen.get('dietary_regimen', {}).get('recommended_foods')}",
        f"- 忌食：{regimen.get('dietary_regimen', {}).get('avoid_foods')}",
        json.dumps(regimen.get('dietary_regimen', {}).get('recipes', []), ensure_ascii=False, indent=2),
        '',
        '### 运动保健',
        regimen.get('exercise', ''),
        '',
        '### 情志起居',
        regimen.get('emotion_and_lifestyle', ''),
        '',
        '## 声明',
        regimen.get('disclaimer', ''),
        '',
        '## PDF逐页抽取全文',
        '以下为 pdfplumber 从 PDF 每一页抽取的原始文本，保留页码，供审计和远程知识库召回。',
    ]
    for page in data.get('pages', []):
        lines += [
            '',
            f"### 第 {page.get('page')} 页",
            page.get('text', ''),
        ]
    lines += [
        '',
        '## 结构化解析 JSON',
        '```json',
        json.dumps({k: v for k, v in data.items() if k != 'pages'}, ensure_ascii=False, indent=2),
        '```',
    ]
    return '\n'.join(lines).strip() + '\n'


class RemoteKb:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def post(self, path, payload, timeout=120):
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(KB_BASE + path, data=data, method='POST', headers={'Content-Type': 'application/json'})
        try:
            response = self.opener.open(req, timeout=timeout)
            return response.status, json.loads(response.read().decode('utf-8', 'ignore'))
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read().decode('utf-8', 'ignore'))
            except Exception:
                return e.code, {'message': e.reason}
        except Exception as e:
            return -1, {'message': str(e)}

    def login(self):
        return self.post('/api/user/passwordLogin', {
            'phoneOrEmail': KB_USER,
            'emailOrPhone': KB_USER,
            'username': KB_USER,
            'password': KB_PASS,
        }, timeout=30)

    def upload_markdown(self, name, content):
        status, body = self.post('/api/knowledge/document/customAdd', {
            'kbId': KB_ID,
            'name': name,
            'fileContent': content,
            'autoSegmentConfigFlag': True,
        })
        doc_id = body.get('data') or body.get('id') or body.get('docId')
        return status, body, doc_id

    def trigger_embedding(self, doc_id):
        if not doc_id:
            return None, {'message': 'missing_doc_id'}
        return self.post(f'/api/knowledge/document/doc/generateEmbeddings/{doc_id}', {}, timeout=60)

    def query_verify(self, query):
        return self.post('/api/knowledge/query', {
            'collection': KB_COLLECTION,
            'query': query,
            'top_k': 3,
            'spaceId': KB_SPACE,
            'agentId': os.environ.get('FLATTALK_KB_AGENT_ID', '373'),
        }, timeout=60)


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    KNOWLEDGE_DOCS_DIR.mkdir(parents=True, exist_ok=True)

    records = read_cache()
    processed = []
    for record in records:
        pdf_url = record.get('pdfUrl') or record.get('signals', {}).get('pdfUrl')
        if not pdf_url:
            continue
        report_id = str(record.get('id') or 'unknown')
        pdf_path = DATA_DIR / f'{report_id}.pdf'
        text_path = DATA_DIR / f'{report_id}.txt'
        json_path = DATA_DIR / f'{report_id}.structured.json'
        md_path = KNOWLEDGE_DOCS_DIR / f'yunzhen_shezhen_report_{report_id}.md'

        download(pdf_url, pdf_path)
        page_texts, full_text = extract_pdf(pdf_path)
        text_path.write_text(full_text, encoding='utf-8')
        structured = build_structured(record, page_texts, full_text, pdf_path, text_path)
        json_path.write_text(json.dumps(structured, ensure_ascii=False, indent=2), encoding='utf-8')
        md = build_markdown(structured)
        md_path.write_text(md, encoding='utf-8')

        record['pdf_parsed'] = {
            'ok': True,
            'parser': 'pdfplumber',
            'local_pdf_path': structured['local_pdf_path'],
            'local_text_path': structured['local_text_path'],
            'local_structured_json_path': str(json_path.relative_to(PROJECT_ROOT)).replace('\\', '/'),
            'local_knowledge_doc_path': str(md_path.relative_to(PROJECT_ROOT)).replace('\\', '/'),
            'page_count': structured['page_count'],
            'text_pages': structured['text_pages'],
            'text_chars': structured['text_chars'],
            'metadata': structured['metadata'],
            'health_analysis': {
                'health_state': structured['health_analysis']['health_state'],
                'occurrence_mechanism': structured['health_analysis']['occurrence_mechanism'],
                'health_index': structured['health_analysis']['health_index'],
                'risk_status': structured['health_analysis']['risk_status'],
                'risk_overview': structured['health_analysis']['risk_overview'],
                'abnormal_meridian_overview': structured['health_analysis']['abnormal_meridian_overview'],
                'pathology_factor': structured['health_analysis']['pathology_factor'],
                'solar_term_risk': structured['health_analysis']['solar_term_risk'],
            },
            'remote_knowledge': {'uploaded': False},
        }

        processed.append({
            'report_id': report_id,
            'pdf_path': str(pdf_path.relative_to(PROJECT_ROOT)).replace('\\', '/'),
            'text_path': str(text_path.relative_to(PROJECT_ROOT)).replace('\\', '/'),
            'json_path': str(json_path.relative_to(PROJECT_ROOT)).replace('\\', '/'),
            'md_path': str(md_path.relative_to(PROJECT_ROOT)).replace('\\', '/'),
            'page_count': structured['page_count'],
            'text_chars': structured['text_chars'],
            'markdown_chars': len(md),
            'record': record,
            'markdown': md,
        })

    write_cache(records)

    remote_results = []
    kb = RemoteKb()
    login_status, login_body = kb.login()
    for item in processed:
        name = f"云诊舌诊PDF报告_{item['report_id']}.md"
        remote = {
            'kb_id': KB_ID,
            'collection': KB_COLLECTION,
            'login_status': login_status,
            'login_success': bool(login_body.get('success')),
        }
        if login_status == 200 and login_body.get('success'):
            status, body, doc_id = kb.upload_markdown(name, item['markdown'])
            embed_status, embed_body = kb.trigger_embedding(doc_id)
            verify_status, verify_body = kb.query_verify('AI员工 痰湿 肺结节风险 舌象')
            remote.update({
                'uploaded': status == 200 and (body.get('success') or body.get('code') in ('0000', 0, '0', None)),
                'upload_status': status,
                'upload_response': body,
                'doc_id': doc_id,
                'embedding_status': embed_status,
                'embedding_response': embed_body,
                'verify_status': verify_status,
                'verify_response': verify_body,
            })
        else:
            remote.update({'uploaded': False, 'error': login_body})
        item['record']['pdf_parsed']['remote_knowledge'] = remote
        remote_results.append(remote)

    write_cache(records)

    summary = {
        'processed_count': len(processed),
        'reports': [
            {
                'report_id': item['report_id'],
                'pdf_path': item['pdf_path'],
                'text_path': item['text_path'],
                'json_path': item['json_path'],
                'md_path': item['md_path'],
                'page_count': item['page_count'],
                'text_chars': item['text_chars'],
                'markdown_chars': item['markdown_chars'],
            }
            for item in processed
        ],
        'remote_results': remote_results,
    }
    out = PROJECT_ROOT / 'data/shezhen_reports/sync_summary.json'
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
