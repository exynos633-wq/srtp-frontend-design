# 动效调研 · Aceternity UI 全量拆解与本站适配

创建：2026-11-04（Asia/Shanghai）。对应：[UI 优化设计](UI优化设计.md)、[动效设计 v2.0](动效设计v2.0.md)、[视觉规范 v1.0（深色）](视觉规范v1.0（深色）.md)。
性质：**外部素材调研，不改代码、不改其他文档**。文中数值均为 Aceternity 页面源码里的原始值；"本站改编"是基于本站约束的建议，不是已实施结论。

## 结论先行

1. 拆解了 118 个组件：表格中 ★★★ 及以上共 **44 个**，其中 **7 个 ★★★★★** 能直接改写第一眼观感（spotlight、spotlight-new、lamp、grid-and-dot、text-generate-effect、card-spotlight、container-scroll-animation）；moving-border、tracing-beam、magnetic-button 等 4★ 组件负责 CTA 与索引细节。
2. 本站当前"太简洁"的根因不是缺动画，而是**缺少"光"与"层次"**：v2.0 的动效全部是位移+透明度，画面里没有光源、没有景深、没有材质反射。Aceternity 最值得抄的是它的**光效三件套**（spotlight / lamp / beams）与**指针驱动的局部光斑**，不是它的循环装饰。
3. 可直接复用而不违反本站"不引入新依赖"原则的：spotlight、spotlight-new、lamp、grid/dot 底纹、text-generate、moving-border、hover-border-gradient、magnetic-button、glowing-effect、card-spotlight、3d-card、glare、lens、parallax、tracing-beam（全部可用 GSAP + CSS + SVG 等价实现）。
4. 需要引擎/新依赖、与本站冲突的：sparkles（tsparticles）、vortex/wavy/ascii/canvas 系（WebGL/Canvas 重绘）、aurora 的大面积 blur + mix-blend（移动端成本高）、世界地图（dotted-map 库）。
5. 建议分批：**第一批只做 3 处光效**（首页光带、观看器入场、目录卡片光斑），就能把"简洁"变成"克制而有光"；第二批再加指针类细节与索引光束。

---

## §0 抓取说明与日期

| 项 | 说明 |
| --- | --- |
| 抓取日期 | 2026-11-04 |
| 来源入口 | `https://ui.aceternity.com/sitemap.xml`，解析出 **118** 个 `/components/` 链接 |
| 抓取方式 | `curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"`，并发 6，超时 40s，失败重试一次 |
| 成功率 | **118 / 118 成功**，0 失败、0 重试。HTML 共约 47 MB，存 `/tmp/acet/pages/`（临时目录，未入仓） |
| 源码提取 | 页面为 Next.js RSC 流式输出，组件源码以 `__rawString__` / `__rawStringJsx__` 字段内嵌在 HTML 中；用正则提取并反转义 `\"`、`\n`、`\x3C`，得到 TS 与 JS 两份源码，去重后存 `/tmp/acet/src/` |
| 覆盖率 | 118 个页面全部提取到标题、描述与源码（部分页面源码由"组件+demo+依赖组件"多块组成，已逐块识别） |
| 未验证项 | 未在浏览器中逐页渲染核对视觉；未下载任何图片/字体/依赖；未核实 Aceternity 的商用与署名条款（落地前需自行确认）；framer-motion 数值未做运行时实测 |
| 数值口径 | "原始参数"栏全部来自源码字面量。标注"约/推断"的为从 className 反推，不做精确断言 |
| 成本口径 | 低 = ≤1 人日且无新依赖；中 = 1–2 人日或需 canvas/SVG 遮罩；高 = 需 WebGL/引擎/新依赖或 >2 人日（含适配与性能调优） |
| 星级口径 | ★ 是"对本站深色空间展厅的适配度"，不是组件质量评价 |

**本站约束（评级依据）**：无 Tailwind、无 framer-motion，动效走 GSAP 3.15 / CSS / Three；令牌见 `frontend/src/styles/tokens.css`（`--dur-*`、`--ease-*`）；色彩 `#080D12 / #121D26 / #EBF2F5 / #A8BAC4 / #54C8C1`；原则见 v2.0 §2：只动 transform/opacity、叙事段 1.2–1.6s、交互 100–280ms、不新增装饰性循环、`prefers-reduced-motion` 保留反馈。

---

## §1 全量组件速查表（118）

> 按组件名排序；"技术"取自页面源码的实际导入（Motion = framer-motion / `motion/react`）；"成本""适配"按 §0 口径。

