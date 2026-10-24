# Codex 与 DeepSeek Harness 协作连接运行说明

更新：2026-10-22。适用工程：`srtp-frontend-design`。依据本机脚本、CLI 帮助和 P11–P14 实际执行记录整理；本次只核对文档与本机版本，没有发起新的模型请求或重新进行连接测试。

## 1. 当前连接方式

当前两者都在同一台 Mac 上运行。Codex 在当前任务中启动 DeepSeek Harness 的 **headless CLI 子进程**，把需求或修复意见经标准输入送入；读取标准输出中的 NDJSON 事件和最终结果。下一轮通过 `--session-id` 续接 Harness 的持久会话。

```text
用户 → Codex 规划与派发
         ↓ 本机 dsh headless，stdin 传任务，stdout/stderr 留日志
       Harness 编码 → 自测 → 真实 Chrome 测试／页面检查 → 自修复 → 交接
         ↓
       Codex 静态代码审查
         ├─ 发现问题 → 同一 Harness 会话修复、复测 → 再审查
         └─ 通过 → Codex 提交／推送／创建 PR → 用户决定合并
```

这里的“对话”是任务文本、CLI 事件和工作文件的交接，不是两个桌面应用聊天窗口互相读取。两者共享同一本地网页仓库；GitHub 不再承担本机任务传递，不需要 Windows、SSH 或校园网设备互通。

## 2. 角色、权限与执行边界

| 角色 | 当前职责 |
| --- | --- |
| Codex | 阅读工程计划、确定范围与验收目标、启动 Harness、接收验收结果、静态审查、按授权处理 Git 与 PR |
| DeepSeek Harness | 编码、相关单测／类型／Lint／构建、实际 Chrome E2E 与页面检查、自修复、返回实际结果和限制 |
| 用户 | 决定工程方向、外部资料与阶段启动；默认由用户合并 PR，明确要求“合并”后 Codex 执行 |

这是 P13 起按用户指定采用的分工：Harness 判断本轮验收可交接后，Codex 再做静态 code review。审查问题交回 Harness 修复、复测；不能以静态审查代替浏览器验收。

Harness 的阶段任务明确禁止它自行切分支、提交、推送、建 PR、合并、部署或跨阶段。Codex 检查工作区后负责这些 Git 操作，不把旧 Windows worker 的自动合并条件直接套到本机流程。提示词与改动检查不等同于操作系统隔离；实际可访问范围由宿主权限和 Harness 工具沙箱共同决定。

同一 checkout 只安排一个编码者；不要同时在 Harness 桌面会话或另一 Codex 任务修改相同文件／切换分支。保留用户已有未提交文件，不用 reset/clean 清场。

## 3. 本机路径与已核对版本

以下是本台 Mac 的路径，换机器后重新核对；均不包含密钥。

| 项目 | 路径／版本 |
| --- | --- |
| 网页仓库 | `/Users/exynos/Projects/srtp网页` |
| 协作工具目录 | `/Users/exynos/Projects/跨设备agent协作/agent-bridge` |
| Harness CLI | `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`，`0.2.1-rc.2` |
| 独立 Codex CLI | 协作工具目录下 `.runtime/node_modules/.bin/codex`，`0.163.0` |
| Node | `/Users/exynos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`，工程验收使用 `v24.19.0` |
| 消息往返探针 | 协作工具目录下 `local-probe.mjs` |
| 本机审查包装脚本 | `~/Library/Application Support/CodexDshBridge/local/run-review.py` |
| 持久日志根目录 | `~/Library/Application Support/CodexDshBridge/local/` |

独立 Codex CLI 用于避开此前系统旧版本与配置的兼容问题，不覆盖系统 CLI；`.runtime/` 已在协作工具 `.gitignore` 中排除。上述审查包装脚本是本机辅助文件，不在网页 Git 仓库内，其他机器需要另行准备。

## 4. 凭据与网络

