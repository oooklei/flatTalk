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
    // URI API (/uri/v1/) 是跳转页，调起腾讯地图 App 或浏览器打开
    window.parent.postMessage({
      type: 'flattalk_open_map',
      url: url,
    }, '*');
  }, true);
})();