| 组件 | 一句话效果 | 技术 | 成本 | 适配 |
| --- | --- | --- | --- | --- |
| 3d-card-effect | 指针驱动 3D 倾斜，子元素按 translateZ 分层景深 | React ref + CSS perspective | 低 | ★★★☆ |
| 3d-globe | three.js 真实地球 + 弧线 + 头像标记 | Three/R3F + drei | 高 | ★★ |
| 3d-marquee | 3D 透视网格跑马灯 | Motion + CSS 3D | 中 | ★★ |
| 3d-pin | 悬停时 pin 卡片绕 X 抬起并露出标题标签 | Motion + CSS 3D | 低 | ★★★ |
| add-utilities | `cn()` 工具函数说明（非视觉组件） | — | — | — |
| animated-modal | 复合弹窗，背板/内容分层进出 | Motion | 中 | ★★ |
| animated-testimonials | 头像切换式引言轮播 | Motion | 中 | ★ |
| animated-tooltip | 跟随指针的头像 tooltip | Motion | 中 | ★★ |
| apple-cards-carousel | Apple 式横滑大卡 + 幕布展开 | Motion | 高 | ★ |
| ascii-art | 图片转 ASCII 字符画（可动画） | Canvas2D + Motion | 高 | ★ |
| aurora-background | CSS 重复渐变极光，60s 位移循环 | CSS keyframes + blur | 中 | ★★★ |
| background-beams-with-collision | 光束碰撞后爆散 | Motion + SVG | 中 | ★★ |
| background-beams | 数十条 SVG 贝塞尔光束，渐变沿线扫过 | Motion + SVG | 中 | ★★★★ |
| background-boxes | 斜切方块网格，hover 点亮单格 | Motion + SVG | 低 | ★★ |
| background-cubes-grid | 3D 立方体网格随指针涟漪 | Three/R3F | 高 | ★★ |
| background-gradient-animation | 多团渐变以 20/30/40s 循环移动 | CSS keyframes | 低 | ★★★ |
| background-gradient | 卡片内部的移动渐变 | Motion | 低 | ★★★ |
| background-lines | SVG 波浪线组背景 | Motion + SVG | 低 | ★★ |
| background-ripple-effect | 网格单元点击涟漪 | CSS + JS | 低 | ★★ |
| bento-grid | 不对称 Bento 网格版式 | 纯布局/CSS | 低 | ★★ |
| canvas-reveal-effect | 点阵 shader 从中心扩散显影 | Three shader | 高 | ★★ |
| canvas-text | 文字轮廓内流动的彩色曲线 | Canvas2D | 中 | ★★ |
| card-hover-effect | 悬停卡片，指示块滑到当前卡片 | Motion | 低 | ★★★ |
| card-spotlight | 卡片内径向光斑跟随指针 | Motion + CSS mask（+点阵 shader 可选） | 中 | ★★★★★ |
| card-stack | 卡片定时堆叠轮播 | Motion | 中 | ★ |
| cards-free | 通用卡片版式集（非动效） | CSS | 低 | ★★ |
| carousel | 带微交互的轮播/图集 | 自定义 JS + CSS | 中 | ★ |
| chromatic-image | 交互图片：色散、位移、倾斜 | WebGL | 高 | ★★ |
| cli | shadcn CLI 安装说明 | — | — | — |
| cloud-shader | 程序化云层漂移 | Canvas2D/WebGL + Motion | 高 | ★★ |
| code-block | 基于 react-syntax-highlighter 的代码块 | react-syntax-highlighter | 低 | — |
| colourful-text | 文字彩色滤镜与缩放流动 | Motion | 低 | ★ |
| comet-card | 指针倾斜 + 反光扫光的 3D 卡 | Motion + CSS 3D | 低 | ★★★ |
| compare | 前后对比：滑动/拖拽分割 | 自定义 JS + CSS | 中 | ★★ |
| container-cover | 词内嵌粒子与光束的"封面字" | Motion + tsparticles | 中 | ★★★ |
| container-scroll-animation | 滚动驱动卡片 3D 抬升（rotateX 20→0） | Motion + scroll | 低 | ★★★★★ |
| container-text-flip | 词容器宽度随翻转变换 | Motion layout | 中 | ★★ |
| direction-aware-hover | 按进入方向滑入的 hover | Motion | 中 | ★★ |
| dither-shader | 实时有序抖动像素化 | Canvas2D | 高 | ★ |
| dotted-glow-background | canvas 点阵随机辉光、明暗呼吸 | Canvas2D | 中 | ★★★★ |
| draggable-card | 可拖拽、回弹的倾斜卡片 | Motion | 中 | ★ |
| encrypted-text | 乱码逐渐解密为文字 | Motion | 低 | ★★ |
| evervault-card | 卡片内加密乱码 + 渐变混合 | Motion + SVG | 中 | ★ |
| expandable-card | 点击展开卡片详情 | Motion layout | 中 | ★★ |
| feature-sections-free | 功能区块版式集（非动效） | CSS | 低 | ★ |
| file-upload | 拖拽上传 + 网格背景 | Motion | 低 | — |
| flip-words | 词语 Spring 翻转切换 | Motion | 低 | ★★★★ |
| floating-dock | macOS 式放大 Dock | Motion | 中 | ★ |
| floating-navbar | 滚动隐藏/回显的导航条 | Motion + scroll | 低 | ★★ |
| focus-cards | hover 聚焦一张，其余模糊缩小 | 纯 CSS | 低 | ★★★★ |
| following-pointer | 自定义指针 + 标签跟随 | Motion | 低 | ★★★ |
| github-globe | GitHub 首页同款 3D 地球 + 弧线 | three / react-globe.gl | 高 | ★★ |
| glare-card | 金属反光/彩虹箔片卡 | 纯 CSS 变量 + 指针 | 低 | ★★★ |
| glowing-effect | 卡片边框 cursor 光晕（conic 渐变遮罩） | Motion + CSS mask | 中 | ★★★★ |
| glowing-stars-effect | 卡片星光在 hover 时点亮 | Motion + SVG | 中 | ★★ |
| gooey-input | SVG gooey 滤镜 + 共享布局展开输入框 | Motion + SVG filter | 中 | ★ |
| google-gemini-effect | 发光 SVG 连线随滚动绘制 | Motion + SVG + scroll | 低 | ★★★ |
| grid-and-dot-backgrounds | CSS 网格/点阵底纹 + 径向渐隐遮罩 | 纯 CSS | 低 | ★★★★★ |
| hero-highlight | 文字高亮块随滚动点亮 | Motion | 中 | ★★★ |
| hero-parallax | 多行产品卡滚动旋转位移 | Motion + scroll | 中 | ★★ |
| hero-sections-free | 首屏版式集（非动效） | CSS | 低 | ★ |
| hover-border-gradient | 悬停时渐变边框绕行/铺满 | Motion + CSS mask | 低 | ★★★★ |
| image-generation-loader | 扫描式像素网格加载器 | Canvas2D | 高 | ★★ |
| images-badge | 悬停展开的图片徽章 | Motion | 低 | ★★ |
| images-slider | 键盘可导航的全屏图集 | Motion | 中 | ★★ |
| infinite-moving-cards | 无限跑马灯卡片/logo 墙 | CSS keyframes | 低 | ★★★★ |
| install-nextjs | 安装说明 | — | — | — |
| install-tailwindcss | 安装说明 | — | — | — |
| keyboard | macOS 键盘按键 + 音效 | Motion + SVG + 音频 | 高 | ★ |
| lamp-effect | 线性灯管聚光收束，内容自下方升起 | Motion + conic 渐变 | 中 | ★★★★★ |
| layout-grid | 点击网格项展开为详情 | Motion layout | 中 | ★★ |
| layout-text-flip | 文字切换时周边布局重排 | Motion layout | 中 | ★★ |
| lens | 圆形放大镜（遮罩 + 缩放克隆） | Motion + CSS mask | 低 | ★★★★ |
| link-preview | 链接悬停预览卡 | Motion + Radix HoverCard | 中 | ★ |
| liquid-glass | 折射玻璃表面 | Canvas2D + Motion | 高 | ★★ |
| loader | 极简加载动效集合 | Motion | 低 | ★★ |
| macbook-scroll | 滚动中笔记本屏幕展开 | Motion + scroll + SVG | 高 | ★ |
| magnetic-button | 按钮磁吸指针，离开时弹簧回位 | Motion | 低 | ★★★★ |
| meteors | 随机流星斜线坠落 | CSS keyframes | 低 | ★★ |
| moving-border | SVG 路径光点绕边框运动 | Motion + SVG | 中 | ★★★★ |
| multi-step-loader | 多步加载状态 | Motion | 低 | ★★ |
| navbar-menu | hover 展开的下拉菜单导航 | Motion | 中 | ★★★ |
| noise-background | 多团鼠标跟随渐变 + 噪点纹理 | Motion | 中 | ★★★ |
| notch | 悬浮 notch 状态栏 | Motion | 中 | ★ |
| parallax-hero-images | 指针视差图片层 | Motion | 低 | ★★ |
| parallax-scroll | 多列不同速度视差网格 | Motion + scroll | 低 | ★★★★ |
| pixelated-canvas | 图片像素化 + 指针扭曲 | Canvas2D | 高 | ★ |
| placeholders-and-vanish-input | 占位词滑动 + 提交蒸发 | Motion + Canvas2D | 中 | ★ |
| pointer-highlight | 文字进入视口后出现指针与描边框 | Motion + SVG | 低 | ★★★ |
| resizable-navbar | 滚动收缩 + 模糊的导航 | Motion + scroll | 中 | ★★★ |
| scales | 斜/横/竖线纹底 | 纯 CSS | 低 | ★★ |
| shooting-stars-and-stars-background | 星空 + 流星 canvas 背景 | Canvas2D + SVG | 中 | ★★★☆ |
| sidebar | 悬停展开的侧边栏 | Motion | 中 | ★ |
| signup-form | 带过渡的注册表单 | Motion | 低 | ★ |
| sparkles | tsparticles 粒子星屑 | tsparticles | 高 | ★★★ |
| spotlight-new | 左右两侧斜向渐变光带缓慢摆动 | Motion | 低 | ★★★★★ |
| spotlight | 顶部椭圆光束淡入，照亮标题 | CSS + SVG | 低 | ★★★★★ |
| squiggly-text | SVG 湍流位移的文字抖动 | Motion + SVG filter | 低 | ★★ |
| stateful-button | 提交中/成功的状态按钮 | Motion | 低 | ★★★ |
| sticky-banner | 滚动隐藏的顶部横幅 | Motion + scroll | 低 | ★★ |
| sticky-scroll-reveal | 左图 sticky + 右文滚动高亮 | Motion + scroll | 低 | ★★★ |
| svg-mask-effect | 指针处遮罩放大揭示底层 | Motion + SVG mask | 中 | ★★★☆ |
| tabs | 点击切换 Tab，背景块动画 | Motion layout | 低 | ★★ |
| tailwindcss-buttons | 按钮样式集（非动效） | CSS | 低 | ★★ |
| terminal | 终端打字机 + 语法高亮 | JS + CSS | 中 | ★ |
| text-flipping-board | 分屏翻牌显示 | Motion | 中 | ★★ |
| text-hover-effect | 悬停时文字渐变描边重绘 | Motion + SVG | 低 | ★★★ |
| text-generate-effect | 逐词模糊淡入 | Motion | 低 | ★★★★★ |
| text-reveal-card | 指针左右擦除，揭示另一段文字 | Motion + clip-path | 低 | ★★★☆ |
| timeline | 滚动驱动竖向时间线 + 进度光束 | Motion + scroll | 中 | ★★ |
| tooltip-card | 跟随指针的说明卡 | Motion | 低 | ★★ |
| tracing-beam | 沿 SVG 路径随滚动推进的渐变光束 | Motion + SVG + scroll | 中 | ★★★★ |
| typewriter-effect | 打字机 + 闪烁光标 | Motion | 低 | ★★ |
| vortex | canvas 漩涡粒子 | Canvas2D | 高 | ★ |
| wavy-background | canvas 波浪线背景 + blur | Canvas2D | 中 | ★★ |
| webcam-pixel-grid | 摄像头像素网格 | Canvas2D | 高 | ★ |
| wobble-card | 指针轻微位移/缩放卡片 | 纯 CSS 变量 | 低 | ★★★ |
| world-map | 点阵世界地图 + 虚线弧线流动 | SVG + dotted-map | 中 | ★★★★ |

