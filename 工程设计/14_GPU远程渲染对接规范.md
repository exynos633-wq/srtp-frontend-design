# GPU 远程渲染对接规范 v1

日期：2026-10-29。前端实施与后端交接依据；协议版本 1。**GPU 节点尚未接通，本文不表示部署或性能验收完成。**

## 1. 分工与已确认决定

- 前端负责：完整预览配置、会话申请、WebRTC 接收、共享工具栏、输入、PNG、35 秒录制、自动降级、生命周期与前端测试。
- 业务后端负责：权限、固定资源版本、会话身份、容量调度、同源信令代理、节点续租与回收。
- GPU 负责人负责：模型加载、独立相机、画面参数、渲染、编码、WebRTC、TURN、驱动与运维。渲染器内部技术由该负责人维护，须满足下述行为协议。
- 模型远程优先；节点离线、繁忙、连接失败和断流自动尝试一次本机渲染，提示将下载模型。不排队、不自动新建远程会话、不自动切回远程。首页地球继续本地渲染。
- 现有后端参考分支：`ClouderDream/low-altitude-economy feature/backend-preview-sessions`，本次检查提交 `faaf39d9e526465948fb035e3a663e5f061efd15`。该分支已有调度代码和测试桩，GPU 服务缺失。历史文档中的线上地址、带宽和部署结论均须复核。
- 本地查看器与远程共用工具栏；GLB、3DGS 高斯 PLY、网格 PLY 均纳入最终验收。高斯球壳资产的画面问题不能用更换渲染位置解决。

## 2. 节点核验与部署交接

| 已知项 | 配置 |
| --- | --- |
| 实例／名称 | `hai-4qlunwcs`／`hai` |
| 地域 | 北京一区 |
| 规格 | GPU 性能型 `24GB_A`，GPU 24GB／28 核／116GiB |
| 镜像／系统盘 | Pytorch／250GB |

下表由 GPU 负责人填写结果、时间与证据；**24GB_A 不能代替具体 GPU 型号**。

| 核验项 | 只读检查或交付内容 | 结果 |
| --- | --- | --- |
| 系统 | `cat /etc/os-release`、`uname -r` | 未核验 |
| GPU、驱动 | `nvidia-smi`、`nvidia-smi -q`（若使用 NVIDIA） | 未核验 |
| 图形加速 | 实际渲染进程的 GPU/后端信息，排除软件渲染；不可照搬旧 Windows D3D11 启动参数 | 未核验 |
| 编码 | 编码器列表及实际硬件编码一段 720p30 的结果；列出编码会话限制 | 未核验 |
| 资源 | `df -h`、进程显存与系统内存峰值、模型缓存目录和配额 | 未核验 |
| 网络 | 公网 IP 或映射、出口带宽、TCP/UDP 放行范围、跨节点模型读取路径 | 未核验 |
| HTTPS／TURN | 受信证书、TURN 地址与部署位置、临时凭据机制、中继出口带宽 | 未核验 |
| 运维 | 启停命令、服务自启、日志位置、崩溃回收、磁盘清理、重启后恢复方法 | 未核验 |

业务 API 与信令同源 HTTPS；节点接口仅服务间访问，`LA_RENDERER_TOKEN` 不进入前端构建或日志。媒体优先 GPU → 浏览器直连，失败时 TURN 中继；不得默认绕经原业务服务器出口。

初始画质 1280×720、30fps、目标 2Mbps。容量先设 1，逐级验证至 3，管理端也占容量；显存容量不能推导并发能力。TURN 验证必须单独记录流量与出口负载。

## 3. HTTP 与会话协议

所有业务 API 沿用 `{error:{code,message,fields?}}` 错误体、同源 Cookie、现有 CSRF 校验。标有“新增/补齐”的能力交给后端实现。

### 完整预览配置

公开 `GET /api/works/:id/preview-config` 只允许已发布作品；管理 `GET /api/admin/works/:id/preview-config` 允许已登录管理员读取草稿／下架作品。获取配置不占 GPU。

