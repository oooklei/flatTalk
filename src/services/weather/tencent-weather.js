import { captureToLocalKnowledge } from '../interface-knowledge-capture.js';
import crypto from 'node:crypto';
import {
  getOrderedWsKeyPairs,
  isWsQuotaStatus,
  markWsKeyExhausted,
} from '../map/tencent-key-pool.js';

const CITY_ADCODE = {
  北京: '110000',
  上海: '310000',
  天津: '120000',
  重庆: '500000',
  广州: '440100',
  深圳: '440300',
  南宁: '450100',
  广西南宁: '450100',
  北海: '450500',
  广西北海: '450500',
  桂林: '450300',
  广西桂林: '450300',
  柳州: '450200',
  防城港: '450600',
  广西防城港: '450600',
  东兴: '450681',
  巴马: '451227',
  广西巴马: '451227',
  百色: '451000',
  广西百色: '451000',
  钦州: '450700',
  广西钦州: '450700',
  崇左: '451400',
  广西崇左: '451400',
  昆明: '530100',
  大理: '532900',
  丽江: '530700',
  三亚: '460200',
  海口: '460100',
  厦门: '350200',
  杭州: '330100',
  成都: '510100',
};

/** P0：默认不仿真；options.allowSimFallback 或 FLATTALK_ALLOW_SIM_FALLBACK=1 才允许。 */
const ALLOW_SIM_FALLBACK = process.env.FLATTALK_ALLOW_SIM_FALLBACK === '1'
  || process.env.FLATTALK_WEATHER_ALLOW_SIM_FALLBACK === '1';
const DISABLE_SIM_FALLBACK = process.env.FLATTALK_DISABLE_SIM_FALLBACK === '1'
  || process.env.FLATTALK_WEATHER_DISABLE_SIM_FALLBACK === '1';

