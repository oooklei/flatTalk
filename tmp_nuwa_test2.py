import sys, time
sys.path.insert(0, r'd:\GuiCare\桂小养集成方案\前期准备\10_new_agent_materials\ai养老助手\ai养老助手\.cursor\skills\ai-elderly-assistant\scripts\backend')
from nuwa_client import NuwaClient

# 默认凭证（space 11, leixicai）
c = NuwaClient()
try:
    c.login()
    print('LOGIN token?', bool(c.token), 'space', c.space_id)
except Exception as e:
    print('LOGIN FAILED', e)

# 直接试 id=57（space 11 下的 广西养老政策知识库 emb=3）
r = c.add_knowledge_text(57, f'zzz_DEF_{int(time.time())}', '广西高龄津贴：年满80周岁可申领高龄津贴，需身份证户口本银行卡到社区办理。')
print('ADD id=57 ->', r.get('code'), r.get('success'), r.get('message'))
# 也试 id=58（广西养老政策QA知识库 emb=3）
r2 = c.add_knowledge_text(58, f'zzz_DEF_QA_{int(time.time())}', '广西高龄津贴：年满80周岁可申领高龄津贴。')
print('ADD id=58 ->', r2.get('code'), r2.get('success'), r2.get('message'))
