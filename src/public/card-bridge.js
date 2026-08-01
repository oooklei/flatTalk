/**
 * Card Interaction Bridge — injected into card iframe for universal button dispatch
 */
(function () {
  if (window.__cardBridgeInitialized) return;
  window.__cardBridgeInitialized = true;

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
    var mapLink = e.target.closest('[data-action-type="external_map"]');
    if (!mapLink) return;
    e.preventDefault();
    var url = mapLink.getAttribute('data-href') || mapLink.getAttribute('href') || '';
    if (!url) return;
    var existingFrame = document.querySelector('.map-embed-frame');
    if (existingFrame) existingFrame.remove();
    var frame = document.createElement('iframe');
    frame.className = 'map-embed-frame';
    frame.style.cssText = 'width:100%;height:300px;border:none;border-radius:8px;margin-top:8px;';
    frame.src = url;
    mapLink.parentElement.appendChild(frame);
  }, true);
})();
