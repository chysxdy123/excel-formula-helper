# 修复说明：Generate 报 "unsafe or invalid result"

> 日期：2026-07-15 ｜ 改动文件：`functions/api/generate.js`（单文件，3 处，最小改动，未碰前端/门禁/数据剥离）

## 现象
点 Generate 报红字 **"The AI returned an unsafe or invalid result. Nothing was written to your table."**（后端 502）。

## 根因（强推断，待本地 `reason` 日志实锤）
`gpt-5-nano` 是**推理模型**，推理 token 算进 `max_completion_tokens`。原值 **1000** 太小，推理吃光预算后 JSON 输出被截断/为空 → `JSON.parse` 失败 → `requestFormula` 返回 null → 重试仍失败 → 第 180 行 502。

## 改了什么（3 处）
1. **防截断（头号修复）**：新增 `reasoning: { effort: "low" }`，`max_completion_tokens` **1000 → 8000**。
   - 说明：该值是**上限不是消耗量**，按实际用量计费，调高对正常请求零成本；真正的成本闸门是 `DAILY_SPEND_LIMIT_USD`。
2. **错误可诊断**：`requestFormula` 改为返回 `{result, reason}`，把失败区分为 `truncated / empty / unparseable / invalid`；502 分支带 **Diagnostic ID** 并 `console.error(reason)`；截断时提示 "The AI ran out of room"。
3. **每日限额**：`DAILY_SPEND_LIMIT_USD` **0.1 → 2**（原值一毛钱，内测自己撞 429）。

## 未改动（红线保留）
前端 `index.html`、access-token 门禁、size/413 限制、真实数据剥离、JSON Schema、`validateModelResult` 校验规则。`node --check` 语法通过。

## 待作者验证（死盯）
- [ ] `wrangler pages dev` 本地跑，用"表里真能算"的需求（如 Count rows where D is A）→ 正常出公式。
- [ ] "计算字体销量"（表里无此列）→ 应走 `status:"unsure"` 显示澄清问题，而非红错。
- [ ] 看终端 `reason` 日志确认之前是否真为 `truncated`（实锤根因）。
- [ ] 复核 bake-off 硬用例（C7 左向查找等）在 `effort:"low"` 下是否仍正确；若回退则去掉 effort、只留 8000。