---

## §2 重点组件拆解（26）

> 每个组件：视觉 / 实现 / 关键参数（源码原值）/ 本站改编 / 成本与风险。
> 所有"本站改编"都必须回到 v2.0 §2 的约束：交互 100–280ms、叙事 1.2–1.6s、只动 transform/opacity、减少动态保留反馈。

### 2.1 spotlight ★★★★★ — 首页地球后方光锥

- **视觉**：一束自上而下的柔和锥形光打在标题/地球后侧，先大后小而定位，落点稳定后不再动。
- **实现**：单个 SVG。`<ellipse>` 经 `feGaussianBlur` 滤镜后铺满容器，CSS 一次性 keyframe 淡入并位移；无 JS。
- **关键参数（原值）**：`animate-spotlight pointer-events-none absolute z-[1] h-[169%] w-[138%] lg:w-[84%] opacity-0`；viewBox `0 0 3787 2842`；ellipse `rx=1924.71 ry=273.501`、`fillOpacity="0.21"`、矩阵变换 `matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)`；`feGaussianBlur stdDeviation="151"`；keyframes `spotlight 2s ease 0.75s 1 forwards`，`0% { opacity:0; transform: translate(-72%,-62%) scale(0.5) }` → `100% { opacity:1; transform: translate(-50%,-40%) scale(1) }`。
- **本站改编**：放首页 hero 层，z 在"星点/地形装饰"之下、地球之上（或地球后侧用 `mix-blend-mode:screen`）；`fill` 改 `#54C8C1` 并把 `fillOpacity` 降到 `.10–.14`（深色底上 21% 偏白会抢标题）；入场压到 900ms（`--dur-scene` 附近）+ `--ease-out`，落点对准标题与地球之间的负空间，不来回动。减少动态：直接最终态。
- **成本与风险**：低（1 个 SVG + 1 段 keyframes）。风险是 151 的大半径模糊在移动端 GPU 上贵：移动端把 `stdDeviation` 降到 80–100 或直接换成径向渐变 div。

### 2.2 spotlight-new ★★★★★ — 首页左右斜向光带

- **视觉**：左右各一组 45° 斜向渐变光带，像展厅两侧的洗墙灯，缓慢横向摆动 ±100px（7s 一程）。
- **实现**：两个绝对定位容器，各含 3 个 div（主光带 560×1380、两条 240×1380 边光），`rotate(±45deg)`，整组用 `x: [0, ±xOffset, 0]` 无限往返；外层 1.5s 淡入。
- **关键参数（原值）**：默认 `duration=7`、`xOffset=100`、`translateY=-350`、`width=560`、`height=1380`、`smallWidth=240`、`rotate(±45deg)`；三条渐变：`radial-gradient(68.54% 68.72% at 55.02% 31.46%, hsla(210,100%,85%,.08) 0, hsla(210,100%,55%,.02) 50%, hsla(210,100%,45%,0) 80%)` / `50% 50%` 版 `.06/.02` / `.04/.02`；缓动 `easeInOut`、`repeatType:"reverse"`。
- **本站改编**：替换/叠加 2.1 的锥形光，放在首页 hero 左右边缘 `z-index:0`，`opacity:.5`；色相从 210°（蓝）转到本站 accent 的青绿（约 `hsla(177,52%,55%,.06)` 起，或不改色相只降透明度以保持冷调）。摆动幅度降到 ±40px、周期 9–12s，并在 `IntersectionObserver` 不可见时暂停；减少动态只保留静态光带。**这正是本站当前最缺的"光"**，且无循环位移之外的语义负担。
- **成本与风险**：低。风险：大面积渐变 + 反向循环在低端机可能掉帧；用 `will-change:transform` 只在 hero 挂载期、滚动出屏即摘除。

### 2.3 lamp-effect ★★★★★ — 目录页头/章节标题的灯管

- **视觉**：一条细亮"灯管"从中间展开，两侧锥形光幕收拢，标题从下方 100px 升起，像线性（Linear）式聚光灯。
- **实现**：左右两个 `conic-gradient` 光幕（半透明→透明），宽度 `15rem→30rem` 动画；叠 `blur-3xl` 的青色光团与 1px 亮线；底部用与背景同色的遮罩把光"收边"。
- **关键参数（原值）**：`--conic-position: from_70deg_at_center_top` 与 `from_290deg_at_center_top`；`initial {opacity:.5, width:"15rem"}` → `whileInView {opacity:1, width:"30rem"}`，`transition {delay:.3, duration:.8, ease:"easeInOut"}`；光团 `h-36 w-[28rem] rounded-full bg-cyan-500 opacity-50 blur-3xl`；亮线 `h-0.5 w-[30rem] -translate-y-[7rem] bg-cyan-400`；标题 `initial {opacity:.5, y:100} → whileInView {opacity:1,y:0}`，同 0.3/0.8s。
- **本站改编**：用在 `/works` 页头（"全部作品"上方）或详情小节标题上方；两束光换成 accent `#54C8C1` 与 `--color-silver #C6E2E6` 的 50% 叠加；标题升起改 24–32px（本站标题已在 64–80px，100px 位移会撞导航）。只播一次（`whileInView` 等价：IntersectionObserver + `once`），不循环。减少动态：光幕静态、标题直接出现。
- **成本与风险**：中。风险：4–6 层大 blur 同时合成，移动端成本高；建议只保留"亮线 + 1 层 blur 光团"，光幕用 `mask-image` 做渐隐而不是额外 blur 层。

### 2.4 background-beams ★★★★ — 主页/目录的"空间坐标线"

- **视觉**：约 50 条细贝塞尔曲线从左上扫向右下，每条曲线上有一段青紫渐变光在缓慢爬行，像卫星轨迹或等高线。
- **实现**：单个 SVG，路径共用一条大 `path` 做底纹（`strokeOpacity .05`），再按数组渲染 50 条 `motion.path`，每条挂自己的 `motion.linearGradient`，渐变坐标从 `0%/0%` 动画到 `100%/95–100%`。
- **关键参数（原值）**：`viewBox="0 0 696 316"`；底纹 `strokeWidth="0.5" strokeOpacity="0.05"`；动态线 `stroke="url(#linearGradient-i)" strokeOpacity="0.4" strokeWidth="0.5"`；渐变 `initial {x1:"0%",x2:"0%",y1:"0%",y2:"0%"}` → `animate {x1:["0%","100%"], x2:["0%","95%"], y1:["0%","100%"], y2:["0%",(93+rand*8)+"%"]}`；`duration: rand*10+10`（10–20s）、`ease:"easeInOut"`、`repeat:Infinity`、`delay: rand*10`；配色 `#18CCFC → #6344F5 → #AE48FF`（0/32.5%/100%）。
- **本站改编**：不要放在真实地球后面（会和球面经纬线打架）；建议放 `/works` 页头背景或详情页"空间档案"区块，路径数减到 8–12 条、透明度 0.25、颜色换 `#54C8C1 → #879CA8`，周期 14–18s。地球首页保留原生的地形线与轨道装饰即可。
- **成本与风险**：中。风险：50 条 SVG 渐变 = 50 个合成层，移动端明显掉帧；必须减量 + 出屏暂停。

