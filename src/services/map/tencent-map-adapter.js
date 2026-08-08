/**
 * 腾讯地图 API 适配器
 *
 * 支持接口：
 * - geocode: 地址转坐标
 * - regeocode: 坐标转地址
 * - locateByIP: IP 定位
 * - suggestion: 地点建议
 * - searchNearby: 周边 POI 搜索
 */

import https from 'node:https';
import {
  getActiveWsPair,
  getOrderedWsKeyPairs,
  isWsQuotaStatus,
  markWsKeyExhausted,
  signWsRequest,
} from './tencent-key-pool.js';

const DEFAULT_TIMEOUT = 8000;

export class TencentMapAdapter {
  constructor(config = {}) {
    // 显式传入 key 时不走池；否则从 Key 池取当前可用主 Key
    const active = (!config.key) ? getActiveWsPair() : null;
    this.key = config.key || active?.key || process.env.TENCENT_MAP_KEY || '';
    this.sk = config.sk != null ? config.sk : (active?.sk ?? process.env.TENCENT_MAP_SK || '');
    this.keyId = config.keyId || active?.id || (this.key ? 'primary' : '');
    this.baseUrl = 'https://apis.map.qq.com/ws';
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this._fixedKey = Boolean(config.key);
  }

  _usePair(pair) {
    this.key = pair.key;
    this.sk = pair.sk || '';
    this.keyId = pair.id;
  }

  /**
   * 腾讯地图 API 签名计算（SK 类型 Key 必须）
   */
  _sign(endpoint, params) {
    return signWsRequest(`/ws${endpoint}`, params, { key: this.key, sk: this.sk });
  }

  /**
   * 构建带签名的 URL
   */
  _buildUrl(endpoint, params = {}) {
    const paramStr = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null)
      .map((k) => `${k}=${encodeURIComponent(params[k])}`)
      .join('&');

    let url = paramStr
      ? `${this.baseUrl}${endpoint}?${paramStr}&key=${this.key}`
      : `${this.baseUrl}${endpoint}?key=${this.key}`;