```json
{
  "workId": "work_1",
  "mode": "remote",
  "version": "asset_7",
  "source": {"kind":"url","url":"/api/works/work_1/model?v=asset_7","version":"asset_7","name":"院落","format":"glb"},
  "view": {"sourceUp":"y","orientation":{"x":0,"y":0,"z":0},"scale":1,"initialCamera":null,"ground":null,"walkArea":null,"eyeHeight":null}
}
```

`mode:'remote'` 表示远程优先，`source` 是允许本机降级的受控来源；`mode:'client'` 兼容旧后端及开发样例。前端保留 view，忽略历史接口里的 null 可选值；版本必须为不可变资源编号。NO_MODEL 404 表示没有模型，不能转成网络故障。

### 创建、查询、续租与结束

| 方法 | 路径 | 约定 |
| --- | --- | --- |
| POST | `/api/preview-sessions` | 已发布作品；沿用匿名访客 HttpOnly Cookie 身份 |
| POST（新增） | `/api/admin/preview-sessions` | 管理员认证，允许任何作品状态；不能仅相信前端传入 admin 标记 |
| GET | `/api/preview-sessions/:id` | 仅创建身份，返回 status/expiresAt |
| POST | `/api/preview-sessions/:id/heartbeat` | 创建身份；每 5 秒续租，返回最新 status/expiresAt |
| DELETE | `/api/preview-sessions/:id` | 幂等 204，同时结束节点会话 |

创建请求：
```json
{"workId":"work_1","version":"asset_7","requestId":"随机 UUID","view":{},"viewport":{"width":1280,"height":720,"fps":30,"bitrate":2000000}}
```

创建响应：
```json
{"sessionId":"session_1","status":"creating","expiresAt":"2026-10-29T18:00:00+08:00","connection":{"kind":"webrtc","protocolVersion":1,"offerUrl":"/rtc/sessions/session_1/offer","iceServers":[{"urls":"turn:turn.example.com:3478","username":"短期用户名","credential":"临时凭据"}]}}
```

- 创建响应允许 `creating` 或 `ready`；均只表示节点已分配。**浏览器收到可解码首帧、控制通道打开、节点 ready 能力核对通过后，才显示可交互**。
- 连接总超时 30 秒，包含创建、ICE、SDP、首帧和能力握手。前端不取消已提交创建请求的响应读取：即使先退出，迟到的 sessionId 也会被 DELETE；响应彻底丢失由节点租约兜底。
- `(创建身份, requestId)` 幂等，同一身份重复请求不得额外占槽；不同浏览器和标签页各自独立相机。
- version 与当前资源绑定不符返回 409 `MODEL_VERSION_CHANGED`，重新读取配置后手动重试。旧会话保持原资源快照；模型下载 `?v=` 必须实际固定版本，不能忽略它返回当前绑定文件。
- 管理会话的 GET/心跳/DELETE 必须按管理员会话归属校验，不能只依赖匿名 visitor Cookie。登录失效不再续租，401/403 时前端终止，不下载草稿降级。
- 节点以服务间凭据获取固定资产，不能依赖管理员浏览器 Cookie，也不能由客户端指定任意文件 URL。非公开模型禁止匿名下载，资源保留至引用会话结束。
- 心跳必须同步续租业务库与 GPU 节点，默认 TTL 90 秒；节点或业务续租失败不能返回假成功。业务与节点各有定时清理任务，不能等下一次创建才清理。
- 节点原子预留槽位，业务库会话只作审计。创建超时、数据库写入失败、节点崩溃、结束请求丢失都须有补偿清理。终态不允许续租复活。
- 关页使用同源 `fetch(DELETE, keepalive:true)` 尝试结束；它不是保证送达，最终依赖租约。`sendBeacon` 固定 POST，不能代替 DELETE。

### 信令与节点内部接口

浏览器建立一个 RTCPeerConnection，增加 `video/recvonly` transceiver，创建可靠、有序 DataChannel `viewer-v1`。不调用 getUserMedia。等待本地 ICE 收集完成后，POST `connection.offerUrl`：`{type:'offer',sdp:'...'}`；响应 `{type:'answer',sdp:'...'}` 必须包含完整节点 ICE 候选。无需 trickle ICE/WSS；TURN 是传输兜底，仍失败后切本机。

