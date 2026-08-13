// 政策类卡片：policy_card / policy_list_card / policy_apply_guide_card / policy_detail_card。
// 支持知识库检索（knowledgeService）+ 默认兜底回复。

import { sanitizeModelResult } from './utils.js';

async function fillPolicyCard({ message, knowledgeService }) {
  const text = String(message || '');
  const isAssistantUsage = /养老助手|桂小养|怎么用|能做什么|可以做什么|使用方法|助手/.test(text);

  // 尝试从知识库查询政策信息
  let policyContent = null;

  if (!isAssistantUsage) {
    try {
      // 提取查询关键词
      const keywords = extractPolicyKeywords(text);

      if (knowledgeService?.retriever && keywords.length > 0) {
        const knowledgeResult = await knowledgeService.retriever.retrieve({
          skill_key: 'common',
          query: keywords.join(' '),
          limit: 5,
        });

        if (knowledgeResult?.matches?.length > 0) {
          policyContent = summarizePolicyKnowledge(knowledgeResult.matches, text);
        }
      }
    } catch (error) {
      console.error('[PolicyCard] 知识库查询失败:', error.message);
    }
    // 如果有知识库结果，使用知识库内容
  }

  if (policyContent) {
    return sanitizeModelResult({
      template_id: 'policy_card',
      answer_text: policyContent.summary,
      answer: policyContent.summary,
      data: {
        emoji: '📋',
        title: '养老政策咨询',
        skill_name: '政策知识库',
        answer_text: policyContent.summary,
        answer: policyContent.summary,
        policy_items: policyContent.items,
        foot: '以上信息来自政策知识库，具体标准以当地民政、人社部门最新规定为准。',
        source: '知识库查询',
      },
      actions: [],
      followup_suggestions: [
        { label: '查询补贴条件', user_prompt: '老人有什么补贴，申请条件是什么' },
        { label: '整理办理材料', user_prompt: '办理养老补贴需要准备哪些材料' },
        { label: '查询办理流程', user_prompt: '养老补贴应该去哪里办理，流程是什么' },
      ],
      template_fit_notes: ['knowledge_base_policy'],
    });
  }

  // 没有知识库结果时，使用默认回复
  const answerText = isAssistantUsage
    ? '桂小养养老助手可以帮您查政策、找服务、做膳食建议、规划康养旅居，并根据老人情况继续追问补全信息。'
    : '养老政策通常涉及高龄津贴、长护险、社区居家养老服务、助餐补贴、适老化改造等。请补充所在城市/区县、老人年龄、户籍和失能情况，我可以继续整理申请条件、材料和流程。';

  const policyItems = isAssistantUsage
    ? [
        { icon: '1', label: '查政策', detail: '查询高龄津贴、长护险、护理补贴、助餐补贴、适老化改造等政策口径。' },
        { icon: '2', label: '找服务', detail: '按老人所在区域和需求，整理居家上门、助餐送餐、养老机构、康养旅居等服务方向。' },
        { icon: '3', label: '做建议', detail: '可继续生成控糖低盐膳食、一周计划、办理材料清单和下一步操作建议。' },
      ]
    : [
        { icon: '1', label: '补贴类', detail: '高龄津贴、护理补贴、困难老人补助等，与年龄、户籍、经济状况、能力评估相关。' },
        { icon: '2', label: '服务类', detail: '社区居家养老、助餐送餐、上门护理、适老化改造、养老机构推荐等。' },
        { icon: '3', label: '办理类', detail: '可继续询问申请条件、办理材料、办理地点和流程，我会按当地政策口径整理。' },
      ];

  return sanitizeModelResult({
    template_id: 'policy_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      emoji: isAssistantUsage ? '💬' : '📋',
      title: isAssistantUsage ? '桂小养养老助手' : '养老政策咨询',
      skill_name: isAssistantUsage ? '使用指引' : '政策与服务指引',
      answer_text: answerText,
      answer: answerText,
      policy_items: policyItems,
      foot: '以上为一般性政策整理，具体标准以当地民政、人社部门最新规定为准。',
    },
    actions: [],
    followup_suggestions: [
      { label: '查询补贴条件', user_prompt: '老人有什么补贴，申请条件是什么' },
      { label: '整理办理材料', user_prompt: '办理养老补贴需要准备哪些材料' },
    ],
    template_fit_notes: [],
  });
}

