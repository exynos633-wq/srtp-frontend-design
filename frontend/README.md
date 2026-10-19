# 建筑模型展厅 · 前端工程

当前阶段：**P03 数据边界与开发 Mock**。视觉基础（P02）之上已建立类型、请求层、缓存键与 MSW，
页面仍是**基础版**：目录与详情还没有消费接口数据（P04 接入），也没有真实认证、模型加载、
AI 助手、三维场景与动效。阶段计划见
[分阶段编码提示词](../工程设计/07_分阶段编码提示词.md)，执行状态见
[开发执行记录](../工程设计/开发执行记录.md)。

## 运行环境

| 项目 | 实测值 | 说明 |
| --- | --- | --- |
| Node.js | v24.15.0 | `engines` 为 `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`：取锁定依赖的共同支持范围（jsdom 30.1.3 与 vitest 5.0.5 不支持 Node 20／23／25，react-router 8 要求 ≥22.22.0）。版本文件见 `.nvmrc`，nvm-windows 用户可 `nvm use`。 |
| npm | 11.12.1 | 锁文件为唯一的 `package-lock.json`，CI 使用 `npm ci` |
| 已验证浏览器 | Chrome（本机安装版） | Firefox / Safari / 真机未验证 |

Windows 注意：若 PowerShell 执行策略禁止 `npm.ps1`，请改用 `cmd /c npm ...` 或 `npm.cmd`。
若沙箱或权限不允许写用户级 npm 缓存，可把缓存改到可写目录，例如
`set npm_config_cache=F:\srtp网页\.npm-cache`（仅影响本机，不写入仓库）。

`engines` 已按锁定依赖的共同支持范围收紧。启用 `engine-strict` 的机器请先按 `.nvmrc` 切到
受支持版本（22.22.2 及以上 22.x、24.15 及以上 24.x、26 及以上），Node 20／23／25 不在支持范围。

## 常用命令

```powershell
npm ci            # 按锁文件安装（首次或干净环境）
npm run dev       # 开发服务器，默认 http://127.0.0.1:5173
npm run build     # 类型检查 + 生产构建，产物在 dist/
npm run preview   # 预览 dist/（仅本地）
npm run typecheck # tsc -b
npm run lint      # eslint .
npm test          # Vitest 单元与路由测试
npm run test:e2e  # Playwright 路由冒烟（自动启动 dev server）
```

`npm run test:e2e` 使用本机已安装的 Chrome（`channel: 'chrome'`），不下载 Playwright 自带浏览器。
若目标机器没有 Chrome，安装浏览器后去掉 `playwright.config.ts` 中的 `channel` 再运行。

## 目录

```text
frontend/
├── src/
│   ├── app/              # 路由表、路由错误页、/admin 跳转、公开配置、QueryClient
│   ├── components/
│   │   ├── layouts/      # 公开导航、公开与后台布局
│   │   ├── ui/           # 按钮、字段、状态提示、页头、跳转入口
│   │   └── works/        # 作品卡片基础
│   ├── api/              # fetch 封装、错误归一、Query 键与各资源请求函数
│   ├── lib/              # classNames、字段 aria 辅助
│   ├── mocks/            # MSW 数据源、派生、场景、浏览器/Node 入口与 Mock 标识
│   ├── pages/            # 公开端页面
│   ├── pages/admin/      # 后台页面
│   ├── styles/           # tokens.css（设计变量）与 global.css（重置与焦点）
│   └── types/            # 公开/管理作品、城市、上传资源与错误体
├── tests/unit/           # Vitest + RTL
├── tests/e2e/            # Playwright
├── .env.example          # 公开配置示例
├── .nvmrc                # 推荐的 Node 版本（24.15.0）
└── playwright.config.ts / vite.config.ts / tsconfig*.json
```

## 路由

