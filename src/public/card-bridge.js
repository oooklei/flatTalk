/**
 * Card Interaction Bridge — injected into card iframe for universal button dispatch
 */
(function () {
  if (window.__cardBridgeInitialized) return;
  window.__cardBridgeInitialized = true;

  function telHrefToPhone(href) {
    return String(href || '').replace(/^tel:/i, '').split(/[?#]/)[0].trim();
  }

  function handleClick(e) {
    var btn = e.target.closest('[data-action-key]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    var payload = {
      type: 'flattalk_card_action',
      action_key: btn.getAttribute('data-action-key') || '',
      action_type: btn.getAttribute('data-action-type') || 'dispatch',
      user_prompt: btn.getAttribute('data-user-prompt') || '',
      skill_key: btn.getAttribute('data-skill-key') || '',
      params: {},
    };

    var paramsStr = btn.getAttribute('data-params');
    if (paramsStr) {
      try { payload.params = JSON.parse(paramsStr); } catch {}
    }

    if (payload.action_type === 'form_submit') {
      var form = btn.closest('form');
      if (form) {
        var formData = new FormData(form);
        var data = {};
        formData.forEach(function (val, key) { data[key] = val; });
        payload.params.form_data = data;
      }
    }

    window.parent.postMessage(payload, '*');
  }

  document.addEventListener('click', handleClick, true);

  document.addEventListener('click', function (e) {
    var telLink = e.target.closest('a[href^="tel:"]');
    if (!telLink) return;
    e.preventDefault();
    e.stopPropagation();
    var href = telLink.getAttribute('href') || '';
    window.parent.postMessage({
      type: 'flattalk_phone_dial',
      phone: telHrefToPhone(href),
      href: href,
      label: (telLink.textContent || '').trim(),
    }, '*');
  }, true);

  document.addEventListener('click', function (e) {
    var mapLink = e.target.closest('[data-action-type="external_map"]');
    if (!mapLink) return;
    e.preventDefault();
    var url = mapLink.getAttribute('data-href') || mapLink.getAttribute('href') || '';

    // 已有 TMap 实例的卡片：直接复用
    if (typeof TMap !== 'undefined' && window.__nbMapInstance) {
      var params0 = mapLink.getAttribute('data-params');
      if (params0) {
        try {
          var poi0 = JSON.parse(params0);
          if (poi0.lat && poi0.lng) {
            showInCardRoute(window.__nbMapInstance, poi0);
            return;
          }
        } catch {}
      }
    }

    // 无 TMap 实例：在按钮下方动态展开迷你地图
    var poi = null;
    var paramsStr = mapLink.getAttribute('data-params');
    if (paramsStr) {
      try { poi = JSON.parse(paramsStr); } catch {}
    }

    var container = mapLink.parentElement;
    var existing = container.querySelector('.nb-mini-map');
    if (existing) { existing.remove(); return; } // 再次点击收起

    if (poi && poi.lat && poi.lng) {
      // 动态加载 TMap SDK + 迷你地图
      showMiniMap(container, poi, url);
    } else {
      // 无坐标：只能新窗口打开 URI API
      window.parent.postMessage({ type: 'flattalk_open_map', url: url }, '*');
    }
  }, true);

  /**
   * 在卡片内动态展开迷你地图（按需加载 TMap SDK）
   */
  function showMiniMap(container, poi, fallbackUrl) {
    var wrap = document.createElement('div');
    wrap.className = 'nb-mini-map';
    wrap.style.cssText = 'width:100%;height:240px;border:1px solid #e0e0e0;border-radius:8px;margin-top:8px;position:relative;overflow:hidden;';
    var canvas = document.createElement('div');
    canvas.style.cssText = 'width:100%;height:100%;';
    wrap.appendChild(canvas);

    // 底部按钮栏：在新窗口打开完整导航
    var bar = document.createElement('div');
    bar.style.cssText = 'padding:6px 8px;background:#f5f5f5;border-top:1px solid #e0e0e0;display:flex;gap:8px;justify-content:flex-end;';
    var openBtn = document.createElement('button');
    openBtn.textContent = '打开完整导航 →';
    openBtn.style.cssText = 'background:#2f6f4e;color:#fff;border:none;padding:4px 12px;border-radius:4px;font-size:13px;cursor:pointer;';
    openBtn.onclick = function (ev) {
      ev.stopPropagation();
      window.parent.postMessage({ type: 'flattalk_open_map', url: fallbackUrl }, '*');
    };
    bar.appendChild(openBtn);
    wrap.appendChild(bar);

    container.appendChild(wrap);

    // 从模板变量获取地图 Key（注入在 window.__MAP_KEY__）
    var key = window.__MAP_KEY__ || '';
    if (!key) {
      canvas.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:13px;">地图加载失败（缺少Key）</div>';
      return;
    }

    // 动态加载 TMap SDK
    if (typeof TMap === 'undefined') {
      var script = document.createElement('script');
      script.src = 'https://map.qq.com/api/gljs?v=1.exp&key=' + key;
      script.onload = function () { initMiniMap(canvas, poi); };
      script.onerror = function () {
        canvas.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:13px;">地图加载失败</div>';
      };
      document.head.appendChild(script);
    } else {
      initMiniMap(canvas, poi);
    }
  }

  function initMiniMap(canvas, poi) {
    try {
      var map = new TMap.Map(canvas, {
        center: new TMap.LatLng(poi.lat, poi.lng),
        zoom: 14,
        baseMap: { type: 'vector', features: ['base', 'label'] },
      });
      // 目的地标记
      new TMap.MultiMarker({
        map: map,
        geometries: [{
          id: 'dest',
          position: new TMap.LatLng(poi.lat, poi.lng),
        }],
      });
      // 信息窗
      new TMap.InfoWindow({
        map: map,
        position: new TMap.LatLng(poi.lat, poi.lng),
        content: '<div style="padding:4px 8px;font-size:13px;">' + (poi.name || '目的地') + '</div>',
      });
    } catch {
      canvas.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:13px;">地图渲染失败</div>';
    }
  }

  function showInCardRoute(map, poi) {
    try {
      map.setCenter(new TMap.LatLng(poi.lat, poi.lng));
      map.setZoom(15);
      var info = new TMap.InfoWindow({
        map: map,
        position: new TMap.LatLng(poi.lat, poi.lng),
        content: '<div style="padding:4px 8px;font-size:13px;">' + (poi.name || '目的地') + '</div>'
      });
    } catch {
      // TMap 操作失败，忽略
    }
  }
})();
