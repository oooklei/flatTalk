/**
 * 登录前导页：严格按对接规范 AES-GCM-128 封装 userInfo，请求 /assistant，
 * 成功后跳转返回的 mobileUrl（携带会话 token）。
 */

const AES_KEY = 'tr6mxi9go1k9p63j'; // 与 H5AESUtils.AES_REAL_PERSON_CERTIFICATION 一致

const statusEl = document.getElementById('status');
const metaEl = document.getElementById('meta');
const gridEl = document.getElementById('grid');

function setStatus(text, isErr = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('err', !!isErr);
}

function bufToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/**
 * 与 flatTalk/src/lib/h5-crypto.js、Java H5AESUtils 一致：
 * Base64(IV[12] + ciphertext + authTag[16])
 */
async function encryptUserInfo(plainText, aesKey = AES_KEY) {
  const keyBytes = new TextEncoder().encode(aesKey);
  if (keyBytes.length !== 16 && keyBytes.length !== 32) {
    throw new Error('aes secretKey长度为16或32');
  }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    new TextEncoder().encode(plainText),
  );
  const encBytes = new Uint8Array(encrypted);
  const combined = new Uint8Array(iv.length + encBytes.length);
  combined.set(iv, 0);
  combined.set(encBytes, iv.length);
  return bufToBase64(combined);
}

function buildPlain(preset) {
  return {
    userId: preset.userId,
    userName: preset.userName,
    roleId: preset.roleId,
    orgId: preset.orgId || '',
    orgName: preset.orgName || '',
    terminal: preset.terminal || 'C',
    timestamp: Date.now(),
    nonce: `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
  };
}

async function enterAs(preset, cardBtn) {
  const buttons = gridEl.querySelectorAll('button.preset-card');
  buttons.forEach((b) => { b.disabled = true; });
  setStatus(`正在加密身份包并请求 /assistant（${preset.userName} / ${preset.roleName || preset.roleId}）…`);

  try {
    const plain = buildPlain(preset);
    const cipherText = await encryptUserInfo(JSON.stringify(plain));

    // 对接入口：优先 /assistant，兼容 /gxy-assistant
    const url = `/assistant?userInfo=${encodeURIComponent(cipherText)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok || !data.mobileUrl) {
      throw new Error(data.message || data.error || `assistant 失败 HTTP ${res.status}`);
    }

    setStatus('登录成功，正在进入移动端…');
    // 服务端已完成解密校验并签发 session token
    window.location.replace(data.mobileUrl);
  } catch (err) {
    setStatus(`登录失败：${err.message || err}`, true);
    buttons.forEach((b) => { b.disabled = false; });
    if (cardBtn) cardBtn.focus();
  }
}

function renderPresets(items) {
  gridEl.innerHTML = '';
  for (const p of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-card';
    btn.innerHTML = `
      <div class="name"></div>
      <div class="role"></div>
      <div class="org"></div>
      <div class="uid"></div>
    `;
    btn.querySelector('.name').textContent = p.userName;
    btn.querySelector('.role').textContent = `${p.roleName || p.roleKey || p.roleId} · ${p.terminal || ''}`;
    if (p.orgName || p.orgId) {
      const code = p.orgCode || p.orgId || '';
      btn.querySelector('.org').textContent = code
        ? `${p.orgName || '（有组织）'} · ${code.slice(0, 12)}${code.length > 12 ? '…' : ''}`
        : (p.orgName || '（未绑定组织）');
    } else {
      btn.querySelector('.org').textContent = '（未绑定组织）';
    }
    btn.querySelector('.uid').textContent = `ID ${p.userId}${p.source === 'tag_system' ? '' : ` · ${p.source || ''}`}`;
    btn.addEventListener('click', () => enterAs(p, btn));
    gridEl.appendChild(btn);
  }
}

async function boot() {
  try {
    const res = await fetch('/api/login/presets', { headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.items) || !data.items.length) {
      throw new Error(data.error || '无可用身份');
    }
    metaEl.textContent = data.source === 'tag_system'
      ? `身份来源：tag-system 用户中心（已绑定组织 ${data.org_bound ?? '-'} / ${data.items.length}）${data.warn ? ` · 查询告警` : ''}`
      : `身份来源：本地像样兜底（tag-system 暂不可用：${data.tag_error || '未配置'}）`;
    setStatus(`请选择身份进入（共 ${data.items.length} 个）`);
    renderPresets(data.items);
  } catch (err) {
    setStatus(`加载身份失败：${err.message || err}`, true);
  }
}

boot();