| 路径 | 页面 | 状态（P03） |
| --- | --- | --- |
| `/` | 首页 · 地图探索 | 基础版：空间开场文案与入口底稿（地球场景在 P07／P08） |
| `/works` | 全部作品 | 基础版：三张示例卡片与网格；数据层已就绪，页面接入在 P04 |
| `/works/:id` | 作品详情 | 基础版：封面承托、禁用控制条、信息列（观看外壳在 P05） |
| `/admin/login` | 管理员登录 | 基础版：字段可输入，提交按钮禁用，不发请求（P09／P16） |
| `/admin/works` | 作品管理 | 基础版：页头与阶段说明（列表在 P10） |
| `/admin/works/new` | 新建作品 | 基础版：页头与阶段说明（表单在 P11） |
| `/admin/works/:id/edit` | 编辑作品 | 基础版：页头与阶段说明（表单在 P11，替换在 P13） |
| `/admin/works/:id/preview` | 管理员预览 | 基础版：复用观看区说明（P05） |
| `/admin` | — | 前端跳转到 `/admin/works` |
| 其他 | 404 页面 | 提供返回首页／全部作品 |

路由可被直接访问**不代表有权限**：当前没有认证逻辑，真实的管理员权限、发布与资源
校验都由服务端负责。

## 配置

复制 `.env.example` 为 `.env.local` 后按需修改（`.env*` 已被忽略，只有示例文件提交）。

- `VITE_` 前缀变量会进入浏览器构建产物，只能放可公开信息；任何供应商密钥、服务器口令、
  管理员密码都不得写入前端或文档。
- `VITE_ENABLE_MOCKS` 默认 `false`。只有**开发构建**（`import.meta.env.DEV`）且该值为 `true`
  时才启动 MSW；生产构建恒走真实 HTTP。启用后界面会显示“开发 Mock · 非真实接口”标识。

## 数据层与开发 Mock（P03）

数据边界按 [接口契约草案](../工程设计/02_接口契约草案.md)（v0.2，**未经后端签字**）建立，
真实路径、字段与错误码仍可能变化；上传与预览的未定部分保持提案，没有固化成协议。

- **类型**（`src/types/`）：`PublicWork`（公开端）与 `AdminWork`（后台，含 `status`、
  资源 id、`updatedAt`）分开；`cityId` 在请求体里省略＝不修改、`null`＝清空；
  作品**不含建筑经纬度**，位置只由 `cityId` 决定。`City`、`Province`、`GeoPoint`、
  `GlobeCity`（含 `workCount`）、`UploadAsset`、统一错误体同在类型层。
- **请求层**（`src/api/http.ts`）：统一基址、`credentials: 'include'`、JSON 解析、
  错误归一为 `ApiError { status, code, fields }`、透传 `AbortSignal`（取消不算失败）。
  网络不可达 → `NETWORK_ERROR`，2xx 但非 JSON → `INVALID_RESPONSE`，不会把失败当成功。
- **缓存**（`src/api/queryKeys.ts` + `src/app/queryClient.ts`）：Query 键集中定义；
  首期关闭自动重试与窗口聚焦重取，`staleTime` 30 s；写操作不重发。
  模型对象、逐帧相机、视频流一律不进 Query 缓存（P05／P18 自行管理生命周期）。
- **Mock 数据**（`src/mocks/`）：一套内存数据派生出公开目录、城市聚合与后台列表，
  写入后立刻一致。含 **10 件已发布**演示作品（3 件真实样例 + 7 件明确占位）、
  2 件草稿、1 件已下架；城市含同城多件、无城市、中心坐标缺失（广州市，不生成地球点位）。
- **演示账号**：`admin` / `admin`，**仅用于 Mock 演示，不是安全方案**；Mock 会话只在内存，
  刷新页面即退出、数据复位，没有持久化。
- **可控场景**：`normal`／`empty`／`list-failure`／`auth-expired`／`validation-failure`／
  `model-in-use`。开发时在控制台用 `window.__mockControls.setScenario('empty')` 切换，
  `window.__mockControls.reset()` 恢复初始数据。
- **失败不回退**：关闭 Mock（或生产构建）时请求真实发出，失败按错误处理，**不会**落到假数据。
  注意 `npm run dev` 对未知 `/api/*` 会返回 `index.html`（HTML 200），客户端会报
  `INVALID_RESPONSE`；接入真实后端时应配置开发代理，避免 SPA 回退吞掉 API 的 404。

## 样式与设计变量（P02）

样式分两层：`src/styles/tokens.css` 只放设计变量，`*.module.css` 组织局部样式；页面里不写
行内颜色，也不从参考图吸色推算——数值一律来自
[视觉规范 v1.0（深色）](../UI设计/视觉规范v1.0（深色）.md)。

