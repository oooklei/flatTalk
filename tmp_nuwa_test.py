import sys, os, time
sys.path.insert(0, r'd:\GuiCare\桂小养集成方案\前期准备\10_new_agent_materials\ai养老助手\ai养老助手\.cursor\skills\ai-elderly-assistant\scripts\backend')
os.environ['NUWA_EMAIL'] = 'admin@nuwax.com'
os.environ['NUWA_PASSWORD'] = '123456'
os.environ['NUWA_SPACE_ID'] = '23'
os.environ['NUWA_BASE'] = 'http://43.138.143.130:9015'

from nuwa_client import NuwaClient

c = NuwaClient()
c.login()
print('token?', bool(c.token))
print('cookie_tickets', [ck.value[:8] + '...' for ck in c.cj if ck.name == 'ticket'])

kb = c.find_knowledge_by_name('广西养老政策知识库')
print('policyKb', kb.get('id'), kb.get('name'))
if kb:
    r = c.add_knowledge_text(kb['id'], f'zzz_PY_{int(time.time())}',
                              '广西高龄津贴：年满80周岁可申领高龄津贴，需身份证户口本银行卡到社区居委会办理。')
    print('ADD', r.get('code'), r.get('success'), r.get('message'))
