# AskUserQuestion 前端交互设计

## 背景

当前项目通过后端 `POST /api/chat` 调用旧版
`@anthropic-ai/claude-code`，再把 SDK 消息以 NDJSON 流传给 React
前端。这个链路只转发 Claude 已经产生的消息；前端没有参与 SDK
的工具授权回调，因此 `AskUserQuestion` 无法暂停同一次查询、收集用户选择并把答案交回
Claude。

本机已指定最新版 Claude Code 可执行文件。后端不会覆盖 `model`，仍由该
Claude Code 的本机配置决定模型。

## 目标

- Claude 调用 `AskUserQuestion` 时，在当前聊天输入区展示问题和列表选项。
- 支持 1–4 个问题、单选、多选以及 “Other” 自由文本。
- 用户提交后恢复原来的 SDK 查询和 NDJSON 响应流，不新建会话，也不发送隐藏的
  “continue” 消息。
- 用户取消、请求中止、连接结束和重复/过期响应都有确定的清理与错误行为。
- 保留现有消息展示、会话恢复、停止按钮和已有权限面板行为。

## 非目标

- 本次不重构 Bash、Edit 等普通工具的批准/拒绝交互。
- 不引入 WebSocket、数据库、跨进程持久化或多实例协调。
- 不改变模型选择逻辑，也不新增模型配置界面。
- 不复刻 Claude Code 终端界面的每个视觉细节。

## SDK 方案

后端从旧包 `@anthropic-ai/claude-code` 迁移到官方当前包
`@anthropic-ai/claude-agent-sdk`，并继续传入已检测到的
`pathToClaudeCodeExecutable`。

选择新版 Agent SDK 的原因是它允许字符串 `prompt` 与 `canUseTool`
一起使用。`AskUserQuestion` 到达 `canUseTool` 时，SDK 会等待回调返回；
这正好提供“暂停原查询 → 浏览器回答 → 原查询继续”的生命周期。依赖使用固定版本并写入
lockfile，避免运行环境静默漂移。

`query` 不传 `model`，所以模型仍由用户指定的本机 Claude Code 配置决定。

## 数据协议

共享类型新增：

```ts
interface AskUserQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}
```

NDJSON 流新增一种事件：

```json
{
  "type": "ask_user_question",
  "interactionId": "随机 UUID",
  "questions": []
}
```

浏览器提交：

```http
POST /api/interactions/:interactionId/respond
Content-Type: application/json

{
  "answers": {
    "问题原文": "选项标签",
    "另一个问题原文": "标签一, 标签二"
  }
}
```

浏览器取消：

```json
{ "cancelled": true }
```

成功响应为 `200 {"ok":true}`；不存在、已响应或已清理的
`interactionId` 返回 `404`；请求体格式错误或缺少问题答案返回 `400`。

答案遵循 Agent SDK 协议：

- `answers` 以问题原文为键。
- 单选值是所选标签，或用户填写的自由文本。
- 多选值由所选标签以 `", "` 连接；自由文本作为其中一个值。
- 每个问题都必须得到去除首尾空白后非空的答案。

## 后端生命周期

`createApp` 持有进程内 pending interaction `Map`，与现有
`requestAbortControllers` 生命周期一致。每项只保存：

- `interactionId`
- 所属 `requestId`
- 原始 `questions`
- 用于恢复 `canUseTool` Promise 的 `resolve`

ID 使用平台原生 `crypto.randomUUID()`。

`POST /api/chat` 的 NDJSON 写入改为一个可从查询循环和
`canUseTool` 回调共同调用的 `send(StreamResponse)`。不建立额外消息总线：

1. SDK 调用 `canUseTool("AskUserQuestion", input, ...)`。
2. 后端校验问题结构，登记 pending interaction，并立即通过 `send` 发出
   `ask_user_question` 事件。
