/**
 * ContextSnapshot + ActiveEntity 锁定
 *
 * 原则：追问只表达意图，实体靠锁定；禁止无上下文静默落到 list[0]/默认样例。
 * 优先级：按钮 params > previous_* 快照 > 当前业务数据 > 消息可解析实体。
 */

/** 各场景需要持久化/回注的实体字段 */
export const SCENE_ENTITY_KEYS = {
  travel_route: ['route_id', 'destination', 'product_id', 'route_title', 'city'],
  health_risk_warning: ['elder_id', 'elder_name'],
  find_service: ['service_id', 'org_id', 'worker_id', 'order_id', 'elder_id', 'elder_name'],
  dispatch_manage: ['dispatch_id', 'order_id', 'worker_id', 'elder_id'],
  nearby_resource: ['center', 'destination', 'category'],
  meal_plan: ['elder_id', 'elder_name'],
  service_quality_eval: ['org_id', 'staff_id', 'org_name'],
};

/**
 * 构建上下文快照（含跨场景 ActiveEntity）
 */
export function buildSnapshot(turnResult = {}) {
  const scene = turnResult.skill_key || turnResult.scene_key || 'common';
  const data = turnResult.data || {};
  const entity = extractActiveEntity(scene, data, turnResult);

  return {
    scene,
    intent: turnResult.intent || '',
    template_id: turnResult.template_id || '',
    turn_id: turnResult.turn_id || '',
    timestamp: Date.now(),
    semantic_source: turnResult.semantic?.source || '',
    semantic_core_need: turnResult.semantic?.core_need || '',
    semantic_category: turnResult.semantic?.adapted?.category || '',
    semantic_destination: turnResult.semantic?.adapted?.destination || '',
    // 兼容旧旅居字段
    destination: entity.destination || '',
    route_id: entity.route_id || '',
    product_id: entity.product_id || '',
    route_title: entity.route_title || '',
    // 通用实体
    entity_type: entity.entity_type || '',
    entity_id: entity.entity_id || '',
    display_name: entity.display_name || '',
    elder_id: entity.elder_id || '',
    elder_name: entity.elder_name || '',
    service_id: entity.service_id || '',
    org_id: entity.org_id || '',
    worker_id: entity.worker_id || '',
    order_id: entity.order_id || '',
    dispatch_id: entity.dispatch_id || '',
    staff_id: entity.staff_id || '',
    org_name: entity.org_name || '',
    center: entity.center || '',
    category: entity.category || '',
    city: entity.city || entity.destination || '',
  };
}

export function extractSnapshot(prevTurn) {
  if (!prevTurn) return null;
  const envelope = prevTurn.envelope || prevTurn;
  return envelope.context_snapshot || null;
}

/**
 * 将快照注入请求 context（全部 previous_* 字段）
 */
export function injectSnapshot(context, snapshot) {
  if (!snapshot) return context;
  const next = {
    ...context,
    previous_scene: snapshot.scene,
    previous_template: snapshot.template_id,
    previous_intent: snapshot.intent,
    previous_turn_id: snapshot.turn_id,
    previous_entity_type: snapshot.entity_type || '',
    previous_entity_id: snapshot.entity_id || '',
    previous_display_name: snapshot.display_name || '',
  };
  for (const key of Object.keys(SCENE_ENTITY_KEYS).flatMap((s) => SCENE_ENTITY_KEYS[s])) {
    const value = snapshot[key];
    if (value) next[`previous_${key}`] = value;
  }
  // 旅居兼容别名
  if (snapshot.destination) next.previous_destination = snapshot.destination;
  if (snapshot.route_id) next.previous_route_id = snapshot.route_id;
  if (snapshot.product_id) next.previous_product_id = snapshot.product_id;
  if (snapshot.route_title) next.previous_route_title = snapshot.route_title;
  return next;
}

/**
 * 通用实体锁定：按场景把 params/快照合并进 businessData，并 enrichment fillMessage。
 */