- **颜色**：页底 `#080D12`、面板 `#121D26`、图像承托 `#20272B`、输入底 `#0D161E`；主文字
  `#EBF2F5`、次文字 `#A8BAC4`、辅助 `#879CA8`；主强调 `#54C8C1`（按钮深色字）、冷银
  `#C6E2E6`；错误／警示／成功各三色，禁用三色。命名见 `--color-*`。
- **字号**：标题 34/42、建筑标题 20/28、正文 16/28、按钮与标签 14/20、字段说明 14/22、
  英数元信息 12/18；手机 <768px 由 tokens 覆盖为 28/36 等。
- **间距与布局**：4–48 的 `--space-*`；导航 72／手机 56＋44，侧边距 32／16，内容上限 1280。
- **圆角／层级／动效**：`--radius-overlay|panel|control`、`--z-nav|overlay|modal`、
  `--dur-fast 120ms`–`--dur-scene 600ms` 与两条缓动。GSAP 时间线使用同一组时长变量。
- **玻璃规则**：`--glass-nav`（`#080D12` 92% + 12px 模糊）与 `--glass-panel`
  （`#121D26` 88%）**只声明、当前未使用**。按规范玻璃仅用于首页导航与场景气泡，且并集不超过
  22% 视口；手机导航、后台与长文界面一律实色。首页叠上三维场景后（P07）再启用并核对预算。
- **图像承托**：封面／占位统一铺 `#20272B`，模型画布也用同一底色，不额外叠渐变。
- **减少动态**：`prefers-reduced-motion: reduce` 时把时长变量置 0，保证当前仅有的过渡失效；
  空间入场与镜头联动的逐项替代方案在 P06／P07 与正常模式一起验收。
- **焦点**：`:focus-visible` 统一 2px 深色间隔＋2px `#8FE1DB` 焦点线，覆盖链接、按钮、字段、
  `[tabindex]`；不支持 `:focus-visible` 的旧浏览器回退为 outline。
- **字体**：思源黑体 SC／Inter／IBM Plex Mono **未入库**，当前使用
  `"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui` 回退栈，
  等宽元信息用 `ui-monospace` 回退。正式字体需从官方项目取得并保留许可，替换时只改
  `--font-*` 变量，不改页面。

## 已知限制（P03）

1. 页面是**基础版**而不是成品：目录与详情仍用本地示例卡片，尚未消费 `useQuery`；登录页字段可
   输入，但提交按钮禁用、不发请求。
2. Mock 是演示与测试替身：内存数据、假登录、假资源状态，**不能当作认证或权限方案**；
   刷新即复位，没有持久化。
3. 真实接口未签字：路径、错误码、字段仍可能变化；上传与预览端点保持提案，未固化为协议。
4. 不加载任何模型；GLB／高斯 PLY 不在 `public/`、源码导入或构建产物中（P05 模拟预览
   生命周期，P18A–C 才接真实观看器）。
5. 三维场景、空间入场、点位联动、封面转场都未实现：首页目前是两栏空间入场底稿，不是动画验收。
6. 玻璃变量已声明但未启用：没有场景可叠，等 P07 再按 22% 预算开启并核对。
7. 错误／警示／成功／禁用／焦点状态只有组件层（单元测试＋临时截图）证据，尚未由真实表单或
   网络失败触发；临时校验页已删除，不进入产品路由。
8. 字体未入库（见上），当前是系统字体回退，不能声称已使用思源黑体或 Inter。
9. favicon 待 Logo 确定，先用空 data URI 避免 404。
10. 开发服务器能回退深层路径，**不等于**生产静态托管已配置页面路径回退；同样，dev 对未知
    `/api/*` 返回 HTML 也说明接入后端前必须配好代理或改写规则。
11. 页面走查覆盖 320／390／768／1440 CSS px，但只在 Chrome 上；真机、Firefox、Safari、
    200% 缩放与屏幕阅读器未验证。
12. Playwright 冒烟只验证路由可达与刷新，不验证视觉、动效、权限或渲染性能；Mock 场景走查
    用临时脚本完成，未纳入 e2e。

## 相关文档

- [项目 README](../README.md)：目标、里程碑与边界。
- [工程设计目录](../工程设计/README.md)：结构、接口草案、验收计划与技术栈决策。
- [UI 设计](../UI设计/)：深色视觉规范 v1.0、动效设计 v1.0、深色页面参考图。