export function createTencentWeatherAdapter(options = {}) {
  const baseUrl = String(options.baseUrl || process.env.TENCENT_WEATHER_BASE_URL || 'https://apis.map.qq.com').replace(/\/+$/, '');
  const fixedKey = options.key != null;
  const key = fixedKey ? options.key : (process.env.TENCENT_MAP_KEY || '');
  const sk = options.sk != null ? options.sk : (process.env.TENCENT_MAP_SK || '');
  const timeoutMs = Number(options.timeoutMs) || 6000;
  const allowSimFallback = options.allowSimFallback === true
    || (ALLOW_SIM_FALLBACK && !DISABLE_SIM_FALLBACK && options.allowSimFallback !== false);

  function getAdcode(cityName) {
    const normalized = normalizeCityName(cityName);
    if (!normalized) return null;
    if (CITY_ADCODE[normalized]) return CITY_ADCODE[normalized];
    const compact = normalized.replace(/(壮族自治区|自治区|省|市|区|县|自治县|自治州|瑶族自治县)$/g, '');
    if (CITY_ADCODE[compact]) return CITY_ADCODE[compact];
    for (const [name, adcode] of Object.entries(CITY_ADCODE)) {
      if (name.includes(compact) || compact.includes(name)) return adcode;
    }
    return null;
  }

  async function getWeather(city, { days = 5 } = {}) {
    const cityName = normalizeCityName(city);
    const pairs = fixedKey
      ? (key ? [{ id: 'fixed', key, sk: sk || '' }] : [])
      : getOrderedWsKeyPairs();
    if (!pairs.length) {
      return fallbackWeather(cityName || city, 'no_key', '未配置 TENCENT_MAP_KEY，无法调用腾讯天气接口');
    }
    if (!cityName) {
      return fallbackWeather(city, 'no_city', '未提供城市名称');
    }

    const adcode = getAdcode(cityName);
    const params = adcode ? { adcode } : { city: cityName };

    let lastError = null;
    for (let pi = 0; pi < pairs.length; pi += 1) {
      const pair = pairs[pi];
      const url = buildTencentUrl(baseUrl, '/weather/v1/', { ...params, key: pair.key }, pair.sk);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const resp = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          });
          if (!resp.ok) {
            return fallbackWeather(cityName, 'http_error', `腾讯天气接口 HTTP ${resp.status}`, { http_status: resp.status });
          }
          const json = await resp.json().catch(() => ({}));
          if (json.status === 0) {
            const weatherData = normalizeTencentWeather(json, cityName, days);
            captureWeather(cityName, weatherData);
            return weatherData;
          }
          lastError = json;
          if (isWsQuotaStatus(json.status) || classifyTencentStatus(json.status) === 'quota_exceeded') {
            if (pi < pairs.length - 1) {
              markWsKeyExhausted(pair, { reason: `weather_${json.status}:${String(json.message || '').slice(0, 60)}` });
              break; // 试下一把 Key
            }
            if (attempt === 0) {
              await sleep(1200);
              continue;
            }
          }
          return fallbackWeather(cityName, classifyTencentStatus(json.status), json.message || '腾讯天气接口返回错误', {
            api_status: json.status,
          });
        } catch (err) {
          const reason = err?.name === 'AbortError' ? 'timeout' : 'network_error';
          lastError = { reason, message: err?.message || String(err) };
          if (attempt === 0 && reason !== 'timeout') {
            await sleep(500);
            continue;
          }
          if (pi < pairs.length - 1) break;
          return fallbackWeather(cityName, reason, err?.message || String(err));
        } finally {
          clearTimeout(timer);
        }
      }
    }
    return fallbackWeather(cityName, classifyTencentStatus(lastError?.status), lastError?.message || '腾讯天气接口返回错误', {
      api_status: lastError?.status || null,
    });
  }

  function fallbackWeather(cityName, reason, error, meta = {}) {
    const result = {
      ok: false,
      degraded: reason,
      city: cityName || '',
      source: 'tencent_weather',
      source_status: 'real_failed',
      error,
      ...meta,
    };
    if (!allowSimFallback) return result;
    return buildSimulatedWeather(cityName || '南宁', reason, error, meta);
  }

  return {
    getWeather,
    getWeatherByCity: getWeather,
    getAdcode,
    baseUrl,
    keyMasked: key ? '***' : '',
  };
}

function buildTencentUrl(baseUrl, endpoint, params, sk) {
  const sorted = Object.keys(params)
    .filter((item) => params[item] !== undefined && params[item] !== null && params[item] !== '')
    .sort();
  const queryForSig = sorted.map((item) => `${item}=${params[item]}`).join('&');
  const query = sorted.map((item) => `${item}=${encodeURIComponent(params[item])}`).join('&');
  const sig = sk
    ? crypto.createHash('md5').update(`/ws${endpoint}?${queryForSig}${sk}`, 'utf8').digest('hex')
    : '';
  return `${baseUrl}/ws${endpoint}?${query}${sig ? `&sig=${sig}` : ''}`;
}

function normalizeTencentWeather(json, cityName, days) {
  const result = json.result || {};
  const realtimeArr = Array.isArray(result.realtime) ? result.realtime : [];
  const rt = realtimeArr[0] || {};
  const infos = rt.infos || rt || {};
  const forecast = Array.isArray(result.forecast) ? result.forecast : [];
  const limit = Math.max(1, Number(days) || 5);
  const forecasts = forecast.slice(0, limit).map((f) => {
    const fi = f.infos || f;
    return {
      date: f.date || fi.date || '',
      week: f.week || fi.week || '',
      weather: fi.weather || fi.dayWeather || fi.day_weather || '',
      nightWeather: fi.nightWeather || fi.night_weather || '',
      tempDay: fi.max_temp ?? fi.dayTemp ?? fi.tempDay ?? '',
      tempNight: fi.min_temp ?? fi.nightTemp ?? fi.tempNight ?? '',
      wind: [fi.wind_direction || fi.windDir, fi.wind_power || fi.windPower].filter(Boolean).join(' ') || '',
    };
  });
  return {
    ok: true,
    city: cityName,
    source: 'tencent_weather',
    source_status: 'real_data',
    updatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    current: {
      weather: infos.weather || '',
      temp: infos.temperature ?? rt.temp ?? '',
      windDir: infos.wind_direction || infos.windDir || '',
      windPower: infos.wind_power || infos.windPower || '',
      humidity: infos.humidity != null ? String(infos.humidity) : '',
      feelTemp: infos.feels_like ?? rt.feelTemp ?? '',
    },
    forecasts,
  };
}