export function applyEntityContextLock(sceneKey, businessData = {}, request = {}, fillMessage = '') {
  const scene = String(sceneKey || request.skill_key || request.context?.previous_scene || '').trim();
  if (scene === 'travel_route') {
    return applyTravelRouteContextLock(businessData, request, fillMessage);
  }
  if (scene === 'health_risk_warning' || scene === 'meal_plan') {
    return applyElderContextLock(businessData, request, fillMessage);
  }
  if (scene === 'find_service') {
    return applyFindServiceContextLock(businessData, request, fillMessage);
  }
  if (scene === 'dispatch_manage') {
    return applyDispatchContextLock(businessData, request, fillMessage);
  }
  if (scene === 'nearby_resource') {
    return applyNearbyContextLock(businessData, request, fillMessage);
  }
  if (scene === 'service_quality_eval') {
    return applyQualityContextLock(businessData, request, fillMessage);
  }
  return { businessData, fillMessage: String(fillMessage || ''), locked: false };
}

/** @deprecated 使用 applyEntityContextLock('travel_route', ...)；保留兼容 */
export function applyTravelRouteContextLock(businessData = {}, request = {}, fillMessage = '') {
  const params = request.context?.action_params || request.params || {};
  const ctx = request.context || {};
  const rawMessage = String(fillMessage || '');

  // 用户明确换目的地时，解除旧 route_id / product 锁定，避免「说北海却仍出七洞乡地图」
  const utteredDest = extractTravelDestinationKey(rawMessage);
  const lockedDestHint = firstText(
    params.destination,
    params.city,
    ctx.previous_destination,
    ctx.previous_city,
    businessData.primary_city,
    Array.isArray(businessData.destination) ? businessData.destination[0] : businessData.destination,
  );
  const destSwitch = Boolean(
    utteredDest
    && lockedDestHint
    && !travelDestinationsCompatible(utteredDest, lockedDestHint)
  );

  let routeId = firstText(
    params.route_id,
    params.publish_route_id,
    ctx.publish_route_id,
    ctx.route_id,
    ctx.previous_route_id,
    businessData.route_id,
    businessData.publish_match?.route_id,
  );
  let destination = firstText(
    params.destination,
    params.city,
    ctx.previous_destination,
    ctx.previous_city,
    businessData.primary_city,
    businessData.destination,
    Array.isArray(businessData.publish_match?.destination)
      ? businessData.publish_match.destination[0]
      : businessData.publish_match?.destination,
  );
  let productId = firstText(
    params.product_id,
    ctx.previous_product_id,
    businessData.jtd?.selected_product?.product_id,
  );
  let routeTitle = firstText(params.route_title, ctx.previous_route_title, businessData.route_title);

  if (destSwitch) {
    destination = utteredDest.startsWith('广西') ? utteredDest : `广西${utteredDest}`;
    // 换城后旧包/旧产品一律作废
    routeId = firstText(params.route_id, params.publish_route_id) || '';
    productId = firstText(params.product_id) || '';
    if (!params.route_title) routeTitle = '';
  }

  const next = { ...businessData };
  if (routeId) {
    next.route_id = routeId;
    next.publish_match = {
      ...(next.publish_match || {}),
      route_id: routeId,
      title: routeTitle || next.publish_match?.title || '',
      destination: destination ? [destination] : (next.publish_match?.destination || []),
    };
  } else if (destSwitch) {
    delete next.route_id;
    next.publish_match = undefined;
  }
  if (destination) {
    next.destination = destination;
    next.primary_city = destination;
  }
  if (productId && next.jtd) {
    const products = Array.isArray(next.jtd.products) ? next.jtd.products : [];
    const selected = products.find((p) => String(p.product_id) === String(productId))
      || next.jtd.selected_product
      || null;
    next.jtd = {
      ...next.jtd,
      selected_product: selected
        ? { ...selected, product_id: productId, destination: selected.destination || destination }
        : { product_id: productId, destination: destination || '', product_name: routeTitle || '' },
    };
  } else if (destSwitch && next.jtd) {
    next.jtd = { ...next.jtd, selected_product: null };
  }

  let message = rawMessage;
  if (destination && !messageIncludesToken(message, destination)) {
    message = `${message} ${destination}`.trim();
  }
  if (routeTitle && !message.includes(routeTitle)) {
    message = `${message} ${routeTitle}`.trim();
  }

  return {
    businessData: next,
    fillMessage: message,
    locked: Boolean(routeId || destination || productId),
    dest_switched: destSwitch,
    entity: {
      entity_type: 'route',
      entity_id: routeId || productId || '',
      display_name: routeTitle || destination || '',
      route_id: routeId,
      destination,
      product_id: productId,
      route_title: routeTitle,
    },
  };
}

