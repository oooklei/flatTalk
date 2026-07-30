const SERVICE_TYPES = ['助餐', '送餐', '居家上门', '护理', '康复', '补贴', '办事', '预约', '工单'];
const SYMPTOMS = ['胸痛', '头晕', '发烧', '咳嗽', '呕吐', '摔倒', '失眠', '血压高', '血糖高', '吞咽困难'];
const MEDICATIONS = ['胰岛素', '降压药', '降糖药', '阿司匹林', '二甲双胍'];

export function extractEntities(input = {}) {
  const text = String(input.text || input.message || '');
  return {
    service_type: firstHit(text, SERVICE_TYPES),
    time: extractTime(text),
    location: extractLocation(text),
    symptom: firstHit(text, SYMPTOMS),
    medication: firstHit(text, MEDICATIONS),
  };
}

function firstHit(text, words) {
  return words.find((word) => text.includes(word)) || null;
}

function extractTime(text) {
  const match = text.match(/(今天|明天|后天|上午|下午|晚上|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}[点时])/);
  return match?.[1] || null;
}

function extractLocation(text) {
  const match = text.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,20}(社区|街道|村|小区|医院|服务站|养老院))/);
  return match?.[1] || null;
}
