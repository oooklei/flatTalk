// lib/business-adapters/workorder-client.js
const WORKORDER_SYSTEM_BASE_URL = process.env.WORKORDER_SYSTEM_BASE_URL || 'http://192.168.1.160:8080';

async function request(path, options = {}) {
  const url = `${WORKORDER_SYSTEM_BASE_URL}${path}`;
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
  async searchWorkorders(query) {
    return request('/api/workorders/search', { method: 'POST', body: JSON.stringify(query) });
  },

  async getWorkorder(workorderId) {
    return request(`/api/workorders/${workorderId}`);
  },

  async acceptWorkorder(workorderId, userId) {
    return request(`/api/workorders/${workorderId}/accept`, { method: 'POST', body: JSON.stringify({ user_id: userId }) });
  },

  async rejectWorkorder(workorderId, reason) {
    return request(`/api/workorders/${workorderId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
  },

  async reportException(workorderId, exception) {
    return request(`/api/workorders/${workorderId}/report-exception`, { method: 'POST', body: JSON.stringify(exception) });
  },

  async requestDoctor(workorderId, doctorType) {
    return request(`/api/workorders/${workorderId}/request-doctor`, { method: 'POST', body: JSON.stringify({ doctor_type: doctorType }) });
  },

  async cancelWorkorder(workorderId, reason) {
    return request(`/api/workorders/${workorderId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
  }
};