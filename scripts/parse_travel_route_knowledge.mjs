import XLSX from 'xlsx';
import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';

const KNOWLEDGE_DIR = 'D:\\GuiCare\\flatTalk\\src\\skills\\travel_route\\knowledge';
const SOURCE_DIR = 'D:\\GuiCare\\guixiaoyang-chat-system\\skill-packages\\travel_route\\knowledge_docs\\business';

// 确保知识目录存在
if (!fs.existsSync(KNOWLEDGE_DIR)) {
  fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
}

// 通用的文件查找函数
function findFile(pattern, extension) {
  const files = fs.readdirSync(SOURCE_DIR);
  return files.find(f => f.includes(pattern) && f.endsWith(extension));
}

// 解析 Excel 文件
function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  // 获取表头
  const headers = data[0];
  const rows = data.slice(1).filter(row => row.some(cell => cell !== undefined && cell !== ''));
  
  return { headers, rows };
}

// 解析 Word 文件
async function parseWord(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

// 1. 嘉路康养中心周边15公里配套表.xlsx
function parseJialuFacilities() {
  const targetFile = findFile('嘉路康养中心周边', '.xlsx');
  if (!targetFile) {
    console.log(`⚠ 嘉路康养中心周边配套表未找到`);
    return { status: 'not_found' };
  }
  
  const filePath = path.join(SOURCE_DIR, targetFile);
  const { headers, rows } = parseExcel(filePath);
  
  const facilities = rows.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      if (header && row[index] !== undefined) {
        obj[header.toString().trim()] = row[index];
      }
    });
    return obj;
  }).filter(obj => Object.keys(obj).length > 0);
  
  const result = {
    title: '嘉路康养中心周边15公里配套表',
    description: '嘉路康养中心周边15公里范围内的配套设施信息',
    extractedAt: new Date().toISOString(),
    headers: headers,
    data: facilities
  };
  
  fs.writeFileSync(
    path.join(KNOWLEDGE_DIR, 'jialu_facilities.json'),
    JSON.stringify(result, null, 2),
    'utf-8'
  );
  
  console.log(`✓ 嘉路康养中心周边配套表解析完成，共 ${facilities.length} 条数据`);
  return result;
}

// 2. 2023-2025广西旅居养老机构入选汇总表.xlsx
function parseGuangxiInstitutions() {
  const targetFile = findFile('广西旅居养老机构', '.xlsx');
  if (!targetFile) {
    console.log(`⚠ 广西旅居养老机构汇总表未找到`);
    return { status: 'not_found' };
  }
  
  const filePath = path.join(SOURCE_DIR, targetFile);
  const workbook = XLSX.readFile(filePath);
  
  // 获取所有工作表
  const allData = {
    title: '2023-2025广西旅居养老机构入选汇总表',
    description: '广西旅居养老机构入选名单及信息',
    extractedAt: new Date().toISOString(),
    sheets: {}
  };
  
  workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (data.length > 0) {
      const headers = data[0];
      const rows = data.slice(1).filter(row => row.some(cell => cell !== undefined && cell !== ''));
      
      const institutions = rows.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          if (header && row[index] !== undefined) {
            obj[header.toString().trim()] = row[index];
          }
        });
        return obj;
      }).filter(obj => Object.keys(obj).length > 0);
      
      allData.sheets[sheetName] = {
        headers,
        data: institutions
      };
      
      console.log(`  - 工作表 "${sheetName}": ${institutions.length} 条数据`);
    }
  });
  
  fs.writeFileSync(
    path.join(KNOWLEDGE_DIR, 'guangxi_institutions.json'),
    JSON.stringify(allData, null, 2),
    'utf-8'
  );
  
  console.log(`✓ 广西旅居养老机构汇总表解析完成`);
  return allData;
}