### 2.5 aurora-background ★★★ — 极光底（谨慎采用）

- **视觉**：一整片柔和的蓝紫极光在页面上缓慢横移，60s 一个循环。
- **实现**：两层 `repeating-linear-gradient`（遮罩条 + 极光条）叠在 `-inset-[10px]` 的伪元素上，`blur(10px)`、`mix-blend-difference`，再叠径向遮罩只让右上角显影；外层 keyframes 只改 `background-position`。
- **关键参数（原值）**：`--animate-aurora: aurora 60s linear infinite`，`from {background-position: 50% 50%, 50% 50%} to {350% 50%, 350% 50%}`；`--aurora: repeating-linear-gradient(100deg,#3b82f6 10%,#a5b4fc 15%,#93c5fd 20%,#ddd6fe 25%,#60a5fa 30%)`；`--white-gradient`/`--dark-gradient` 以 `#fff/#000 0–7%` 与 `transparent 10–12%` 交替；`blur-[10px] opacity-50`；径向遮罩 `radial-gradient(ellipse at 100% 0%, black 10%, transparent 70%)`。
- **本站改编**：只建议做**加载态/空态**的单次极光，或首页 logo 区的小面积变体；不要铺满首页。深色空间展厅要"黑得干净"，大面积极光会破坏 #080D12 的秩序感，也与"不用低透明度堆叠制造高级感"的规范相悖。若采用：色相收窄到青绿—银灰，`opacity ≤ .35`，停掉 `mix-blend-difference`。
- **成本与风险**：中偏高。`blur(10px)` 全屏 + 混合模式在移动端是典型掉帧源；减少动态必须整层移除。

### 2.6 dotted-glow-background ★★★★ — 点阵呼吸底纹

- **视觉**：规则点阵中随机若干点缓慢变亮再暗，像夜空里零星闪烁的灯，整体极克制。
- **实现**：Canvas2D。按 `gap` 生成点阵（隔行偏移半格），每点带随机相位与角速度，`sin` 调制半径/透明度；支持从 CSS 变量取色、监听主题切换、`ResizeObserver` 重算、DPR 上限 2、不可见时跳过绘制。
- **关键参数（原值）**：`gap=12`、`radius=2`、`opacity=0.6`、`speedMin=0.4`、`speedMax=1.3`（弧度/秒）、`backgroundOpacity=0`；demo 用 `gap={10} radius={1.6} speedMin={0.3} speedMax={1.6} speedScale={1}`、暗色 `glowColorDarkVar="--color-sky-800"`；DPR `Math.min(Math.max(1, devicePixelRatio),2)`；隔行偏移 `(j % 2 === 0 ? 0 : gap * 0.5)`。
- **本站改编**：用于 `/works` 整页底纹或详情页空白区；点色 `--color-line #2A3E4B`、辉光 `--color-accent #54C8C1` 且 `opacity` 只给 0.10–0.18；`gap` 提到 20–24（展厅尺度更大更"贵"）。**更省的替代**：静态点阵 CSS `radial-gradient` + 8~12 个 CSS 呼吸点，避免整屏 canvas。
- **成本与风险**：中。canvas 全屏重绘吃电；必须做"不可见暂停 + DPR 限幅 + 低端机降级为静态点阵"。

### 2.7 grid-and-dot-backgrounds ★★★★★ — 零成本空间底纹

- **视觉**：40px 或 20px 的极淡网格/点阵，中央被径向遮罩吃掉，只留边缘纹理。
- **实现**：纯 CSS 两层：`background-image` 两条 `linear-gradient` 画网格（或 `radial-gradient` 画点），外层 `background-size` + `mask-image` 径向渐隐。无 JS、无动画。
- **关键参数（原值）**：网格 `[background-size:40px_40px]`、`linear-gradient(to_right,#262626_1px,transparent_1px)` + 纵向同款；小网格 20px；点阵 `[background-size:20px_20px]`、`radial-gradient(#404040_1px,transparent_1px)`；遮罩 `[mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]`。
- **本站改编**：直接换成本站色值：线 `#2A3E4B`（1px、`opacity .5`），点 `#879CA8`（1px、40%），尺寸 40px（桌面）/32px（手机），遮罩改 `ellipse_at_center, transparent 30%, black`。用于 `/works` 整页底或详情信息区背景，能把"空"变成"有秩序的暗纹"，成本几乎为零，**建议第一批就加**。
- **成本与风险**：低。唯一注意：别与卡片边框、分隔线叠加到同一视觉层，避免"到处是线"。

### 2.8 sparkles ★★★ — 星屑粒子

- **视觉**：标题/地球周围悬浮大量极细的白色光点，缓慢漂移、偶尔聚散。
- **实现**：`@tsparticles/react` + `loadSlim` 引擎；一个 `motion.div` 先 `opacity:0`，粒子加载后 `duration:1` 淡到 1。
- **关键参数（原值）**：`fpsLimit: 120`、`interactivity.events.onClick {enable:true, mode:"push"}`、`modes.push.quantity=4`、`repulse {distance:200, duration:0.4}`；demo：`minSize={0.4} maxSize={1} particleDensity={1200} particleColor="#FFFFFF"`；`background:"transparent"` 时由容器透出。
- **本站改编**：**不引入 tsparticles**（违反"不新增依赖"）。等价物：Three 场景里已有的星点层加 1 组 `Points`（≈300–600 点、`sizeAttenuation`、`opacity .35`），或 CSS 生成 200 个 1px 圆点 + 20 个呼吸点。密度按"地球前景不抢戏"定，宁可少。减少动态：静态星点。
- **成本与风险**：高（原方案）/低（本站复刻）。风险：粒子 + 地球 + 后处理同帧容易掉到 40fps，必须和地球共享一个渲染循环。

### 2.9 shooting-stars-and-stars-background ★★★☆ — 星空与流星

- **视觉**：深色天幕上密集小星点缓慢闪烁，每隔几秒一颗流星斜划而过，带青色拖尾。
- **实现**：星点用 canvas 逐帧绘制 + `ResizeObserver`；流星是 SVG `<rect>`（10×1）沿随机角度平移，位置/速度/缩放由 state 驱动，越飞越远越大。
- **关键参数（原值）**：流星 `minSpeed=10 maxSpeed=30`、`starColor="#9E00FF"`、`trailColor="#2EB9DF"`、`starWidth=10`、`starHeight=1`；`scale = 1 + distance/100`；角度 135°/225° 两组；星点 `radius: rand*0.05+0.5`、`opacity: rand*0.5+0.5`、`twinkleSpeed` 0.5–1、`twinkleProbability` 可配。
- **本站改编**：首页 hero 夜空可以加，但**颜色必须去紫**（#9E00FF 与本站在冲突），改 `#C6E2E6` 拖尾 `#54C8C1`；流星频率降到 8–14s 一颗、一次只有 1 颗；星点用静态 CSS 生成。减少动态：无流星、静态星点。
- **成本与风险**：中。风险：流星 + 星空 canvas + 地球 → 三个渲染源抢 GPU；建议流星用纯 CSS（两三条 keyframe 循环）而不是 canvas。

### 2.10 text-generate-effect ★★★★★ — 逐词模糊入场