function applyElderContextLock(businessData = {}, request = {}, fillMessage = '') {
  const params = request.context?.action_params || request.params || {};
  const ctx = request.context || {};
  const elderId = firstText(params.elder_id, ctx.previous_elder_id, businessData.elder_id, request.elder_id);
  const elderName = firstText(params.elder_name, ctx.previous_elder_name, businessData.elder_name, businessData.elderName);
  const next = { ...businessData };
  if (elderId) next.elder_id = elderId;
  if (elderName) {
    next.elder_name = elderName;
    next.elderName = elderName;
  }
  let message = String(fillMessage || '');
  if (elderName && !message.includes(elderName)) message = `${message} ${elderName}`.trim();
  return {
    businessData: next,
    fillMessage: message,
    locked: Boolean(elderId || elderName),
    entity: { entity_type: 'elder', entity_id: elderId, display_name: elderName, elder_id: elderId, elder_name: elderName },
  };
}

function applyFindServiceContextLock(businessData = {}, request = {}, fillMessage = '') {
  const params = request.context?.action_params || request.params || {};
  const ctx = request.context || {};
  const serviceId = firstText(params.service_id, ctx.previous_service_id, businessData.service_id);
  const orgId = firstText(params.org_id, ctx.previous_org_id, businessData.org_id);
  const workerId = firstText(params.worker_id, ctx.previous_worker_id, businessData.worker_id);
  const orderId = firstText(params.order_id, ctx.previous_order_id, businessData.order_id);
  const elder = applyElderContextLock(businessData, request, fillMessage);
  const next = { ...elder.businessData };
  if (serviceId) next.service_id = serviceId;
  if (orgId) next.org_id = orgId;
  if (workerId) next.worker_id = workerId;
  if (orderId) next.order_id = orderId;
  return {
    businessData: next,
    fillMessage: elder.fillMessage,
    locked: Boolean(serviceId || orgId || workerId || orderId || elder.locked),
    entity: {
      entity_type: serviceId ? 'service' : (orderId ? 'order' : (workerId ? 'worker' : (orgId ? 'org' : 'elder'))),
      entity_id: serviceId || orderId || workerId || orgId || elder.entity?.elder_id || '',
      display_name: elder.entity?.elder_name || '',
      service_id: serviceId,
      org_id: orgId,
      worker_id: workerId,
      order_id: orderId,
      elder_id: elder.entity?.elder_id || '',
      elder_name: elder.entity?.elder_name || '',
    },
  };
}

function applyDispatchContextLock(businessData = {}, request = {}, fillMessage = '') {
  const params = request.context?.action_params || request.params || {};
  const ctx = request.context || {};
  const dispatchId = firstText(params.dispatch_id, ctx.previous_dispatch_id, businessData.dispatch_id);
  const orderId = firstText(params.order_id, ctx.previous_order_id, businessData.order_id);
  const workerId = firstText(params.worker_id, ctx.previous_worker_id, businessData.worker_id);
  const elder = applyElderContextLock(businessData, request, fillMessage);
  const next = { ...elder.businessData };
  if (dispatchId) next.dispatch_id = dispatchId;
  if (orderId) next.order_id = orderId;
  if (workerId) next.worker_id = workerId;
  let message = String(elder.fillMessage || fillMessage || '');
  if (dispatchId && !message.includes(dispatchId)) message = `${message} 派单${dispatchId}`.trim();
  if (orderId && !message.includes(orderId)) message = `${message} 工单${orderId}`.trim();
  return {
    businessData: next,
    fillMessage: message,
    locked: Boolean(dispatchId || orderId || workerId || elder.locked),
    entity: {
      entity_type: 'dispatch',
      entity_id: dispatchId || orderId || '',
      display_name: dispatchId || orderId || '',
      dispatch_id: dispatchId,
      order_id: orderId,
      worker_id: workerId,
      elder_id: elder.entity?.elder_id || '',
      elder_name: elder.entity?.elder_name || '',
    },
  };
}

