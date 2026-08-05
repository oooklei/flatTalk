/**
 * 地图前端渲染器（通用 TMap 桥接）
 * 支持 3 种模式（由 data-map-mode 属性决定）：
 *   route — 走线：Polyline 连线 + 多类型 Marker + 景点图层 + InfoWindow
 *   base  — 基地中心：同类 Marker + 中心定位
 *   poi   — POI 中心：散点 Marker（按分类着色）+ 雷达半径
 *
 * 用法（模板内）：
 *   <div id="mapCanvas" data-map-mode="route"
 *        data-center='{...}' data-waypoints='[...]' data-spots='[...]' ...></div>
 *   <script src="/api/map/bridge"></script>
 *   或内联调用：window.flatMapKit.render(document.getElementById('mapCanvas'));
 *
 * 降级：TMap 加载失败时自动渲染 SVG 方位图。
 */
window.flatMapKit = (function () {
  // Marker 图标：SVG pin（按颜色+标签生成）
  function pinSvg(color, label) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42">' +
      '<path d="M16 1C8 1 3 6 3 13c0 10 13 28 13 28s13-18 13-28c0-7-5-12-13-12z" fill="' + color + '" stroke="#fff" stroke-width="2"/>' +
      '<text x="16" y="18" text-anchor="middle" font-size="13" fill="#fff" font-weight="700" font-family="system-ui">' + label + '</text></svg>'
    );
  }
  function dotSvg(color) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
      '<circle cx="10" cy="10" r="8" fill="' + color + '" stroke="#fff" stroke-width="2"/></svg>'
    );
  }

  // 走线模式 Marker 类型样式
  var ROUTE_STYLES = {
    arrival:   { color: '#2E7D32', label: '抵' },
    spot:      { color: '#FF7826', label: '游' },
    wellness:  { color: '#1976D2', label: '养' },
    departure: { color: '#D32F2F', label: '返' },
    base:      { color: '#7B1FA2', label: '宿' },
    default:   { color: '#FF7826', label: '·' },
  };

  // POI 模式分类颜色
  var POI_COLORS = {
    medical: '#E53935', wellness: '#1976D2', stay: '#7B1FA2',
    food: '#FB8C00', spot: '#FF7826', default: '#9AA7B2',
  };

  function poiColor(cat) {
    return (POI_COLORS[cat] || POI_COLORS.default);
  }

  // SVG 降级：画一个简易方位图
  function renderFallback(el, data) {
    var center = data.center || { lat: 0, lng: 0 };
    var points = data.waypoints || data.pois || data.markers || [];
    var svg = '<div style="padding:8px;background:#f0f4f8;border-radius:8px;text-align:center;">';
    svg += '<svg viewBox="0 0 200 160" style="width:100%;max-width:400px;">';
    svg += '<rect x="0" y="0" width="200" height="160" fill="#E8EEF4" rx="8"/>';
    // 画连线
    if (points.length > 1 && data.mode === 'route') {
      var path = points.map(function (p, i) {
        var x = 20 + (i / (points.length - 1)) * 160;
        var y = 80 + Math.sin(i * 1.3) * 30;
        return (i === 0 ? 'M' : 'L') + x + ',' + y;
      }).join(' ');
      svg += '<path d="' + path + '" stroke="#0E7C86" stroke-width="2" fill="none" stroke-dasharray="4,3"/>';
    }
    // 画点
    points.forEach(function (p, i) {
      var x = 20 + (points.length > 1 ? (i / (points.length - 1)) * 160 : 80);
      var y = 80 + (points.length > 1 ? Math.sin(i * 1.3) * 30 : 0);
      svg += '<circle cx="' + x + '" cy="' + y + '" r="5" fill="#FF7826" stroke="#fff" stroke-width="1.5"/>';
      if (p.name) svg += '<text x="' + x + '" y="' + (y - 10) + '" text-anchor="middle" font-size="8" fill="#333">' + (p.name || '').slice(0, 4) + '</text>';
    });
    svg += '<text x="100" y="150" text-anchor="middle" font-size="9" fill="#888">' + (center.name || '地图预览') + '</text>';
    svg += '</svg>';
    svg += '<p style="font-size:11px;color:#999;margin:4px 0 0;">地图组件加载失败，显示降级示意图</p>';
    svg += '</div>';
    el.innerHTML = svg;
  }

  // 从 DOM data-* 属性读取 JSON 数据
  function readData(el) {
    function parse(attr) {
      if (!el.dataset[attr]) return null;
      try { return JSON.parse(el.dataset[attr]); } catch (e) { return null; }
    }
    return {
      mode: el.dataset.mapMode || 'route',
      center: parse('center') || { lat: parseFloat(el.dataset.centerLat) || 0, lng: parseFloat(el.dataset.centerLng) || 0, name: el.dataset.centerName || '' },
      waypoints: parse('waypoints') || [],
      spots: parse('spots') || [],
      markers: parse('markers') || [],
      pois: parse('pois') || parse('markers') || [],
      polylinePath: parse('polylinePath') || [],
      fitBounds: parse('fitBounds'),
      mapKey: el.dataset.mapKey || '',
      staticMapUrl: el.dataset.staticMapUrl || '',
      radiusKm: parseFloat(el.dataset.radiusKm) || 0,
    };
  }

  // 等待 TMap SDK 加载
  function waitForTMap(callback, timeout) {
    if (typeof window.TMap !== 'undefined') { callback(); return; }
    var elapsed = 0;
    var timer = setInterval(function () {
      elapsed += 100;
      if (typeof window.TMap !== 'undefined') {
        clearInterval(timer);
        callback();
      } else if (elapsed > (timeout || 5000)) {
        clearInterval(timer);
        callback(new Error('TMap SDK 加载超时'));
      }
    }, 100);
  }

  // 动态加载 TMap SDK
  function loadTMapScript(key) {
    if (typeof window.TMap !== 'undefined') return;
    if (document.getElementById('tmap-sdk-script')) return;
    var s = document.createElement('script');
    s.id = 'tmap-sdk-script';
    s.src = 'https://map.qq.com/api/gljs?v=1.exp&key=' + encodeURIComponent(key || '');
    s.async = true;
    document.head.appendChild(s);
  }

  // 主渲染入口
  function render(el) {
    if (!el) return;
    // 静态 SVG 走线卡自管交互，禁止当 TMap 容器渲染（否则会清空 body）
    var modeAttr = String(el.getAttribute('data-map-mode') || el.dataset?.mapMode || '');
    if (modeAttr === 'static_svg') return;
    var data = readData(el);
    if (!data.mapKey) { renderFallback(el, data); return; }

    loadTMapScript(data.mapKey);
    waitForTMap(function (err) {
      if (err || typeof window.TMap === 'undefined') { renderFallback(el, data); return; }
      try {
        if (data.mode === 'route') renderRoute(el, data);
        else if (data.mode === 'base') renderBase(el, data);
        else if (data.mode === 'poi') renderPoi(el, data);
        else renderRoute(el, data); // 默认走线
      } catch (e) {
        console.warn('[map-kit] 渲染失败，降级:', e);
        renderFallback(el, data);
      }
    });
  }

  // ===================== route 模式 =====================
  function renderRoute(el, data) {
    var T = window.TMap;
    var center = data.center;
    var wps = data.waypoints || [];
    var spots = data.spots || [];

    var mapOptions = { zoom: 9, center: new T.LatLng(center.lat, center.lng) };
    // fitBounds 自动缩放
    if (data.fitBounds && data.fitBounds.minLat != null) {
      try {
        mapOptions.center = new T.LatLng(
          (data.fitBounds.minLat + data.fitBounds.maxLat) / 2,
          (data.fitBounds.minLng + data.fitBounds.maxLng) / 2
        );
      } catch (e) { /* 用 center */ }
    }
    var map = new T.Map(el, mapOptions);

    // 1. Polyline 走线
    if (wps.length >= 2) {
      var path = wps.map(function (wp) { return new T.LatLng(wp.lat, wp.lng); });
      new T.MultiPolyline({
        map: map,
        geometries: [{ id: 'route', styleId: 'route', paths: path }],
        styles: { route: new T.PolylineStyle({ color: '#0E7C86', width: 4, borderWidth: 1, borderColor: '#fff', lineCap: 'round' }) },
      });
    }

    // 2. 途经点 Marker（按 type 着色）
    if (wps.length) {
      var geometries = [];
      var styles = {};
      wps.forEach(function (wp, i) {
        var st = ROUTE_STYLES[wp.type] || ROUTE_STYLES.default;
        var styleId = wp.type || 'default';
        if (!styles[styleId]) {
          styles[styleId] = new T.MarkerStyle({ width: 32, height: 42, anchor: { x: 16, y: 42 }, src: pinSvg(st.color, st.label) });
        }
        geometries.push({ id: 'wp' + i, styleId: styleId, position: new T.LatLng(wp.lat, wp.lng), properties: wp });
      });
      var wpLayer = new T.MultiMarker({ map: map, geometries: geometries, styles: styles });

      // 点击 Marker 弹出信息
      var wpInfo = new T.InfoWindow({ map: map, position: new T.LatLng(center.lat, center.lng), offset: { x: 0, y: -42 } });
      wpInfo.close();
      wpLayer.on('click', function (evt) {
        var geo = evt && evt.geometry;
        if (geo && geo.properties) {
          wpInfo.open();
          wpInfo.setPosition(geo.position);
          var html = '<div style="padding:6px;min-width:120px;">';
          html += '<strong>' + (geo.properties.name || '') + '</strong>';
          if (geo.properties.day) html += '<br><span style="color:#666;font-size:12px;">' + geo.properties.day + '</span>';
          if (geo.properties.plan) html += '<br><span style="color:#666;font-size:12px;">' + geo.properties.plan + '</span>';
          html += '</div>';
          wpInfo.setContent(html);
        }
      });
    }

    // 3. 特色景点图层（蓝点 Marker + InfoWindow）
    if (spots.length) {
      var spotGeos = spots.filter(function (s) { return s.lat && s.lng; }).map(function (s, i) {
        return { id: 'spot' + i, styleId: 'spot', position: new T.LatLng(s.lat, s.lng), properties: s };
      });
      if (spotGeos.length) {
        var spotLayer = new T.MultiMarker({
          map: map, geometries: spotGeos,
          styles: { spot: new T.MarkerStyle({ width: 28, height: 28, anchor: { x: 14, y: 14 }, src: dotSvg('#1976D2') }) },
        });
        var spotInfo = new T.InfoWindow({ map: map, position: new T.LatLng(center.lat, center.lng), offset: { x: 0, y: -16 } });
        spotInfo.close();
        spotLayer.on('click', function (evt) {
          var geo = evt && evt.geometry;
          if (geo && geo.properties && geo.properties.name) {
            spotInfo.open();
            spotInfo.setPosition(geo.position);
            var html = '<div style="padding:6px;max-width:200px;">';
            html += '<strong style="color:#1976D2;">' + geo.properties.name + '</strong>';
            if (geo.properties.desc) html += '<br><span style="font-size:12px;color:#555;">' + geo.properties.desc + '</span>';
            if (geo.properties.parent_day) html += '<br><span style="font-size:11px;color:#999;">' + geo.properties.parent_day + ' ' + (geo.properties.parent_waypoint || '') + '</span>';
            html += '</div>';
            spotInfo.setContent(html);
          }
        });
        console.log('[map-kit] 景点图层已渲染', spotGeos.length, '个');
      }
    }
  }

  // ===================== base 模式 =====================
  function renderBase(el, data) {
    var T = window.TMap;
    var center = data.center;
    var markers = data.markers || [];

    var map = new T.Map(el, { zoom: 10, center: new T.LatLng(center.lat, center.lng) });

    if (markers.length) {
      var geos = markers.filter(function (m) { return m.lat && m.lng; }).map(function (m, i) {
        return { id: 'm' + i, styleId: 'base', position: new T.LatLng(m.lat, m.lng), properties: m };
      });
      var layer = new T.MultiMarker({
        map: map, geometries: geos,
        styles: { base: new T.MarkerStyle({ width: 32, height: 42, anchor: { x: 16, y: 42 }, src: pinSvg('#7B1FA2', '宿') }) },
      });
      var info = new T.InfoWindow({ map: map, position: new T.LatLng(center.lat, center.lng), offset: { x: 0, y: -42 } });
      info.close();
      layer.on('click', function (evt) {
        var geo = evt && evt.geometry;
        if (geo && geo.properties) {
          info.open();
          info.setPosition(geo.position);
          var html = '<div style="padding:6px;min-width:120px;"><strong>' + (geo.properties.name || '') + '</strong>';
          if (geo.properties.address) html += '<br><span style="font-size:12px;color:#666;">' + geo.properties.address + '</span>';
          html += '</div>';
          info.setContent(html);
        }
      });
    }
  }

  // ===================== poi 模式 =====================
  function renderPoi(el, data) {
    var T = window.TMap;
    var center = data.center;
    var pois = data.pois || data.markers || [];

    var map = new T.Map(el, { zoom: 12, center: new T.LatLng(center.lat, center.lng) });

    // 雷达半径圆
    if (data.radiusKm > 0) {
      try {
        var rKm = data.radiusKm;
        var pts = [];
        var n = 64;
        for (var i = 0; i < n; i++) {
          var t = i / n * Math.PI * 2;
          var lat = center.lat + (rKm / 111) * Math.cos(t);
          var lng = center.lng + (rKm / (111 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(t);
          pts.push(new T.LatLng(lat, lng));
        }
        new T.MultiPolygon({
          map: map,
          geometries: [{ id: 'radius', styleId: 'radius', paths: pts }],
          styles: { radius: new T.PolygonStyle({ strokeColor: '#cbd5e1', strokeWidth: 2, fillColor: '#0E7C8608' }) },
        });
      } catch (e) { /* 忽略圆 */ }
    }

    // POI 散点 Marker
    if (pois.length) {
      var styles = {};
      var geos = pois.filter(function (p) { return p.lat && p.lng; }).map(function (p, i) {
        var color = poiColor(p.cat);
        var styleId = p.cat || 'default';
        if (!styles[styleId]) {
          styles[styleId] = new T.MarkerStyle({ width: 20, height: 20, src: dotSvg(color) });
        }
        return { id: 'poi' + i, styleId: styleId, position: new T.LatLng(p.lat, p.lng), properties: p };
      });
      var layer = new T.MultiMarker({ map: map, geometries: geos, styles: styles });

      var info = new T.InfoWindow({ map: map, position: new T.LatLng(center.lat, center.lng), offset: { x: 0, y: -12 } });
      info.close();
      layer.on('click', function (evt) {
        var geo = evt && evt.geometry;
        if (geo && geo.properties) {
          info.open();
          info.setPosition(geo.position);
          var p = geo.properties;
          var html = '<div style="padding:6px;max-width:180px;"><strong>' + (p.name || '') + '</strong>';
          if (p.distance != null) html += '<br><span style="font-size:12px;color:#666;">距离 ' + p.distance + ' km</span>';
          if (p.address) html += '<br><span style="font-size:12px;color:#666;">' + p.address + '</span>';
          html += '</div>';
          info.setContent(html);
        }
      });
    }
  }

  return {
    render: render,
    renderAll: function () {
      var els = document.querySelectorAll('[data-map-mode]:not([data-map-mode="static_svg"])');
      for (var i = 0; i < els.length; i++) render(els[i]);
    },
    version: '1.0.0',
  };
})();

// 自动渲染所有带 data-map-mode 的元素
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { window.flatMapKit.renderAll(); });
} else {
  window.flatMapKit.renderAll();
}
