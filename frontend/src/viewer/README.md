# 客户端模型查看器

本目录是站内独立的原生 Three.js 渲染核心，不经过首页的 React Three Fiber 地球。
一个查看器实例只有一个可见 canvas、一个 `requestAnimationFrame` 循环和一个相机控制器；
GLB、3DGS PLY 与网格 PLY 只在上层适配器中分流。查看器只有在用户显式开始预览后才动态加载，
模型字节、`File`、相机和视频流都不进入 TanStack Query。

## 运行与入口

```bash
# 仅开发：5173 由 Vite 启动；VITE_ENABLE_MOCKS=true 启用种子作品映射
cd frontend
VITE_ENABLE_MOCKS=true npm run dev -- --host 127.0.0.1 --port 5173
```

- 公开详情：`/works/:id` → 点击“开始预览”后才挂载查看器。
- 管理员预览：`/admin/works/:id/preview` 复用同一外壳与查看器。
- 独立测试页（仅 DEV 构建存在）：`/dev/model-viewer`。
- 生产构建不包含测试页、开发模型映射或模型文件；生产需要宿主显式提供模型 URL。

### 开发映射

仅 Vite `serve` 模式注册 `/__dev/models/:assetId/...` 白名单，支持 `Range` 与真实字节进度：

| Mock 资源编号 | 仓库根目录文件 |
| --- | --- |
| `asset_demo_001_model` | `ancient_chinese_courtyard_park.glb` |
| `asset_demo_002_model` | `great_wall_survey.glb` |
| `asset_demo_003_model` | `丘陵.ply` |

白名单只按资源编号查表，不接受目录参数，不开放整个磁盘；未知编号返回 404 JSON。
模拟替换绑定会生成新的 `modelAssetId` 与 `version`，旧的种子文件不会被继续显示。
生产构建里这套映射不存在。

## 嵌入 API

### 模型来源

```ts
type ModelSource =
  | { kind: 'url'; url: string; version: string; name?: string }
  | { kind: 'file'; file: File; version?: string; name?: string }
```

- URL 必须带 `version`；版本变化会中止旧读取并替换任务。
- `File` 只在本地内存中通过 `File.stream()` 读取，不上传、不写 Query。
- `PublicWork`/`AdminWork` 不新增 URL 字段；生产宿主通过 `PreviewViewer` 的
  `modelSource` prop 或 `resolveModelSource` 注入来源。两者都没有时显示“尚未配置模型资源”，
  不会伪造 preview-config 后端，也不会回退模拟。
- 公开/后台页面在“显式开始 + 可用性检查通过”后才解析来源。DEV 只有 `isMocksActive()`
  为真时才动态读取 seed DB，并按当前 `workId`、`modelAssetId`、`updatedAt/version` 生成
  白名单 URL；关闭 Mock、连接真实 API 时返回 `null`，不会把同 ID 旧 seed 当真实来源。
  独立 `/dev/model-viewer` 的本地 File 不受此限制。生产构建不包含该动态 import 或 mockDB。

### React 嵌入

```tsx
import { ModelViewport } from './src/components/viewer/ModelViewport'

<ModelViewport
  source={{ kind: 'url', url: '/models/courtyard.glb?v=7', version: '7', name: '院落模型' }}
  modelName="院落模型"
  modelFormat="glb"
  viewConfig={{
    // sourceUp 省略时按真实内容自动：GLB y、3DGS PLY z；显式值优先。
    sourceUp: 'y',
    orientation: { x: 1, y: 0, z: 0 }, // 可选：源方向后再叠加各轴 +90°
    scale: 1,                 // 根节点尺度标定
    initialCamera: { position: [20, -20, 15], target: [0, 0, 0] },
    ground: { height: 0 },    // 可选，Walk 地面约束
    eyeHeight: 1.7,           // 相对单位；无单位时不宣称米
    walkStart: [0, 0],
    walkArea: { minX: -20, maxX: 20, minY: -20, maxY: 20 },
    walkAreaTrusted: true,    // 仅可信有限区域允许点击传送
  }}
  dprCap={1.5}
  onPhase={(phase) => {}}
  onReady={(info) => {}}
  onError={(error) => {}}
  onEnd={() => {}}
  onZoom={() => {}}
/>
```

`ModelViewport` 在挂载时创建一个 `ModelViewer`，`source`/`viewConfig` 变化时调用
`load()`；`dprCap` 变化只调整像素比，不重建相机或解析数据。

### 原生核心

