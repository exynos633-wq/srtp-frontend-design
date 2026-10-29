# GPU 前端实施记录

日期：2026-10-29。关联 [GPU 远程渲染对接规范 v1](14_GPU远程渲染对接规范.md)。

## 实施结果

- 公开详情与管理预览读取完整配置（mode、version、source、view），保留旧 client 模式、DEV Mock 和本地 File 测试入口；remote 模式仅在显式开始后申请会话。
- 增加 WebRTC 会话适配：同源 SDP、完整 ICE、仅收视频、DataChannel v1、首帧与能力握手、5 秒心跳、30 秒连接超时、可见页面 10 秒停帧检查、关键操作 5 秒确认。
- 现有 ModelViewport 共用工具栏，通过 ViewerController 对接本地与远程。输入按 30Hz 合并，失焦／取消时清键；模型模式、方向、步行、补光、发光、Bloom、高斯尺度等保留原有适用范围。
- PNG 取自已解码视频帧；MediaRecorder 克隆接收轨道，录制无音频视频，35 秒自动停止或手动提前停止；终止录制不结束原始视频轨道。
- 节点不可用、繁忙或传输故障清理远程实例后重新校验，最多降级本机一次。401/403/404、版本冲突等业务错误保留，不触发模型下载。
- 显式结束、卸载、关页、迟到创建和异常路径释放连接、媒体轨道、输入监听与计时器；DELETE 使用 keepalive，租约作为服务端最终回收保障。
- 更新入口、接口草案和已确认事项，明确以规范 v1 替代旧“渲染待定”和“繁忙只手动重试”的描述。未修改上游业务后端，也未部署服务器。

## 验证方式

使用 Node 24.15.0 运行最终工程检查。机器默认 Node 25.9.0 不在项目 engines 范围，最终检查使用临时 npm 运行时，不改动项目依赖或 lockfile。

```sh
cd frontend
npm run typecheck
npm run lint
npm test
npm run build
npx playwright test tests/e2e/remote-preview.spec.ts --workers=1
npx playwright test tests/e2e/mesh-ply.spec.ts tests/e2e/routes.spec.ts tests/e2e/admin-works.spec.ts tests/e2e/admin-publication.spec.ts tests/e2e/model-viewer.spec.ts --workers=2
npx playwright test tests/e2e/model-recording.spec.ts --workers=2
```

| 检查 | 结果 |
| --- | --- |
| typecheck／lint／生产构建 | 通过；构建仍有大 bundle 提示 |
| Vitest | 26 文件、298 用例通过 |
| 相关 Chrome 回归 | 40 项通过：真实三件 GLB／高斯模型、本地网格 PLY、查看器交互、发布、管理员预览、路由 |
| 本地录制 Chrome 回归 | 7 项通过：35 秒解码、提前停止、异步 error、替换、隐藏、卸载及轨道释放 |
| WebRTC 回环协议桩 | 固定源码后单独重跑通过（40.1 秒）：真实收流、PNG、提前停止后原轨道 live、再次录满 35 秒并 seek 解码、断流降级、DELETE |
| 布局 | 已查看桌面与 390×844 截图；移动尺寸无横向溢出，仅为桌面浏览器模拟 |

回环测试在浏览器中启动独立 RTCPeerConnection，以动画 Canvas 提供视频，真实交换 SDP/ICE、传输和解码视频，检查 PNG、控制命令、35 秒录像、原始轨道保持 live、断流后只请求一次客户端模型、会话 DELETE。它不调用 GPU，不冒充真实节点。

扩展录制测试曾在开发服务器运行期间遇到一次下载按钮等待失败；当时仍有源码变更。最终验收固定源码单独重跑后通过，前端 typecheck／lint／298 单测／构建与回环测试在同一串行命令下全部成功；不将该干扰当作 GPU 实测结论。

截图产物位于 Playwright 的 `frontend/test-results/remote-preview-*/remote-desktop.png` 与 `remote-mobile.png`，不提交生成物。

## 后端接入门槛与未验证项

后端负责人须按规范 v1 补齐管理员创建、同源信令、固定资产版本、节点续租和原子容量；GPU 节点须实现完整渲染与控制能力。**旧后端若仍返回 mode=client，前端保持原本本机预览；返回 remote 后才启用本轮链路。**

以下均未验证：hai 实际 GPU 型号、硬件渲染／编码、节点部署、公网带宽、TURN、可信证书、真实管理员草稿远程鉴权、服务器崩溃回收、1→3 并发各 30 分钟、真实手机、Safari／Firefox、真实网络性能。首帧 ≤5 秒、720p30、交互 p95 ≤250ms 均为待测目标。

未取得可访问的 GPU 服务、登录连接资料及 TURN 环境，因此本轮只完成前端与交接标准；不宣称已实现 GPU 端到端上线。
