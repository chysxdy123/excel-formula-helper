# Excel Formula Helper 项目规则

## 产品定位

- 面向不懂 Excel 公式的用户，根据表结构和描述生成可复制的公式，并说明应放入哪个单元格。
- 网格只用于本地展示和描述结构；不计算数据、不上传真实单元格值、不扩展为在线 Excel。

## 技术边界

- 前端保持单个 `index.html`，使用纯 HTML、CSS、JavaScript 和现有 AG Grid Community CDN。
- 后端仅允许 `functions/api/generate.js` 这一项 Cloudflare Pages Function，不引入框架、构建工具、npm 依赖或数据库。
- OpenRouter key 和内测口令只能保存在 Cloudflare Secret 中，不得写入源码。

## 必跑安全检查

- AI 请求体只能包含 `columns`、`rowCount`、`targetCell`、`description`；`columns` 只能包含 `col`、`header`、`type`。
- 上线前必须用浏览器 Network 检查请求体，确认不存在真实单元格值。
- 上线前必须搜索工作树，确认不存在 API key、`.dev.vars`、`.env` 或其他密钥文件。
- OpenRouter 请求必须保留 `data_collection: "deny"`、`zdr: true`、`require_parameters: true` 和严格 JSON Schema。

## 验证

- 每次改动 Generate 流程后，至少回归：指定目标、未指定兜底、重复覆盖、澄清不写入、403、费用超限、重新粘贴、Clear all、引用高亮。
- 部署属于高风险外部操作，执行前必须获得 Cooper 明确确认。