```ts
import { ModelViewer } from './src/viewer/ModelViewer'

const viewer = new ModelViewer(canvas, host, {
  autoRotate: true,
  autoRotateSpeed: 6,      // 度/秒
  resumeDelayMs: 15_000,
  dprCap: 1.5,
  lowPower: false,         // true 时 DPR 上限为 1
  reducedMotion: false,
  onEvent: (event) => { /* phase/progress/ready/error/stats/... */ },
})

await viewer.load(source, viewConfig)
viewer.setMode('orbit' | 'fly' | 'walk')
viewer.setAutoRotate(false)
viewer.setTouchEnabled(true)
viewer.setBloom(true, 0.25)
viewer.setBloomStrength(0.35)
viewer.setUniformTone(true)
viewer.setSplatScale(1.2)          // 单 splat 尺度，不是 Object3D.scale
viewer.setSoftLight(true, 1.2)     // GLB／网格 PLY；强度范围 0–2
viewer.setEmission(true, 1.6)      // 仅原有发光材质；统一色调下不可见
viewer.setFlySpeed(1.2)            // 相对速度
viewer.setWalkSpeed(0.6)
viewer.setSourceUp('y')            // null = 按内容自动；会重置方向叠加并回 Orbit
viewer.rotateOrientation('x')      // 根节点再叠加 +90°，不改文件/不重解析
viewer.resetOrientation()
viewer.configureWalk({ ground, eyeHeight, start: [x, y] })
viewer.getWalkDefaults()
viewer.beginParameterInteraction() // 滑块/输入框按住
viewer.endParameterInteraction()
viewer.resetDisplay()              // 只重置显示参数，不动相机
viewer.resetView()                 // 相机回到 initialCamera
await viewer.capturePng()          // 同一合成 canvas；含 Bloom；即时 toBlob
await viewer.startRecording()      // 35s 上限，30fps 目标，无音频
await viewer.stopRecording('manual')
await viewer.end()                 // 停止任务并释放模型
viewer.dispose()                   // 卸载：监听、RAF、GPU、Spark、视频流
```

### 事件

```ts
type ModelViewerEvent =
  | { type: 'phase'; phase: 'idle'|'read'|'parse'|'initialize'|'ready'|'error'|'ended' }
  | { type: 'progress'; progress: { loadedBytes; totalBytes; percent } }
  | { type: 'ready'; info: ModelInfo }
  | { type: 'info'; info: ModelInfo }
  | { type: 'error'; error: ViewerErrorInfo }
  | { type: 'stats'; stats: ViewerStats }
  | { type: 'mode'; mode: ViewerMode }
  | { type: 'autoRotate'; enabled; userDisabled }
  | { type: 'recording'; state: RecordingState }
  | { type: 'recordingReady'; result: RecordingResult }
  | { type: 'screenshot'; blob; filename }
  | { type: 'ended' }
```

`progress.percent` 只来自真实已读字节；没有 `Content-Length` 时为 `null`，不伪造百分比。
`stats` 约每秒一次，不逐帧提交 React 状态。

## 支持格式与拒绝规则

### GLB

- 只接受 glTF 2.0 二进制 GLB；校验 magic、版本、声明长度、chunk 对齐和 JSON。
- 外部 buffer / 图片 URI 明确拒绝，不自动联网。
- `KHR_draco_mesh_compression`、`EXT_meshopt_compression`、`KHR_texture_basisu`
  明确提示需要解码器；未知 `extensionsRequired` 拒绝。
- 首期未配置 Draco/Meshopt/KTX2 解码器。

### 3DGS PLY

- 只接受 `binary_little_endian 1.0`，验证 `end_header`、顶点数、每行字节数和文件长度。
- 必需字段：`x/y/z`、`f_dc_0..2`、`f_rest_0..K-1`（K 仅 0/9/24/45）、`opacity`（logit）、
  `scale_0..2`（log）、`rot_0..3`（标准 wxyz）。
- 可选 `nx/ny/nz`；未知属性、普通点云、缺失字段、NaN/Infinity、零四元数明确拒绝。
- 真高斯使用 Spark 2.4.0 `SplatMesh`，不是 Three `Points`。
- 坐标：默认按**真实内容**选择：GLB 标准 Y-up、3DGS PLY 缺方向元数据按 Z-up；
  文件后缀和作品元数据不参与该判断。可用 `sourceUp` 覆盖，再用 `orientation` 的
  X/Y/Z 各 +90° 组合纠正；均为根节点变换，不改文件、不重新解析。

### 网格 PLY