// 3. 解析防城港市AI养老试点线路产品设计方案.docx
async function parseFangchenggangRoutes() {
  const targetFile = findFile('防城港市AI养老试点', '.docx');
  if (!targetFile) {
    console.log(`⚠ 防城港市AI养老试点线路文档未找到`);
    return { status: 'not_found' };
  }
  
  const filePath = path.join(SOURCE_DIR, targetFile);
  
  try {
    const content = await parseWord(filePath);
    
    // 提取路线信息
    const lines = content.split('\n').filter(line => line.trim());
    const routes = [];
    
    let currentRoute = null;
    let currentSection = '';
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // 识别路线标题
      if (trimmedLine.match(/^[一二三四五六七八九十]+[、.．]/) ||
          trimmedLine.match(/^线路[一二三四五六七八九十]+/) ||
          trimmedLine.match(/^第[一二三四五六七八九十]+条/) ||
          trimmedLine.match(/^【?线路[一二三四五六七八九十]+】?/)) {
        
        if (currentRoute) {
          routes.push(currentRoute);
        }
        
        currentRoute = {
          name: trimmedLine,
          description: '',
          highlights: [],
          details: [],
          spots: []
        };
        currentSection = 'details';
      } else if (currentRoute) {
        // 识别景点、特色等
        if (trimmedLine.includes('景点') || trimmedLine.includes('景区')) {
          currentSection = 'spots';
          currentRoute.spots.push(trimmedLine);
        } else if (trimmedLine.includes('特色') || trimmedLine.includes('亮点')) {
          currentSection = 'highlights';
          currentRoute.highlights.push(trimmedLine);
        } else if (trimmedLine.match(/^[（(]/) || trimmedLine.length > 50) {
          // 长描述或详细说明
          currentRoute.details.push(trimmedLine);
        } else if (currentSection === 'spots') {
          currentRoute.spots.push(trimmedLine);
        } else if (currentSection === 'highlights') {
          currentRoute.highlights.push(trimmedLine);
        } else {
          currentRoute.details.push(trimmedLine);
        }
      }
    }
    
    if (currentRoute) {
      routes.push(currentRoute);
    }
    
    const result = {
      title: '防城港市AI养老试点5条旅居养老线路',
      description: '防城港市AI养老试点的5条旅居养老线路产品设计方案',
      extractedAt: new Date().toISOString(),
      rawContent: content,
      routes: routes.length > 0 ? routes : [{
        name: '防城港市AI养老试点线路',
        description: '详见原始文档',
        rawText: content
      }]
    };
    
    fs.writeFileSync(
      path.join(KNOWLEDGE_DIR, 'fangchenggang_routes.json'),
      JSON.stringify(result, null, 2),
      'utf-8'
    );
    
    console.log(`✓ 防城港市AI养老试点线路解析完成，共识别 ${routes.length} 条线路`);
    return result;
  } catch (error) {
    console.log(`⚠ 防城港市AI养老试点线路文档解析失败: ${error.message}`);
    return { status: 'error', error: error.message };
  }
}

