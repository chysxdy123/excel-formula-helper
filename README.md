# excel-formula-helper

Generate an Excel formula from table structure and a plain-language request. Real cell values stay in the browser.

## 表格交互原则

- 表格选择、区域拖拽、行列操作和快捷键默认遵循 Excel 已成熟的交互习惯，不要求 Cooper 逐项重新设计。
- 实现范围以公式描述和单元格定位所需的交互为限，不机械复制完整 Excel。
- 表格只在浏览器本地展示和描述数据结构，不计算数据、不上传数据，也不扩展为在线 Excel 编辑器。

## 当前结构

- `index.html`：单文件前端和 AG Grid 交互。
- `functions/api/generate.js`：唯一的 Cloudflare Pages Function，经 OpenRouter 调用 `openai/gpt-5-nano`。
- 前端请求体仅包含列字母、表头、推断类型、行数、目标格和用户描述；后端会拒绝任何额外字段。

## 上线前配置

在 Cloudflare Pages 的 Production 和 Preview 环境中分别添加两个加密 Secret：

- `OPENROUTER_API_KEY`：只供 serverless 函数使用。
- `ACCESS_TOKEN`：内测口令，只有持有者能触发 AI 调用。

不要把密钥写入源码、`.env` 或 `.dev.vars` 后提交。相关文件已加入 `.gitignore`。

OpenRouter 后台还需要：

1. 开启对应模型组的 ZDR，并关闭 prompt / completion logging。
2. 给此 API key 设置每日重置的美元硬上限；建议与函数顶部 `DAILY_SPEND_LIMIT_USD` 保持一致，当前默认 `$0.10/day`。
3. 确认 `openai/gpt-5-nano` 至少有一个支持 Structured Outputs 且符合 ZDR 的可用 endpoint。

代码会在每次生成前读取该 key 的 `usage_daily`，达到函数内上限后停止调用。API key 自身的每日硬上限是并发情况下的最终费用保险。

## 上线前必查

- 在浏览器 Network 中检查 `/api/generate` 请求体，确认没有任何真实单元格值。
- 错误口令返回 403，并确认没有向 OpenRouter发起生成请求。
- 含糊需求只显示澄清问题，不向目标格写入公式。
- `ok` 结果的公式格、卡片坐标和步骤坐标完全一致。
- 搜索整个工作树，确认没有 OpenRouter key、Cloudflare token 或本地 Secret 文件。

## 已知限制

Cloudflare Pages Functions 在不增加 KV、Durable Objects 或其他持久化服务的前提下，无法可靠统计“每日 N 次调用”。本项目遵守“仅一个函数、无数据库”的约束，因此采用：前端防重复点击、内测口令门禁、函数内每日美元用量检查，以及 OpenRouter key 的每日美元硬上限。若以后必须按调用次数精确封顶，需要放宽无存储约束。
