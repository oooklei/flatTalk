import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FLATTALK_ASSETS_ROOT = path.resolve("D:\\GuiCare\\flatTalk\\assets");
const FLATTALK_ROOT = path.resolve("D:\\GuiCare\\flatTalk");
const GUICARE_ROOT = path.resolve("D:\\GuiCare");
const DEFAULT_SOURCE_ROOT = path.resolve("D:\\GuiCare\\guixiaoyang-chat-system");
const DEFAULT_ASSET_ROOT = path.resolve("D:\\GuiCare\\flatTalk\\assets\\source-copies");

const REQUIRED_TARGETS = [
  "data/template-registry.json",
  "data/action-registry.json",
  "data/role-skill-matrix.json",
  "data/keyword-registry-default.json",
  "data/external-service-registry.json",
  "data/openapi-app-registry.json",
  "data/bff-capability-registry.json",
  "skill-packages/meal_plan",
  "skill-packages/guixiaoyang_dispatch",
  "public/mobile.html",
  "public/mobile.css",
  "public/mobile.js",
];

const OPTIONAL_TARGETS = [
  "data/model-registry.json",
  "data/templates",
  "data/kb",
  "data/contracts",
  "data/supplemental",
  "public/assets",
];

const EXCLUDED_SEGMENTS = new Set([
  "node_modules",
  "tmp",
  "dist",
  "backup",
  "import-zips",
  "_knowledge_upload",
  ".git",
]);
const SENSITIVE_PATTERN = /code-?plugin/i;
const SENSITIVE_ENTRY_FIELDS = new Set(["key", "id", "type", "name", "capability", "action"]);

export function normalizeRelative(relativePath) {
  return relativePath.split(path.sep).join("/");
}

export function isCodePluginPath(relativePath) {
  return normalizeRelative(relativePath)
    .split("/")
    .some((segment) => {
      const lower = segment.toLowerCase();
      return lower.includes("codeplugin") || lower.includes("code-plugin");
    });
}

export function isExcludedPath(relativePath) {
  return normalizeRelative(relativePath)
    .split("/")
    .some((segment) => EXCLUDED_SEGMENTS.has(segment.toLowerCase()) || isCodePluginPath(segment));
}

function containsSensitiveText(value) {
  return typeof value === "string" && SENSITIVE_PATTERN.test(value);
}

function entryHasSensitiveRegistryIdentity(objectValue) {
  return Object.entries(objectValue).some(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    return (
      SENSITIVE_ENTRY_FIELDS.has(normalizedKey) &&
      (SENSITIVE_PATTERN.test(key) || containsSensitiveText(value))
    );
  });
}

function objectContainsSensitiveText(objectValue) {
  return SENSITIVE_PATTERN.test(JSON.stringify(objectValue));
}

export function sanitizeRegistryJson(value) {
  if (Array.isArray(value)) {
    const sanitized = [];
    let removed = 0;

    for (const item of value) {
      if (typeof item === "object" && item !== null && objectContainsSensitiveText(item)) {
        removed += 1;
        continue;
      }

      const child = sanitizeRegistryJson(item);
      removed += child.removed;

      if (
        containsSensitiveText(child.value) ||
        (typeof item === "object" && item !== null && objectContainsSensitiveText(child.value))
      ) {
        removed += 1;
        continue;
      }

      sanitized.push(child.value);
    }

    return { value: sanitized, removed };
  }

  if (typeof value !== "object" || value === null) {
    return { value, removed: 0 };
  }

  const sanitized = {};
  let removed = 0;

  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_PATTERN.test(key)) {
      removed += 1;
      continue;
    }

    if (typeof item === "object" && item !== null && entryHasSensitiveRegistryIdentity(item)) {
      removed += 1;
      continue;
    }

    const child = sanitizeRegistryJson(item);
    removed += child.removed;

    if (
      containsSensitiveText(child.value) ||
      (typeof child.value === "object" && child.value !== null && objectContainsSensitiveText(child.value))
    ) {
      removed += 1;
      continue;
    }

    sanitized[key] = child.value;
  }

  return { value: sanitized, removed };
}