- **视觉**：一句话按词依次从模糊 10px 淡入清晰，像字幕/展签逐条出现。
- **实现**：把字符串 `split(" ")` 成 span，初始 `opacity:0` + `blur(10px)`，`useEffect` 里用 `animate("span", {opacity:1, filter:"blur(0px)"}, {duration, delay: stagger(0.2)})`。
- **关键参数（原值）**：`duration=0.5`、`delay: stagger(0.2)`、初始 `filter:"blur(10px)"`、`filter` 可关（`filter=false` 时 `filter:"none"`）；默认渲染为 `text-2xl leading-snug tracking-wide font-bold`。
- **本站改编**：用于首页副标题、详情页摘要、`/works` 页头描述。中文本站要按"词/短语"而非空格切分（中文无空格）：按 `Intl.Segmenter` 或手动短语数组切。stagger 从 0.2 降到 0.06–0.09（200ms 级交互节奏），总时长 ≤ 700ms；字号沿用 `--text-body/--text-heading`，不要用它的 bold 2xl 默认值。减少动态：整句直接出现。
- **成本与风险**：低。风险：中文 span 包裹会破坏换行与标点避头尾；用 `display:inline-block` + 保留空格节点，或只对"短句/英文微标签"使用。

### 2.11 flip-words ★★★★ — 英文微标签轮换

- **视觉**：一个词从下方带模糊翻入，旧词放大模糊飞出；多词时逐字母错峰。
- **实现**：`AnimatePresence` 中按 `duration` 定时替换 `currentWord`；进入用 spring，退出用 `opacity:0, y:-40, x:40, blur(8px), scale:2, position:absolute`。
- **关键参数（原值）**：`duration=3000`（3s 一词）；进入 `spring stiffness:100 damping:10`；退出 `y:-40 x:40 blur(8px) scale(2)`；逐词 `delay: wordIndex*0.3 duration:0.3`；逐字母 `delay: wordIndex*0.3 + letterIndex*0.05 duration:0.2`。
- **本站改编**：用在首页 eyebrow 旁或详情元信息，例如在 `A NEW PERSPECTIVE` 后轮换 `ARCHIVE / EXHIBITION / FIELD NOTES`；也可在 `/works` 计数旁轮换城市名。周期 3.2–4s、只切 2–4 个词，**不要逐字母**（对中文破坏性大）。减少动态：固定显示第一个词。
- **成本与风险**：低。风险：持续存在的定时器 + 布局跳动；固定容器宽度或 `position:absolute` 承担溢出。

### 2.12 text-reveal-card ★★★☆ — 指针擦除揭示

- **视觉**：鼠标左右移动时，一个竖直光刃擦除前景文字，露出底下的另一段文字，光刃有轻微旋转。
- **实现**：`mousemove` 算百分比 → 上层 `clipPath: inset(0 X% 0 0)`；光刃 `left: X%`、`rotate: (X-50)*0.1deg`；离开时 `widthPercentage` 归零并用 0.4s 过渡复位。
- **关键参数（原值）**：`rotateDeg = (widthPercentage - 50) * 0.1`；光刃 `w-[8px] bg-gradient-to-b from-transparent via-neutral-800 to-transparent`；鼠标离开过渡 `{duration:0.4}`，悬停中 `{duration:0}`；背景 `#1d1c20`、边框 `white/[0.08]`；内含 80 颗随机星点（`2px`、`duration: 20–30s`、`repeat:Infinity`）。
- **本站改编**：用于 `/works` 卡片封面 —— 默认显示英文名/编号，指针擦出中文名与一句话；或详情页封面擦出线框/参数。光刃换 `--color-accent`；去掉 80 颗星点（成本与噪点）。触屏：点击切换而不是擦除。减少动态：直接显示两段文字。
- **成本与风险**：低。风险：`clip-path` 每帧变化在 Safari 上有合成开销；用 `will-change:clip-path` 只在 hover 时。

### 2.13 moving-border ★★★★ — 主 CTA 的绕边光点

- **视觉**：一条发光小段沿按钮边框持续绕行，像展签边缘的呼吸灯。
- **实现**：SVG `<rect rx ry>` 求 `getTotalLength()`，`requestAnimationFrame` 里按 `length/duration` 推进，用 `getPointAtLength` 取坐标，把光斑 div 平移到该点；外层按钮用内层实色遮住中心，只留 1px 边。
- **关键参数（原值）**：`duration=3000`（3s 一圈）；`rx="30%" ry="30%"`；光斑 `h-20 w-20 bg-[radial-gradient(#0ea5e9_40%,transparent_60%)] opacity-[0.8]`；容器 `p-[1px]`、内层 `border-slate-800 bg-slate-900/[0.8] backdrop-blur-xl`、半径 `calc(borderRadius*0.96)`；默认 `borderRadius="1.75rem"`。
- **本站改编**：只给首页主 CTA"浏览全部作品"用；`duration` 放慢到 5000–6000ms（越慢越"贵"）；配色 `#54C8C1` 40% → transparent 60%，光斑缩到 `w-12 h-12`、`opacity .6`；圆角用本站控件 6px 或按钮现有圆角。悬停时加速到 3000ms，离开恢复。减少动态：静态 1px 边框高亮。
- **成本与风险**：中。风险：`getPointAtLength` 每帧调用在小元素上没问题，但需在 `visibilitychange`/出屏时暂停 rAF。

### 2.14 hover-border-gradient ★★★★ — 悬停渐变描边

- **视觉**：鼠标进入时，一条渐变从某个方向扫满边框，离开时退回。
- **实现**：一个隐形的 `motion.div` 作为"遮罩层"，用 4 个方向的径向渐变遮罩轮流切换（TOP/LEFT/BOTTOM/RIGHT），每 `duration` 秒旋转一次方向；外层 `filter:blur(2px)` 让渐变变柔。
- **关键参数（原值）**：`duration=1`（每秒换一次方向，`setInterval(duration*1000)`）；方向渐变如 `radial-gradient(20.7% 50% at 50% 0%, hsl(0,0%,100%) 0%, rgba(255,255,255,0) 100%)`（TOP）/ `16.6% 43.1% at 0% 50%`（LEFT）/ 底部/右侧同构；中心态 `radial-gradient(75% 181.15942028985506% at 50% 50%, #3275F8 0%, rgba(255,255,255,0) 100%)`；`transition {ease:"linear", duration:1}`。
- **本站改编**：替代目录卡片现有的"边框色变化"——把 accent 渐变绕边 + 内层 `background: #121D26` 盖住中心，只露 1px。方向轮换降为 1.4–1.8s（更慢更克制）；`#3275F8` 换 `#54C8C1`。可只用于首排两张"大卡"，其余保持现有 hover。
- **成本与风险**：低。风险：`blur(2px)` 在多层卡片上叠加会糊；只给 1–2 个元素用。

### 2.15 magnetic-button ★★★★ — 磁吸按钮

- **视觉**：指针靠近按钮时按钮轻微向指针方向偏移，离开后弹簧回位，边框出现虚线与淡色底。
- **实现**：`mousemove` 算中心差 × `strength`，`Math.hypot` 距离超 `maxDistance` 时按比例缩放限幅；`motion.div` 用 spring 跟随；指针未进入时边框透明。
- **关键参数（原值）**：`strength=0.8`、`maxDistance=100`；`transition {type:"spring", stiffness:150, damping:25, mass:0.1}`；外框 `rounded-lg border border-dashed`，`hasMoved` 时 `borderColor:var(--show-color)`、`backgroundColor: color-mix(in srgb, var(--show-color) 20%, transparent)`；`--show-color: var(--color-blue-500)`；`transition-colors duration-150`。
- **本站改编**：只给主 CTA 与"开始预览"用，**强度必须大幅降低**：`strength .25–.35`、`maxDistance 8–12px`（原值 100px 会显得廉价、也违反"不做弹跳"）；spring 改 `stiffness 220 / damping 30 / mass .2` 更稳；不要虚线框与外扩底色，保留 1px accent 边框即可。只在 `(hover:hover) and (pointer:fine)` 生效。减少动态：不位移。
- **成本与风险**：低。风险：按钮位移会让相邻元素视觉"抖"；容器预留 padding，位移只在按钮自身。

### 2.16 card-spotlight ★★★★★ — 目录卡片光斑

