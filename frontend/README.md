# 建筑模型展厅 · 前端工程

当前阶段：**P01 路由骨架**。所有页面都是明确标注的“开发占位”，没有业务数据、真实认证、
模型加载或 AI 助手。阶段计划见 [分阶段编码提示词](../工程设计/07_分阶段编码提示词.md)，
执行状态见 [开发执行记录](../工程设计/开发执行记录.md)。

## 运行环境

| 项目 | 实测值 | 说明 |
| --- | --- | --- |
| Node.js | v24.15.0 | `package.json` 的 `engines` 为 `^20.19.0 \|\| >=22.12.0`（Vite 8 要求） |
| npm | 11.12.1 | 锁文件为唯一的 `package-lock.json`，CI 使用 `npm ci` |
| 已验证浏览器 | Chrome（本机安装版） | Firefox / Safari / 真机未验证 |

Windows 注意：若 PowerShell 执行策略禁止 `npm.ps1`，请改用 `cmd /c npm ...` 或 `npm.cmd`。
若沙箱或权限不允许写用户级 npm 缓存，可把缓存改到可写目录，例如
`set npm_config_cache=F:\srtp网页\.npm-cache`（仅影响本机，不写入仓库）。

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
│   ├── app/          # 路由表、路由错误页、/admin 跳转、公开配置
│   ├── components/   # 布局与开发占位组件
│   ├── pages/        # 公开端页面
│   ├── pages/admin/  # 后台页面
│   └── styles/       # 全局基线样式（正式设计变量在 P02 建立）
├── tests/unit/       # Vitest + RTL
├── tests/e2e/        # Playwright
├── .env.example      # 公开配置示例
└── playwright.config.ts / vite.config.ts / tsconfig*.json
```

## 路由

| 路径 | 页面 | P01 状态 |
| --- | --- | --- |
| `/` | 首页 · 地图探索 | 开发占位（地球场景在 P07／P08） |
| `/works` | 全部作品 | 开发占位（目录在 P04，数据在 P03） |
| `/works/:id` | 作品详情 | 开发占位（观看区在 P05，不加载模型） |
| `/admin/login` | 管理员登录 | 开发占位（无输入框、无认证请求） |
| `/admin/works` | 作品管理 | 开发占位（列表在 P10） |
| `/admin/works/new` | 新建作品 | 开发占位（表单在 P11） |
| `/admin/works/:id/edit` | 编辑作品 | 开发占位（表单在 P11，替换在 P13） |
| `/admin/works/:id/preview` | 管理员预览 | 开发占位（复用观看区，P05） |
| `/admin` | — | 前端跳转到 `/admin/works` |
| 其他 | 404 页面 | 提供返回首页／全部作品 |

路由可被直接访问**不代表有权限**：P01 不含任何认证逻辑，真实的管理员权限、发布与资源
校验都由服务端负责。

## 配置

复制 `.env.example` 为 `.env.local` 后按需修改（`.env*` 已被忽略，只有示例文件提交）。

- `VITE_` 前缀变量会进入浏览器构建产物，只能放可公开信息；任何供应商密钥、服务器口令、
  管理员密码都不得写入前端或文档。
- `VITE_ENABLE_MOCKS` 默认 `false`，生产构建必须保持关闭；MSW 到 P03 才接入，当前该开关
  不产生任何行为。

## 已知限制（P01）

1. 所有页面是占位内容，没有业务表单、业务数据或交互。
2. 没有认证：登录页没有输入框、不发请求；管理路由可直接打开。
3. 没有 API 层与 MSW：真实接口仍为草案，P03 才建立 fetch／Query／Mock。
4. 不加载任何模型；GLB／高斯 PLY 不在 `public/`、源码导入或构建产物中（P05 模拟预览
   生命周期，P18A–C 才接真实观看器）。
5. 深色设计变量与字体尚未落地：`src/styles/global.css` 只是可读性基线，正式色板、字号、
   间距、玻璃与状态色在 P02 建立；思源黑体／Inter／IBM Plex Mono 未入库，当前用系统字体。
6. favicon 待 Logo 确定，先用空 data URI 避免 404。
7. 开发服务器能回退深层路径，**不等于**生产静态托管已配置页面路径回退；部署阶段需单独
   配置与验证，API 与缺失资源应返回真实错误而不是页面。
8. 页面走查只覆盖 1440×900 与 390×844；320 CSS px、真机、Firefox、Safari 未验证。
9. Playwright 冒烟只验证路由可达与刷新，不验证视觉、动效、权限或渲染性能。

## 相关文档

- [项目 README](../README.md)：目标、里程碑与边界。
- [工程设计目录](../工程设计/README.md)：结构、接口草案、验收计划与技术栈决策。
- [UI 设计](../UI设计/)：深色视觉规范 v1.0、动效设计 v1.0、深色页面参考图。