function extractPolicyKeywords(text) {
  const keywords = [];
  const keywordPatterns = [
    { pattern: /高龄津贴|高龄补贴|老人津贴/, keyword: '高龄津贴' },
    { pattern: /长护险|长期护理保险|护理险/, keyword: '长护险' },
    { pattern: /护理补贴|护理费/, keyword: '护理补贴' },
    { pattern: /助餐补贴|助餐|送餐/, keyword: '助餐补贴' },
    { pattern: /适老化改造|居家改造/, keyword: '适老化改造' },
    { pattern: /居家养老|社区养老/, keyword: '居家养老服务' },
    { pattern: /养老机构|养老院|敬老院/, keyword: '养老机构' },
    { pattern: /广西|南宁|桂林|北海|巴马/, keyword: '广西' },
    { pattern: /补贴|政策|申请条件|办理/, keyword: '补贴政策' },
  ];

  for (const { pattern, keyword } of keywordPatterns) {
    if (pattern.test(text) && !keywords.includes(keyword)) {
      keywords.push(keyword);
    }
  }

  // 如果没有匹配到关键词，使用通用关键词
  if (keywords.length === 0) {
    keywords.push('养老政策', '补贴');
  }

  return keywords;
}

function summarizePolicyKnowledge(results, query) {
  if (!results || results.length === 0) return null;

  const items = [];
  const summaries = [];

  for (const result of results.slice(0, 5)) {
    const content = result.content || result.text || result.chunk || '';
    const title = result.title || result.name || '';

    if (content) {
      // 提取关键信息作为政策条目
      const lines = content.split('\n').filter(line => line.trim());
      for (const line of lines.slice(0, 3)) {
        if (line.length > 10 && !items.some(i => i.detail === line.trim())) {
          items.push({
            icon: String(items.length + 1),
            label: extractLabel(line) || '政策信息',
            detail: line.trim().slice(0, 100),
          });
        }
      }
    }
  }

  // 生成摘要
  const summary = items.length > 0
    ? `根据知识库查询，为您整理了${items.length}条相关政策信息。请补充老人具体情况（年龄、户籍、失能状况），我可以提供更精准的申请条件和办理指引。`
    : '养老政策通常涉及高龄津贴、长护险、社区居家养老服务、助餐补贴、适老化改造等。';

  return {
    summary,
    items: items.length > 0 ? items : [
      { icon: '1', label: '补贴类', detail: '高龄津贴、护理补贴、困难老人补助等，与年龄、户籍、经济状况、能力评估相关。' },
      { icon: '2', label: '服务类', detail: '社区居家养老、助餐送餐、上门护理、适老化改造、养老机构推荐等。' },
      { icon: '3', label: '办理类', detail: '可继续询问申请条件、办理材料、办理地点和流程，我会按当地政策口径整理。' },
    ],
  };
}

function extractLabel(text) {
  // 尝试从文本中提取标签
  const labelPatterns = [
    /高龄津贴/,
    /长护险/,
    /护理补贴/,
    /助餐/,
    /适老化/,
    /居家养老/,
    /养老机构/,
  ];

  for (const pattern of labelPatterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }

  return null;
}

async function fillPolicyListCard({ message, knowledgeService }) {
  const text = String(message || '');
  let policyContent = null;

  try {
    const keywords = extractPolicyKeywords(text);
    if (knowledgeService?.retriever && keywords.length > 0) {
      const knowledgeResult = await knowledgeService.retriever.retrieve({
        skill_key: 'common',
        query: keywords.join(' '),
        limit: 5,
      });
      if (knowledgeResult?.matches?.length > 0) {
        policyContent = summarizePolicyKnowledge(knowledgeResult.matches, text);
      }
    }
  } catch (error) {
    console.error('[PolicyListCard] 知识库查询失败:', error.message);
  }

  const policies = (policyContent?.items?.length ? policyContent.items : buildDefaultPolicyList(text))
    .slice(0, 6)
    .map((item, index) => ({
      id: item.id || `policy_${String(index + 1).padStart(3, '0')}`,
      icon: item.icon || '📋',
      title: item.title || item.label || '养老政策信息',
      description: item.description || item.detail || '可继续补充老人年龄、户籍、失能情况，我会整理申请条件和办理材料。',
      tags: item.tags || inferPolicyTags(item.label || item.title || item.detail || text),
    }));

  const answerText = policyContent?.summary
    || '已为您整理社区居家养老、补贴和支持政策方向。具体标准通常与老人年龄、户籍或居住地、失能等级和经济状况有关。';

  return sanitizeModelResult({
    template_id: 'policy_list_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      eyebrow: '📋 政策知识库',
      title: /社区居家养老|居家养老|社区养老/.test(text) ? '社区居家养老支持政策' : '养老补贴相关政策',
      summary: answerText,
      count: policies.length,
      policies,
      hint: '💡 可继续告诉我老人所在城市、年龄、户籍和失能情况，我会按当地口径整理申请条件、材料和办理流程。',
    },
    actions: [],
    followup_suggestions: [
      { label: '查询办理流程', user_prompt: '养老补贴应该去哪里办理，流程是什么' },
      { label: '整理办理材料', user_prompt: '办理养老补贴需要准备哪些材料' },
      { label: '说明老人情况', user_prompt: '老人80岁，广西户籍，想了解可以申请哪些补贴' },
    ],
    template_fit_notes: ['deterministic_policy_list'],
  });
}