function applyNearbyContextLock(businessData = {}, request = {}, fillMessage = '') {
  const params = request.context?.action_params || request.params || {};
  const ctx = request.context || {};
  const center = firstText(params.center, ctx.previous_center, businessData.center, '嘉路康养中心');
  const category = firstText(params.category, ctx.previous_category, businessData.category);
  const destination = firstText(params.destination, ctx.previous_destination, businessData.destination);
  const next = { ...businessData, center };
  if (category) next.category = category;
  if (destination) next.destination = destination;
  let message = String(fillMessage || '');
  if (center && !message.includes(center) && !/嘉路/.test(message)) message = `${message} ${center}`.trim();
  if (category && !message.includes(category)) message = `${message} ${category}`.trim();
  return {
    businessData: next,
    fillMessage: message,
    locked: Boolean(center || category || destination),
    entity: { entity_type: 'poi_center', entity_id: center, display_name: center, center, category, destination },
  };
}

function applyQualityContextLock(businessData = {}, request = {}, fillMessage = '') {
  const params = request.context?.action_params || request.params || {};
  const ctx = request.context || {};
  const orgId = firstText(params.org_id, ctx.previous_org_id, businessData.org_id);
  const staffId = firstText(params.staff_id, ctx.previous_staff_id, businessData.staff_id);
  const orgName = firstText(params.org_name, ctx.previous_org_name, businessData.org_name, businessData.orgName);
  const next = { ...businessData };
  if (orgId) next.org_id = orgId;
  if (staffId) next.staff_id = staffId;
  if (orgName) {
    next.org_name = orgName;
    next.orgName = orgName;
  }
  let message = String(fillMessage || '');
  if (orgName && !message.includes(orgName)) message = `${message} ${orgName}`.trim();
  return {
    businessData: next,
    fillMessage: message,
    locked: Boolean(orgId || staffId || orgName),
    entity: {
      entity_type: staffId ? 'staff' : 'org',
      entity_id: staffId || orgId || '',
      display_name: orgName || '',
      org_id: orgId,
      staff_id: staffId,
      org_name: orgName,
    },
  };
}

