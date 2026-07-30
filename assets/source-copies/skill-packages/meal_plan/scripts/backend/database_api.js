const PACKAGE_KEY = "meal_plan";
const BUSINESS_TABLE = "gxy_meal_recommendation";
const BUSINESS_KB = "meal_plan_business_kb";
const DIALOGUE_KB = "meal_plan_dialogue_kb";

export function describeDatabase(loginContext = {}) {
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