3. 回调等待对应 Promise。
4. `/respond` 校验答案、从 Map 原子删除该项并 resolve：

   ```ts
   {
     behavior: "allow",
     updatedInput: { questions, answers }
   }
   ```

5. SDK 在同一个 `query` 中继续执行，后续消息仍写入原 NDJSON 流。

取消时后端删除 pending 项并 resolve：

```ts
{
  behavior: "deny",
  message: "User cancelled the question"
}
```

普通工具不创建 interaction；`canUseTool` 对它们返回 deny，让 SDK 继续产生现有
tool error/result，前端沿用当前权限处理流程。

清理规则：

- `/api/abort/:requestId` 触发 AbortController 后，所有属于该请求的 pending
  interaction 都以 deny 结果结束并从 Map 删除。
- 浏览器断开 NDJSON 流时，`ReadableStream.cancel()` 中止该 request，并执行同样的
  pending interaction 清理。
- 查询正常结束、异常结束或流写入失败时，在 `finally` 中执行相同清理。
- `/respond` 先删除再 resolve，确保双击提交只有第一次成功。
- 已关闭的流不再写入事件，避免 `ReadableStream` controller 异常。

## 前端状态与交互

流解析器识别 `ask_user_question`，通过现有 streaming context 把事件交给
`ChatPage`。`ChatPage` 只保存当前交互：

```ts
{
  interactionId: string;
  questions: AskUserQuestionItem[];
}
```

项目现有设计一次只运行一个聊天请求，因此不增加队列。收到问题时，
`ChatInput` 优先渲染新的 `AskUserQuestionPanel`；原文本框仍处于同一请求的
loading 状态。

面板行为：

- 一次展示全部问题。
- 单选使用原生 radio，多选使用原生 checkbox。
- 展示选项 `label` 和 `description`；有 `preview` 时在选项内展示。
- 每个问题提供 “Other” 选项；选中后展示文本输入。
- 所有问题都有有效答案后才启用提交按钮。
- 提交期间禁用重复操作；接口成功后关闭面板，接口失败则保留选择并显示可重试错误。
- 取消按钮提交 `{cancelled:true}`；成功后关闭面板并让原流自然完成。
- 原请求被停止、流结束或报错时清除对应面板。

使用 `fieldset`、`legend`、原生表单控件、可见焦点和 `aria-live`
错误提示；样式复用当前输入区的 Tailwind 色彩、圆角和暗色模式，不引入新组件库。

## 错误处理

- 后端收到非 `AskUserQuestion` 的 `canUseTool` 调用时，不创建 interaction，
  直接返回 deny，让现有前端权限处理流程接手 SDK 产生的拒绝结果。
- SDK 提供的 AskUserQuestion 输入不合法时，回调直接 deny，并把原因记录到后端日志；
  不向前端发送不可渲染的面板。
- 回答接口网络失败或返回非 2xx 时，面板保持原状态并显示错误。
- 过期交互返回 404 后，前端提示该问题已失效，并允许用户停止当前请求。
- 流断开时后端立即中止查询并清理 pending Promise，防止内存泄漏。

## 测试与验收

后端测试覆盖：

- `AskUserQuestion` 发出包含 UUID 和完整问题的 NDJSON 事件。
- 提交答案后，`canUseTool` 收到 `allow + updatedInput`，原流继续并完成。
- 取消返回 deny。
- 缺失答案返回 400。
- 重复或过期 interaction 返回 404。
- 请求 abort 和查询结束都会清理 pending 项。

前端测试覆盖：

- 流解析器把新事件交给页面状态。
- 单选、多选和 Other 自由文本生成正确答案。
- 未答完时不能提交。
- 成功提交后关闭面板。
- 提交失败时保留选择并允许重试。
- 取消发送正确请求。

最终运行后端与前端的定向测试、完整测试、TypeScript 检查和生产构建。手动验收使用
本机指定的最新版 Claude Code，触发一个包含单选和多选的
`AskUserQuestion`，确认选择提交后 Claude 在原会话继续回答。