- 接受 `ascii 1.0`、`binary_little_endian 1.0`、`binary_big_endian 1.0`；按头部属性逐项解析，
  不依赖顶点顺序。
- 必需顶点 `x/y/z`；可选 `nx/ny/nz` 与 `red/green/blue`（uchar 或 0–1 float）。
- 必需面元素及整数索引列表（`vertex_indices` 或 `vertex_index`）；四边形及以上按扇形拆成三角面。
- 支持 char/uchar/short/ushort/int/uint/float/double 标量；索引必须是整数类型。
- 拒绝无面、少于 3 顶点、越界索引、非整数索引、截断或带尾随字节的文件；上限 2,000 万顶点／
  5,000 万三角面／1,000 万列表项。
- 用 Three `BufferGeometry` + `MeshStandardMaterial`（双面）渲染，可选顶点色；不读取 UV、贴图、
  材质扩展、morph/skin 或点云。
- 网格 PLY 仍按 PLY 默认 Z-up；柔和补光、统一色调与 Bloom 可用，高斯单 splat 尺度禁用；
  网格材质没有发光贴图入口，因此“原有发光材质”只对 GLB 可用。
- **上传契约仍只接受 GLB 与高斯 PLY**；网格 PLY 目前通过 DEV 测试台 `File` 或宿主提供的
  `preview-config` URL 进入查看器，不能经现有后台上传。

## 坐标、相机与控制

- 显示坐标系固定右手 Z-up，`camera.up = (0,0,1)`；不改 Three 全局默认 up，也不影响首页地球。
- GLB 标准 Y-up 在根节点绕 X +90° 转到 Z-up；PLY 默认 Z-up。方向纠正入口可再叠加
  X/Y/Z 各 +90° 并可重置；任何方向改变都会重算 bounds、target、初始相机和地面建议，
  回到 Orbit，并作废旧 Walk 地面/区域确认，必须重新确认。
- 用有效包围盒 + 画布宽高迭代适配相机距离，near/far 随尺度；默认外部完整视图。
- Orbit：左键旋转（世界 Z 水平、相机右轴俯仰、无 roll）、中键平移、滚轮缩放。
- Fly：WASD、Shift 加速、Ctrl 减速、右键观察、F 复位；速度随模型尺度。Ctrl 只对 canvas 聚焦时的 WASD 组合生效，其他浏览器组合键不拦截。
- Walk：进入前可编辑地面高度、视角高、起点并勾选确认；仅地面高度约束，不提供碰撞/防穿墙。
  `bounds` 底部只是建议。方向改变后旧确认作废。无可信 `walkArea` 时禁用点击传送。
- 自动旋转默认 6°/s，只在 Orbit 生效；加载完成默认开启（减少动态偏好下默认关闭）。
  按住拖动、滑块或移动键期间始终暂停；松开/取消/失焦后才开始 15 秒等待。
  滚轮/按钮/复位/恢复显示默认等离散操作也重新开始等待；hover 不算交互。
  用户关闭后不会自动恢复。隐藏、不可见或离开 Orbit 只暂停，恢复时保留尚未满的等待。
- 快捷键只绑定 canvas；输入框、滑块、设置面板和宿主不响应 WASD/F。
- 触控需显式开启；单指旋转、双指平移/缩放；`touch-action` 只作用于 canvas。

## 显示参数

- 原色默认；快速着色“统一色调”对 GLB 和 COLMAP 3DGS 都可用。
- Bloom 默认关闭，开启初始强度 0.25；Three `EffectComposer` + `UnrealBloomPass`，
  Spark 与 GLB 都走同一最终合成。
- Gaussian “单 splat 尺度”只改 Spark 每个 splat 的 scales uniform，不缩放 Object3D。
- GLB 与网格 PLY 不提供尺寸缩放。
- “柔和补光”只对 GLB／网格 PLY 加不可见场景光，保留原材质；强度 0–2，可调；高斯禁用。
- “原有发光材质”只增强模型已有的 emissive/emissiveMap；强度 0.1–3，可调；
  高斯或没有发光材质时禁用并说明。统一色调使用无发光替代材质时也禁用，切回原色保留设置。
- 飞行/步行相对速度可调，按模型尺度和 dt 生效，不重解析。
- 参数更新只改 uniform/材质；高斯参数变化调用 Spark `updateGenerator()`，不重新读取或重建点数据。
- “恢复显示默认”只重置显示参数，不移动相机。

## 截图与录制

