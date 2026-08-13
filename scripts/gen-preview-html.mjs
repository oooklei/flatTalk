// 直接生成完整预览HTML（不走Mustache，确保结构正确）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'd:/GuiCare/flatTalk';
const geoDir = path.join(ROOT, 'geographicSVG');
const svgStd = fs.readFileSync(path.join(geoDir, 'test-bama-real-standard.svg'), 'utf8');

// 行程数据
const itinerary = [
  { day: 'Day1', wp: '巴马县城', plan: '抵达巴马，入住康养基地，适应气候，品鉴长寿火麻汤' },
  { day: 'Day2', wp: '百魔洞', plan: '上午游览百魔洞，感受地磁养生；下午盘阳河畔漫步' },
  { day: 'Day3', wp: '长寿村', plan: '探访巴盘屯长寿村，拜访百岁老人，学习长寿饮食' },
  { day: 'Day4', wp: '水晶宫', plan: '游览水晶宫溶洞奇观，欣赏晶莹钟乳石；下午命河观景' },
  { day: 'Day5', wp: '赐福湖→返程', plan: '上午赐福湖湖畔康养，午后返程' },
];
const highlights = ['百魔洞地磁养生', '长寿村探访百岁老人', '水晶宫地下艺术宫殿', '命河天然太极图', '赐福湖湖畔康养', '高负氧离子呼吸'];

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>巴马5天4晚康养旅居 - 预览</title>
<style>
  :root { --primary:#FF7826; --primary-gradient:linear-gradient(135deg,#FF7826 0%,#FF9A5C 100%); --bg:#FFFDF9; --bg-white:#fff; --ink:#3A3A3A; --ink-light:#666; --muted:#999; --border:#E5E5E5; --divider:#F0EBE3; --primary-light:#FFF3E0; }
  * { box-sizing:border-box; }
  body { margin:0; padding:14px; font-family:-apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif; background:var(--bg); color:var(--ink); line-height:1.5; }
  .route-card { max-width:400px; margin:0 auto; background:var(--bg-white); border:1px solid var(--border); border-radius:14px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.06); }
  .hero { padding:16px; background:var(--primary-gradient); color:#fff; }
  .eyebrow { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; background:rgba(255,255,255,0.22); font-size:12px; margin-bottom:10px; }
  .hero h1 { margin:0; font-size:20px; line-height:1.25; }
  .subtitle { margin:8px 0 0; font-size:13px; opacity:0.92; line-height:1.45; }
  .price-tag { display:inline-block; padding:2px 8px; border-radius:4px; background:rgba(255,255,255,0.28); font-weight:600; font-size:12px; vertical-align:middle; }
  .svg-map-section { position:relative; border-top:1px solid var(--divider); }
  .svg-map-section h2 { padding:12px 14px 6px; margin:0; font-size:15px; display:flex; align-items:center; justify-content:space-between; }
  .svg-map-section h2 .hint { font-size:11px; color:var(--primary); background:var(--primary-light); padding:2px 8px; border-radius:999px; font-weight:600; }
  .svg-container { position:relative; width:100%; overflow:hidden; background:#fff; }
  .svg-container svg { display:block; width:100%; height:auto; }
  .route-marker { cursor:pointer; transition:opacity 0.15s; }
  .route-marker:hover { opacity:0.8; }
  .spot-popup { display:none; position:absolute; top:10px; right:10px; background:#fff; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.15); padding:14px; max-width:220px; z-index:20; }
  .spot-popup.show { display:block; animation:popIn 0.2s ease-out; }
  @keyframes popIn { from{opacity:0;transform:scale(0.9)} to{opacity:1;transform:scale(1)} }
  .spot-popup .close-btn { position:absolute; top:8px; right:8px; width:24px; height:24px; border:none; border-radius:50%; background:#F0EBE3; color:#666; font-size:16px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:1; }
  .spot-popup .close-btn:hover { background:#E5E5E5; }
  .spot-popup .spot-img { width:100%; height:120px; object-fit:cover; border-radius:8px; margin-bottom:10px; display:block; }
  .spot-popup .spot-name { font-size:16px; font-weight:700; color:var(--ink); margin-bottom:6px; line-height:1.3; }
  .spot-popup .day-tag { display:inline-block; font-size:11px; color:var(--primary); background:var(--primary-light); padding:2px 8px; border-radius:999px; margin-bottom:8px; font-weight:600; }
  .spot-popup .spot-plan { font-size:13px; color:var(--ink-light); margin-bottom:6px; line-height:1.5; }
  .spot-popup .spot-desc { font-size:12px; color:var(--muted); line-height:1.5; }
  .summary-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; padding:12px 14px 4px; }
  .metric { border:1px solid #F0EBE3; border-radius:10px; padding:10px; background:#FFFAF5; }
  .metric span { display:block; color:var(--muted); font-size:11px; margin-bottom:4px; }
  .metric strong { display:block; font-size:14px; line-height:1.35; color:var(--ink); word-break:break-word; }
  .highlights { padding:12px 14px; border-top:1px solid var(--divider); }
  .highlights h2 { margin:0 0 8px; font-size:15px; }
  .highlights .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .highlights .chip { padding:5px 10px; border-radius:999px; background:var(--primary-light); color:#E65100; font-size:12px; }
  .itinerary { padding:12px 14px; border-top:1px solid var(--divider); }
  .itinerary h2 { margin:0 0 8px; font-size:15px; }
  .itinerary .timeline { display:grid; gap:8px; }
  .itinerary .day-item { display:grid; grid-template-columns:60px minmax(0,1fr); gap:8px; align-items:start; }
  .itinerary .day-item b { display:inline-flex; align-items:center; justify-content:center; min-height:28px; border-radius:8px; background:linear-gradient(135deg,#FFF3E0,#FFE0B2); color:#E65100; font-size:12px; }
  .itinerary .day-item p { margin:0; font-size:13px; line-height:1.5; color:var(--ink-light); }
  .itinerary .day-item .wp-name { display:block; font-size:12px; color:var(--primary); font-weight:600; margin-bottom:2px; }
  .health { padding:12px 14px; border-top:1px solid var(--divider); }
  .health h2 { margin:0 0 8px; font-size:15px; }
  .health .notice { margin:0; padding:10px; border-radius:10px; background:#E8F5E9; color:#2E7D32; font-size:13px; line-height:1.5; }
</style>
</head>
<body>
<article class="route-card">
  <header class="hero">
    <div class="eyebrow">四季皆宜 · 经济舒适</div>
    <h1>巴马5天4晚康养旅居</h1>
    <p class="subtitle"><span class="price-tag">¥2980起</span> 世界长寿之乡 · 负氧离子天堂 · 地磁康养圣地</p>
  </header>
  <section class="svg-map-section">
    <h2>📍 走线路线 <span class="hint">悬停景点查看详情</span></h2>
    <div class="svg-container" id="svgMapContainer"></div>
    <div class="spot-popup" id="spotPopup">
      <button class="close-btn" onclick="hidePopup()">&times;</button>
      <div id="popupContent"></div>
    </div>
  </section>
  <section class="summary-grid">
    <div class="metric"><span>目的地</span><strong>广西巴马瑶族自治县</strong></div>
    <div class="metric"><span>天数</span><strong>5天4晚</strong></div>
    <div class="metric"><span>适合人群</span><strong>中老年康养 / 慢病调理</strong></div>
    <div class="metric"><span>预订状态</span><strong>可预订</strong></div>
  </section>
  <section class="highlights">
    <h2>行程亮点</h2>
    <div class="chips">${highlights.map((h) => `<span class="chip">${h}</span>`).join('')}</div>
  </section>
  <section class="itinerary">
    <h2>建议行程</h2>
    <div class="timeline">
      ${itinerary.map((d) => `<div class="day-item"><b>${d.day}</b><p><span class="wp-name">${d.wp}</span>${d.plan}</p></div>`).join('')}
    </div>
  </section>
  <section class="health">
    <h2>健康与接驳</h2>
    <p class="notice">巴马海拔较高，昼夜温差大，建议携带保暖衣物。康养期间多饮用地磁矿泉水，配合呼吸负氧离子，效果更佳。</p>
  </section>
</article>
<script type="text/html" id="staticSvgData">${svgStd}</script>
<script>
  var STATIC_SVG = document.getElementById('staticSvgData').textContent;
  var hideTimer = null;
  function showPopup(marker) {
    cancelHide();
    var name = marker.getAttribute('data-name') || '';
    var day = marker.getAttribute('data-day') || '';
    var plan = marker.getAttribute('data-plan') || '';
    var desc = marker.getAttribute('data-spot-desc') || '';
    var img = marker.getAttribute('data-spot-img') || '';
    var html = '';
    if (img) html += '<img class="spot-img" src="' + img + '" alt="' + name + '" onerror="this.style.display=\'none\'" />';
    if (name) html += '<div class="spot-name">' + name + '</div>';
    if (day) html += '<span class="day-tag">' + day + '</span>';
    if (plan) html += '<div class="spot-plan">' + plan + '</div>';
    if (desc) html += '<div class="spot-desc">' + desc + '</div>';
    document.getElementById('popupContent').innerHTML = html;
    document.getElementById('spotPopup').classList.add('show');
  }
  function hidePopup() { cancelHide(); var p = document.getElementById('spotPopup'); if (p) p.classList.remove('show'); }
  function scheduleHide() { cancelHide(); hideTimer = setTimeout(function(){ var p=document.getElementById('spotPopup'); if(p) p.classList.remove('show'); }, 3000); }
  function cancelHide() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }
  (function() {
    var container = document.getElementById('svgMapContainer');
    if (container && STATIC_SVG && STATIC_SVG.indexOf('<svg') !== -1) container.innerHTML = STATIC_SVG;
    var popup = document.getElementById('spotPopup');
    if (!container || !popup) return;
    var markers = container.querySelectorAll('.route-marker');
    markers.forEach(function(marker) {
      marker.style.cursor = 'pointer';
      marker.addEventListener('mouseenter', function() { showPopup(marker); });
      marker.addEventListener('mouseleave', function() { scheduleHide(); });
      marker.addEventListener('touchstart', function(e) { e.preventDefault(); showPopup(marker); scheduleHide(); }, { passive:false });
    });
    popup.addEventListener('mouseenter', cancelHide);
    popup.addEventListener('mouseleave', scheduleHide);
  })();
</script>
</body>
</html>`;

const outPath = path.join(geoDir, 'preview-bama-route.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('preview regenerated: ' + outPath + ' size=' + (html.length/1024).toFixed(1) + 'KB');
