# meal_plan 模板预览目录

用途：

- 存放由 `templates/html/*.html` 和 `templates/data/*.sample.json` 渲染出的静态预览 HTML。
- 方便直接用浏览器打开核查模板样式、字段替换、数组重复、分页等效果。
- 这里是生成产物目录，不参与运行时模板扫描。

当前运行时模板来源：

```text
src/skills/meal_plan/templates/html/*.html
src/skills/meal_plan/templates/html/*.manifest.json
```

当前建议保留的轻量资源：

```text
templates/html/diet_card.html
templates/html/diet_card.manifest.json
templates/data/diet_card.sample.json
templates/followups/diet_card.json
```

预览生成命令：

```bash
node scripts/render-template-preview.js meal_plan
```

生成结果：

```text
src/skills/meal_plan/templates/preview/diet_card.preview.html
src/skills/meal_plan/templates/preview/index.html
```

注意：

- 不要把 preview 目录作为 LLM 模板库输入。
- 修改模板时，应改 `templates/html` 下的源 HTML 和同名 manifest。
- 修改示例数据时，应改 `templates/data` 下的 sample JSON。