- PNG：在同一合成 canvas 上先 `composer.render()`，随后立即 `toBlob`；不长期开启
  `preserveDrawingBuffer`。图像不含 DOM/工具栏，含 Bloom 与 Spark 最终输出。
- 视频：`canvas.captureStream` + `MediaRecorder`，无音频；录制画布固定为起始宽高比、
  最长边 ≤1280、目标 30fps，主画布尺寸变化时等比 contain，不拉伸。
- 35 秒自动停止，可提前停止；停止完成前不能开始新录制；显示已录/剩余。
- `RecordingResult.wallClockMs` 是从开始到 stop 的墙钟时间，不是媒体实际时长；
  完整媒体时长由真实 `<video>`/ffprobe 另行核验。`complete` 还要求有数据且非 error。
- 录制捕获开始时的模型代际与 `sourceName`；load/end/新录制使旧结果失效，
  旧停止事件不会用新模型命名下载或覆盖新 UI。停止中异步 error 优先于 complete。
- 隐藏、替换、结束、错误和卸载会提前停止并释放 track/recorder/timer；卸载不自动下载。
- 录制不会重置相机或自动旋转。

## 释放边界

`dispose()`/`end()` 会取消加载代际与 AbortController、停止 RAF 和事件监听、移除模型、
释放 GLTF 几何/材质/贴图（包括去重后 `ImageBitmap.close()`）、网格 PLY 的 BufferGeometry/材质、
Spark `SplatMesh`/`SparkRenderer`、
EffectComposer target、MediaRecorder 与 MediaStream track。迟到解析结果在加入场景前检查代际，
过期立即释放；GLB 边界必须有限且非退化，否则报 `INVALID_BOUNDS`。读取流在魔数/格式早退时
`cancel()` 未读部分，不继续后台下载。

## 嵌入布局

查看器根容器是 flex 列：普通详情约 775px 宽时，设置面板放在画布下方并让画布收缩；
只有容器宽度 ≥1040px（如全屏/页内放大）才把设置放到画布右侧。窄屏下设置、Walk 起点的
X/Y 输入可换行，不横向溢出。工具栏和面板使用既有实色 token，不使用玻璃 `backdrop-filter`。

## 证据与限制

已用本机 Google Chrome 155 在真实三件资源上验证：

- 院落 GLB（24,818,280 B，268,540 三角面）：加载与首帧、Bloom、PNG、35s 视频均通过。
- 长城 GLB（195,625,056 B，1,842,014 三角面）：加载与渲染通过。
- 丘陵 3DGS PLY（264,843,708 B，1,067,912 splats，SH degree 3）：真实 Spark 加载与渲染通过；
  有效包围盒是直径约 101.8 的球壳，从外部看是灰球。**不能声称它正确展示建筑/地形**；
  资产字段和渲染结果已分别核对，不把球形全景采集说成建筑模型。
- 网格 PLY：只用合成 ASCII 四边形（313 B，2 三角面）在 DEV 测试台验证；未使用真实网格资产，
  因此不声称真实建筑网格、材质或大型文件性能已验收。

性能：Chrome 155 / Apple M5 / ANGLE Metal / DPR 上限 1.5，交互与参数采样 p50≈16.7ms、
p95≈16.7–16.8ms；首轮编译有 0.1–0.5s 长帧。30fps 的 p95≤50ms 只是预算目标，不是对所有
设备的承诺。录制停止后 `MediaStreamTrack.readyState` 全部为 `ended`；35 秒成片已在真实 `<video>` 中播放并在 1s/17s/34s seek 解码。Safari、Firefox、手机真机、触屏多指真机和弱网尚未实测。

最终验证：25 文件、252 条单测通过；网格 PLY 专项 Chrome E2E 1 条通过。完整 Chrome E2E 套件
本轮不是全绿（108 条中 85 通过、13 失败、10 未跑，失败含本机缺 `ffprobe`、冷启动超时与
`丘陵.ply` 被重命名为 `丘陵(1).ply`），不能把旧的全绿记录套用到本轮。
E2E 含真实浏览器回归：显式 Walk 配置在方向纠正后旧 ground/eye/start/area 与 trusted 全部作废，
重新确认的起点不被旧矩形夹取；未改变方向时可信区域仍约束起点。最终 `metrics-final.json` 的 10 轮
GLB/3DGS 交替释放：几何 1、纹理 3/5 稳定，worker 创建/终止差恒为 1（不随轮次增长），GC 后堆
GLB 约 134.6→136.5 MB、3DGS 约 406.2→395.4 MB，无逐轮线性增长证据，不写成“已无泄漏”。
