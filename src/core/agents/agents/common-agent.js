import { createBaseAgent } from '../base-agent.js';

export function createCommonAgent() {
  return createBaseAgent({
    key: 'common', name: '桂小养', actionPrefix: '',
    keywords: ['你好', '谢谢', '再见', '帮助', '政策', '补贴', '您好', '请问', '养老助手', '桂小养', '怎么用', '使用方法', '能做什么', '可以做什么'],
    boundaryTerms: [], boundaryMap: {}, threshold: 1,
  });
}
