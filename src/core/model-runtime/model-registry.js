import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REGISTRY_PATH = path.join(process.cwd(), 'data', 'model-registry.json');

export function readModelRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  const filePath = registryPath || DEFAULT_REGISTRY_PATH;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(raw.models) ? raw.models : [];
  } catch {
    return [];
  }
}

export function pickChatModel({ registryPath, modelId, purpose = '主对话与模板编排' } = {}) {
  const models = readModelRegistry(registryPath || DEFAULT_REGISTRY_PATH)
    .filter((model) => model && model.is_active !== false && model.model_type !== 'vision');

  return (modelId ? models.find((model) => String(model.id) === String(modelId) || model.name === modelId) : null)
    || models.find((model) => model.is_default)
    || models.find((model) => String(model.purpose || '').includes(purpose))
    || models[0]
    || null;
}

export function resolveModelApiKey(model = {}) {
  if (model.api_key && String(model.api_key).trim()) return String(model.api_key);
  const provider = String(model.provider || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (provider && process.env[`FLATTALK_MODEL_${provider}_API_KEY`]) {
    return process.env[`FLATTALK_MODEL_${provider}_API_KEY`];
  }
  // longcat 回退：兼容旧变量名 FLATTALK_MODEL_ANTHROPIC_API_KEY
  if (provider === 'LONGCAT' && process.env.FLATTALK_MODEL_ANTHROPIC_API_KEY) {
    return process.env.FLATTALK_MODEL_ANTHROPIC_API_KEY;
  }
  return process.env.FLATTALK_MODEL_API_KEY || '';
}

export function publicModelName(model) {
  return model?.display_name || model?.name || model?.model_id || '';
}
