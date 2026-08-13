// 生成巴马 5天4晚康养旅居 预览 HTML（独立卡片，内嵌 SVG，多图轮播弹窗）
// 运行: node scripts/gen-preview-final.mjs
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SVG_PATH = join(ROOT, 'data', 'sojourn-maps', 'bama_5d4n', 'map_standard.svg');
const OUT_PATH = join(ROOT, 'geographicSVG', 'preview-bama-route.html');

const svgRaw = readFileSync(SVG_PATH, 'utf8');
// 防止 </script> 截断（当前 SVG 中无此片段，做保护处理）
const svgForScript = svgRaw.replace(/<\/script>/gi, '<\\/script>');

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
  <title>巴马5天4晚康养旅居 · 走线预览</title>
  <style>
    :root {
      --primary: #FF7826;
      --primary-dark: #E65100;
      --primary-gradient: linear-gradient(135deg, #FF7826 0%, #FF9A5C 100%);
      --bg: #FFFDF9;
      --bg-white: #ffffff;
      --ink: #3A3A3A;
      --ink-light: #666;
      --muted: #999999;
      --border: #E5E5E5;
      --divider: #F0EBE3;
      --primary-light: #FFF3E0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 14px;
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      background: var(--bg);
      color: var(--ink);
      line-height: 1.5;
    }
    .route-card {
      max-width: 400px;
      margin: 0 auto;
      background: var(--bg-white);
      border: 1px solid var(--border);
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }

    /* Hero 标题栏 */
    .hero {
      padding: 16px;
      background: var(--primary-gradient);
      color: #fff;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.22);
      font-size: 12px;
      margin-bottom: 10px;
    }
    .hero h1 {
      margin: 0;
      font-size: 20px;
      line-height: 1.25;
    }
    .subtitle {
      margin: 8px 0 0;
      font-size: 13px;
      opacity: 0.92;
      line-height: 1.45;
    }
    .price-tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(255,255,255,0.28);
      font-weight: 600;
      font-size: 12px;
      vertical-align: middle;
    }

    /* SVG 地图区 */
    .svg-map-section {
      position: relative;
      border-top: 1px solid var(--divider);
    }
    .svg-map-section h2 {
      padding: 12px 14px 6px;
      margin: 0;
      font-size: 15px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .svg-map-section h2 .hint {
      font-size: 11px;
      color: var(--primary);
      background: var(--primary-light);
      padding: 2px 8px;
      border-radius: 999px;
      font-weight: 600;
    }
    .svg-container {
      position: relative;
      width: 100%;
      overflow: hidden;
      background: #fff;
    }
    .svg-container svg {
      display: block;
      width: 100%;
      height: auto;
    }
    .route-marker {
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .route-marker:hover { opacity: 0.8; }

    /* 景点浮窗 */
    .spot-popup {
      display: none;
      position: absolute;
      top: 10px;
      right: 10px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.18);
      padding: 12px;
      width: 230px;
      max-width: calc(100% - 20px);
      z-index: 20;
    }
    .spot-popup.show {
      display: block;
      animation: popIn 0.2s ease-out;
    }
    @keyframes popIn {
      from { opacity: 0; transform: scale(0.9); }
      to { opacity: 1; transform: scale(1); }
    }
    .spot-popup .close-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 50%;
      background: #F0EBE3;
      color: #666;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2;
    }
    .spot-popup .close-btn:hover { background: #E5E5E5; }

    .carousel {
      position: relative;
      margin-bottom: 10px;
    }
    .carousel .spot-img {
      width: 100%;
      height: 130px;
      object-fit: cover;
      border-radius: 8px;
      display: block;
      background: #f4f4f4;
    }
    .carousel .nav-btn {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 26px;
      height: 26px;
      border: none;
      border-radius: 50%;
      background: rgba(255,120,38,0.88);
      color: #fff;
      font-size: 16px;
      font-weight: bold;
      line-height: 1;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .carousel .nav-btn:hover { background: var(--primary-dark); }
    .carousel .nav-prev { left: 6px; }
    .carousel .nav-next { right: 6px; }
    .carousel .counter {
      position: absolute;
      bottom: 6px;
      right: 6px;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(0,0,0,0.55);
      color: #fff;
      font-size: 11px;
      display: none;
    }

    .spot-popup .spot-name {
      font-size: 16px;
      font-weight: 700;
      color: var(--ink);
      margin-bottom: 6px;
      line-height: 1.3;
      padding-right: 24px;
    }
    .spot-popup .day-tag {
      display: inline-block;
      font-size: 11px;
      color: var(--primary);
      background: var(--primary-light);
      padding: 2px 8px;
      border-radius: 999px;
      margin-bottom: 8px;
      font-weight: 600;
    }
    .spot-popup .spot-plan {
      font-size: 13px;
      color: var(--ink-light);
      margin-bottom: 6px;
      line-height: 1.5;
    }
    .spot-popup .spot-desc {
      font-size: 12px;
      color: var(--muted);
      line-height: 1.55;
      max-height: 96px;
      overflow-y: auto;
    }

    /* 概览指标 */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      padding: 12px 14px 4px;
    }
    .metric {
      border: 1px solid #F0EBE3;
      border-radius: 10px;
      padding: 10px;
      background: #FFFAF5;
    }
    .metric span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 4px;
    }
    .metric strong {
      display: block;
      font-size: 14px;
      line-height: 1.35;
      color: var(--ink);
      word-break: break-word;
    }

    /* 亮点 */
    .highlights {
      padding: 12px 14px;
      border-top: 1px solid var(--divider);
    }
    .highlights h2 {
      margin: 0 0 8px;
      font-size: 15px;
    }
    .highlights .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .highlights .chip {
      padding: 5px 10px;
      border-radius: 999px;
      background: var(--primary-light);
      color: #E65100;
      font-size: 12px;
    }

    /* 行程 */
    .itinerary {
      padding: 12px 14px;
      border-top: 1px solid var(--divider);
    }
    .itinerary h2 {
      margin: 0 0 8px;
      font-size: 15px;
    }
    .itinerary .timeline {
      display: grid;
      gap: 8px;
    }
    .itinerary .day-item {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr);
      gap: 8px;
      align-items: start;
    }
    .itinerary .day-item b {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 28px;
      border-radius: 8px;
      background: linear-gradient(135deg, #FFF3E0, #FFE0B2);
      color: #E65100;
      font-size: 12px;
    }
    .itinerary .day-item p {
      margin: 0;
      font-size: 13px;
      line-height: 1.5;
      color: var(--ink-light);
    }
    .itinerary .day-item .wp-name {
      display: block;
      font-size: 12px;
      color: var(--primary);
      font-weight: 600;
      margin-bottom: 2px;
    }

    /* 健康 */
    .health {
      padding: 12px 14px;
      border-top: 1px solid var(--divider);
    }
    .health h2 {
      margin: 0 0 8px;
      font-size: 15px;
    }
    .health .notice {
      margin: 0;
      padding: 10px;
      border-radius: 10px;
      background: #E8F5E9;
      color: #2E7D32;
      font-size: 13px;
      line-height: 1.5;
    }

    .footer-note {
      padding: 10px 14px 14px;
      border-top: 1px solid var(--divider);
      font-size: 11px;
      color: var(--muted);
      text-align: center;
    }
  </style>
</head>
<body>
  <article class="route-card">
    <!-- Hero 标题栏 -->
    <header class="hero">
      <div class="eyebrow">四季皆宜 · 经济舒适</div>
      <h1>巴马5天4晚康养旅居</h1>
      <p class="subtitle"><span class="price-tag">¥2980起</span> 世界长寿之乡 · 负氧离子天堂 · 地磁康养圣地</p>
    </header>

    <!-- SVG 地图区（核心） -->
    <section class="svg-map-section">
      <h2>📍 走线路线 <span class="hint">悬停景点查看详情</span></h2>
      <div class="svg-container" id="svgMapContainer"></div>
      <!-- 景点浮窗（动态显示） -->
      <div class="spot-popup" id="spotPopup">
        <button class="close-btn" id="popupCloseBtn" aria-label="关闭">&times;</button>
        <div class="carousel" id="popupCarousel">
          <img class="spot-img" id="popupImg" alt="" />
          <button class="nav-btn nav-prev" id="popupPrev" aria-label="上一张">&#10094;</button>
          <button class="nav-btn nav-next" id="popupNext" aria-label="下一张">&#10095;</button>
          <span class="counter" id="popupCounter"></span>
        </div>
        <div id="popupContent"></div>
      </div>
    </section>

    <!-- 概览指标 -->
    <section class="summary-grid">
      <div class="metric"><span>目的地</span><strong>广西巴马瑶族自治县</strong></div>
      <div class="metric"><span>行程天数</span><strong>5天4晚</strong></div>
      <div class="metric"><span>适合人群</span><strong>中老年康养 / 慢病调理 / 家庭度假</strong></div>
      <div class="metric"><span>核心特色</span><strong>高负氧离子 · 地磁养生</strong></div>
    </section>

    <!-- 亮点 -->
    <section class="highlights">
      <h2>行程亮点</h2>
      <div class="chips">
        <span class="chip">百魔洞地磁养生</span><span class="chip">长寿村探访百岁老人</span><span class="chip">水晶宫地下艺术宫殿</span><span class="chip">命河天然太极图</span><span class="chip">赐福湖湖畔康养</span><span class="chip">高负氧离子呼吸</span>
      </div>
    </section>

    <!-- 行程信息卡片 -->
    <section class="itinerary">
      <h2>建议行程 · 5天4晚</h2>
      <div class="timeline">
        <div class="day-item">
          <b>Day1</b>
          <p><span class="wp-name">巴马县城</span>抵达世界长寿之乡，入住康养基地，漫步盘阳河畔，适应微气候。</p>
        </div>
        <div class="day-item">
          <b>Day2</b>
          <p><span class="wp-name">百魔洞</span>天下第一洞磁疗体验，感受高负氧离子与地磁养生的自然奇观。</p>
        </div>
        <div class="day-item">
          <b>Day3</b>
          <p><span class="wp-name">长寿村 · 命河</span>探访巴盘屯百岁老人，泛舟命河，品味长寿文化。</p>
        </div>
        <div class="day-item">
          <b>Day4</b>
          <p><span class="wp-name">百鸟岩 · 水晶宫</span>乘船穿越百鸟岩三天三夜，赏水晶宫鹅管群奇观。</p>
        </div>
        <div class="day-item">
          <b>Day5</b>
          <p><span class="wp-name">赐福湖 · 返程</span>百岛长湖游船疗养，沿盘阳河长寿走廊返程。</p>
        </div>
      </div>
    </section>

    <!-- 健康 -->
    <section class="health">
      <h2>健康与接驳</h2>
      <p class="notice">巴马海拔较高，昼夜温差大，建议携带保暖衣物。康养期间多饮用地磁矿泉水，配合呼吸负氧离子，效果更佳。</p>
    </section>

    <div class="footer-note">康养旅居 · 精品路线 · 悬停地图标点查看景点详情</div>
  </article>

  <!-- 静态 SVG 数据（通过 textContent 读取） -->
  <script type="text/html" id="staticSvgData">${svgForScript}</script>

  <script>
    (function () {
      var hideTimer = null;
      var currentImages = [];
      var currentIndex = 0;

      var container = document.getElementById('svgMapContainer');
      var popup = document.getElementById('spotPopup');
      var popupImg = document.getElementById('popupImg');
      var popupPrev = document.getElementById('popupPrev');
      var popupNext = document.getElementById('popupNext');
      var popupCounter = document.getElementById('popupCounter');
      var popupContent = document.getElementById('popupContent');
      var popupCloseBtn = document.getElementById('popupCloseBtn');

      // 1. 从 textContent 读取 SVG 并注入容器
      var svgTpl = document.getElementById('staticSvgData');
      if (svgTpl && svgTpl.textContent && svgTpl.textContent.indexOf('<svg') !== -1) {
        container.innerHTML = svgTpl.textContent;
      }

      function decodeImgs(raw) {
        if (!raw) return [];
        return raw.split(',').map(function (s) {
          // 还原 HTML 实体
          return s.replace(/&amp;/g, '&').trim();
        }).filter(Boolean);
      }

      function renderImage() {
        if (currentImages.length === 0) {
          popupImg.style.display = 'none';
          popupPrev.style.display = 'none';
          popupNext.style.display = 'none';
          popupCounter.style.display = 'none';
          return;
        }
        popupImg.style.display = 'block';
        popupImg.src = currentImages[currentIndex];
        popupImg.alt = '';
        if (currentImages.length > 1) {
          popupPrev.style.display = 'flex';
          popupNext.style.display = 'flex';
          popupCounter.style.display = 'block';
          popupCounter.textContent = (currentIndex + 1) + '/' + currentImages.length;
        } else {
          popupPrev.style.display = 'none';
          popupNext.style.display = 'none';
          popupCounter.style.display = 'none';
        }
      }

      function showPopup(marker) {
        cancelHide();
        var name = marker.getAttribute('data-name') || '';
        var day = marker.getAttribute('data-day') || '';
        var plan = marker.getAttribute('data-plan') || '';
        var desc = marker.getAttribute('data-spot-desc') || '';
        var imgRaw = marker.getAttribute('data-spot-img') || '';

        currentImages = decodeImgs(imgRaw);
        currentIndex = 0;
        renderImage();

        var html = '';
        if (name) html += '<div class="spot-name">' + name + '</div>';
        if (day) html += '<span class="day-tag">' + day + '</span>';
        if (plan) html += '<div class="spot-plan">' + plan + '</div>';
        if (desc) html += '<div class="spot-desc">' + desc + '</div>';
        popupContent.innerHTML = html;
        popup.classList.add('show');
      }

      function hidePopup() {
        cancelHide();
        popup.classList.remove('show');
      }

      function scheduleHide() {
        cancelHide();
        hideTimer = setTimeout(function () {
          popup.classList.remove('show');
        }, 3000);
      }

      function cancelHide() {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
      }

      popupPrev.addEventListener('click', function (e) {
        e.stopPropagation();
        if (currentImages.length === 0) return;
        currentIndex = (currentIndex - 1 + currentImages.length) % currentImages.length;
        renderImage();
        cancelHide();
      });
      popupNext.addEventListener('click', function (e) {
        e.stopPropagation();
        if (currentImages.length === 0) return;
        currentIndex = (currentIndex + 1) % currentImages.length;
        renderImage();
        cancelHide();
      });
      popupImg.addEventListener('error', function () {
        this.style.display = 'none';
      });
      popupCloseBtn.addEventListener('click', hidePopup);

      // 2. 绑定标点交互
      var markers = container.querySelectorAll('.route-marker');
      markers.forEach(function (marker) {
        marker.style.cursor = 'pointer';
        marker.addEventListener('mouseenter', function () { showPopup(marker); });
        marker.addEventListener('mouseleave', function () { scheduleHide(); });
        marker.addEventListener('touchstart', function (e) {
          e.preventDefault();
          showPopup(marker);
          scheduleHide();
        }, { passive: false });
      });

      // 鼠标进入弹窗取消隐藏；离开重新计时
      popup.addEventListener('mouseenter', cancelHide);
      popup.addEventListener('mouseleave', scheduleHide);
    })();
  </script>
</body>
</html>
`;

writeFileSync(OUT_PATH, HTML, 'utf8');
const size = statSync(OUT_PATH).size;
console.log('OK ->', OUT_PATH);
console.log('SIZE bytes:', size);
