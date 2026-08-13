#!/bin/bash
# 直接调 fillTravelH5EmbedCard 看 URL 来源
node -e "
import('./src/core/model-service.js').then(m => {
  // 模拟 booking_handoff action 的 business_data
  const business_data = {
    jtd: {
      selected_product: {
        product_id: '2070305000000000271',
        product_name: '测试旅居路线',
        handoff_urls: {
          h5_product_url: 'https://lvjutest.jtdcn.cn/h5/#/pages/product/detail?productId=2070305000000000271',
          h5_order_url: '',
        }
      }
    }
  };
  const result = m.fillTravelH5EmbedCard({ message: '预订', business_data });
  console.log('h5Url:', result.data?.h5Url || '(empty)');
  console.log('template_id:', result.template_id);
}).catch(e => console.error(e.message));
"
