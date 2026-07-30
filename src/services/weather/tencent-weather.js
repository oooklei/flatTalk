// 腾讯天气适配器（实时天气 / 多日预报）
// 依赖腾讯位置服务天气接口：
//   GET {baseUrl}/ws/weather/v1/?city={city}&key={key}
// 文档：https://lbs.qq.com/service/weather/weatherguide
// 注意：天气接口与腾讯地图共用同一个 key（TENCENT_MAP_KEY）。

export function createTencentWeatherAdapter(options = {}) {
  const baseUrl = String(options.baseUrl || process.env.TENCENT_WEATHER_BASE_URL || 'https://apis.map.qq.com').replace(/\/+$/, '');
  const key = options.key != null ? options.key : (process.env.TENCENT_MAP_KEY || '');
  const timeoutMs = Number(options.timeoutMs) || 6000;

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

    const url = `${baseUrl}/ws/weather/v1/?city=${encodeURIComponent(String(city).trim())}&key=${encodeURIComponent(key)}`;
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
          city,
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
          city,
          source: 'tencent_weather',
          status: json.status,
          error: json.message || '腾讯天气接口返回错误',
        };
      }

      const result = json.result || {};
      const realtime = result.realtime || {};
      const forecast = Array.isArray(result.forecast) ? result.forecast : [];
      const limit = Math.max(1, Number(days) || 5);
      const forecasts = forecast.slice(0, limit).map((f) => ({
        date: f.date || '',
        week: f.week || '',
        weather: f.dayWeather || f.weather || '',
        nightWeather: f.nightWeather || '',
        tempDay: f.dayTemp != null ? f.dayTemp : (f.tempDay != null ? f.tempDay : ''),
        tempNight: f.nightTemp != null ? f.nightTemp : (f.tempNight != null ? f.tempNight : ''),
        wind: [f.dayWindDir, f.dayWindPower].filter(Boolean).join(' ') || '',
      }));

      return {
        ok: true,
        city,
        source: 'tencent_weather',
        updatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
        current: {
          weather: realtime.weather || '',
          temp: realtime.temp,
          windDir: realtime.windDir || '',
          windPower: realtime.windPower || '',
          humidity: realtime.humidity || '',
          feelTemp: realtime.feelTemp,
        },
        forecasts,
      };
    } catch (err) {
      return {
        ok: false,
        degraded: 'network_error',
        city,
        source: 'tencent_weather',
        error: err && err.message ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    getWeather,
    baseUrl,
    keyMasked: key ? '***' : '',
  };
}
