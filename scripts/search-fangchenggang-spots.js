import 'dotenv/config';
import { searchCategory } from '../src/services/nearby-resource/tavily-nearby-adapter.js';
import fs from 'fs';
import path from 'path';

// 防城港景点列表
const spots = [
  {
    name: '嘉路滨海旅居基地',
    lat: 21.5279,
    lng: 108.1668,
    category: 'spot'
  },
  {
    name: '东兴京族三岛',
    lat: 21.5083,
    lng: 107.8833,
    category: 'spot'
  },
  {
    name: '金滩 (Golden Beach)',
    lat: 21.495,
    lng: 107.87,
    category: 'spot'
  }
];

async function main() {
  console.log('开始搜索防城港景点信息...\n');
  
  const results = [];
  
  for (const spot of spots) {
    console.log(`正在搜索: ${spot.name}...`);
    
    try {
      const center = {
        name: spot.name,
        lat: spot.lat,
        lng: spot.lng
      };
      
      // 使用 searchCategory 搜索景点信息
      const enrichment = await searchCategory('spot', center, 10000);
      
      const result = {
        name: spot.name,
        coordinates: {
          lat: spot.lat,
          lng: spot.lng
        },
        description: enrichment.description || '',
        images: enrichment.images || [],
        rating_hint: enrichment.rating_hint || '',
        source_status: enrichment.source_status || '',
        source_results: enrichment.source_results || [],
        enriched_at: new Date().toISOString()
      };
      
      results.push(result);
      console.log(`✓ ${spot.name} 搜索完成`);
      if (enrichment.description) {
        console.log(`  描述: ${enrichment.description.slice(0, 100)}...`);
      }
      if (enrichment.images?.length) {
        console.log(`  图片: ${enrichment.images.length} 张`);
      }
      console.log();
      
    } catch (error) {
      console.error(`✗ ${spot.name} 搜索失败:`, error.message);
      results.push({
        name: spot.name,
        coordinates: {
          lat: spot.lat,
          lng: spot.lng
        },
        error: error.message,
        enriched_at: new Date().toISOString()
      });
    }
  }
  
  // 保存结果到 JSON 文件
  const outputPath = 'D:\\GuiCare\\flatTalk\\geographicSVG\\fangchenggang-spots-data.json';
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  
  console.log('========================================');
  console.log(`搜索完成！结果已保存到: ${outputPath}`);
  console.log(`成功: ${results.filter(r => !r.error).length} / ${results.length}`);
}

main().catch(console.error);