`offerUrl` 必须同源 HTTPS（仅 localhost/127.0.0.1 开发允许 HTTP），由业务层核对会话身份后代理，不能把服务间 token 暴露给访客。

节点内部沿用 `GET /health → {ok,active,capacity}`、`POST /sessions → {sessionId,connection}`、`DELETE /sessions/:id → 204`；**补齐 `POST /sessions/:id/heartbeat` 续租**。创建输入需有固定版本、受限资源访问、view 和 viewport。健康检查／预留响应应快速完成，模型冷加载异步进行，不沿用旧 2 秒 HTTP 超时等待整个模型加载。

## 4. DataChannel v1

JSON 文本消息，上限 64KB；协议以 v=1 区分。节点负责验证类型、数值范围和会话状态。未知协议或缺少完整能力时前端清理并降级，不能把静态封面或协议桩当作真实首帧。

节点准备完成后发送：
```json
{"v":1,"type":"ready","info":{"format":"glb","sourceName":"院落","bytes":24818280,"sourceUp":"y","orientation":{"x":0,"y":0,"z":0},"bounds":{"min":[0,0,0],"max":[1,1,1],"size":[1,1,1],"center":[0.5,0.5,0.5]},"splats":null,"triangles":268540,"materials":24,"textures":24,"shDegree":null,"hasEmissive":false},"capabilities":["setMode","...见下表全部适用命令..."],"walkDefaults":{"ground":0,"eyeHeight":1.7,"start":[0,0],"area":null,"areaTrusted":false}}
```

capabilities 必须是下表全部适用命令的真实名称列表，不能直接使用上例的省略文本；模型信息结构与前端 `ModelInfo` 一致。view 的初始方向和缩放在 ready 前应用。

关键命令：`{v:1,type:'command',id:1,name:'setMode',args:['fly']}`。节点**按序应用**后回复 `{v:1,type:'ack',id:1,ok:true}`；应用失败回复 `ok:false,message`。5 秒没有 ack 或拒绝命令，前端终止当前远程会话并降级，避免工具栏与画面长期不一致。修改源坐标系／方向的 ack 必须附最新 info 和 walkDefaults，并切回 Orbit；涉及步行参数时附最新 walkDefaults。节点因交互暂停／恢复自动旋转或改变模式时，另发 `{v:1,type:"state",mode:"orbit",autoRotate:{enabled:false,userDisabled:false}}` 同步工具栏（字段可按变更省略）。

| name | args | 适用范围 |
| --- | --- | --- |
| setMode | `['orbit'|'fly'|'walk']` | 全部；节点执行相机移动 |
| setAutoRotate | `[boolean]` | 全部；默认速度 6°/秒，手动操作后暂停 15 秒，遵守用户关闭状态 |
| resetView／resetDisplay／resetOrientation | `[]` | 全部；行为沿用客户端查看器 |
| setSourceUp | `['y'|'z'|null]` | 全部；null 自动识别，改变方向后复位到 Orbit |
| rotateOrientation | `['x'|'y'|'z']` | 全部；对应轴 +90° |
| setBloom／setBloomStrength | `[enabled,strength]`／`[strength]` | 全部；范围沿用现有 UI |
| setUniformTone | `[boolean]` | 全部 |
| setSplatScale | `[scale]` | 仅高斯；仅调整单 splat 尺度 |
| setSoftLight | `[enabled,intensity]` | GLB／网格 PLY |
| setEmission | `[enabled,intensity]` | 仅存在发光材质的 GLB；统一色调下不可用 |
| setFlySpeed／setWalkSpeed | `[speed]` | 全部；沿用客户端 0.05–5 |
| configureWalk | `[{ground,eyeHeight,start:[x,y]}]` | 全部；eyeHeight > 0，数值有限 |
| beginParameterInteraction／endParameterInteraction | `[]` | 全部；参数操作期间暂停自动旋转 |
| clearUserInput | `[]` | 全部；清空键盘／拖拽，防止卡键 |
| resize | `[{width,height}]` | 全部；偶数尺寸，受 1280×720 边界限制，保持视频与操作区比例 |
| teleport | `[x,y]` | 全部可识别；仅 Walk 且可信区域有效时执行，x/y 为视频区 0–1 坐标，前端二次确认；节点校验地面射线交点及可信区域 |