- **视觉**：指针在卡片上移动时，卡内一束 350px 的柔和光斑跟随，边缘略亮，像手电照在展签上。
- **实现**：`mousemove` 把坐标写进 `useMotionValue`，用 `useMotionTemplate` 生成 `maskImage: radial-gradient(350px circle at Xpx Ypx, white, transparent 80%)`；底层是一个纯色 `motion.div`（`#262626`），可选内嵌点阵着色器。
- **关键参数（原值）**：`radius=350`、`color="#262626"`；`maskImage` 模板 `radial-gradient(${radius}px circle at ${mouseX}px ${mouseY}px, white, transparent 80%)`；卡片 `p-10 rounded-md border border-neutral-800 bg-black`；光斑层 `-inset-px opacity-0 transition duration-300`，hover 才 `opacity-100`；点阵层 `animationSpeed=5`、`dotSize=3`、colors `[[59,130,246],[139,92,246]]`。
- **本站改编**：`/works` 卡片。用 GSAP `quickTo` 或 rAF 节流把 `--mx/--my` 写到卡片上，`mask-image: radial-gradient(320px circle at var(--mx) var(--my), rgb(84 200 193 / 10%), transparent 75%)`；底层改 `#121D26`，悬停时再加 1px accent 边框。不要点阵 shader（Three 依赖、也过度）。卡片进入视口才挂监听。减少动态：只保留边框色变化。
- **成本与风险**：中。风险：10 张卡同时挂 `mousemove` 会拖慢；用事件委托到网格容器 + 只更新当前卡。

### 2.17 glowing-effect ★★★★ — 边框光晕（card-spotlight 的轻量替代）

- **视觉**：卡片边框上有一段彩虹状光晕随指针绕边滑动，并只在高亮区内发光。
- **实现**：监听指针与卡片中心的距离，超过 `inactiveZone` 且小于 `proximity` 时激活；用 `repeating-conic-gradient` 做 `--gradient`，`mask` 裁到边框宽度（`--glowingeffect-border-width`），`--blur` 做柔化，`duration: movementDuration` 过渡。
- **关键参数（原值）**：`blur=0`、`movementDuration=2`、`borderWidth=1`、`inactiveZone`/`proximity` 可配；`ease: [0.16, 1, 0.3, 1]`；`--repeating-conic-gradient-times: 5`；默认彩色 `--gradient` = 4 个 radial-gradient（`#dd7bbb` / `#d79f1e` / `#5a922c` / `#4c7894`，均在 10–20% 内渐隐）+ `repeating-conic-gradient(from 236.84deg at 50% 50%, ...)`；`variant==="white"` 时退化为纯黑白 conic。
- **本站改编**：**比 card-spotlight 更适合本站**：只发光边框、不糊内层，更接近"精密展具"。改 `--gradient` 为 accent→银灰的低饱和 conic，`blur 4–6px`、`borderWidth 1px`、`movementDuration 2.5s`；用于目录卡片与详情侧栏卡片。它是纯 mask 方案，比 spotlight 便宜。
- **成本与风险**：中。风险：conic-gradient + mask 在 Safari 的合成路径需实测；给 `will-change: transform` 会适得其反（mask 变化不吃 transform）。

### 2.18 3d-card-effect ★★★☆ — 卡片倾斜 + 分层景深

- **视觉**：卡片随指针 3D 倾斜，卡内标题/图片按 `translateZ` 浮在不同高度，倾斜时产生真实视差。
- **实现**：容器 `perspective:1000px`；`mousemove` 用 `(clientX - left - width/2)/25` 得 rotateY/X（500px 宽卡约 ±10°，1000px 约 ±20°）直接写 `style.transform`；子元素通过 `CardItem` 设置 `translateZ`，并在 hover 时把 `translateZ` 归零再回弹（过渡 200ms）。
- **关键参数（原值）**：位移除数 `25`；`containerRef.current.style.transform = rotateY(x) rotateX(y)`；`perspective:1000px`；`transition-all duration-200 ease-linear`；demo 层深 `translateZ="50"/"60"/"100"`、`rotateX={20} rotateZ={-10}`。
- **本站改编**：目录卡片。倾斜幅度压到 **±3–4°**（除数改 120–150）、层深只保留两层：标题 `translateZ(18px)`、封面 `translateZ(0)`；`perspective 1200px`；离开时 260ms `--ease-out` 回位。移动端禁用。减少动态：不倾斜。
- **成本与风险**：低。风险：`translateZ` 分层会让封面图在边缘溢出/模糊，需 `overflow:hidden` + `backface-visibility` 处理。

### 2.19 glare-card ★★★ — 金属反光卡

- **视觉**：深色金属卡，指针移动时表面出现一道彩虹反光和斜向拉丝，像展品铭牌。
- **实现**：全部用 CSS 变量：`--m-x/--m-y`（光斑位置）、`--r-x/--r-y`（旋转）、`--bg-x/--bg-y`（背景偏移）；`background-blend-mode: hue,hue,hue,overlay` 叠 4 层（彩虹、斜纹、光泽、遮罩）；指针事件里改变量，过渡 300ms。
- **关键参数（原值）**：`--duration:300ms`、`--easing:ease`、`--radius:48px`、`--step:5%`；`--rainbow: repeating-linear-gradient(0deg, rgb(255,119,115) ... rgb(255,119,115) calc(var(--step)*7)) 0% var(--bg-y)/200% 700% no-repeat`；`--diagonal: repeating-linear-gradient(128deg,#0e152e 0%,hsl(180,10%,60%) 3.8%...)`；旋转系数 `rotateFactor=0.4`，`rotate.x = -(delta.x/3.5)`、`rotate.y = delta.y/2`，`background.x = 50 + pct.x/4 - 12.5`、`background.y = 50 + pct.y/3 - 16.67`。
- **本站改编**：只用在详情页封面或"作品铭牌"卡。彩虹饱和度必须砍掉：换成 accent↔silver 的 2 色斜纹 + 白色 6% 光泽；旋转减半。**注意**：它与本站"不用低透明度堆叠制造高级感"的规范有张力，只在 1 个元素上用。
- **成本与风险**：低。风险：`background-blend-mode` 在移动端 GPU 上偶发闪烁；提供不支持时的纯色降级。

### 2.20 focus-cards ★★★★ — 聚焦式卡片墙

- **视觉**：指针悬停某张卡时，其余卡片立刻虚化并轻微缩小，被悬停的那张保持清晰、底部浮出标题。
- **实现**：纯 CSS。`hovered` 状态写在卡片上，非当前卡加 `blur-sm scale-[0.98]`；标题层 `opacity` 从 0 到 1；全部 300ms。
- **关键参数（原值）**：`transition-all duration-300 ease-out`；非聚焦 `blur-sm scale-[0.98]`；标题 `transition-opacity duration-300`、`hovered===index` 时 `opacity-100`；卡片 `h-60 md:h-96`、`rounded-lg`。
- **本站改编**：`/works` 首排"一大一小"两张卡用，或整个网格用但把 `blur` 降到 2px、`scale` 降到 .985、其余卡同时 `opacity .55`；标题浮出改成本站展签（中文名 + 编号 + 城市）。移动端改为点击选中。减少动态：只做透明度。
- **成本与风险**：低。风险：整墙 blur 对 GPU 有成本（10 张卡同时模糊）；限制到 6 张以内或只对相邻卡模糊。

### 2.21 lens ★★★★ — 封面放大镜

- **视觉**：指针移到封面上时出现一个圆形放大镜，镜内是放大 1.5 倍的同一张图，边界柔和。
- **实现**：克隆 children 放进一个 `absolute inset-0` 层，`mask-image: radial-gradient(circle lensSize/2 at x y, black 100%, transparent 100%)`，内层 `transform: scale(zoomFactor)` 且 `transform-origin` 同指针；进入/退出 `scale .58→1 / .8`，0.3s easeOut。
- **关键参数（原值）**：`zoomFactor=1.5`、`lensSize=170`（半径 85px）；`maskImage: radial-gradient(circle 85px at Xpx Ypx, black 100%, transparent 100%)`；`transformOrigin: Xpx Ypx`；`initial {opacity:0, scale:0.58} animate {opacity:1, scale:1} exit {opacity:0, scale:.8} transition {duration:.3, ease:"easeOut"}`。
- **本站改编**：详情页封面（模型截图）"局部放大看细节"，`lensSize 140–160`、`zoomFactor 1.6`；遮罩边缘加 1px accent 圆环，更像观察镜。触屏改成"长按放大"。减少动态：不做放大镜，直接可点击查看大图（站点已有放大查看，注意不要重复功能）。
- **成本与风险**：低。风险：克隆节点里若含 canvas/视频会重复渲染；只对 `<img>` 封面使用。

