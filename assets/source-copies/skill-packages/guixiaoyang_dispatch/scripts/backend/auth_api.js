const PACKAGE_KEY = "guixiaoyang_dispatch";
const BUSINESS_TABLE = "gxy_dispatch_session";
const BUSINESS_KB = "guixiaoyang_dispatch_business_kb";
const DIALOGUE_KB = "guixiaoyang_dispatch_dialogue_kb";

export function describeAuth(loginContext = {}) {
  return {
    packageKey: PACKAGE_KEY,
    terminal: loginContext.terminal || "C",
    role: loginContext.terminal === "G" ? "系统管理员" : loginContext.role,
    businessTable: BUSINESS_TABLE,
    businessKb: BUSINESS_KB,
    dialogueKb: DIALOGUE_KB,
    remoteRequired: true
  };
}
