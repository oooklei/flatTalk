// nearby_resource 技能入口
// 业务逻辑集中在 core 层（scene-router / model-service / action-dispatcher / orchestrator），
// 此处仅作为技能被发现用的轻量入口，导出技能元信息与模板清单。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(__dirname, 'manifest.json'), 'utf-8'));

export const skillKey = manifest.key;
export const skillName = manifest.name;
export const templates = manifest.templates || [];

export function getSkillMeta() {
  return manifest;
}

export default { skillKey, skillName, templates, getSkillMeta };