### 2.22 container-scroll-animation ★★★★★ — 观看器入场

- **视觉**：滚动时一个"屏幕/展柜"从后仰 20° 慢慢抬正、放大到 1、同时上移，带一层柔和长阴影，完成时像展品被放进展台。
- **实现**：`useScroll` 取容器进度，`useTransform` 把进度映射到 `rotateX 20→0`、`scale 1.05→1`（移动端 .7→.9）、`translateY 0→-100`；容器 `perspective:1000px`；卡片带多层 box-shadow。
- **关键参数（原值）**：`rotate [20, 0]`、`translate [0, -100]`、桌面 `scale [1.05, 1]` / 移动 `[0.7, 0.9]`；`perspective:1000px`；容器高 `h-[60rem] md:h-[80rem]`；卡片 `rounded-[30px] border-4 border-[#6C6C6C] p-2 md:p-6 bg-[#222222]`；阴影 `0 9px 20px #0000004a, 0 37px 37px #00000042, 0 84px 50px #00000026, 0 149px 60px #0000000a, 0 233px 65px #00000003`。
- **本站改编**：**最高优先级**。详情页观看器/封面入场：外壳 `rotateX 12→0`、`scale .965→1`、`y 22→0`，600–800ms `--ease-out`，阴影用现有 `--shadow` 加深一档；关键是**只转外壳不转 canvas**，且必须在真实首帧就绪后才开始，避免转场中看到空画面。如果按滚动驱动，则在观看器首次进入视口时一次性触发（不要持续 scrub，太晃）。
- **成本与风险**：低。风险：对大尺寸 WebGL 容器做 3D transform 会触发昂贵的合成；外壳和 canvas 分层（`transform-style` 隔开），或只对封面图做 rotateX，canvas 淡入。

### 2.23 parallax-scroll ★★★★ — 多列视差

- **视觉**：多列卡片在滚动时以不同速度上下移动，形成纵深（中列慢、两侧反向）。
- **实现**：`useScroll({target})` 取进度，三列分别 `y: [0,-200] / [0,200] / [0,-200]`。
- **关键参数（原值）**：`translateFirst [0,-200]`、`translateSecond [0,200]`、`translateThird [0,-200]`；容器 `grid md:grid-cols-2 lg:grid-cols-3 gap-10 py-40 px-10`；第二版还有 `rotateZ [0,-20] / [0,20]`、`x [0,±200]`。
- **本站改编**：`/works` 目录若非严格网格（首排一大一小），可给左右两列 ±30–40px 的视差（原值 200 太大，会让"展签"变成"贴纸"）；用 `scrub` + `--ease-out`，避免旋转。减少动态：全部归零。
- **成本与风险**：低。风险：视差与滚动揭示（v2.0 已有 IntersectionObserver）叠加时容易"抢拍"；让视差只作用于 `transform: translate3d` 的包装层，揭示仍在卡片层。

### 2.24 sticky-scroll-reveal ★★★ — 左定右滚

- **视觉**：左侧大图固定，右侧文字随滚动逐段高亮，当前段落不透明、其余 30%。
- **实现**：`useMotionValueEvent(scrollYProgress)` 按阈值设置 `activeCard`；左列 `sticky top-10`，右列每段 `opacity: active ? 1 : 0.3` 且 `y` 轻微位移。
- **关键参数（原值）**：`opacity: activeCard===index ? 1 : 0.3`；进入 `initial {opacity:0}` → `animate {opacity:1}`；左列 `sticky top-10 hidden lg:block`；背景渐变 `#06b6d4→#10b981`、`#ec4899→#6366f1`、`#f97316→#eab308`。
- **本站改编**：详情页正好是"左看右读"：左观看器可以 sticky，右侧信息分段在当前段时 100%、其余 30–50%，并给一条 1px accent 进度线。不要用它的彩色渐变背景（与深色规范冲突）。
- **成本与风险**：低。风险：观看器 sticky + WebGL 在滚动中持续渲染；滚出视口时降帧或暂停。

### 2.25 tracing-beam ★★★★ — 索引/进度光束

- **视觉**：一条竖线贴着内容左缘，线上有一段 200px 的发光渐变随滚动下移，长度随滚动速度变长。
- **实现**：按内容高度生成 SVG 路径（`M 1 0 V -36 l 18 24 V 0.8H l -18 24 V H`），两个 `useSpring(useTransform(...))` 控制 `linearGradient` 的 `y1/y2`；底色路径 `strokeOpacity .16`，亮色路径 1.25px 渐变。
- **关键参数（原值）**：`y1 = spring(transform(progress, [0,.8], [50, svgHeight]), {stiffness:500, damping:90})`；`y2 = spring(transform(progress, [0,1], [50, svgHeight-200]), {stiffness:500, damping:90})`；渐变 `#18CCFC (0%) → #6344F5 (32.5%) → #AE48FF (100%)`；路径 `M 1 0V -36 l 18 24 V ${h*0.8} l -18 24V ${h}`；顶部圆点 `#10b981` → 滚动后变白。
- **本站改编**：`/works` 索引区左侧或详情信息列的进度线；渐变换 `#54C8C1 → #C6E2E6`，`svgHeight-200` 改 `-120`（区段更短），spring 保留 500/90；顶部圆点用 accent。v2.0 已有 `stroke-dashoffset` 的连接线，可把这条作为"目录页纵向时间轴"的新增层。
- **成本与风险**：中。风险：弹簧 + 每帧改 SVG 渐变坐标，需限制只在该区块可见时更新。

### 2.26 指针类：following-pointer / pointer-highlight / svg-mask-effect ★★★☆

- **following-pointer**：指针变成小箭头 + 跟手的标签气泡；`useMotionValue` 驱动，进入时 `scale 1/opacity 1`，离开 `scale 0/opacity 0`；标签底色从 7 种随机色里取。→ **本站替代**：不要替换系统指针（可访问性/触屏）；只在卡片 hover 时用"跟随的小标签（查看 / 展开）"，标签固定 accent 底色，`scale .5→1`。
- **pointer-highlight**：文字进入视口后，先出现一个描边框从 0 长到文字尺寸（`duration:1, ease:"easeInOut"`），四个角出现 L 形指针（`x:width+4, y:height+4, rotate:-90`，`duration:.1`）。→ **本站用法**：首页 eyebrow 或详情"作品信息"标题的入场，1s 太长，压到 520–640ms；用 1px `--color-line` 边框 + accent 角标。
- **svg-mask-effect**：`mask-image: url(/mask.svg)`，`mask-size: 40px`，指针所在处 `mask-size` 从 `10px` 放大到 `revealSize=600`，露出底层另一张图；`maskPosition` 跟指针，过渡 `mask-size .3s easeInOut` / `maskPosition .15s linear`。→ **本站用法**：详情封面 hover 揭示线框/参数层；本站不必放 mask.svg，改用径向遮罩即可，`revealSize 420–520`。

---

## §3 借鉴清单 Top 10（按"提升高级感的杠杆"排序）

