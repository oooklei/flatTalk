// 在远程容器创建SVG文件
const http = require('http');

const svgFiles = {
  'bama': require('fs').readFileSync('/app/geographicSVG/巴马5天4晚康养旅居-丰富版.svg', 'utf8'),
  'fcg': require('fs').readFileSync('/app/geographicSVG/防城港京族滨海文化线-丰富版.svg', 'utf8')
};

console.log('SVG files loaded');