输入消息：`{v:1,type:'input',dx:0.01,dy:-0.02,zoom:0.1,pan:false,keys:['w','shift']}`。dx/dy 为视频区宽／高的相对位移；zoom 正值拉远、负值拉近，节点以 `radius *= exp(zoom)` 解释（Fly/Walk 转为沿视向移动）。pan=true 解释为平移，否则 Orbit 旋转／Fly、Walk 环顾；keys 是当前完整状态，支持 w/a/s/d/q/e/shift/control；control 减速，shift 加速。每批位移只消费一次，按键在节点渲染循环按时间积分，不依赖输入消息次数。

前端至多 30Hz 合并位移与滚轮；双指缩放／平移仅在触控开关打开时启用。参数面板、切换模式、失焦、隐藏、pointercancel、断线清空输入。节点 250ms 未收到 input 必须停止移动；可靠通道拥塞超过 64KiB 前端断开并降级。禁用视频输入不能影响普通页面滚动或表单键盘。

节点异常消息：`{v:1,type:'error',message:'渲染进程退出'}`；不携带服务端密钥或文件系统内部路径。

截图从解码视频帧画入临时 Canvas 导出 PNG；录制克隆接收视频轨道，以 MediaRecorder 录制无音频视频，35 秒自动停止，可提前停止；不会停止播放中的原始轨道。录制期间保持输出宽高比与尺寸，结束再同步视口。关闭页面／降级时释放录制，不产生旧作品的迟到下载。浏览器不支持录制时明确提示，不伪造成片。

## 5. 错误、降级与验收

| 条件 | HTTP／code | 前端 |
| --- | --- | --- |
| 节点不可用 | 503 RENDERER_OFFLINE | 清理后重新取配置，自动尝试本机一次 |
| 容量满 | 503 PREVIEW_BUSY | 同上，不排队 |
| 网络失败、ICE/首帧超时、控制断线、视频 10 秒不更新 | 传输错误 | 同上；隐藏标签页不以视频停帧判断失败 |
| 无权限／登录失效 | 401／403 | 保留业务错误，不降级 |
| 作品不可用／没有模型 | 404 WORK_NOT_FOUND / WORK_UNAVAILABLE / NO_MODEL | 不降级、不下载 |
| 资源版本变化／模型无效 | 409 MODEL_VERSION_CHANGED／422 VALIDATION_FAILED | 提示原因，手动重试 |
| 普通 5xx／限流 | 原始错误 | 保留错误，手动重试，不冒充节点离线 |

降级先释放远程实例，再重新校验作品权限、获取最新完整配置。若期间作品下架或管理员失效，停止降级。资源／网络对象不放入 TanStack Query；管理页只缓存配置元数据，并在离开时取消查询。

验收目标（目标而非承诺）：预热模型首帧 ≤5s，720p30，操作至画面响应 p95 ≤250ms。逐级并发各 30 分钟，记录 GPU/编码器/内存/带宽、网络条件、直连或 TURN。每个会话独立相机；容量满不超额分配，最后一个会话结束／TTL 到期后槽位与 GPU 资源回落。

必须覆盖：三种模型格式、完整工具栏、方向与步行、双指触控、PNG、35 秒可解码录像；重复进出、节点离线、容量满、断流、迟到创建、强制关页、版本替换、管理员失效、草稿越权；Chrome／Safari／Firefox 与真实手机。协议桩、浏览器设备模拟与桌面录制不能替代 GPU、TURN 或真机验收。

### 本轮验证记录

验证命令、结果与尚未完成的实机项目见 [GPU 前端实施记录](15_GPU前端实施记录.md)。GPU/TURN/真实手机/容量压测均待负责人提供可访问环境后执行。