| # | 组件 | 放哪里 | 为什么能提升高级感 | 改动量 | 主要风险 |
| --- | --- | --- | --- | --- | --- |
| 1 | spotlight-new | 首页 hero 左右 | 给画面一个"光源"，立刻从扁平 UI 变成有布光的展厅 | 小（2 层渐变 + GSAP yoyo） | 移动端大面积渐变掉帧 |
| 2 | container-scroll-animation | 详情观看器入场 | 3D 抬正 + 长阴影是"展品上台"的仪式感，详情页第一印象 | 小（外壳 transform） | 大 canvas 3D 合成开销 |
| 3 | lamp-effect | `/works` 页头 | 线性灯管 + 标题升起，替代现在"标题直接出现"的平淡 | 中（conic + blur 分层） | 多层 blur 在手机贵 |
| 4 | card-spotlight（轻量版用 glowing-effect） | `/works` 卡片 | 指针光斑让卡片有"被照亮"的材质感，且是局部更新不脏 | 中（mask + rAF） | 多卡监听拖慢 |
| 5 | moving-border | 首页主 CTA | 一圈缓慢的光让 CTA 从"一个按钮"变成"展签的呼吸灯" | 小（SVG + rAF） | 需出屏暂停 |
| 6 | text-generate-effect | 首页副标题 / 详情摘要 | 逐词模糊入场是最便宜的高级感，且 700ms 内完成 | 小（GSAP stagger） | 中文分词与换行 |
| 7 | magnetic-button | 主 CTA / 开始预览 | 微磁吸提升"精致度"，但幅度必须 ≤10px | 小 | 幅度过大会廉价 |
| 8 | tracing-beam | `/works` 索引 / 详情进度 | 一条随滚动推进的光束，把"浏览"变成"沿着档案走" | 中（SVG 渐变 + spring） | 每帧改渐变 |
| 9 | focus-cards | `/works` 首排两卡 | 悬停聚焦、其余退后，是展厅导览的观看关系 | 小（CSS） | 整墙 blur 成本 |
| 10 | lens | 详情封面 | 局部放大看细节，符合"模型展厅"的功能语义 | 小（mask + scale） | 与已有放大查看重复 |

**备选（第二批）**：spotlight（地球后光锥）、background-beams（`/works` 坐标线，≤12 条）、parallax-scroll（±40px）、svg-mask-effect（封面揭示）、3d-card-effect（±3° 倾斜）、flip-words（英文微标签）、grid-and-dot（零成本底纹，建议随手加）。

**落地顺序建议**：第 1 批 = 2.7 底纹 + 2.2 hero 光带 + 2.10 副标题 + 2.16 卡片光斑 + 2.13 CTA（都是小改动、无新依赖）；第 2 批 = 2.22 观看器入场 + 2.3 目录页头 + 2.25 索引光束；第 3 批 = 指针类细节与 2.21/2.19。

---

## §4 明确不采用清单与理由

| 组件 | 不采用理由 |
| --- | --- |
| vortex | 700 粒子漩涡 + blur(8px) brightness(200%) 的 canvas 全屏重绘；与"空间地理档案"的秩序感冲突，像 AI 产品落地页。 |
| wavy-background | 彩色波浪 canvas 背景，饱和度与本站深色克制调性相反；成本中高。 |
| meteors | 斜线下坠的流星群是通用 SaaS 装饰，和地球/城市叙事无关；本站已有真实地球+星点。 |
| background-boxes | 斜切彩色方块像开发者工具，与展签版式冲突。 |
| sparkles（原方案） | 需要 tsparticles 新依赖；本站可用 Three 星点层或 CSS 点阵替代。 |
| 3d-globe / github-globe | 本站已有真实彩色地球 + 云层 + 城市气泡，重复且会抢主场景；引入 react-globe.gl/three 大包不划算。 |
| aurora-background | 大面积 blur + mix-blend-difference，移动端贵；且会破坏 #080D12 的干净底色（除非只做小面积加载态）。 |
| macbook-scroll / keyboard / terminal | 设备拟物，与本项目"低空视界"的空间叙事无关，成本高。 |
| apple-cards-carousel / images-slider | 横向大图轮播会削弱"展览式目录"的静态陈列感，也与现有路由/卡片体系重复。 |
| ascii-art / dither / pixelated-canvas / webcam-pixel-grid / cloud-shader / chromatic-image | WebGL/Canvas 重绘成本高，风格偏"实验/复古"，不适合作为常态界面。 |
| liquid-glass / gooey-input | 折射玻璃与 gooey 滤镜都属"过度材质"，与规范"不扩大玻璃面积、不用低透明度堆字"冲突。 |
| animated-testimonials / card-stack / animated-modal / draggable-card | 与本站信息架构（作品目录、详情左看右读）不匹配，或与已有的菜单/面板重复。 |
| floating-dock / sidebar / notch / floating-navbar / resizable-navbar | 导航已定稿为公开导航 + 手机导航；再引入第二套导航形态会打架。 |
| 3d-marquee / infinite-moving-cards / container-cover | 跑马灯类持续循环违反 v2.0"不增加装饰性循环"；如确需 logo/合作墙再议。 |
| compare | 图片对比滑块对本站无对应内容（没有前后对比素材），且与观看器功能重叠。 |
| timeline / bento-grid / layout-grid / layout-text-flip | 版式与交互方案与现有目录/详情结构冲突，改造成本高、收益低。 |
| text-flipping-board / typewriter / encrypted-text / squiggly-text / colourful-text | 文字特效偏"玩梗"，与展览语言的克制不符；最多可用于加载/错误态的极小面积。 |
| noise-background / comet-card / wobble-card / card-hover-effect | 可作为"卡片光效"的备选，但优先级低于 2.16/2.17，且同时上会风格重复。 |
| globe/loader 类通用加载组件 | 本站加载态已有 shimmer 与状态规范，不引入第二套。 |

> 说明：**不采用 ≠ 不好**。多数是与本站"深色空间地理展厅"的叙事、成本或已有实现冲突；如后续页面形态变化（例如新增"关于/数据"页），部分组件可重新评估。

---

## §5 来源链接

- 站点地图（118 个组件）：<https://ui.aceternity.com/sitemap.xml>
- 组件总览：<https://ui.aceternity.com/components>
- 深读组件页面（与 §2 编号对应）：
  - <https://ui.aceternity.com/components/spotlight>
  - <https://ui.aceternity.com/components/spotlight-new>
  - <https://ui.aceternity.com/components/lamp-effect>
  - <https://ui.aceternity.com/components/background-beams>
  - <https://ui.aceternity.com/components/aurora-background>
  - <https://ui.aceternity.com/components/dotted-glow-background>
  - <https://ui.aceternity.com/components/grid-and-dot-backgrounds>
  - <https://ui.aceternity.com/components/sparkles>
  - <https://ui.aceternity.com/components/shooting-stars-and-stars-background>
  - <https://ui.aceternity.com/components/text-generate-effect>
  - <https://ui.aceternity.com/components/flip-words>
  - <https://ui.aceternity.com/components/text-reveal-card>
  - <https://ui.aceternity.com/components/moving-border>
  - <https://ui.aceternity.com/components/hover-border-gradient>
  - <https://ui.aceternity.com/components/magnetic-button>
  - <https://ui.aceternity.com/components/card-spotlight>
  - <https://ui.aceternity.com/components/glowing-effect>
  - <https://ui.aceternity.com/components/3d-card-effect>
  - <https://ui.aceternity.com/components/glare-card>
  - <https://ui.aceternity.com/components/focus-cards>
  - <https://ui.aceternity.com/components/lens>
  - <https://ui.aceternity.com/components/container-scroll-animation>
  - <https://ui.aceternity.com/components/parallax-scroll>
  - <https://ui.aceternity.com/components/sticky-scroll-reveal>
  - <https://ui.aceternity.com/components/tracing-beam>
  - <https://ui.aceternity.com/components/following-pointer>
  - <https://ui.aceternity.com/components/pointer-highlight>
  - <https://ui.aceternity.com/components/svg-mask-effect>
  - <https://ui.aceternity.com/components/3d-pin>
  - <https://ui.aceternity.com/components/world-map>
- 站内依据：`UI设计/动效设计v2.0.md`、`UI设计/UI优化设计.md`、`UI设计/视觉规范v1.0（深色）.md`、`frontend/src/styles/tokens.css`
