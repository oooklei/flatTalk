/**
 * 设备与浏览器重定向脚本（前端备用方案）
 *
 * 使用场景：
 * 1. 服务端检测失效时（如 CDN/代理修改 UA 头）
 * 2. 静态部署环境无后端支持时
 * 3. 用户调整窗口大小时（响应式切换）
 *
 * 功能：
 * - 检测设备类型（PC/手机/平板）
 * - 检测浏览器类型（Chrome/Safari/微信/QQ/UC等）
 * - 根据设备+浏览器综合决策是否重定向
 *
 * 放置位置：在 <head> 中优先加载
 */

(function() {
  'use strict';

  // 配置项
  const CONFIG = {
    // 移动端断点（屏幕宽度小于此值视为移动设备）
    mobileBreakpoint: 768,
    // 平板断点
    tabletBreakpoint: 1024,
    // Cookie 名称（记录用户手动选择）
    cookieName: 'gui_device_preference',
    // Cookie 有效期（天）
    cookieExpiry: 30,
    // 当前页面类型（由服务端注入，避免重复跳转）
    currentPageType: window.__DEVICE_TYPE__ || null,  // 'pc' | 'mobile' | 'tablet'
    // 服务端注入的完整设备信息
    serverDeviceInfo: window.__DEVICE_INFO__ || null,
  };

  /**
   * 客户端浏览器识别规则（按优先级排序）
   */
  const BROWSER_RULES = [
    { name: 'wechat',    regex: /micromessenger\/([\d.]+)/i,            label: '微信内置浏览器' },
    { name: 'qq',        regex: /\bqq\/([\d.]+)|\bmqqbrowser\/([\d.]+)/i, label: 'QQ浏览器' },
    { name: 'wecom',     regex: /\bwxwork\/([\d.]+)/i,                  label: '企业微信' },
    { name: 'alipay',    regex: /\baliapp\(ap\/([\d.]+)/i,              label: '支付宝' },
    { name: 'dingtalk',  regex: /\bdingtalk\/([\d.]+)/i,                label: '钉钉' },
    { name: 'baidu',     regex: /\bbaiduboxapp\/([\d.]+)|\bbaidubrowser\/([\d.]+)/i, label: '百度浏览器' },
    { name: 'uc',        regex: /\bucbrowser\/([\d.]+)|\bucweb\/([\d.]+)/i, label: 'UC浏览器' },
    { name: 'sogou',     regex: /\bsogoumobilebrowser\/([\d.]+)|\bse ([\d.]+)/i, label: '搜狗浏览器' },
    { name: '360',       regex: /\b360browser\/([\d.]+)|\bqihu[\s\/]([\d.]+)/i, label: '360浏览器' },
    { name: 'xiaomi',    regex: /\bmiuibrowser\/([\d.]+)/i,             label: '小米浏览器' },
    { name: 'huawei',    regex: /\bhonor([\s\/]huawei)?[\s\/]hbrowser\/([\d.]+)|\bhihonor\/([\d.]+)/i, label: '华为浏览器' },
    { name: 'oppo',      regex: /\bheytapbrowser\/([\d.]+)|\boppobrowser\/([\d.]+)/i, label: 'OPPO浏览器' },
    { name: 'vivo',      regex: /\bvivobrowser\/([\d.]+)/i,             label: 'vivo浏览器' },
    { name: 'samsung',   regex: /\bsamsungbrowser\/([\d.]+)/i,          label: '三星浏览器' },
    { name: 'edge',      regex: /\bedg\/([\d.]+)/i,                     label: 'Edge' },
    { name: 'edge_legacy',regex:/\bedge\/([\d.]+)/i,                    label: 'Edge (旧版)' },
    { name: 'firefox',   regex: /\bfirefox\/([\d.]+)/i,                 label: 'Firefox' },
    { name: 'opera',     regex: /\bopr\/([\d.]+)|\bopios\/([\d.]+)/i,   label: 'Opera' },
    { name: 'vivaldi',   regex: /\bvivaldi\/([\d.]+)/i,                 label: 'Vivaldi' },
    { name: 'brave',     regex: /\bbrave\/([\d.]+)/i,                   label: 'Brave' },
    { name: 'chrome',    regex: /\bchrome\/([\d.]+)/i,                  label: 'Chrome' },
    { name: 'safari',    regex: /\bsafari\/([\d.]+)/i,                  label: 'Safari' },
  ];

  /**
   * 客户端检测设备类型（基于屏幕尺寸和用户代理）
   */
  function detectDeviceByScreen() {
    const width = window.screen.width || window.innerWidth || 0;
    const height = window.screen.height || window.innerHeight || 0;
    const userAgent = navigator.userAgent.toLowerCase();

    // 基于屏幕宽度的初步判断
    let deviceType = 'pc';
    if (width <= CONFIG.mobileBreakpoint) {
      deviceType = 'mobile';
    } else if (width <= CONFIG.tabletBreakpoint) {
      deviceType = 'tablet';
    }

    // 结合 User-Agent 进行二次验证
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isMobileUA = /android|iphone|ipod|blackberry|windows phone|mobile/i.test(userAgent);
    const isTabletUA = /ipad|tablet|playbook|silk/i.test(userAgent);

    if (isMobileUA && !isTabletUA) {
      deviceType = 'mobile';
    } else if (isTabletUA) {
      deviceType = 'tablet';
    }

    // 触摸设备 + 小屏幕 = 强制移动端
    if (isTouchDevice && width <= CONFIG.tabletBreakpoint) {
      deviceType = width <= CONFIG.mobileBreakpoint ? 'mobile' : 'tablet';
    }

    return {
      deviceType,
      isMobile: deviceType === 'mobile',
      isTablet: deviceType === 'tablet',
      screenWidth: width,
      screenHeight: height,
      isTouchDevice
    };
  }

  /**
   * 客户端检测浏览器类型
   */
  function detectBrowser() {
    const ua = navigator.userAgent;
    let browserType = 'other';
    let browserName = '未知浏览器';
    let browserVersion = '';

    for (const rule of BROWSER_RULES) {
      const match = ua.match(rule.regex);
      if (match) {
        browserType = rule.name;
        browserName = rule.label;
        browserVersion = (match.slice(1).find(v => v !== undefined) || '');
        break;
      }
    }

    return { browserType, browserName, browserVersion, userAgent: ua };
  }

  /**
   * 获取 URL 参数
   */
  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  /**
   * 设置 Cookie
   */
  function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = `expires=${date.toUTCString()}`;
    document.cookie = `${name}=${value};${expires};path=/;SameSite=Lax`;
  }

  /**
   * 读取 Cookie
   */
  function getCookie(name) {
    const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
    return match ? match[2] : null;
  }

  /**
   * 执行重定向
   */
  function redirectTo(targetPage) {
    const currentPath = window.location.pathname;
    const currentSearch = window.location.search;

    // 避免循环重定向
    if (currentPath.includes(targetPage)) {
      console.log(`[DeviceRedirect] Already on ${targetPage}, skipping redirect`);
      return false;
    }

    // 构建目标URL（保留查询参数，移除 force 参数）
    const searchParams = new URLSearchParams(currentSearch);
    searchParams.delete('force');
    const searchString = searchParams.toString();
    const targetUrl = `${targetPage}${searchString ? '?' + searchString : ''}`;

    console.log(`[DeviceRedirect] Redirecting to: ${targetUrl}`);

    // 记录用户偏好
    setCookie(CONFIG.cookieName, targetPage === '/mobile.html' ? 'mobile' : 'pc', CONFIG.cookieExpiry);

    // 执行跳转
    window.location.replace(targetUrl);  // 使用 replace 避免浏览器返回键问题
    return true;
  }

  /**
   * 主逻辑入口
   */
  function init() {
    const browser = detectBrowser();
    const device = detectDeviceByScreen();

    console.log(`[DeviceRedirect] Browser: ${browser.browserName} ${browser.browserVersion} | Device: ${device.deviceType} | Screen: ${device.screenWidth}x${device.screenHeight}`);

    // 检查是否已由服务端正确分发
    if (CONFIG.currentPageType) {
      console.log(`[DeviceRedirect] Server-assigned: ${CONFIG.currentPageType} | Client-detected: ${device.deviceType} | Browser: ${browser.browserName}`);

      // 如果服务端和客户端检测结果不一致，且差异明显（非边界情况），给出警告
      if ((CONFIG.currentPageType === 'pc' && device.isMobile) ||
          (CONFIG.currentPageType === 'mobile' && device.deviceType === 'pc')) {
        console.warn(`[DeviceRedirect] ⚠️ Server/client mismatch! Server=${CONFIG.currentPageType}, Client=${device.deviceType}, Browser=${browser.browserName}`);
      }
      return;  // 服务端已处理，退出
    }

    // 检查手动强制参数（优先级最高）
    const forceParam = getQueryParam('force');
    if (forceParam === 'mobile') {
      console.log('[DeviceRedirect] Force parameter: mobile');
      if (!window.location.pathname.includes('mobile.html')) {
        redirectTo('/mobile.html');
      }
      return;
    } else if (forceParam === 'pc') {
      console.log('[DeviceRedirect] Force parameter: pc');
      if (window.location.pathname.includes('mobile.html')) {
        redirectTo('/index.html');
      }
      return;
    }

    // 检查用户的设备偏好Cookie
    const userPreference = getCookie(CONFIG.cookieName);
    if (userPreference) {
      const onMobilePage = window.location.pathname.includes('mobile.html');

      if (userPreference === 'mobile' && !onMobilePage && device.isMobile) {
        console.log('[DeviceRedirect] User prefers mobile, redirecting...');
        redirectTo('/mobile.html');
        return;
      } else if (userPreference === 'pc' && onMobilePage && !device.isMobile) {
        console.log('[DeviceRedirect] User prefers PC, redirecting...');
        redirectTo('/index.html');
        return;
      }
    }

    // 自动检测并重定向
    const onMobilePage = window.location.pathname.includes('mobile.html');

    console.log(`[DeviceRedirect] Auto-detect: ${device.deviceType} | Browser: ${browser.browserName}`);

    if (device.isMobile && !onMobilePage) {
      // 移动设备访问了PC页 → 重定向到移动端
      console.log('[DeviceRedirect] Mobile device detected, redirecting to mobile.html');
      redirectTo('/mobile.html');
    } else if (device.deviceType === 'pc' && onMobilePage) {
      // PC设备访问了移动页 → 重定向到PC端
      console.log('[DeviceRedirect] PC device detected, redirecting to index.html');
      redirectTo('/index.html');
    } else {
      console.log('[DeviceRedirect] No redirect needed, current page matches device type');
    }
  }

  // 监听窗口大小变化（用于响应式切换场景）
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      // 仅当用户没有手动偏好时才自动调整
      if (!getCookie(CONFIG.cookieName)) {
        init();
      }
    }, 500);  // 防抖 500ms
  });

  // DOM 加载完成后执行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 导出到全局（供调试使用）
  window.__DeviceRedirect__ = {
    detect: detectDeviceByScreen,
    detectBrowser,
    redirectTo,
    getConfig: () => CONFIG,
    getServerInfo: () => CONFIG.serverDeviceInfo,
    version: '2.0.0'
  };

})();
