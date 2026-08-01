/**
 * 前端定位服务 — 按容器类型探测最优定位方式，逐级降级。
 * 优先级: Flutter JSBridge > 浏览器 GPS > IP 定位 > 默认坐标
 */
(function () {
  const CACHE_KEY = 'flattalk_location';
  const CACHE_TTL = 30 * 60 * 1000; // 30 分钟
  const DEFAULT_CENTER = { lat: 21.4906, lng: 109.1199, source: 'default', accuracy: null };

  function detectContainer() {
    if (window.FlatTalkNative?.getLocation) return 'flutter';
    if (window.flutter_inappwebview) return 'flutter_inappwebview';
    if (/MicroMessenger/i.test(navigator.userAgent)) return 'wechat';
    if (navigator.geolocation) return 'browser';
    return 'unknown';
  }

  function getCached() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() - data.ts > CACHE_TTL) return null;
      return data;
    } catch { return null; }
  }

  function setCache(loc) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...loc, ts: Date.now() })); } catch {}
  }

  function flutterLocation() {
    if (window.FlatTalkNative?.getLocation) {
      return Promise.resolve(window.FlatTalkNative.getLocation())
        .then((r) => {
          if (r && typeof r.lat === 'number') return { lat: r.lat, lng: r.lng, source: 'flutter', accuracy: r.accuracy || null };
          throw new Error('flutter_bridge_empty');
        });
    }
    return Promise.reject(new Error('no_flutter_bridge'));
  }

  function browserLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('no_geolocation'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps', accuracy: pos.coords.accuracy || null }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 }
      );
    });
  }

  async function ipLocation() {
    const res = await fetch('/api/open/v1/map/locate-by-ip');
    if (!res.ok) throw new Error('ip_locate_failed');
    const data = await res.json();
    if (data.lat && data.lng) return { lat: data.lat, lng: data.lng, source: 'ip', accuracy: data.accuracy || null };
    throw new Error('ip_locate_empty');
  }

  async function detect() {
    // 1. 读缓存
    const cached = getCached();
    if (cached) return { ...cached, cached: true };

    const container = detectContainer();

    // 2. 按容器探测，逐级降级
    const chain = [];
    if (container === 'flutter' || container === 'flutter_inappwebview') chain.push(flutterLocation);
    // 微信容器: 暂跳过 JS-SDK（无公众号配置），直接走 IP
    if (container === 'wechat') chain.push(ipLocation);
    if (container === 'browser') chain.push(browserLocation);
    // 兜底
    chain.push(ipLocation);

    for (const fn of chain) {
      try {
        const loc = await fn();
        if (loc && typeof loc.lat === 'number') {
          setCache(loc);
          return loc;
        }
      } catch (e) { /* try next */ }
    }

    // 3. 全部失败 → 默认坐标
    return DEFAULT_CENTER;
  }

  window.locationService = { detect, detectContainer, getCached, CACHE_TTL };
})();
