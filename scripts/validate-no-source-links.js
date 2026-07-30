import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LEGACY_PROJECT = ["gui", "xiaoyang-chat-system"].join("");
const SCAN_TARGETS = ["src", "scripts", "tests", "docs", "package.json", "README.md", ".env.example", ".env"];
const ALLOWLIST = new Set([".env.example", "src/config/env.js", "scripts/copy-source-assets.js"]);
const FORBIDDEN_REFERENCES = [
  ["D:", "GuiCare", LEGACY_PROJECT].join("\\"),
  ["D:", "GuiCare", LEGACY_PROJECT].join("/"),
  ["..", LEGACY_PROJECT].join("/"),
  ["..", LEGACY_PROJECT].join("\\"),
  ["FLATTALK", "SOURCE", "ROOT"].join("_"),
  ["source", "Root"].join(""),
  ["source", "root"].join("_"),
];

function normalizeRelative(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(rootDir, relativeTarget, files) {
  const absoluteTarget = path.join(rootDir, relativeTarget);
  if (!(await exists(absoluteTarget))) {
    return;
  }

  const stat = await fs.stat(absoluteTarget);
  if (stat.isFile()) {
    files.push(normalizeRelative(relativeTarget));
    return;
  }

  if (!stat.isDirectory()) {
    return;
  }

  const entries = await fs.readdir(absoluteTarget, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && ["node_modules", ".git"].includes(entry.name)) {
      continue;
    }

    const childRelative = path.join(relativeTarget, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(rootDir, childRelative, files);
    } else if (entry.isFile()) {
      files.push(normalizeRelative(childRelative));
    }
  }
}

export async function scanWorkspaceForSourceLinks(rootDir = process.cwd()) {
  const files = [];
  const violations = [];

  for (const target of SCAN_TARGETS) {
    await collectFiles(rootDir, target, files);
  }

  for (const relativePath of files.sort()) {
    if (ALLOWLIST.has(relativePath)) {
      continue;
    }

    const absolutePath = path.join(rootDir, relativePath);
    const content = await fs.readFile(absolutePath, "utf8");

    for (const forbidden of FORBIDDEN_REFERENCES) {
      if (content.includes(forbidden)) {
        violations.push({ file: relativePath, forbidden });
      }
    }
  }

  return {
    checked: files.length,
    violations,
  };
}

async function main() {
  const result = await scanWorkspaceForSourceLinks();
  if (result.violations.length > 0) {
    throw new Error(`Forbidden source references found: ${JSON.stringify(result.violations)}`);
  }

  console.log(JSON.stringify({ ok: true, checked: result.checked }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