- Harness 沿用本机已配置的凭据。此前 headless 报过 `MISSING_CREDENTIAL`，成功配置后已完成工程调用；不能仅因桌面聊天可用，就假定每个 headless provider route 都有凭据。
- 若缺凭据，按 CLI 错误所指的 provider route，在 Harness 的 Models／凭据服务配置，或由启动环境注入 `DEEPSEEK_API_KEY`。不把密钥写进任务、代码、文档、PR 或日志，不打印环境变量全集。
- Codex CLI 使用自己的已有登录；GitHub CLI 使用自己的登录。三者不是同一份凭据，不能拿 GitHub 登录替代 DeepSeek API 凭据。
- CLI 需要可用网络。`local-probe.mjs` 在未设置 `HTTPS_PROXY` 时读取 macOS 当前启用的 HTTPS 代理，并为本机地址设置 `NO_PROXY`；`run-review.py` 也读取系统代理。不要把 Clash 的某个历史端口固化为通用要求。
- 直接执行下节的 `dsh` 命令只继承启动进程的环境，**不会因为示例命令而自动读取系统代理**。需要代理时先按本机实际配置设置 `HTTPS_PROXY`／`HTTP_PROXY`，并让 `localhost,127.0.0.1,::1` 绕过代理。

2026-10-21 的 P14 文档收尾曾返回 HTTP 402／`QUOTA`／`Insufficient Balance`。这是模型额度问题，不是两台设备连接失败；在恢复额度前不应反复重试。2026-10-22 本次只执行无模型调用的版本／帮助检查，没有验证额度是否已恢复。

## 5. 派发与会话续接

在网页仓库运行，避免任务落到用户主目录或协作工具目录。先把明确的阶段需求写入日志目录的 `task.txt`，包含：工程根、阶段、允许修改范围、验收命令、交接要求和禁止自行 Git 发布的边界。

以下为 Mac/zsh/Bash 示例；`manual-example` 是示例运行目录，每次实际执行使用新的目录名，避免 `>` 覆盖旧日志。任务文件必须先准备好。这段会真正调用模型并产生用量，不是只读检查。

```bash
export PATH="/Users/exynos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
cd '/Users/exynos/Projects/srtp网页'
TASK_LOG_DIR="$HOME/Library/Application Support/CodexDshBridge/local/manual-example"
mkdir -p "$TASK_LOG_DIR"

'/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh' \
  headless --json - \
  < "$TASK_LOG_DIR/task.txt" \
  > "$TASK_LOG_DIR/dsh.jsonl" \
  2> "$TASK_LOG_DIR/dsh.stderr.log"
```

首次运行的 `session` 事件含 `sessionId` 和 `cwd`。需要返工或继续同一工程上下文时，从日志复制 sessionId，再执行：

```bash
TASK_SESSION_ID='替换为 session 事件中的实际 sessionId'

'/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh' \
  headless --json --session-id "$TASK_SESSION_ID" - \
  < "$TASK_LOG_DIR/repair-task.txt" \
  > "$TASK_LOG_DIR/dsh-repair.jsonl" \
  2> "$TASK_LOG_DIR/dsh-repair.stderr.log"
```

会话续接必须等上一轮退出后再执行，不要并发写同一 Session。未知会话 ID 会报错；不要凭空编造，也不要在结果不明时盲目重放写入任务。新 Session 可以从任务文件和工程记录恢复工作，但不会自动拥有旧聊天上下文。

## 6. 怎样判断真的完成

`--json` 输出是逐行事件，不是一个可整体 JSON.parse 的对象。常见事件如下：

| 事件 | 含义 |
| --- | --- |
| `session` | 本轮持久会话 ID、工作目录 |
| `status` | turn／step 开始、结束及结束原因 |
| `tool_call`／`tool_result` | 调用工具及结果，用于核对实际执行的测试与文件操作 |
| `text`／`thinking` | 过程输出，不能单独作为完成证据 |
| `final` | 最终文本；还必须结合进程退出码和 turn 结束原因判断 |

成功交接至少要求进程成功退出、`turn_end.reason.kind=completed`，且本轮没有错误结束；另核对所需测试的真实输出和工作区改动。`final.text` 非空不等于成功：P14 文档修正轮在工具已修改文件后遇到额度错误，仍有 final 事件，但该轮不是正常完成。

Harness 的交接应列改动、实际命令／测试数量、日志／截图、未验证项；未执行不能写通过。浏览器测试使用实际 Chrome，jsdom 单测、截图存在或 Playwright `--list` 都不能替代真实交互。

Codex 静态审查读取完整 diff、必要上下文和本阶段新增文件。现有包装脚本使用 `codex exec --sandbox read-only --json --output-schema ... --output-last-message ... -`，从 `review-task.txt` 读输入、从 `review-schema.json` 约束输出。该脚本启动前需准备这两份文件：

```bash
python3 "$HOME/Library/Application Support/CodexDshBridge/local/run-review.py" \
  "$TASK_LOG_DIR" review
```