function fillPolicyApplyGuideCard({ message }) {
  const text = String(message || '');
  const isHomeModification = /适老化改造|居家改造/.test(text);
  const title = isHomeModification ? '适老化改造补贴申请指引' : '养老补贴申请指引';
  const answerText = isHomeModification
    ? '适老化改造补贴一般先确认老人身份和改造需求，再向社区、街道或民政部门提交申请，审核评估后按当地目录实施改造和验收。'
    : '养老补贴通常按“确认条件、准备材料、提交申请、审核评估、发放或服务兑现”的流程办理，具体以当地民政、人社、医保部门要求为准。';

  return sanitizeModelResult({
    template_id: 'policy_apply_guide_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      eyebrow: '📝 办事指引',
      title,
      subtitle: isHomeModification ? '防滑、扶手、如厕洗浴、室内安全等居家改造申请流程' : '高龄津贴、护理补贴、困难老人补助等申请流程',
      conditions: {
        items: isHomeModification
          ? [
              { label: '老人范围', value: '高龄、失能、残疾、困难或有居家安全改造需求的老人' },
              { label: '居住地', value: '通常需在申请地常住，具体看当地政策' },
              { label: '改造需求', value: '经入户评估确认存在防跌倒、如厕洗浴等改造需求' },
              { label: '补贴限制', value: '同一住房或同一老人是否重复享受，以当地规定为准' },
            ]
          : [
              { label: '年龄', value: '通常为60周岁及以上，部分津贴按更高年龄段' },
              { label: '户籍/居住', value: '以当地户籍、居住证或常住要求为准' },
              { label: '能力等级', value: '护理类补贴一般需失能或半失能评估' },
              { label: '经济状况', value: '困难类补贴需符合当地收入或救助认定标准' },
            ],
      },
      steps: {
        items: [
          { number: '1', title: '确认政策口径', description: '先确认老人所在城市/区县、年龄、户籍、居住地和身体能力情况。' },
          { number: '2', title: '准备申请材料', description: '准备身份证、户口本或居住证明、评估材料、银行卡等基础资料。' },
          { number: '3', title: '提交申请', description: '到社区、街道办事处、民政窗口或当地线上政务平台提交申请。' },
          { number: '4', title: '审核评估', description: '相关部门审核材料，必要时进行入户评估、公示或复核。' },
          { number: '5', title: '结果兑现', description: isHomeModification ? '审核通过后按改造目录施工、验收，再按规定结算或补贴。' : '审核通过后按月发放补贴，或以服务券、服务包等方式兑现。' },
        ],
      },
      materials: {
        items: isHomeModification
          ? ['身份证原件及复印件', '户口本或居住证明', '房屋权属或居住证明', '改造需求评估表', '银行卡信息', '委托代办材料']
          : ['身份证原件及复印件', '户口本或居住证明', '近期免冠照片', '能力/失能评估报告', '银行卡信息', '困难证明或救助材料'],
      },
      contact: {
        location: '户籍或常住地社区/街道办事处/民政部门',
        phone: '12345政务服务热线或当地民政窗口',
        duration: '一般15-30个工作日，具体以当地规定为准',
      },
      highlight: '⚠️ 提示：各地补贴对象、金额、材料和办理入口可能不同，建议补充城市/区县后再核对当地最新口径。',
    },
    actions: [],
    followup_suggestions: [
      { label: '整理办理材料', user_prompt: `${isHomeModification ? '适老化改造' : '养老补贴'}办理需要准备哪些材料` },
      { label: '查询补贴条件', user_prompt: `${isHomeModification ? '适老化改造' : '养老补贴'}申请条件是什么` },
    ],
    template_fit_notes: ['deterministic_policy_apply_guide'],
  });
}

