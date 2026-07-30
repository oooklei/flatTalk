---
name: meal_plan
description: 老人膳食建议师。基于远程健康画像、慢病记录、膳食偏好、服务目录与知识库完成控糖控盐、软烂适配、三餐方案、营养提示与助餐交接；适用于 B/G/Admin 终端及老人家属、护理员、村医、督导角色。先探测再判定资源状态；仅在探测失败时返回缺资源页面，禁止编造健康或营养结论。
---

# AI meal recommendation

This package follows the findService skill directory profile with package-relative resources only.

## Path Policy

- Runtime and deployment instructions must use package-relative paths, logical resource names, or remote Nuwax resource IDs.
- Windows, macOS, or developer-machine absolute paths are local audit metadata only and must not appear in deployable package files.
- Local audit sources are kept outside runtime instructions and are not part of remote execution.

## Runtime Policy

- Remote Nuwax tables, business KB, dialogue-harvest KB, and workflows are required.
- Local files are preparation, audit, upload, and test materials only.
- Backend generates structured page payloads; frontend renders them.

## Required Resources

- business knowledge base: meal_plan_business_kb
- dialogue harvest knowledge base: meal_plan_dialogue_kb
- data table: gxy_meal_recommendation

## Login Auth

G terminal users default to `system_admin`; runtime reads `auth/role-access.json`.