// 4. "到广西过冬养老"十条精品路线发布.docx
async function parseTenPremiumRoutes() {
  // 使用动态文件发现
  const files = fs.readdirSync(SOURCE_DIR);
  const targetFile = files.find(f => f.includes('十条精品路线') && f.endsWith('.docx'));
  
  if (!targetFile) {
    console.log(`⚠ 十条精品路线文档未找到`);
    return { status: 'not_found' };
  }
  
  const filePath = path.join(SOURCE_DIR, targetFile);
  const content = await parseWord(filePath);
  
  // 提取路线信息
  const lines = content.split('\n').filter(line => line.trim());
  const routes = [];
  
  let currentRoute = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // 尝试识别路线标题（通常包含数字和"线"字）
    if (line.match(/^第[一二三四五六七八九十]+条?[线路段]/) || 
        line.match(/^\d+[、.．]\s*.{3,30}线/) ||
        line.match(/^路线[一二三四五六七八九十]+/) ||
        line.match(/^【.{2,10}线】/)) {
      
      if (currentRoute) {
        routes.push(currentRoute);
      }
      
      currentRoute = {
        name: line,
        description: '',
        highlights: [],
        details: []
      };
    } else if (currentRoute) {
      // 添加到当前路线的详细信息
      if (line.includes('景点') || line.includes('特色') || line.includes('亮点')) {
        currentRoute.highlights.push(line);
      } else {
        currentRoute.details.push(line);
      }
    }
  }
  
  if (currentRoute) {
    routes.push(currentRoute);
  }
  
  const result = {
    title: '到广西过冬养老十条精品路线',
    description: '广西发布的十条精品旅居养老路线',
    extractedAt: new Date().toISOString(),
    rawContent: content,
    routes: routes.length > 0 ? routes : [{ 
      name: '十条精品路线', 
      description: '详见原始文档',
      rawText: content 
    }]
  };
  
  fs.writeFileSync(
    path.join(KNOWLEDGE_DIR, 'ten_premium_routes.json'),
    JSON.stringify(result, null, 2),
    'utf-8'
  );
  
  console.log(`✓ 十条精品路线解析完成，共识别 ${routes.length} 条路线`);
  return result;
}

// 5. (2024年12月39个)广西中国长寿之乡情况.docx
async function parseLongevityHometowns() {
  const targetFile = findFile('广西中国长寿之乡', '.docx');
  if (!targetFile) {
    console.log(`⚠ 长寿之乡情况文档未找到`);
    return { status: 'not_found' };
  }
  
  const filePath = path.join(SOURCE_DIR, targetFile);
  const content = await parseWord(filePath);
  
  // 提取长寿之乡数据
  const lines = content.split('\n').filter(line => line.trim());
  const hometowns = [];
  
  // 尝试按行解析
  for (const line of lines) {
    // 匹配格式：县名 + 描述信息
    const match = line.match(/^([^\s，。、]+(?:县|市|区|旗))\s*[:：]?\s*(.*)$/);
    if (match) {
      hometowns.push({
        name: match[1],
        description: match[2] || ''
      });
    }
  }
  
  const result = {
    title: '广西中国长寿之乡情况',
    description: '2024年12月广西39个中国长寿之乡情况',
    extractedAt: new Date().toISOString(),
    totalCount: 39,
    rawContent: content,
    hometowns: hometowns.length > 0 ? hometowns : [{ 
      note: '详见原始文档',
      rawText: content 
    }]
  };
  
  fs.writeFileSync(
    path.join(KNOWLEDGE_DIR, 'longevity_hometowns.json'),
    JSON.stringify(result, null, 2),
    'utf-8'
  );
  
  console.log(`✓ 长寿之乡情况解析完成，共识别 ${hometowns.length} 个地区`);
  return result;
}

// 主执行函数
async function main() {
  console.log('开始解析旅居养老知识文档...\n');
  
  try {
    // 解析 Excel 文件
    console.log('1. 解析嘉路康养中心周边配套表...');
    parseJialuFacilities();
    
    console.log('\n2. 解析广西旅居养老机构汇总表...');
    parseGuangxiInstitutions();
    
    // 解析 Word 文件
    console.log('\n3. 解析防城港市AI养老试点线路...');
    await parseFangchenggangRoutes();
    
    console.log('\n4. 解析十条精品路线...');
    await parseTenPremiumRoutes();
    
    console.log('\n5. 解析长寿之乡情况...');
    await parseLongevityHometowns();
    
    console.log('\n========================================');
    console.log('所有文件解析完成！');
    console.log(`输出目录: ${KNOWLEDGE_DIR}`);
    
    // 列出生成的文件
    const files = fs.readdirSync(KNOWLEDGE_DIR);
    console.log('\n生成的文件:');
    files.forEach(file => {
      const stats = fs.statSync(path.join(KNOWLEDGE_DIR, file));
      console.log(`  - ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
    });
    
  } catch (error) {
    console.error('解析过程中出现错误:', error);
    throw error;
  }
}

main();