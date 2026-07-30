/**
 * 设备切换按钮组件（浏览器感知版）
 *
 * 在页面底部显示"切换到PC端/移动端"的快捷链接
 * 支持Cookie记忆用户偏好
 * 显示当前检测到的浏览器类型
 *
 * 使用方法：
 * 1. 在页面适当位置添加 <div id="device-switch"></div>
 * 2. 此脚本会自动渲染切换按钮
 */

(function() {
  'use strict';

  const CONFIG = {
    containerId: 'device-switch',
    cookieName: 'gui_device_preference',
    currentPath: window.location.pathname,
    isMobilePage: window.location.pathname.includes('mobile.html'),
    apiBase: window.location.origin,
    serverDeviceInfo: window.__DEVICE_INFO__ || null,
  };

  /**
   * 获取浏览器图标SVG
   */
  function getBrowserIcon(browserType) {
    // 不同浏览器使用不同颜色的图标
    const icons = {
      wechat: '<svg width="14" height="14" viewBox="0 0 24 24" fill="#07C160"><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.045c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-7.062-6.122zM14.53 13.39c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982z"/></svg>',
      qq: '<svg width="14" height="14" viewBox="0 0 24 24" fill="#12B7F5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 16.5c-2.48 0-4.5-2.02-4.5-4.5S9.52 9.5 12 9.5s4.5 2.02 4.5 4.5-2.02 4.5-4.5 4.5z"/></svg>',
      alipay: '<svg width="14" height="14" viewBox="0 0 24 24" fill="#1677FF"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>',
    };
    return icons[browserType] || null;
  }

  /**
   * 创建切换按钮HTML
   */
  function renderSwitchButton() {
    const container = document.getElementById(CONFIG.containerId);
    if (!container) {
      console.warn(`[DeviceSwitch] Container #${CONFIG.containerId} not found`);
      return;
    }

    // 确定目标页面和按钮文本
    let targetUrl, buttonText, iconSvg;

    if (CONFIG.isMobilePage) {
      // 当前在移动端 → 显示"切换到PC端"
      targetUrl = '/index.html?force=pc';
      buttonText = '切换到电脑版';
      iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <path d="M8 21h8M12 17v4"/>
      </svg>`;
    } else {
      // 当前在PC端 → 显示"切换到手机版"
      targetUrl = '/mobile.html?force=mobile';
      buttonText = '切换到手机版';
      iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="5" y="2" width="14" height="20" rx="2"/>
        <line x1="12" y1="18" x2="12" y2="18"/>
      </svg>`;
    }

    // 获取浏览器信息
    const info = CONFIG.serverDeviceInfo;
    const browserName = info ? info.browserName : '';
    const browserType = info ? info.browserType : '';
    const browserIcon = getBrowserIcon(browserType);

    // 渲染按钮
    container.innerHTML = `
      <div class="device-switch-wrapper" style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
      ">
        <a href="${targetUrl}"
           class="device-switch-btn"
           style="
             display: inline-flex;
             align-items: center;
             gap: 6px;
             padding: 10px 16px;
             background: rgba(255, 255, 255, 0.95);
             border: 1px solid #e0e0e0;
             border-radius: 20px;
             color: #666;
             text-decoration: none;
             font-size: 13px;
             box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
             transition: all 0.3s ease;
             backdrop-filter: blur(10px);
             ${CONFIG.isMobilePage ? 'bottom: auto; top: 50px; right: 10px;' : ''}
          "
           onclick="document.cookie='${CONFIG.cookieName}=${CONFIG.isMobilePage ? 'pc' : 'mobile'};path=/;max-age=${30 * 24 * 60 * 60}'"
           title="${buttonText}">
          ${iconSvg}
          <span>${buttonText}</span>
          ${browserIcon ? `<span style="margin-left:2px; display:flex; align-items:center;" title="当前浏览器: ${browserName}">${browserIcon}</span>` : ''}
        </a>
        ${browserName ? `<div style="
          text-align: center;
          font-size: 10px;
          color: #999;
          margin-top: 4px;
        ">当前: ${browserName}</div>` : ''}
      </div>
    `;

    // 添加悬停效果
    const btn = container.querySelector('.device-switch-btn');
    if (btn) {
      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'translateY(-2px)';
        btn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
        btn.style.color = '#1890ff';
        btn.style.borderColor = '#1890ff';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translateY(0)';
        btn.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
        btn.style.color = '#666';
        btn.style.borderColor = '#e0e0e0';
      });
    }

    // ★ 默认隐藏，Alt+F 切换显示
    const wrapper = container.querySelector('.device-switch-wrapper');
    if (wrapper) {
      wrapper.style.display = 'none';
    }
    if (!window.__deviceSwitchKeyBound) {
      window.__deviceSwitchKeyBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'f' || e.key === 'F')) {
          e.preventDefault();
          const w = document.querySelector('.device-switch-wrapper');
          if (w) {
            w.style.display = w.style.display === 'none' ? 'block' : 'none';
          }
        }
      });
    }

    console.log(`[DeviceSwitch] Switch button rendered (${CONFIG.isMobilePage ? '→ PC' : '→ Mobile'} | Browser: ${browserName})`);
  }

  // DOM 加载完成后渲染
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderSwitchButton);
  } else {
    renderSwitchButton();
  }

})();
