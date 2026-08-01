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

import crypto from 'node:crypto';
import https from 'node:https';

const DEFAULT_TIMEOUT = 8000;

export class TencentMapAdapter {
  constructor(config = {}) {
    this.key = config.key || process.env.TENCENT_MAP_KEY || '';
    this.sk = config.sk || process.env.TENCENT_MAP_SK || '';
    this.baseUrl = 'https://apis.map.qq.com/ws';
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
  }

  /**
   * 腾讯地图 API 签名计算（SK 类型 Key 必须）
   *
   * 正确算法（已验证通过）：
   *   1. 取 path = /ws{endpoint}（如 /ws/geocoder/v1/）
   *   2. 将所有参数（含 key）按参数名字母升序排列
   *   3. 用原始值（不 URL 编码）拼接：key1=val1&key2=val2
   *   4. 拼接签名原文：path?sortedParams + SK（SK 直接追加，不加 &）
   *   5. MD5 → 小写 hex → 作为 sig 参数
   */
  _sign(endpoint, params) {
    if (!this.sk) return '';

    // 将 key 加入参数列表，一起参与排序
    const signParams = { ...params, key: this.key };
    delete signParams.sig;

    const sortedQuery = Object.keys(signParams)
      .sort()
      .map((k) => `${k}=${signParams[k]}`)
      .join('&');

    // 签名原文：path?sortedParams+SK
    const raw = `/ws${endpoint}?${sortedQuery}${this.sk}`;
    return crypto.createHash('md5').update(raw, 'utf8').digest('hex');
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
   * HTTP GET 请求
   */
  async _get(endpoint, params = {}) {
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

    // 签名参数（不含 sig 自身）
    const params = {
      center: `${center.lat},${center.lng}`,
      zoom,
      size,
    };

    // 构造 markers 参数：coord:lat,lng;title:xxx
    if (markers.length) {
      const parts = markers.slice(0, 30).map((m) => {
        const title = (m.name || '').slice(0, 10);
        return `coord:${m.lat},${m.lng};title:${title}`;
      });
      params.markers = parts.join('|');
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
}

export default TencentMapAdapter;