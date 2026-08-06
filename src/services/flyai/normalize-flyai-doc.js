import crypto from 'node:crypto';

const LINKED_TITLE_RE = /\*\*\[([^\]]+)\]\([^)]+\)\*\*/g;

export function extractTitlesFromMarkdown(md) {
  if (!md) return [];
  const titles = [];
  let match;
  while ((match = LINKED_TITLE_RE.exec(md)) !== null) {
    titles.push(match[1]);
  }
  return titles;
}

function stripScenicSuffix(name) {
  return String(name || '').replace(/景区$/, '').trim();
}

function poiNamesAlign(poiName, title) {
  if (!poiName || !title) return false;
  if (poiName === title) return true;

  const strippedPoi = stripScenicSuffix(poiName);
  const strippedTitle = stripScenicSuffix(title);
  if (strippedPoi === strippedTitle) return true;
  if (poiName.includes(title) || title.includes(poiName)) return true;
  if (strippedPoi.includes(strippedTitle) || strippedTitle.includes(strippedPoi)) return true;
  return false;
}

function findPoi(poiList, title) {
  if (!Array.isArray(poiList) || poiList.length === 0) return null;
  return poiList.find((poi) => poiNamesAlign(poi.name, title)) || null;
}

function extractDocTitle(aiMarkdown, query) {
  if (aiMarkdown) {
    const heading = aiMarkdown.match(/^#{1,6}\s+(.+)$/m);
    if (heading) {
      return heading[1]
        .replace(/\*\*/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();
    }
  }
  return query || '';
}

function normalizeProducts(products) {
  if (!Array.isArray(products)) return [];
  return products
    .map((item) => {
      const info = item?.info || item || {};
      return {
        title: info.title,
        jumpUrl: info.jumpUrl,
        picUrl: info.picUrl,
      };
    })
    .filter((product) => product.title);
}

function buildContentHash(stableFields) {
  return crypto.createHash('md5').update(JSON.stringify(stableFields)).digest('hex');
}

export function normalizeFlyaiDoc(input = {}) {
  const {
    linked_route_id,
    query,
    aiMarkdown = '',
    poiList = [],
    products = [],
    keywords,
  } = input;

  const titles = extractTitlesFromMarkdown(aiMarkdown);
  const title = extractDocTitle(aiMarkdown, query);
  const normalizedProducts = normalizeProducts(products);

  const waypoints = titles.map((name, index) => {
    const poi = findPoi(poiList, name);
    const waypoint = {
      name,
      order: index + 1,
    };

    if (poi) {
      if (poi.id != null) waypoint.poi_id = String(poi.id);
      if (poi.latitude != null && poi.latitude !== '') {
        waypoint.lat = Number.parseFloat(poi.latitude);
      }
      if (poi.longitude != null && poi.longitude !== '') {
        waypoint.lng = Number.parseFloat(poi.longitude);
      }
    }

    return waypoint;
  });

  const text = [title, aiMarkdown, ...titles].filter(Boolean).join('\n');

  const stableFields = {
    linked_route_id,
    title,
    query,
    keywords,
    markdown: aiMarkdown,
    waypoints: waypoints.map(({ name, order, lat, lng, poi_id }) => ({
      name,
      order,
      lat,
      lng,
      poi_id,
    })),
    products: normalizedProducts,
  };

  return {
    source: 'flyai',
    linked_route_id,
    title,
    query,
    keywords,
    markdown: aiMarkdown,
    waypoints,
    products: normalizedProducts,
    text,
    content_hash: buildContentHash(stableFields),
  };
}
