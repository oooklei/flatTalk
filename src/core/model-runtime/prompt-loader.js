import fs from 'node:fs';
import path from 'node:path';

const PROMPT_ROOT = path.join(process.cwd(), 'src', 'prompts');

export function loadPrompt(relativePath, variables = {}) {
  const filePath = path.join(PROMPT_ROOT, relativePath);
  let text = fs.readFileSync(filePath, 'utf8');
  for (const [key, value] of Object.entries(variables)) {
    text = text.replaceAll(`{{${key}}}`, stringifyPromptValue(value));
  }
  return text;
}

function stringifyPromptValue(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}
