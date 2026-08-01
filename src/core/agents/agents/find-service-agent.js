import { createBaseAgent } from '../base-agent.js';

const serviceTopicTerms = ['服务', '办理', '申请', '补贴', '政策', '资格', '条件', '养老', '居家养老', '社区养老', '机构养老'];
const serviceTypeTerms = ['护工', '护理员', '保姆', '家政', '上门', '陪护', '机构', '养老院', '敬老院', '福利院', '康养中心', '日间照料', '助浴', '助行', '助医'];
const serviceIntentTerms = ['找', '推荐', '查询', '咨询', '预约', '报名', '办理', '申请'];
const boundaryTerms = ['膳食', '饮食', '食谱', '吃什么', '旅居', '旅游', '行程', '周边', '附近', '地图', '派单', '工单', '调度'];
const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '食谱': 'meal_plan', '吃什么': 'meal_plan',
  '旅居': 'travel_route', '旅游': 'travel_route', '行程': 'travel_route',
  '周边': 'nearby_resource', '附近': 'nearby_resource', '地图': 'nearby_resource',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage', '调度': 'dispatch_manage',
};

export function createFindServiceAgent() {
  return createBaseAgent({
    key: 'find_service', name: '服务助手', actionPrefix: 'find_service',
    evidenceGroups: [
      { group: 'topic', weight: 3, terms: serviceTopicTerms },
      { group: 'type', weight: 2.5, terms: serviceTypeTerms },
      { group: 'intent', weight: 3, terms: serviceIntentTerms },
    ],
    boundaryTerms, boundaryMap, threshold: 6,
  });
}
