// lib/business-adapters/order-client.js
const ORDER_SYSTEM_BASE_URL = process.env.ORDER_SYSTEM_BASE_URL || 'http://192.168.1.160:8080';

async function request(path, options = {}) {
  const url = `${ORDER_SYSTEM_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-System-Id': 'guixiaoyang-bff',
      ...options.headers
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export default {
  async createOrder(params) {
    return request('/api/orders/create', { method: 'POST', body: JSON.stringify(params) });
  },

  async getOrder(orderId) {
    return request(`/api/orders/${orderId}`);
  },

  async searchOrders(query) {
    return request('/api/orders/search', { method: 'POST', body: JSON.stringify(query) });
  },

  async cancelOrder(orderId, reason) {
    return request(`/api/orders/${orderId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
  },

  async evaluateOrder(orderId, evaluation) {
    return request(`/api/orders/${orderId}/evaluate`, { method: 'POST', body: JSON.stringify(evaluation) });
  },

  async getOrderTimeline(orderId) {
    return request(`/api/orders/${orderId}/timeline`);
  }
};