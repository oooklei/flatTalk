// 腾讯天气适配器（实时天气 / 多日预报）
// 依赖腾讯位置服务天气接口：
//   GET {baseUrl}/ws/weather/v1/?adcode={adcode}&key={key}
//   GET {baseUrl}/ws/weather/v1/?location={lat},{lng}&key={key}
// 文档：https://lbs.qq.com/service/weather/weatherguide
// 注意：天气接口与腾讯地图共用同一个 key（TENCENT_MAP_KEY）。

// 常用城市 adcode 映射表（部分）
const CITY_ADCODE = {
  '北京': '110000', '北京市': '110000',
  '上海': '310000', '上海市': '310000',
  '天津': '120000', '天津市': '120000',
  '重庆': '500000', '重庆市': '500000',
  '广州': '440100', '广州市': '440100',
  '深圳': '440300', '深圳市': '440300',
  '珠海': '440400', '珠海市': '440400',
  '东莞': '441900', '东莞市': '441900',
  '佛山': '440600', '佛山市': '440600',
  '中山': '442000', '中山市': '442000',
  '惠州': '441300', '惠州市': '441300',
  '南宁': '450100', '南宁市': '450100',
  '北海': '450500', '北海市': '450500',
  '桂林': '450300', '桂林市': '450300',
  '柳州': '450200', '柳州市': '450200',
  '巴马': '451223', '巴马瑶族自治县': '451223',
  '昆明': '530100', '昆明市': '530100',
  '大理': '532900', '大理白族自治州': '532900',
  '丽江': '530700', '丽江市': '530700',
  '西双版纳': '532800', '版纳': '532800',
  '海口': '460100', '海口市': '460100',
  '三亚': '460200', '三亚市': '460200',
  '文昌': '469005', '文昌市': '469005',
  '琼海': '469002', '琼海市': '469002',
  '成都': '510100', '成都市': '510100',
  '杭州': '330100', '杭州市': '330100',
  '苏州': '320500', '苏州市': '320500',
  '南京': '320100', '南京市': '320100',
  '武汉': '420100', '武汉市': '420100',
  '长沙': '430100', '长沙市': '430100',
  '郑州': '410100', '郑州市': '410100',
  '西安': '610100', '西安市': '610100',
  '青岛': '370200', '青岛市': '370200',
  '大连': '210200', '大连市': '210200',
  '厦门': '350200', '厦门市': '350200',
  '福州': '350100', '福州市': '350100',
  '哈尔滨': '230100', '哈尔滨市': '230100',
  '沈阳': '210100', '沈阳市': '210100',
  '长春': '220100', '长春市': '220100',
};

export function createTencentWeatherAdapter(options = {}) {
  const baseUrl = String(options.baseUrl || process.env.TENCENT_WEATHER_BASE_URL || 'https://apis.map.qq.com').replace(/\/+$/, '');
  const key = options.key != null ? options.key : (process.env.TENCENT_MAP_KEY || '');
  const timeoutMs = Number(options.timeoutMs) || 6000;

  /**
   * 根据城市名获取 adcode
   * @param {string} cityName 城市名（如 "北海"、"北海市"、"广西北海"）
   * @returns {string|null} adcode 或 null
   */
  function getAdcode(cityName) {
    if (!cityName) return null;
    
    // 直接匹配
    if (CITY_ADCODE[cityName]) {
      return CITY_ADCODE[cityName];
    }
    
    // 去除省市后缀匹配
    const name = cityName.replace(/[省市自治区州县]/g, '');
    for (const [key, adcode] of Object.entries(CITY_ADCODE)) {
      if (key.includes(name) || name.includes(key.replace(/[省市]/g, ''))) {
        return adcode;
      }
    }
    
    return null;
  }

  async function getWeather(city, { days = 5 } = {}) {
    if (!key) {
      return {
        ok: false,
        degraded: 'no_key',
        city,
        source: 'tencent_weather',
        error: '未配置 TENCENT_MAP_KEY，无法调用腾讯天气接口',
      };
    }
    if (!city || !String(city).trim()) {
      return {
        ok: false,
        degraded: 'no_city',
        city,
        source: 'tencent_weather',
        error: '未提供城市名称',
      };
    }

    const cityName = String(city).trim();
    
    // 获取 adcode
    const adcode = getAdcode(cityName);
    
    // 构建请求 URL（优先使用 adcode，其次使用城市名）
    let url;
    if (adcode) {
      url = `${baseUrl}/ws/weather/v1/?adcode=${adcode}&key=${encodeURIComponent(key)}`;
      console.log(`[TencentWeather] 使用 adcode=${adcode} 查询 ${cityName} 天气`);
    } else {
      // 如果没有找到 adcode，尝试直接使用城市名（可能失败）
      url = `${baseUrl}/ws/weather/v1/?city=${encodeURIComponent(cityName)}&key=${encodeURIComponent(key)}`;
      console.log(`[TencentWeather] 未找到 ${cityName} 的 adcode，尝试直接查询`);
    }
    
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) {
        return {
          ok: false,
          degraded: 'http_error',
          city: cityName,
          source: 'tencent_weather',
          status: resp.status,
          error: `腾讯天气接口 HTTP ${resp.status}`,
        };
      }
      const json = await resp.json();
      if (json.status !== 0) {
        return {
          ok: false,
          degraded: 'api_error',
          city: cityName,
          source: 'tencent_weather',
          status: json.status,
          error: json.message || '腾讯天气接口返回错误',
        };
      }

      const result = json.result || {};
      // 腾讯天气 API 实际返回结构：result.realtime 是数组，天气数据在 realtime[0].infos 中
      const realtimeArr = Array.isArray(result.realtime) ? result.realtime : [];
      const rt = realtimeArr[0] || {};
      const infos = rt.infos || {};
      const forecast = Array.isArray(result.forecast) ? result.forecast : [];
      const limit = Math.max(1, Number(days) || 5);
      const forecasts = forecast.slice(0, limit).map((f) => {
        // forecast 也可能是 { infos: {...} } 结构
        const fi = f.infos || f;
        return {
          date: f.date || fi.date || '',
          week: f.week || fi.week || '',
          weather: fi.weather || fi.dayWeather || '',
          nightWeather: fi.nightWeather || '',
          tempDay: fi.max_temp != null ? fi.max_temp : (fi.dayTemp != null ? fi.dayTemp : (fi.tempDay != null ? fi.tempDay : '')),
          tempNight: fi.min_temp != null ? fi.min_temp : (fi.nightTemp != null ? fi.nightTemp : (fi.tempNight != null ? fi.tempNight : '')),
          wind: [fi.wind_direction, fi.wind_power].filter(Boolean).join(' ') || '',
        };
      });

      return {
        ok: true,
        city: cityName,
        source: 'tencent_weather',
        updatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
        current: {
          weather: infos.weather || '',
          temp: infos.temperature != null ? infos.temperature : rt.temp,
          windDir: infos.wind_direction || '',
          windPower: infos.wind_power || '',
          humidity: infos.humidity != null ? String(infos.humidity) : '',
          feelTemp: infos.feels_like != null ? infos.feels_like : rt.feelTemp,
        },
        forecasts,
      };
    } catch (err) {
      return {
        ok: false,
        degraded: 'network_error',
        city: cityName,
        source: 'tencent_weather',
        error: err && err.message ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    getWeather,
    getWeatherByCity: getWeather, // 别名，兼容不同调用方式
    getAdcode,
    baseUrl,
    keyMasked: key ? '***' : '',
  };
}