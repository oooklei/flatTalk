import { createBaseAgent } from '../base-agent.js';

export function createCommonAgent() {
  return createBaseAgent({
    key: 'common', name: '桂小养', actionPrefix: '',
    keywords: ['你好', '谢谢', '再见', '帮助', '政策', '补贴', '您好', '请问'],
    boundaryTerms: [], boundaryMap: {}, threshold: 1,
  });
}
