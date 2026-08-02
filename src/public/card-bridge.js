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
    if (!url) return;

    // 优先尝试在卡片内显示路线预览（需要 TMap 已加载）
    if (typeof TMap !== 'undefined' && window.__nbMapInstance) {
      var params = mapLink.getAttribute('data-params');
      if (params) {
        try {
          var poi = JSON.parse(params);
          if (poi.lat && poi.lng) {
            showInCardRoute(window.__nbMapInstance, poi);
            return;
          }
        } catch {}
      }
    }

    // 无地图实例时：交给父窗口在新标签页打开（移动端调起地图 App）
    // 不能在卡片 iframe 内嵌入 URI API — 它会尝试 top-navigation 导致 SecurityError
    window.parent.postMessage({
      type: 'flattalk_open_map',
      url: url,
    }, '*');
  }, true);

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
