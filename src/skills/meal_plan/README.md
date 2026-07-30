# meal_plan 技能目录说明

当前技能采用轻量 `template-card` 链路，不再使用旧的 `template-contracts`。

## 运行目录

```text
meal_plan/
  index.js
  manifest.json
  templates/
    html/
      diet_card.html
      diet_card.manifest.json
    data/
      diet_card.sample.json
    followups/
      diet_card.json
    preview/
      README.md
      index.html
      diet_card.preview.html
```

## 各目录职责

| 目录 | 用途 | 是否运行时读取 |
|---|---|---|
| `templates/html` | HTML 原型模板和同名 manifest。`manifest.match` 是 LLM 语义选模板的关键描述。 | 是 |
| `templates/data` | 模板样例数据，用于预览和调测。 | 运行时主链路不读，预览脚本读取 |
| `templates/followups` | 当前模板的追问建议配置。 | 后续动作/追问模块读取 |
| `templates/preview` | 生成的静态预览 HTML，便于人工核查模板。 | 否 |
| `_legacy` | 旧复杂链路资料归档。 | 否 |

## 不再需要的一等目录

| 旧目录 | 结论 |
|---|---|
| `fixtures` | 只是早期空占位，无当前用途，已移入 `_legacy/fixtures`。 |
| `template-contracts` | 旧 Envelope/contract 模板链路，不再被运行时读取，已移入 `_legacy/template-contracts`。 |

## 预览生成

```bash
node scripts/render-template-preview.js meal_plan
```

打开：

```text
src/skills/meal_plan/templates/preview/index.html
```