function normalizeCityName(city) {
  return String(city || '')
    .replace(/\s+/g, '')
    .replace(/路镇?的位置|您的位置|嘉路康养中心/g, '防城港')
    .replace(/^广西壮族自治区/, '广西')
    .trim();
}

function classifyTencentStatus(status) {
  if (status === 110 || status === 111) return 'auth_error';
  if (status === 120 || status === 121) return 'quota_exceeded';
  if (status === 199) return 'param_error';
  return 'api_error';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSimulatedWeather(cityName, reason, error, meta = {}) {
  const profile = simulatedProfile(cityName);
  const forecasts = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(Date.now() + index * 24 * 60 * 60 * 1000);
    return {
      date: date.toISOString().slice(0, 10),
      week: `周${'日一二三四五六'[date.getDay()]}`,
      weather: profile.forecast[index % profile.forecast.length],
      nightWeather: profile.night,
      tempDay: profile.dayTemp + (index % 2),
      tempNight: profile.nightTemp,
      wind: profile.wind,
    };
  });
  return {
    ok: true,
    city: cityName,
    source: 'tencent_weather',
    source_status: 'simulated_fallback',
    degraded: reason,
    error,
    ...meta,
    updatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    current: {
      weather: profile.current,
      temp: profile.dayTemp,
      windDir: profile.windDir,
      windPower: profile.windPower,
      humidity: String(profile.humidity),
      feelTemp: profile.dayTemp + 1,
    },
    forecasts,
    warnings: [`真实腾讯天气不可用，已启用仿真降级：${reason}`],
  };
}

function simulatedProfile(cityName) {
  if (/北海|防城港|东兴|钦州|三亚|海口/.test(cityName)) {
    return {
      current: '多云',
      forecast: ['多云', '阵雨', '多云', '小雨', '阴'],
      night: '阴',
      dayTemp: 30,
      nightTemp: 25,
      wind: '东南风 3级',
      windDir: '东南风',
      windPower: '3级',
      humidity: 78,
    };
  }
  if (/巴马|百色|桂林|崇左/.test(cityName)) {
    return {
      current: '阴',
      forecast: ['阴', '小雨', '多云', '阴', '阵雨'],
      night: '小雨',
      dayTemp: 28,
      nightTemp: 22,
      wind: '东北风 2级',
      windDir: '东北风',
      windPower: '2级',
      humidity: 72,
    };
  }
  return {
    current: '多云',
    forecast: ['多云', '阴', '多云', '小雨', '多云'],
    night: '阴',
    dayTemp: 29,
    nightTemp: 23,
    wind: '东风 2级',
    windDir: '东风',
    windPower: '2级',
    humidity: 70,
  };
}

function captureWeather(cityName, weatherData) {
  try {
    captureToLocalKnowledge({
      skillKey: 'travel_route',
      provider: 'tencent_weather',
      sourcePath: '腾讯天气',
      records: [{
        id: `weather_${cityName}_${new Date().toISOString().slice(0, 10)}`,
        type: 'weather',
        data: weatherData,
        capturedAt: new Date().toISOString(),
      }],
    });
  } catch {
    // Capture failure should not break weather risk cards.
  }
}