审查结果字段为 `reviewComplete`、`summary`、`findings`；每个 finding 含优先级、文件、行号、标题和说明。读取 `review.json` 时也检查 CLI 正常完成，不能把缺失／截断结果当成无问题。脚本超时为 900 秒，不是无限等待器。

有问题时把可行动意见写入修复任务，续接 Harness，让它复现、修复、复测，再静态复审；无问题且验收充分后才交付 PR。审查与测试之后发生的新源码修改需要相应复验，不能复用过期结论。

## 7. 浏览器与日志约定

- 真实 E2E 使用本机 Google Chrome、项目已有 Playwright，不为常规验收下载另一套浏览器。
- `CI=true npm run test:e2e` 使用 5173 自动启动测试服务；端口被占用先排查，不随意终止用户进程。
- 用户本地演示使用 5174；已有预览服务不重复启动、不因测试而关闭。开发演示需显式 `VITE_ENABLE_MOCKS=true`，生产失败不得回退 Mock。
- 工程检查用 Node 24 和实际 package.json：typecheck、lint、unit、build、相关／完整 E2E；按变更选择，文档修正不无理由重跑全部测试。
- 阶段日志目录已有 `p11/`、`p12/`、`p13/`、`p14/`。典型文件是 `task.txt`、`dsh*.jsonl`、stderr、验收摘要、`review*.json`、测试输出与截图。
- Harness 工具曾不能直接写 `~/Library/Application Support/...`，但可写 `/tmp/p14-demo/`。此时由 Codex 将结果复制到持久日志目录；P14 证据现存 `local/p14/artifacts/`。临时目录不是长期保存位置。
- 不把原始模型对话、完整日志、截图或 File 内容自动上传公开仓库；Git 只交付工程所需代码／测试和不含密钥的验收说明。

## 8. 连接探针及已验证范围

如需重新检查三段消息往返，可在协作工具目录执行：

```bash
cd '/Users/exynos/Projects/跨设备agent协作/agent-bridge'
node local-probe.mjs
```

该探针会调用 Harness → Codex → 原 Harness Session，校验随机标记及正常完成后才输出 `LOCAL_ROUNDTRIP_OK`。每步超时 3 分钟，在临时空目录运行；不读写网页项目、不领取 GitHub 任务、不自动提交或部署，但会产生模型用量。进程需使用可用的 Node。

最近持久化的成功往返记录是 **2026-10-21 10:25（Asia/Shanghai）**，位于 `local/latest.json` 指向的测试目录。它只证明当时消息交接与续接成功，不代表今天额度、网络或所有工程任务都健康。P11–P14 的日志另外证明了本机实际编码、测试、返工与静态审查交接；P14 最终完成 192 单测、89 Chrome E2E，PR #14 已合并（`9144aaf`）。

## 9. 停止、恢复与设备要求

本机工作时 Mac 需要开机、联网且不休眠；带走、断网、休眠或关机都可能中断模型请求和测试。当前没有已配置的常驻后台 worker、开机自启、定时监控或自动唤醒；Codex 当前执行结束不代表以后还会自行接单。

中断后先检查进程、日志末尾、Git 状态和远端 PR，再决定从哪个步骤继续：

1. 进程还在写文件时不要启动第二个编码任务。
2. 进程已退出但没有 completed：保留已落盘文件；检查有没有部分修改／测试失败，不把整个任务从头无条件重放。
3. 可续接时使用实际 sessionId，明确说明已完成与待完成部分；会话不可用时新建任务并提供现状。
4. 测试失败修复后复测；模型超时、断线、额度错误分别排查。额度恢复后再继续，不循环制造失败请求。
5. 发布结果不明先查 GitHub；用 PR 当前 head SHA 防止合并错误版本，不重复创建同一 PR。

Mac 上的子进程方式减少了跨设备队列与网络连通问题，但没有消除外部 API、额度、长任务中断或工具权限问题。它是已实测的协作方式，不是无人值守、高可用服务。

## 10. 旧 Windows 方案

历史方案为 Mac 经 GitHub Issue 派发，Windows worker 领取后运行 DSH／Codex，利用独立 clone 完成限定 PR 修复。脚本和启动包仍在协作工具目录，详见其 README 的历史章节。

旧方案中“Mac 可关机、Windows 必须常开”只适用于 Windows worker，不能用于当前 Mac 本机调用。当前本机流程不需要启动 Windows worker；旧 worker 若仍运行，需要先确认其队列和进程状态，不能假定它已因迁移而自动停止。