    const sig = this._sign(endpoint, params);
    if (sig) url += '&sig=' + sig;
    return url;
  }

  /**
   * HTTP GET 请求（配额 120/121 时自动切备用 Key）
   */
  async _get(endpoint, params = {}) {
    const pairs = this._fixedKey
      ? [{ id: this.keyId || 'fixed', key: this.key, sk: this.sk }]
      : getOrderedWsKeyPairs();
    if (!pairs.length) {
      throw new Error('未配置 TENCENT_MAP_KEY');
    }

    let lastError = null;
    for (let i = 0; i < pairs.length; i += 1) {
      const pair = pairs[i];
      if (!this._fixedKey) this._usePair(pair);
      try {
        return await this._getOnce(endpoint, params);
      } catch (e) {
        lastError = e;
        const msg = String(e?.message || e);
        const statusMatch = msg.match(/status\s*=\s*(\d+)/i);
        const status = statusMatch ? Number(statusMatch[1]) : null;
        const quotaLike = isWsQuotaStatus(status) || /每日调用量|quota/i.test(msg);
        if (quotaLike && !this._fixedKey && i < pairs.length - 1) {
          markWsKeyExhausted(pair, { reason: msg.slice(0, 80) });
          continue;
        }
        throw e;
      }
    }
    throw lastError || new Error('腾讯地图 Key 池耗尽');
  }

  async _getOnce(endpoint, params = {}) {
    const url = this._buildUrl(endpoint, params);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Tencent Map API timeout'));
      }, this.timeout);

      https
        .get(
          url,
          {
            headers: { 'User-Agent': 'flatTalk/1.0' },
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
              clearTimeout(timer);
              try {
                const result = JSON.parse(body);
                if (result.status === 0) {
                  resolve(result);
                } else if (result.status === 111) {
                  reject(new Error('腾讯地图签名验证失败 (SK 未配置或错误)'));
                } else {
                  reject(new Error(`腾讯地图错误: ${result.message} (status=${result.status})`));
                }
              } catch (e) {
                reject(new Error(`腾讯地图响应解析失败: ${body.substring(0, 200)}`));
              }
            });
          }
        )
        .on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  /**
   * 地理编码 - 地址转坐标
   */
  async geocode(address) {
    const result = await this._get('/geocoder/v1/', { address });
    return {
      lat: result.result?.location?.lat,
      lng: result.result?.location?.lng,
      formatted_address: result.result?.address || address,
      precision: result.result?.precision || 0,
    };
  }

  /**
   * 逆地理编码 - 坐标转地址
   */
  async regeocode(lat, lng, coord_type = 5) {
    const result = await this._get('/geocoder/v1/', {
      location: `${lat},${lng}`,
      coord_type,
    });

    const res = result.result || {};
    return {
      address: res.address || '',
      formatted_addresses: {
        recommend: res.formatted_addresses?.recommend || res.address || '',
        rough: res.formatted_addresses?.rough || '',
      },
      address_component: {
        nation: res.address_component?.nation || '',
        province: res.address_component?.province || '',
        city: res.address_component?.city || '',
        district: res.address_component?.district || '',
        street: res.address_component?.street || '',
        street_number: res.address_component?.street_number || '',
      },
      ad_info: {
        adcode: res.ad_info?.adcode || '',
        city_code: res.ad_info?.city_code || '',
        nation: res.ad_info?.nation || '',
        province: res.ad_info?.province || '',
        city: res.ad_info?.city || '',
        district: res.ad_info?.district || '',
      },
    };
  }

  /**
   * IP 定位
   */
  async locateByIP(ip = '') {
    const params = ip ? { ip } : { ip: '0.0.0.0' };
    const result = await this._get('/location/v1/ip', params);

    const res = result.result || {};
    return {
      ip: res.ip || ip,
      location: {
        lat: res.location?.lat || 0,
        lng: res.location?.lng || 0,
      },
      ad_info: {
        nation: res.ad_info?.nation || '',
        province: res.ad_info?.province || '',
        city: res.ad_info?.city || '',
        district: res.ad_info?.district || '',
        adcode: res.ad_info?.adcode || '',
      },
    };
  }

  /**
   * 地点建议（关键词提示）
   */
  async suggestion(keyword, options = {}) {
    const params = {
      keyword,
      region: options.region,
      city_limit: options.city_limit ? 'true' : undefined,
      location: options.location,
      page_size: options.page_size || 10,
      page_index: options.page_index || 1,
    };

    const result = await this._get('/place/v1/suggestion', params);
    const data = result.data || [];

    return data.map((item) => ({
      id: item.id || '',
      title: item.title || '',
      address: item.address || '',
      city: item.city || '',
      district: item.district || '',
      type: item.type || '',
      location: {
        lat: item.location?.lat || 0,
        lng: item.location?.lng || 0,
      },
      ad_info: {
        adcode: item.ad_info?.adcode || '',
        province: item.ad_info?.province || '',
        city: item.ad_info?.city || '',
        district: item.ad_info?.district || '',
      },
      distance: item._distance || 0,
    }));
  }

  /**
   * 构建静态图 URL（降级用）
   *
   * 腾讯静态图 API: /ws/staticmap/v2
   * 用于 JS API 加载失败时的中间降级层（比 SVG 示意图更真实）。
   * markers 最多取前 30 个，避免 URL 过长。
   */
  buildStaticMapUrl(center, markers = [], options = {}) {
    const zoom = options.zoom || 11;
    const size = options.size || '600*420';
    const scale = options.scale || 2; // 默认高清（腾讯官方 scale=2 返回2倍像素）
    const maptype = options.maptype || 'roadmap'; // roadmap | satellite | terrain

    // 签名参数（不含 sig 自身）
    const params = {
      center: `${center.lat},${center.lng}`,
      zoom,
      size,
      scale, // 高清参数：scale=2 时实际像素 = size × 2
      maptype,
    };

    // 腾讯静态图 markers 格式：markers=color:blue|size:mid|lat,lng|lat,lng
    if (markers.length) {
      const points = markers.slice(0, 30)
        .filter((m) => Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng)))
        .map((m) => `${Number(m.lat)},${Number(m.lng)}`);
      if (points.length) params.markers = ['color:blue', 'size:mid', ...points].join('|');
    }

    const sig = this._sign('/staticmap/v2', params);
    const paramStr = Object.keys(params)
      .map((k) => `${k}=${encodeURIComponent(params[k])}`)
      .join('&');

    let url = `${this.baseUrl}/staticmap/v2?${paramStr}&key=${this.key}`;
    if (sig) url += '&sig=' + sig;
    return url;
  }

  /**
   * 周边 POI 搜索
   */
  async searchNearby(keyword, lat, lng, radius = 1000, pageSize = 10) {
    const result = await this._get('/place/v1/search', {
      keyword,
      boundary: `nearby(${lat},${lng},${radius})`,
      page_size: pageSize,
      page_index: 1,
    });

    const pois = result?.data || [];
    return pois.map((poi) => ({
      id: poi.id || '',
      title: poi.title || '',
      address: poi.address || '',
      tel: poi.tel || '',
      type: poi.type || '',
      category: poi.category || '',
      location: {
        lat: poi.location?.lat || 0,
        lng: poi.location?.lng || 0,
      },
      distance: poi._distance || 0,
      ad_info: {
        adcode: poi.ad_info?.adcode || '',
        province: poi.ad_info?.province || '',
        city: poi.ad_info?.city || '',
        district: poi.ad_info?.district || '',
      },
    }));
  }
  /**
   * 路线规划（驾车）
   * 腾讯地图 direction/v1/driving 接口
   */
  async routePlanning(from, to, via = '', policy = 1) {
    const params = { from, to, policy };
    if (via) params.via = via;
    const result = await this._get('/direction/v1/driving/', params);
    const routes = result.result?.routes || [];
    if (!routes.length) return { ok: false, message: '未找到可行路线' };
    const route = routes[0];
    // 解码 polyline（腾讯返回压缩编码的点串）
    return {
      ok: true,
      distance: route.distance,
      duration: route.duration,
      polyline: this._decodePolyline(route.polyline || []),
      coors: route.polyline || [],
    };
  }

  /**
   * 解码腾讯地图 polyline（每两个数值为一个坐标点，已为 lat,lng 微小数格式）
   */
  _decodePolyline(coors = []) {
    if (!coors.length) return [];
    const points = [];
    for (let i = 0; i < coors.length - 1; i += 2) {
      points.push({ lat: coors[i], lng: coors[i + 1] });
    }
    return points;
  }

  /**
   * 获取行政区划边界（区县级别）
   * 腾讯地图 district/v1/list 接口
   * @param {string} keywords - 搜索关键词（如"巴马瑶族自治县"、"防城港"）
   * @param {string} level - 行政级别：province/city/district
   * @returns {Promise<{ok: boolean, polygons: Array<Array<{lat: number, lng: number}>>}>}
   */
  async getDistrictBoundary(keywords, level = 'district') {
    const params = {
      keywords,
      sub_district: 0,
      page_size: 1,
      output: 'json',
    };

    const result = await this._get('/district/v1/list', params);
    const districts = result.result?.[0] || [];

    if (!districts.length) {
      return { ok: false, message: '未找到行政区划', polygons: [] };
    }

    const district = districts[0];
    const polygons = (district.polygon || []).map((poly) => {
      // 腾讯返回的 polygon 格式：[[lat1, lng1, lat2, lng2, ...], ...]
      return this._decodePolyline(poly);
    });

    return {
      ok: true,
      adcode: district.adcode,
      name: district.name,
      center: district.location,
      polygons,
    };
  }

  /**
   * 获取子级行政区列表
   * @param {string} adcode - 上级行政区编码（如广西壮族自治区：450000）
   * @param {string} level - 子级级别：province/city/district
   */
  async getSubDistricts(adcode, level = 'district') {
    const params = {
      id: adcode,
      sub_district: level === 'province' ? 1 : level === 'city' ? 2 : 3,
      output: 'json',
    };

    const result = await this._get('/district/v1/list', params);
    return {
      ok: true,
      districts: result.result?.[0] || [],
    };
  }
}

export default TencentMapAdapter;
