export class MockBusinessSystemAdapter {
  constructor({ collaboration = {} } = {}) {
    this.collaboration = collaboration;
  }

  currentUser(input = {}) {
    const profile = this.collaboration.getProfile?.(input) || {};
    return {
      ok: true,
      user: {
        user_id: input.user_id || input.userId || input.userToken || profile.userId || "mock_user",
        user_name: input.user_name || input.userName || profile.userName || "模拟用户",
        role: input.role || input.roleKey || profile.roleKey || "family",
        role_name: input.role_name || input.roleName || profile.roleName || "家属",
        tenant_id: input.tenant_id || "gxyl",
        org_id: input.org_id || profile.orgId || "",
        org_name: input.org_name || profile.orgName || "",
        elder_ids: input.elder_ids || [],
        login_state_version: input.login_state_version || input.loginStateVersion || `mock_${Date.now()}`,
      },
      source_status: "mock",
    };
  }

  executeAction({ actionDef, params = {} } = {}) {
    if (actionDef.action_key === "workorder.detail") {
      const workOrders = this.collaboration.getWorkOrders?.(params) || [];
      return {
        ok: true,
        target: "business_system",
        action_key: actionDef.action_key,
        source_status: "mock",
        result: {
          workorder_id: params.workorder_id || params.workorderId || "",
          work_orders: workOrders,
        },
      };
    }
    return {
      ok: true,
      target: "business_system",
      action_key: actionDef.action_key,
      source_status: "mock",
      result: {
        accepted: true,
        params,
      },
    };
  }
}