function shouldSanitizeJson(relativePath) {
  const normalized = normalizeRelative(relativePath);
  return (
    normalized.endsWith(".json") &&
    (normalized.startsWith("data/") ||
      (normalized.startsWith("skill-packages/") && normalized.includes("/registry")))
  );
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  const content = await fs.readFile(filePath);
  return {
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function isInside(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function isDriveRoot(targetPath) {
  const parsed = path.parse(targetPath);
  return targetPath === parsed.root;
}

export function assertSafeAssetRoot(assetRoot, sourceRoot) {
  const resolvedAssetRoot = path.resolve(assetRoot);
  const resolvedSourceRoot = path.resolve(sourceRoot);

  if (!isInside(FLATTALK_ASSETS_ROOT, resolvedAssetRoot)) {
    throw new Error(`Unsafe asset root: must be inside ${FLATTALK_ASSETS_ROOT}`);
  }

  const forbiddenRoots = new Set([FLATTALK_ROOT, GUICARE_ROOT, resolvedSourceRoot]);
  if (forbiddenRoots.has(resolvedAssetRoot) || isDriveRoot(resolvedAssetRoot)) {
    throw new Error(`Unsafe asset root: ${resolvedAssetRoot}`);
  }
}

export function assertCopyDestinationInside(assetRoot, destinationPath) {
  const resolvedAssetRoot = path.resolve(assetRoot);
  const resolvedDestination = path.resolve(destinationPath);
  const relativePath = path.relative(resolvedAssetRoot, resolvedDestination);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Copy destination escapes asset root: ${resolvedDestination}`);
  }
}

async function removeExistingCopy(assetRoot, sourceRoot) {
  assertSafeAssetRoot(assetRoot, sourceRoot);
  await fs.rm(assetRoot, { recursive: true, force: true });
  await fs.mkdir(assetRoot, { recursive: true });
}

async function copyFileWithManifest(sourceRoot, assetRoot, relativePath, files) {
  if (isExcludedPath(relativePath)) {
    return;
  }

  const sourcePath = path.join(sourceRoot, relativePath);
  const assetPath = path.join(assetRoot, relativePath);
  assertCopyDestinationInside(assetRoot, assetPath);

  await fs.mkdir(path.dirname(assetPath), { recursive: true });

  let sanitized_count = 0;
  if (shouldSanitizeJson(relativePath)) {
    const sourceContent = await fs.readFile(sourcePath, "utf8");
    const parsed = JSON.parse(sourceContent);
    const sanitized = sanitizeRegistryJson(parsed);
    sanitized_count = sanitized.removed;
    await fs.writeFile(assetPath, `${JSON.stringify(sanitized.value, null, 2)}\n`, "utf8");
  } else {
    await fs.copyFile(sourcePath, assetPath);
  }

  const { bytes, sha256 } = await hashFile(assetPath);
  const fileEntry = {
    source_relative: normalizeRelative(relativePath),
    copied_relative: normalizeRelative(relativePath),
    bytes,
    sha256,
  };

  if (sanitized_count > 0) {
    fileEntry.sanitized_count = sanitized_count;
  }

  files.push(fileEntry);
}

async function copyDirectoryWithManifest(sourceRoot, assetRoot, relativePath, files) {
  if (isExcludedPath(relativePath)) {
    return;
  }

  const sourcePath = path.join(sourceRoot, relativePath);
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });

  for (const entry of entries) {
    const childRelative = path.join(relativePath, entry.name);
    if (isExcludedPath(childRelative)) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyDirectoryWithManifest(sourceRoot, assetRoot, childRelative, files);
    } else if (entry.isFile()) {
      await copyFileWithManifest(sourceRoot, assetRoot, childRelative, files);
    }
  }
}

async function copyTarget(sourceRoot, assetRoot, relativePath, files) {
  const sourcePath = path.join(sourceRoot, relativePath);
  const stat = await fs.stat(sourcePath);

  if (stat.isDirectory()) {
    await copyDirectoryWithManifest(sourceRoot, assetRoot, relativePath, files);
  } else if (stat.isFile()) {
    await copyFileWithManifest(sourceRoot, assetRoot, relativePath, files);
  }
}

async function assertRequiredTargets(sourceRoot) {
  const missing = [];

  for (const relativePath of REQUIRED_TARGETS) {
    if (!(await exists(path.join(sourceRoot, relativePath)))) {
      missing.push(normalizeRelative(relativePath));
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required source targets: ${missing.join(", ")}`);
  }
}

export async function copySourceAssets() {
  const sourceRoot = path.resolve(process.env.FLATTALK_SOURCE_ROOT || DEFAULT_SOURCE_ROOT);
  const assetRoot = path.resolve(process.env.FLATTALK_ASSET_ROOT || DEFAULT_ASSET_ROOT);
  const files = [];

  await assertRequiredTargets(sourceRoot);
  await removeExistingCopy(assetRoot, sourceRoot);

  for (const relativePath of REQUIRED_TARGETS) {
    await copyTarget(sourceRoot, assetRoot, relativePath, files);
  }

  for (const relativePath of OPTIONAL_TARGETS) {
    if (await exists(path.join(sourceRoot, relativePath))) {
      await copyTarget(sourceRoot, assetRoot, relativePath, files);
    }
  }

  files.sort((left, right) => left.copied_relative.localeCompare(right.copied_relative));

  const manifest = {
    copied_at: new Date().toISOString(),
    source_name: path.basename(sourceRoot),
    source_root_note:
      "Copied from FLATTALK_SOURCE_ROOT at copy time. Runtime code must read from this asset root only.",
    asset_root: assetRoot,
    files,
  };
  const manifestPath = path.join(assetRoot, "asset-copy-manifest.json");
  await fs.writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.rename(`${manifestPath}.tmp`, manifestPath);

  return {
    ok: true,
    copied: files.length,
    manifest: normalizeRelative(path.relative(process.cwd(), manifestPath)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  copySourceAssets()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
      process.exitCode = 1;
    });
}