async function fillPolicyDetailCard({ message, knowledgeService }) {
  const text = String(message || '');
  let policyContent = null;

  try {
    const keywords = extractPolicyKeywords(text);
    if (knowledgeService?.retriever && keywords.length > 0) {
      const knowledgeResult = await knowledgeService.retriever.retrieve({
        skill_key: 'common',
        query: keywords.join(' '),
        limit: 5,
      });
      if (knowledgeResult?.matches?.length > 0) {
        policyContent = summarizePolicyKnowledge(knowledgeResult.matches, text);
      }
    }
  } catch (error) {
    console.error('[PolicyDetailCard] 知识库查询失败:', error.message);
  }

  const isHomeModification = /适老化改造|居家改造/.test(text);
  const answerText = policyContent?.summary
    || (isHomeModification
      ? '适老化改造政策重点关注居家安全风险，常见改造包括防滑处理、安装扶手、如厕洗浴改造、紧急呼叫和室内通行优化。'
      : '养老政策通常覆盖高龄津贴、长期护理保险、护理补贴、助餐补贴、社区居家养老服务和能力评估等内容。');

  return sanitizeModelResult({
    template_id: 'policy_detail_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      eyebrow: '政策解读',
      title: isHomeModification ? '适老化改造政策解读' : '养老政策要点解读',
      tags: inferPolicyTags(text),
      summary: answerText,
      highlights: {
        items: (policyContent?.items?.length ? policyContent.items : buildDefaultPolicyList(text)).slice(0, 4).map((item, index) => ({
          icon: String(index + 1),
          text: item.detail || item.description || item.title || item.label,
        })),
      },
      details: {
        heading: '办理提示',
        content: '<p>建议先确认老人所在城市/区县、年龄、户籍或居住情况、失能等级和经济状况。</p><p>不同地区对补贴标准、材料清单、审核时限和发放方式会有差异，最终以当地民政、人社、医保等部门最新要求为准。</p>',
      },
      footer_tip: '如需了解具体申请条件和办理流程，请告诉我老人年龄、户籍和失能情况。',
    },
    actions: [],
    followup_suggestions: [
      { label: '查询办理流程', user_prompt: '这个政策怎么办理，流程是什么' },
      { label: '整理办理材料', user_prompt: '办理这个政策需要哪些材料' },
    ],
    template_fit_notes: ['deterministic_policy_detail'],
  });
}

function buildDefaultPolicyList(text = '') {
  if (/适老化改造|居家改造/.test(text)) {
    return [
      { icon: '🏠', title: '居家适老化改造补贴', description: '围绕防滑、扶手、如厕洗浴、通行安全和紧急呼叫等项目进行改造支持。', tags: ['适老化改造', '居家安全'] },
      { icon: '🧾', title: '困难老年人改造支持', description: '部分地区优先支持低保、特困、失能、残疾、高龄等困难老年人家庭。', tags: ['困难老人', '补贴'] },
      { icon: '🛠️', title: '改造目录和验收', description: '通常需先评估后施工，按当地改造目录、限额和验收标准执行。', tags: ['办理流程', '验收'] },
    ];
  }

  return [
    { icon: '💰', title: '高龄津贴', description: '面向达到当地规定年龄的老年人，通常与户籍、年龄档次和申请审核有关。', tags: ['津贴', '高龄'] },
    { icon: '🏥', title: '长期护理保险', description: '面向经评估达到护理需求等级的参保人员，提供护理服务或待遇支付。', tags: ['长护险', '护理'] },
    { icon: '🤝', title: '社区居家养老服务', description: '包含助餐送餐、上门照护、日间照料、探访关爱等服务支持。', tags: ['居家养老', '社区服务'] },
    { icon: '🍽️', title: '助餐补贴', description: '部分地区对符合条件老人提供助餐、送餐或老年食堂价格优惠。', tags: ['助餐', '补贴'] },
    { icon: '🏠', title: '适老化改造', description: '对符合条件家庭开展防滑、扶手、如厕洗浴等居家安全改造支持。', tags: ['适老化', '安全'] },
  ];
}

function inferPolicyTags(text = '') {
  const tags = [];
  if (/补贴|津贴/.test(text)) tags.push('补贴政策');
  if (/社区居家养老|居家养老|社区养老/.test(text)) tags.push('居家养老');
  if (/适老化改造|居家改造/.test(text)) tags.push('适老化改造');
  if (/长护险|长期护理保险/.test(text)) tags.push('长护险');
  if (/办理|申请|流程|材料/.test(text)) tags.push('办理指引');
  return tags.length ? tags : ['养老政策'];
}

export {
  fillPolicyCard,
  fillPolicyListCard,
  fillPolicyApplyGuideCard,
  fillPolicyDetailCard,
};