function extractActiveEntity(scene, data = {}, turnResult = {}) {
  if (scene === 'travel_route') {
    // 天气卡等只写 data.city；线路卡写 destination / publish_match
    const destination = firstText(
      data.destination,
      data.city,
      data.primary_city,
      Array.isArray(data.publish_match?.destination) ? data.publish_match.destination[0] : data.publish_match?.destination,
    );
    const routeId = firstText(data.route_id, data.publish_match?.route_id, turnResult.route_id);
    const productId = firstText(data.productId, data.product_id);
    const routeTitle = firstText(data.routeTitle, data.route_title, data.publish_match?.title);
    return {
      entity_type: 'route',
      entity_id: routeId || productId || '',
      display_name: routeTitle || destination || '',
      destination,
      route_id: routeId,
      product_id: productId,
      route_title: routeTitle,
      city: firstText(data.city, data.primary_city, destination),
    };
  }
  if (scene === 'health_risk_warning' || scene === 'meal_plan') {
    const elderId = firstText(data.elder_id, data.elderId);
    const elderName = firstText(data.elder_name, data.elderName, data.profileName);
    return {
      entity_type: 'elder',
      entity_id: elderId,
      display_name: elderName,
      elder_id: elderId,
      elder_name: elderName,
    };
  }
  if (scene === 'find_service') {
    const serviceId = firstText(data.service_id);
    const orgId = firstText(data.org_id, data.highlightOrg?.org_id);
    const workerId = firstText(data.worker_id);
    const orderId = firstText(data.orderId, data.order_id, data.order_no);
    const elderId = firstText(data.elder_id);
    const elderName = firstText(data.elderName, data.elder_name, data.name);
    return {
      entity_type: serviceId ? 'service' : (orderId ? 'order' : 'service'),
      entity_id: serviceId || orderId || orgId || workerId || '',
      display_name: firstText(data.name, data.service_name, data.sceneTitle, elderName),
      service_id: serviceId,
      org_id: orgId,
      worker_id: workerId,
      order_id: orderId,
      elder_id: elderId,
      elder_name: elderName,
    };
  }
  if (scene === 'dispatch_manage') {
    const dispatchId = firstText(data.dispatchId, data.dispatch_id);
    const orderId = firstText(data.orderId, data.order_id, data.orderNo);
    return {
      entity_type: 'dispatch',
      entity_id: dispatchId || orderId || '',
      display_name: dispatchId || orderId || '',
      dispatch_id: dispatchId,
      order_id: orderId,
      worker_id: firstText(data.workerName, data.worker_id),
      elder_id: firstText(data.elder_id),
    };
  }
  if (scene === 'nearby_resource') {
    return {
      entity_type: 'poi_center',
      entity_id: firstText(data.center, '嘉路康养中心'),
      display_name: firstText(data.center, '嘉路康养中心'),
      center: firstText(data.center, '嘉路康养中心'),
      category: firstText(data.category),
      destination: firstText(data.destination),
    };
  }
  if (scene === 'service_quality_eval') {
    const orgId = firstText(data.org_id, data.orgId);
    const staffId = firstText(data.staff_id, data.staffId);
    const orgName = firstText(data.orgName, data.org_name);
    return {
      entity_type: staffId ? 'staff' : 'org',
      entity_id: staffId || orgId || '',
      display_name: orgName,
      org_id: orgId,
      staff_id: staffId,
      org_name: orgName,
    };
  }
  return { entity_type: '', entity_id: '', display_name: '' };
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function messageIncludesToken(message, token) {
  const msg = String(message || '');
  const value = String(token || '').trim();
  if (!value) return true;
  if (msg.includes(value)) return true;
  const short = value.replace(/^(广西|云南|海南|福建|四川|浙江|江苏|广东)/, '').replace(/(市|县|区|中心)$/, '');
  return Boolean(short && msg.includes(short));
}

/** 从话术提取旅居目的地短键（用于换城解锁） */
export function extractTravelDestinationKey(text = '') {
  const msg = String(text || '');
  if (/防城港|东兴|嘉路|白浪滩|簕山|京族|十万大山/.test(msg)) return '防城港';
  if (/七洞/.test(msg)) return '七洞乡';
  if (/来宾/.test(msg)) return '来宾';
  if (/北海|银滩|涠洲/.test(msg)) return '北海';
  if (/桂林|阳朔|荔浦/.test(msg)) return '桂林';
  if (/巴马|百魔洞|赐福湖/.test(msg)) return '巴马';
  if (/南宁/.test(msg)) return '南宁';
  if (/柳州/.test(msg)) return '柳州';
  return '';
}

/** 两目的地是否同城/可继承（七洞乡≈来宾；北海≠七洞） */
export function travelDestinationsCompatible(a, b) {
  const na = normalizeTravelDestKey(a);
  const nb = normalizeTravelDestKey(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  const aliases = {
    七洞乡: ['七洞', '来宾'],
    七洞: ['七洞乡', '来宾'],
    来宾: ['七洞', '七洞乡'],
    防城港: ['东兴', '嘉路'],
    东兴: ['防城港', '嘉路'],
    嘉路: ['防城港', '东兴'],
    桂林: ['阳朔'],
    阳朔: ['桂林'],
  };
  return (aliases[na] || []).includes(nb) || (aliases[nb] || []).includes(na);
}

function normalizeTravelDestKey(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const hit = extractTravelDestinationKey(raw);
  if (hit) return hit;
  return raw
    .replace(/^(广西|云南|海南|福建)/, '')
    .replace(/(壮族自治区|市|县|区|乡|镇)$/g, '')
    .trim();
}
