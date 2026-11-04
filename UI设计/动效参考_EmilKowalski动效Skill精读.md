# 动效参考 · Emil Kowalski 动效 Skill 精读

> 来源：B 站视频 BV1z2uH6XEbC《用了这个skill，我的动画丝滑的像——！》（49 秒）简介唯一链接 → [emilkowalski/skills](https://github.com/emilkowalski/skills)。
> 本文是该仓库中全部与 Web 动效相关 skill 的精读 + 本项目落地清单，不是视频笔记。视频本身只是"把 skill 装进 agent"的演示，真正的方法是仓库里的规则与数值。
> 抓取日期：2026-10-29。抓取方式见 §13。

**一句话结论**：这套库的价值不在"更多动画"，而在三件事——**先判断该不该动（大量请求的正确答案是不动）**、**用固定数值表代替审美猜测**、**把"跟手 / 可打断 / 退出与进入不对称"当作硬指标**。它同时给了三套工作流：构建（animate）、评审（review-animations）、审计改计划（improve-animations）。

---

## 1. 这个库是什么、怎么装、怎么触发

- 作者 Emil Kowalski：Sonner（toast，13M+ 周下载）、Vaul（drawer）、animations.dev 作者，前 Vercel / Linear 设计工程师。
- 定位：不是组件库，而是 **SKILL.md 形式的"专家判断力"**，给 AI agent（Claude Code / Codex / Cursor 等支持 skills 的工具）加载。仓库 README 的原话大意：agent 没有品味，会选错动效配料（入场用 `ease-in`、该用半透明阴影却用实线边框），这些小事会复利成"手感完全不同的产品"。
- 安装：`npx skills@latest add emilkowalski/skills`。装完后 skill 按各自 frontmatter 的 `description` 被 agent 自动匹配触发；`review-animations` 标了 `disable-model-invocation: true`，即**只能由人显式调用**（避免模型自说自话给自己打分）。
- 三个备忘单（`ui-cheatsheet.md`、`performance-cheatsheet.md`）是纯表格速查，`README.md` 是索引与安装说明。

### 1.1 skill 分工（哪些与动效相关）

| skill | 干什么 | 什么时候用 | 产出 |
| --- | --- | --- | --- |
| `emil-design-eng` | 主 skill：动效决策框架 + 组件原则 + 设计品味 | 想一次拿到"完整设计工程观" | 建议 + 代码 |
| `animate` | 从零构建一个动效：按固定顺序做 7 个决策并写实现 | "给某物加动效/做转场" | 代码 |
| `animate-expo` | 同标准，React Native / Expo（手势、sheet、触感、屏幕转场、不上 JS 线程） | 移动原生 | 代码 |
| `review-animations` | 按 10 条硬标准严格评审动效代码，默认"先挑刺" | 评审 diff / 单个组件 | Before/After/Why 表 + Block/Approve |
| `improve-animations` | 只读扫描全库动效，出按收益排序的审计表 + 自包含实施计划 | "让整个 app 手感变好" | `plans/NNN-*.md` |
| `find-animation-opportunities` | 找"该动却没动"的地方，同时否掉大多数候选 | "这里能不能加动效？" | 机会表 + 被否候选（必须写） |
| `remove-animations` | 反过来：删掉不需要的动画，只做减法 | "感觉太乱/太慢" | 删除/降级清单 |
| `animation-performance` | 掉帧诊断与属性选择 | 卡顿、选择属性、决定 CSS/JS | 归因报告 |
| `animation-vocabulary` | 反向词典：把"那种弹一下"翻译成精确术语 | 写 prompt / 跟设计师沟通 | 术语 + 定义 |
| `apple-design` | Apple WWDC 流体交互原则的 Web 翻译：响应、1:1、可打断、spring、速度投射 | 手势、sheet、拖拽、高级手感 | 原则 + 具体参数 |
| 其他（非动效主体） | `pick-ui-library`、`prototype`、`mobile-native`、`break-ui`、`ask-sonner`、`write-swift` | 选库 / 原型 / 移动端细节 / 极端数据 | — |

> 与本项目的关系：动效主体用 `animate` + `review-animations`；要系统性改造用 `improve-animations`；`apple-design` 是地球拖拽/镜头的手感依据；`animation-performance` 是 Three.js 场景旁边 DOM 动效的验收依据。

---

## 2. 核心：七步构建序列（`animate` skill 的骨架）

**硬规则（原文五条，照做）**

1. 顺序执行，第 1、2 步是**闸门**；没过闸门不许碰曲线。
2. 不许近似：曲线、时长、spring 参数必须来自数值表，禁止"看起来差不多"地手写 `cubic-bezier(0.4, 0, 0.2, 1)`。
3. 扩展代码库已有 token，不许另起一套平行体系（"adding a parallel system is a defect"）。
4. `prefers-reduced-motion` 与 hover 门控**随动画一起交付**，不许当后续任务。
5. 用最便宜的工具：一个淡入不值得装动效库。

### 2.1 第 1 步：该不该动（频率闸门）

| 频率 | 决策 |
| --- | --- |
| 100+ 次/天（键盘快捷键、命令面板开关） | **不动画，永远。** 到此为止 |
| 几十次/天（hover、列表导航） | 只能做"几乎察觉不到"的：快且微弱，或者干脆没有 |
| 偶尔（modal、drawer、toast） | 标准动效 |
| 罕见/首次（onboarding、成功、庆祝） | 唯一的"愉悦预算"所在 |

键盘触发的动作是**取消资格**，不是"看情况"：Raycast 的打开/关闭就没有动画，那对一天开几百次的东西是正确体验。

### 2.2 第 2 步：目的是什么（必须能命名，否则不做）

六个合法目的：**Feedback**（确认听到了）、**Spatial consistency**（从哪来往哪去）、**State indication**（状态变化可读）、**Preventing a jarring change**（接住原本会瞬移的内容）、**Explanation**（演示功能，仅营销/引导）、**Delight**（仅限罕见/首次档）。
再加一道**功能**检查：用户正在读或操作的数据不该为了好看而动（银行 app 的图表上不做鼠标跟踪装饰）。

### 2.3 第 3 步：选工具（从便宜到贵，命中即停）

| 需求 | 工具 |
| --- | --- |
| hover、按压、颜色、用 class/属性控制的状态切换 | **CSS transition** |
| 挂载入场、无 JS 状态 | **CSS `@starting-style`** |
| 预定好的动作、页面在忙时也必须顺滑 | **CSS animation**（跑在主线程之外） |
| 需要 JS 控制但要 CSS 性能、不引库 | **WAAPI**（`element.animate()`） |
| spring、布局动画、退出动画、手势驱动值 | **Motion**（motion.dev） |

原则：**预定的动作用 CSS，动态/可打断的动作用 JS**。页面加载/脚本/绘制繁忙时，rAF 驱动的动画会掉帧，CSS 动画不会。
若需求其实是"要一个组件"（toast / drawer / 命令菜单 / dropdown），转 `pick-ui-library`，别手搓。

### 2.4 第 4 步：动哪些属性

- **只动 `transform` 和 `opacity`**（跳过 layout 与 paint，走 GPU）。`width/height/margin/padding/top/left` 三阶段全触发。
- `clip-path` 是被承认的**第四个**动画属性（见 2.8 与 `RECIPES.md`）；`height` 只在 accordion 这种没有 transform 等价物的场景被容忍。
- **永远不要 `scale(0)`**：入场从 `scale(0.9–0.97)` + `opacity: 0`。现实里没有东西从"无"里长出来。
- **`transform-origin` 对准触发器**（popover / dropdown / menu / tooltip），Base UI 里是 `var(--transform-origin)`；**modal 豁免**，它不锚定触发器，保持居中。
- `translate()` 里的 **百分比相对元素自身尺寸**（`translateY(100%)` = 自身高度），优先于硬编码 px。
- 用 Motion 时**写完整 transform 字符串**：`x/y/scale` 简写不是硬件加速的。
- **不要用父级 CSS 变量驱动子元素 transform**（见 §8.3）。

### 2.5 第 5 步：缓动与时长（或 spring）

缓动决策顺序：

| 场景 | 缓动 |
| --- | --- |
| 进入/退出 | `ease-out` |
| 屏幕上移动/形变 | `ease-in-out` |
| hover / 颜色变化 | `ease` |
| 匀速运动（marquee、进度） | `linear` |
| 默认 | `ease-out` |

**UI 里永远不要 `ease-in`**：它开头慢，恰好拖慢用户最关注的那一刻。`ease-out` 200ms 在体感上比 `ease-in` 200ms 更快。
CSS 内置缓动太弱，用强曲线（三条 token）：

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);        /* 强 ease-out，UI 默认 */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);    /* 强 ease-in-out，屏上位移 */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);     /* iOS 抽屉曲线（Ionic） */
```

需要别的曲线去 [easing.dev](https://easing.dev/) / [easings.co](https://easings.co/) 抄，别手搓。

时长表：

| 元素 | 时长 |
| --- | --- |
| 按钮按压反馈 | 100–160ms |
| Tooltip、小 popover | 125–200ms |
| Dropdown、select | 150–250ms |
| Modal、drawer | 200–500ms |
| 营销/讲解 | 可以更长 |

**UI 动效一律 < 300ms**：180ms 的 dropdown 比 400ms 更"灵敏"。

**该用 spring 而不是 duration 的四种情况**：带惯性的拖拽；应该"活"的元素（Dynamic Island）；用户能打断/反向的手势；装饰性鼠标跟踪。

```js
{ type: "spring", duration: 0.5, bounce: 0.2 }            // Apple 式，易推理（推荐）
{ type: "spring", mass: 1, stiffness: 100, damping: 10 }   // 传统物理，控制更细
```

bounce 保持 **0.1–0.3**；大多数 UI 不要 bounce，留给 drag-to-dismiss 和俏皮交互。

### 2.6 第 6 步：打断与退出

- **快速触发的东西用 transition，不用 keyframes**：transition 从当前值重定向，keyframes 从零重播。toast、toggle、一秒内能点两次的任何东西都属此列。
- **手势用 spring**：它携带速度穿过打断点。
- **从哪进就从哪出**：底部滑入的 toast 从底部离开。对称路径让"滑动关闭"变得可预期。
- **非对称时长**：用户做决定的阶段慢（长按确认 2s linear），系统响应阶段快（松手 200ms ease-out）。

### 2.7 第 7 步：减少动态 + 指针门控（每次都要随动画交付）

```css
@media (prefers-reduced-motion: reduce) {
  .element { animation: fade 0.2s ease; } /* 保留 opacity/颜色，去掉 transform 位移 */
}
@media (hover: hover) and (pointer: fine) {
  .element:hover { transform: scale(1.05); } /* 触屏点击会误触发 hover */
}
```

```jsx
const reduce = useReducedMotion();
const closedX = reduce ? 0 : '-100%';
```

**Reduced motion = 更少更轻，不是归零**：保留帮助理解的过渡，去掉位移与位置变化。

### 2.8 常用配方（`RECIPES.md` 原值，可直接抄）

| 组件 | 关键代码/数值 | 要点 |
| --- | --- | --- |
| 按钮按压 | `transition: transform 160ms var(--ease-out)` + `:active { transform: scale(0.97) }` | `scale()` 会带着文字/图标一起缩，才有"按下去"的物理感；`:active` 在触屏上是真实按压，不用门控 |
| Dropdown/Popover | `transform-origin: var(--transform-origin)`；`opacity 200ms` + `transform 200ms` 同曲线；起止态 `opacity: 0; transform: scale(0.95)` | 面板要像从被点的东西里长出来 |
| Tooltip | 125ms；`scale(0.97)`；`[data-instant] { transition-duration: 0ms }` | 首个延迟防误触；之后同组 tooltip 全部瞬时，工具栏整体变快 |
| Modal | 250ms；`transform-origin: center`；起止 `scale(0.96)`；backdrop 一起做 opacity | 唯一保持居中的"popover"；backdrop 与面板要像一个表面 |
| Drawer/Sheet | `transform: translateY(100%)` 隐藏；`500ms var(--ease-drawer)` | Vaul 的做法；加拖拽就变成手势问题（见 §9） |
| Toast | `opacity/transform 400ms ease`（**注意是 `ease` 不是 `ease-out`**）+ `@starting-style { opacity: 0; translateY(100%) }` | Sonner 略慢、略优雅，是"组件人格"校准过的；无 `@starting-style` 时用 `data-mounted` + `useEffect` 兜底 |
| Accordion | `height 200ms var(--ease-out)` + `opacity 200ms`；JS 量高度，不要动画到 `auto` | 少数每帧都要 layout 的动画，所以必须短 |
| 列表 stagger | 每项 `opacity: 0; translateY(8px)`；`300ms var(--ease-out) forwards`；第 2/3/4 项 `50/100/150ms` | 错峰是装饰，播放时不能阻塞交互 |
| 长按确认 | 按下 `clip-path 2s linear`（进度不缓动），松手 `200ms var(--ease-out)`；按钮 `scale(0.97)` | `linear` 在这里是对的，因为它是进度条 |
| Tab 指示器 | 复制一份"激活态"tab 列表，用 `clip-path: inset(0 60% 0 20%)` 裁剪并 `250ms var(--ease-in-out)` | 文字与底色作为一个元素同步揭示，颜色分别补间永远对不齐 |
| 滚动揭示 | `clip-path: inset(0 0 100% 0)` → `inset(0 0 0 0)`，`600ms var(--ease-in-out)`；`IntersectionObserver` 或 `useInView({ once: true, margin: "-100px" })` | **仅营销页**；只播一次 |
| 拖拽关闭 | 速度判定 `Math.abs(swipeAmount) / timeTaken > 0.11` 也可关闭；spring `duration 0.5, bounce 0.2` | 见 §9 的四个细节 |
| 遮不住的 crossfade | 过渡期 `filter: blur(2px)` + `opacity: 0.7` | 模糊把"两个物体交换"读成"一个物体变化"；blur < 20px |
| 无库编程式 | `element.animate([...], { duration: 1000, fill: 'forwards', easing: 'cubic-bezier(0.77, 0, 0.175, 1)' })` | WAAPI：可硬件加速、可打断、零包体 |

---

## 3. 数值总表（Emil 原值，照抄，不要近似）

### 3.1 时长

| 场景 | 值 | 出处 |
| --- | --- | --- |
| 按钮按压 | 100–160ms（配方用 160ms） | animate SKILL §5 / RECIPES |
| Tooltip / 小 popover | 125–200ms（配方 tooltip 125ms、popover 200ms） | 同上 |
| Dropdown / select | 150–250ms | 同上 |
| Modal / drawer | 200–500ms（modal 250ms、drawer 500ms） | 同上 |
| Toast（Sonner 式） | 400ms `ease` | RECIPES |
| Accordion | 200ms | RECIPES |
| 列表 stagger 单项 | 300ms + 每项 50ms | RECIPES |
| Tab 指示器 | 250ms | RECIPES |
| 滚动揭示 | 600ms | RECIPES |
| 长按确认 | 按下 2s `linear` / 松手 200ms `ease-out` | RECIPES |
| **UI 上限** | **< 300ms** | 多文件一致 |
| 进场（开场叙事） | 项目文档另定 1.2–1.6s（见 §11.4） | 项目文档 |

### 3.2 缓动

| token | 值 | 用途 |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | 进/出、默认 |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | 屏上移动/形变、clip 揭示 |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | 抽屉 |
| `ease` | CSS 原生 | hover/颜色、toast（Sonner 刻意） |
| `linear` | — | 进度、marquee、长按填充 |
| 禁止 | `ease-in` | 任何 UI 交互 |

### 3.3 幅度与位移

| 场景 | 值 |
| --- | --- |
| 按压反馈 | `scale(0.97)`，可接受区间 **0.95–0.98** |
| 入场初始缩放 | **0.9–0.97** + `opacity: 0`（popover 0.95 / tooltip 0.97 / modal 0.96） |
| 入场位移 | `translateY(8px)`（列表项）或 `translateY(100%)`（自身高度，toast/drawer） |
| hover 抬起 | 项目取 `translateY(-3px)`（小幅度是对的） |
| hover 图片缩放 | 项目取 `scale(1.025)`（Emil 示例用 `scale(1.05)`，属同量级） |
| 开场导航位移 | 项目 `y: -12`（`GlobeExperience.tsx:518` 附近） |
| 气泡退出位移 | 项目 `y: 6`（`GlobeExperience.tsx:276`） |
| blur 过渡 | **< 20px**；2–5px 足够软化 crossfade |

### 3.4 Spring 参数

| 方案 | 值 | 说明 |
| --- | --- | --- |
| Apple 式（推荐） | `{ type: "spring", duration: 0.5, bounce: 0.2 }` | 好推理；bounce 0.1–0.3 |
| 传统物理 | `{ type: "spring", mass: 1, stiffness: 100, damping: 10 }` | 控制更细 |
| Apple 默认 UI | damping **1.0**（临界阻尼，无回弹），response（≈duration）**0.3–0.4** | 大多数 UI |
| 有惯性的交互 | damping **0.8**（轻微回弹），response 0.3–0.4 | 只有手势带速度时才回弹 |
| Apple 官方三组 | 移动/重排 1.0 / 0.4；旋转 0.8 / 0.4；drawer/sheet 0.8 / 0.3 | apple-design §4 |
| Motion 写法 | `animate(el, {y:0}, {type:'spring', bounce:0, duration:0.4})`；惯性时 `bounce:0.2` | apple-design §4 |

### 3.5 手势数值

| 项 | 值 |
| --- | --- |
| 速度判定关闭 | `Math.abs(distance) / elapsedMs > ~0.11`（不是只看距离） |
| 方向判定迟滞 | ~10px（项目地球拖拽用 5px，`GlobeExperience.tsx:701`） |
| 松手速度投射 | `project(v, d=0.998) = (v/1000) * d / (1 - d)`；`d` 取 **0.998**（普通滚动感）/ **0.99**（更脆）——**不要用教科书 `v²/(2·decel)`** |
| 速度交接（需要相对速度时） | `relativeVelocity = gestureVelocity / (target − current)` |
| 边界阻尼（rubber-band） | `(overshoot * dimension * 0.55) / (dimension + 0.55 * |overshoot|)` |

### 3.6 性能与帧预算

| 项 | 值 |
| --- | --- |
| 60fps 每帧预算 | **16.7ms**（1000/60） |
| 120Hz 每帧预算 | **8ms**（设计按这个算） |
| 复杂页面一次 layout | 可 > 100ms（= 十几帧） |
| 动画属性 | `transform` / `opacity`（+ 当前 Chrome/Firefox 的 `filter`/`clip-path`/`background-color`） |
| `will-change` | 只在看到 1px 位移或实测掉帧后加；只加在动画元素上，不要 `*` 或大容器 |

---

## 4. 反模式清单（"Never Ship"，评审时每条都是自动 Block）

| 不要 | 改成 |
| --- | --- |
| `transition: all` | 明确列出属性 |
| `transform: scale(0)` 入场 | `scale(0.95)` + `opacity: 0` |
| UI 上用 `ease-in` | `ease-out` 或强自定义曲线 |
| 刻意动效还用 CSS 内置 `ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| 给键盘快捷键 / 100+ 次/天动作加动画 | 不加 |
| UI 时长 > 300ms 且没有理由 | 150–250ms |
| 触发器锚定的 popover 用 `transform-origin: center` | `var(--transform-origin)`（modal 例外） |
| toast / toggle / 快速触发元素用 keyframes | CSS transition |
| 动画 `width/height/margin/padding/top/left` | `transform` / `opacity` |
| 页面繁忙时用 Motion `x/y/scale` 简写 | 完整 `transform` 字符串 |
| 未门控的 `:hover` 动效 | `@media (hover: hover) and (pointer: fine)` |
| 缺 `prefers-reduced-motion` | 更轻的版本，不是没有 |
| 全部元素同时入场 | 30–80ms stagger |

补充红线（散见于 `review-animations` / `animation-performance`）：

- 动画 `box-shadow` / `border-radius` / `color` 属"paint 档"，每帧重绘（`box-shadow` → 用 `filter: drop-shadow()` 或伪元素 opacity 替代）。
- 用父级 CSS 变量驱动子元素 transform（style recalc 风暴）。
- 手势用固定 duration 的 keyframe 补间；拖拽用距离阈值而不是速度判定；边界硬停而不是渐进阻尼。
- 循环动画（pulse/shimmer/glow）挂在常驻元素上；< 300ms 的操作加 spinner / skeleton（闪一下反而像故障）。
- 列表、表格、图表在每次挂载/刷新时重播动画；数字在页面加载时从 0 计数（应只在值变化时动）。
- `transform-origin: center` 与"modal 居中"混淆：modal 是对得，popover 是错得。

---

## 5. 如何验收（`review-animations`）

### 5.1 十条不可协商标准

1. **动效有理由**：能说出是六个目的之一；高频元素上"看着酷"直接 Block。
2. **频率匹配**：键盘/100+ 次一天 = 不动；几十次 = 大幅削减；偶尔 = 标准；罕见 = 可愉悦。
3. **缓动响应性**：进/出 `ease-out` 或强自定义；UI 上 `ease-in` = Block。
4. **UI < 300ms**：超了要么给理由，要么就是 finding。
5. **原点与物理正确**：触发器锚定的面板从触发器长出来；不能 `scale(0)`；modal 例外。
6. **可打断**：快速触发/手势驱动必须是 transition 或 spring，不能 keyframes 从零重播。
7. **GPU 属性**：只 `transform`/`opacity`；Motion 简写在繁忙页面算性能问题。
8. **无障碍**：`prefers-reduced-motion` 做到"更轻不是没有"；hover 动效必须门控。
9. **非对称进出**：用户决策慢、系统响应快；按压/长按用对称时长 = finding。
10. **一致性**：动效符合组件与产品人格；两个状态叠影的 crossfade 该用 2px blur 桥接。

### 5.2 见到就硬 flag 的触发条件（14 条）

`transition: all`；`scale(0)` 或无初始 transform 的纯淡入；UI 上的 `ease-in`；键盘/命令面板/100+ 次动作上的动画；无理由 > 300ms；触发器 popover 的 `transform-origin: center`；toast/toggle 用 keyframes；动画 layout 属性；繁忙期 Motion 简写；父级 CSS 变量驱动子 transform；缺 reduced-motion；未门控 hover；按压/长按进出对称；该 stagger 却一起入场。

### 5.3 修复优先级（从前往后选，前面的永远优于后面的）

1. **删掉**（高频/无目的/键盘触发）
2. **缩小**（更短、更小幅度、更少属性）
3. **修缓动**（`ease-in` → `ease-out`/强曲线）
4. **修原点/物理**（transform-origin；`scale(0)` → `scale(0.95)`+opacity）
5. **改成可打断**（keyframes → transition；手势 → spring）
6. **搬到 GPU**（layout 属性 → transform/opacity；简写 → 完整 transform；程序化用 WAAPI）
7. **非对称时长**（慢决策、快响应）
8. **打磨**（blur 桥接、stagger、`@starting-style`、spring）
9. **无障碍与一致性**（reduced-motion + hover 门控；对齐组件人格）

### 5.4 输出格式（评审必须按这个写）

- **Part 1**：一张 `| Before | After | Why |` 表，一行一个问题，**不许**写成 Before/After 段落列表。
- **Part 2**：按影响分层的结论（手感回归 → 该删/该减 → 性能 → 打断与时序 → 原点与一致性 → 无障碍），结尾给明确裁决：
  - **Block**：任何手感回归、键盘/高频上的动画、UI 上的 `scale(0)`/`ease-in`、有一个"容易改成 GPU 属性"的非 GPU 动画。
  - **Approve**：无手感回归、没有明显该删的动效、时长与缓动在界内、该打断的地方已打断、reduced-motion 成立。
- 每条 finding 必须带 `file:line`；需要数值时从标准表抄，不许近似。

### 5.5 手感无法从代码判断时的四种调试

1. **慢放**：时长临时 ×2–5，或 DevTools Animations 面板降速，看颜色是否平滑、缓动有没有急停、origin 对不对、协同属性是否同步。
2. **逐帧**：Chrome DevTools Animations 面板步进，暴露协同属性的时序漂移。
3. **真机**：手势（drawer、swipe）必须真机，手机连 USB + 按 IP 访问 dev server + Safari 远程调试。
4. **隔天再看**：开发期看不见的瑕疵，第二天一眼就看出来。

### 5.6 本项目 PR 评审可直接勾的清单

- [ ] 新增/改动的动画是否说明"为什么动"（六个目的之一）
- [ ] 是否用了本项目 `--dur-*` / `--ease-*` 令牌（或 `lib/motion.ts` 常量），而不是新数字
- [ ] 是否有 `ease-in`、`transition: all`、`scale(0)`、layout 属性动画
- [ ] hover 是否有 `(hover: hover) and (pointer: fine)` 门控；按压是否有 `:active` 反馈
- [ ] reduced-motion 下是否保留 opacity/颜色反馈（而不是什么都不动）
- [ ] 高频路径（导航、键盘、列表滚动）是否被加了动效
- [ ] 退出是否与进入同路径、且不快于进入
- [ ] 手势路径是否 1:1 跟手、可打断、带速度判定
- [ ] 是否能用 `file:line` 指出每个数值的来源（令牌或本文数值表）

---

## 6. 审计与出计划（`improve-animations`）

- 定位：**只读**代码，产出可直接交给"零上下文、零品味"的弱模型执行的计划；它自己不改代码、不安装、不提交、不格式化。
- 四阶段：**Recon**（栈 / 动效在哪 / 已有 token 约定 / 产品人格 / 频率地图）→ **Audit**（八类并行）→ **Vet & 排序**（按 impact ÷ effort 排序表）→ **写计划**（每 finding 一个 `plans/NNN-slug.md`）。
- 八类审计：① 目的与频率 ② 缓动与时长 ③ 物理与原点 ④ 可打断性 ⑤ 性能 ⑥ 无障碍 ⑦ 一致性与 token ⑧ 遗漏的机会。
- 严重度：**HIGH** = 破坏手感（UI 错缓动、键盘/高频动效、掉帧、`scale(0)`）；**MEDIUM** = 明显不对（原点错、动态 UI 不可打断、缺 reduced-motion）；**LOW** = 打磨（stagger、blur 桥接、token 合并）。
- 力度：`quick`（只查高频组件、~5 条 HIGH）/ `standard`（全交互 UI、≤4 subagent）/ `deep`（含营销页、≤8 subagent、带 LOW 打磨项）。
- 调用变体：`quick/deep`、单类聚焦（`performance`/`accessibility`/`easing`…）、`plan <描述>`、`execute <plan>`（在隔离 worktree 执行，再用 review 标准审 diff）、`reconcile`（对照计划清单核销已完成/刷新 file:line）。
- 计划模板必填：**Problem**（现状代码原文 + `file:line`）、**Target**（精确到曲线/时长/spring/媒体查询，不许"用个更好看的缓动"）、**Repo conventions**（一个可模仿的范例）、**Steps**（一步一处编辑）、**Boundaries**（不许碰什么；与计划不一致时停止并报告）、**Verification**（机械检查 + **Feel check** 必填：慢放、连点、reduced-motion 开关各看什么）、**Done when**。计划要用 `git rev-parse --short HEAD` 打戳；最后维护 `plans/README.md`（编号、严重度、状态、执行顺序、依赖）。
- 五条硬规则里最有用的一条：**计划必须自包含**——执行者看不到这次对话，不能写"按上面讨论的缓动"。

**本项目怎么用**：先跑一次 `improve-animations quick`（只看首页/目录/详情/地球这几个高频面），再按本文件 §11 的优先级挑 3 条写成计划；不要一次全库重构。

---

## 7. 找机会与删动画（`find-animation-opportunities` / `remove-animations`）

### 7.1 找机会：四道门，全过才留

1. **频率**：100+ 次/天 → 拒绝；几十次 → 只允许近不可察；偶尔 / 罕见 → 合格。
2. **目的**：必须命中六个词之一；"看着酷"不是目的。
3. **速度**：能在预算内完成（UI < 300ms）；只有"很慢很长才好看"的方案不合格。
4. **功能**：信息密集的功能界面上的装饰会碍事；用户正在读的数据不要动。

约束：全 app **最多 5–7 条**建议，按杠杆排序；**必须**附 2–5 条"我考虑过但决定不加"的候选（写明被哪道门否掉）——这一节才是它区别于"动效许愿单"的地方。首选猎物：无 `:active` 的可点元素、瞬移的状态、没有空间来源的面板、一起入场的列表、没有物理的拖拽、"愉悦预算"被浪费的首次/成功时刻。

### 7.2 删动画：门槛树

```
键盘触发（快捷键/命令面板/focus 跳转/方向键）？ → 删。Raycast 无开关动画就是最优体验
100+ 次/天？                                  → 删。这个频率下任何时长都读作"延迟"
用户正在读/操作的功能数据？                     → 删，除非它展示的是"值真的变了"
说不出目的？                                   → 是罕见/首次吗？是→留（愉悦预算）；否→删
目的成立 → 几十次/天？                         → 缩减为近不可察版本
         → 超预算（>300ms / 该用 fade 却用 slide-scale）？ → 缩减
         → 否 → 留
```

**缩减 = 同一个动作的更小版本**，不是换一个动画：

| 现在 | 缩减为 |
| --- | --- |
| hover 带 scale/抬升/阴影增长 | 只改颜色/透明度，≤150ms，`ease` |
| 高频面上的 slide/scale 入场 | 只 opacity，150ms，`ease-out` |
| UI 动效 > 300ms | 200–250ms，同曲线 |
| 每项 stagger > 80ms 或总时长 > 300ms | 每项 ≤30ms，或整组淡入 |
| 常驻元素上的无限循环 | 只跑一次，或删循环留静态终态 |

**删除的六个危险（删之前必须查）**：隐藏的初始态（`opacity: 0` + fill-forwards / `initial` / reveal class，删动画不删初始态 = 元素永久消失）；等待动画的代码（`transitionend`/`onAnimationEnd`/按 duration 写的 `setTimeout`）；延迟卸载的退出动画（`AnimatePresence` 卸载后 `onExitComplete` 里的逻辑要前移）；掩盖布局跳动的 layout 动画（删了会露出跳动，此时应保留并另立 finding）；动画回调里移焦点（改为立即移）；等动画类的测试/选择器。清理：删没人引用的 `@keyframes`、把空掉的 `motion.div` 改回 `div`。

**本项目注意**：`UI设计/动效设计v1.0.md:3` 写明"用户明确要求保留丰富动态效果"，所以**不要**对首页开场、点位联动、封面连续转场跑删除流程；"删/减"只用于高频交互（列表 hover、导航、键盘）和常驻无限循环。

---

## 8. 性能（`animation-performance`）

### 8.1 三档属性（成本差一个数量级）

| 档 | 属性 | 成本 |
| --- | --- | --- |
| 仅合成 | `transform`、`opacity`（当前 Chrome/Firefox 还有 `filter`、`clip-path`、`background-color`） | 最便宜，浏览器可提升为独立层 |
| 绘制 + 合成 | `box-shadow`、`border-radius`、`color` | 不重排，但每帧重绘 |
| 布局 + 绘制 + 合成 | `width`、`height`、`padding`、`margin`、`top`、`left`、`border-width` | 最贵；一个元素长大会推动周围一切 |

**降档替换**：`width/height/padding` 做伸缩 → `scale()`；`top/left/margin` 做移动 → `translate()`；`display/visibility` 切换 → `opacity`；`box-shadow` → `filter: drop-shadow()`（最后这条最常被漏：动画阴影看起来无害，其实每帧重绘整个元素）。
**布局属性还会带错东西**：动画 sidebar 的 `margin-left` 会每帧推动旁边内容；`translateX` 不会。

### 8.2 在哪里跑

| 驱动 | 线程 |
| --- | --- |
| JS + `requestAnimationFrame`（GSAP、`motion/react` 组件） | 永远主线程 |
| WAAPI（`element.animate()`、Motion 的 `animate()`） | 可硬件加速 |
| CSS transition / keyframes | 可硬件加速 |

要警惕的模式是"**动效恰好撞上页面在干重活**"：路由切换、数据请求、hydration 时的 tab 指示器/页面转场。Vercel dashboard 的 tab 指示器用 Framer Motion shared layout，恰好撞上加载下一页 → 掉帧；改成 CSS 动画后解决。
硬件加速是**渐进增强**，浏览器可能拒绝（Chrome 历史上不加速百分比 transform）；所以正确性优先于优化，`translateY(100%)` 该用就用。

### 8.3 两个"看起来对"的陷阱

- **继承的 CSS 变量**：Vaul 的抽屉超过 ~20 个 item 后拖动变卡，因为拖动距离写在父级 `--swipe-amount` 上、由 `translateY()` 读取。CSS 变量会继承，改父级会重算所有子元素样式。→ `element.style.transform = 'translateY(Npx)'`。**"transform 动画随内容增长而变卡"就是它。**
- **blur**：`filter: blur()` 很快变贵（尤其 Safari）。动画中的 blur 保持 < 20px；2–5px 足够软化过渡。
- **React 逐帧 state**：手搓动画里每帧 `setState` → 每 16.7ms 重渲染一次，渲染本身就超预算。→ `ref.current.style.transform = ...` 或 motion value。查 `requestAnimationFrame` / `pointermove` / `scroll` / 拖拽 handler 里的 state 更新。

### 8.4 `will-change`

浏览器可能在动画中途把元素从 CPU 交给 GPU，交接会让元素在开始/结束位移 1px。`will-change` 提前提升，避免交接。**但只在真的看到位移或实测掉帧后才加**：已经在动 transform/opacity 的元素浏览器本来就会提升，加了通常无效，而每个提升层都吃 GPU 显存。放在真正动画的那个元素上，永远不要 `*` 或大容器。它真正有价值的地方是昂贵的绘制（大面积 blur/filter 元素）：提升它，并让层尽量小。

### 8.5 诊断顺序（按命中率）

1. 动的是不是 `transform`/`opacity`？先查 layout 属性，再查 `box-shadow`/`border-radius`（它们不像布局，最容易漏）。
2. 卡顿是否与页面繁忙同时发生（导航/请求/hydration/长任务）？→ 搬到 CSS 或 WAAPI。
3. React 是否每帧重渲染？→ 查 rAF/pointer/scroll handler 里的 state。
4. 是否内容越多越卡？→ 继承 CSS 变量，或同屏动画节点太多。
5. 是否真的有 CSS 变量在被动画（直接或经 Motion 简写）？
6. 动画的 `blur()` 是否 > 20px？
7. 仍然位移/抖动？→ 才加 `will-change: transform`。

确认靠录制不靠感觉：DevTools Performance（掉帧、长任务）+ Animations（慢放）；真机中端手机远程调试（桌面 CPU 节流只能模拟慢 CPU，模拟不了弱 GPU/小内存）。

### 8.6 CSS 与 JS 的分工

不要躲 JS 动画：主线程动画只在"恰好页面忙"时受损，而那很少见。Motion 能给你 CSS 给不了的东西：真实 spring、共享布局、卸载退出动画、惯性手势。**分工**：简单动效 + 页面忙时播放的东西 → CSS；复杂、可打断、手势驱动 → Motion。GSAP 属 rAF 主线程驱动，所以**页面加载/切路由时正在播的 GSAP 时间轴要格外小心**（本项目开场就在资源加载期，必须保证资源未就绪时不靠动画冒充成功）。

---

## 9. 手势与"跟手"（`apple-design` + `emil-design-eng`）

一条主线：**界面之所以"活"，是因为动作从当前屏幕值开始、继承用户速度、把动量投射到终点、并且任何瞬间都能被抓住反向。**

1. **响应：杀死延迟**。**在 pointer-down 就响应，不要等 release/click**；按压高亮必须在按下瞬间出现。逐一审计 debounce、人为定时器、过渡等待、~300ms 点击延迟。反馈必须在交互**过程中连续**存在（拖动/滑块/drawer 全程 1:1），不能只在结束时播一下。
2. **直接操纵：1:1 跟踪**。拖动时内容贴着手指，并**尊重抓取点的偏移**（不要吸附到元素中心）。用 Pointer Events + `setPointerCapture`，指针移出元素也继续跟踪；记录最近几次 `pointermove` 的**位置+时间**，松手时才有速度可用。
3. **可打断：最重要的原则**。永不锁输入；**永远从 presentation（当前屏幕上）的值开始新动画**，不要从目标值开始（会跳）；手势驱动的不要用 CSS transition/keyframes（抓不住、反不了），用 spring；反向时**混合速度而不是硬切**（否则撞墙）；二维运动拆成独立的 X/Y 两个 spring（速度不同步会歪）。
4. **行为而非动画：用 spring**。Apple 把 mass/stiffness/damping 换成两个设计参数：**damping**（1.0 = 临界阻尼不回弹；< 1 回弹，越低越弹）与 **response**（多快到达，秒；不是 duration）。默认 damping 1.0；**只有手势本身带动量时**才给 ~0.8 的回弹——菜单淡入还回弹是错的。
5. **速度交接**：拖动结束转动画时，动画必须以手指的**精确速度**继续（`velocity` 传给 spring），否则接缝可见。需要归一化时 `relativeVelocity = gestureVelocity / (target − current)`。
6. **动量投射**：不要从松手点就近吸附；用速度**投射静止点**（像滚动减速），再吸附到离投射点最近的落点。`project(v, d=0.998) = (v/1000)·d/(1−d)`，`d` 0.998 普通 / 0.99 更脆。这是 flick 有"扔出去"感觉的原因。
7. **空间一致**：同一路径进出；菜单/popover/sheet 锚定触发元素（`transform-origin` 对准触发器）；可逆转场用镜像（反向的 cubic-bézier 控制点）。
8. **朝手势方向提示**：中间帧要指向结果，不是盲目插值。
9. **橡皮筋边界**：越界越拖越少（公式见 §3.5），硬停读起来像"冻住"。
10. **手势细节**：tap 在**按下**高亮、抬起提交，留 ~10px 迟滞与命中扩展，支持拖出取消再拖回恢复；拖动先 10px 方向迟滞再 1:1；从第一个 move 起并行识别所有可能手势、意图明确后取消落败者（不要用只报最终态的 `swipeleft` 类事件）；少做双击/单击消歧（双击检测必然拖慢单击）。
11. **帧内平滑**：每帧位移低于感知阈值避免频闪；极快运动加轻微运动模糊/拉伸比硬边拖影更好；`requestAnimationFrame` 是 Web 的显示时钟，只动合成友好属性。
12. **多模态反馈**：因果（在真正因果事件触发）、和谐（视觉/声音/触感**同一帧**，不能让 CSS 过渡拖后腿）、克制（只给成功/错误/提交/吸附等重要时刻）。
13. **减少动态的三个信号**（比多数实现完整）：`prefers-reduced-motion: reduce` → 换成短 opacity crossfade / 静态切换，去掉 slide/spring/parallax 与回弹；`prefers-reduced-transparency: reduce` → 半透明面板变得更实（提高背景不透明度、去掉 blur）；`prefers-contrast: more` → 近实底 + 明确边框。另外：避免全屏移动背景、慢循环振荡（~0.2Hz / 5s 一周期）、暗/亮主题突跳；大面积移动物体在飞行途中半透明、落位后再淡入。
14. **材质与深度**（Web 近似）：`backdrop-filter: blur()` + 半透明背景做浮层；材质重量编码层级（侧栏更重、按钮更轻）；**不要在半透明面上再叠半透明面**；大表面要"更厚"（更强 blur + 更深阴影）；"materialize, don't just fade"——blur 半径与 scale 一起动，才像真的材质到场。

**本项目注意**：地球拖拽要按第 2/3/5/6 条审（`GlobeExperience.tsx:641-741` 已有 pointerdown 起手、capture、多点保护、5px 迟滞；但松手惯性用的是"最后一帧位移 + 固定 0.28s"，不是速度投影，见 §11.3）。

---

## 10. 术语表（写 prompt / 跟人沟通用）

| 中文说法 | 术语 | 一句定义 |
| --- | --- | --- |
| 一个个依次出现 | **Stagger** | 多个元素之间留小延迟，形成瀑布 |
| 从按钮里长出来 | **Origin-aware animation** | 动效原点在触发元素，而不是自身中心 |
| 弹一下到位置 | **Pop in** | 带轻微过冲到位的入场 |
| 弹簧感 | **Spring** | 物理驱动的动画，无固定时长，靠参数收敛 |
| 能中途抓住改向 | **Interruptible animation** | 可被中途重定向而不用先播完 |
| 松手继续滑 | **Momentum / Velocity handoff** | 手势速度交给后续动画 |
| 拖过头会回弹 | **Rubber-banding** | 越界阻力 + 回弹（iOS 过滚动感） |
| 一个形状变成另一个 | **Morph** | 形变，如 Dynamic Island |
| 元素从一处飞到另一处 | **Shared element transition** | 共享元素转场（缩略图变卡片） |
| 一进一出的叠化 | **Crossfade** | 同一位置一个淡出一个淡入 |
| 滚动到才出现 | **Scroll reveal** | 进入视口时揭示 |
| 滚动位置直接驱动 | **Scroll-driven animation** | 进度与滚动位置绑定 |
| 前景背景不同速 | **Parallax** | 视差 |
| 按住逐渐填充 | **Hold to confirm** | 长按进度填充确认 |
| 快速甩一下关闭 | **Swipe to dismiss / flick** | 速度判定而不是距离判定 |
| 左一下右一下抖 | **Shake / Wiggle** | 错误/拒绝输入 |
| 数字滚动 | **Number ticker** | 数字变化时逐位滚动（配 tabular-nums） |
| 文本逐字出现 | **Typewriter** | 打字机 |
| 骨架屏扫光 | **Skeleton / Shimmer** | 加载占位 + 移动高光 |
| 布局变化自动补间 | **Layout animation** | 尺寸/位置变化时补间而非瞬跳 |
| 前后同一元素建立连续 | **Continuity transition** | 前后状态视觉连续 |
| 前进/后退方向相反 | **Direction-aware transition** | 方向感知转场 |
| 冻结掉帧 | **Jank / Dropped frame** | 掉帧卡顿 |
| 布局抖动 | **Layout thrashing** | 动画 layout 属性导致每帧重排 |
| 合成 | **Compositing** | GPU 单独移动/淡出图层 |
| 频率越高越短越轻 | **Frequency of use** | 使用频率决定动效预算 |
| 别处消失要回到原处 | **Spatial consistency** | 空间一致性 |

---

## 11. 与本项目对接（核心交付）

### 11.1 项目现状（已核对代码，2026-10-29）

技术栈：React 19 + Vite + Three.js/R3F + GSAP 3.15 + @gsap/react + Flip；CSS Modules + `styles/tokens.css` 全局令牌；动效设计文档：`UI设计/动效设计v1.0.md`。

**令牌现状**（`frontend/src/styles/tokens.css:105-111`）：

```css
--dur-fast: 120ms;
--dur-base: 180ms;
--dur-slow: 280ms;
--dur-enter: 380ms;
--dur-scene: 600ms;
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-out: cubic-bezier(0.22, 0.61, 0.36, 1);
```

**逐项核对表**

| # | 位置 | 现状 | 判断 | 依据 / 改法 |
| --- | --- | --- | --- | --- |
| 1 | `frontend/src/styles/tokens.css:105-111` | 5 档时长 + 2 条曲线，缺 `ease-in-out` 与 `ease-drawer`；`--ease-out` 偏弱 | **需补** | 现有 `--ease-out: (0.22,0.61,0.36,1)` 比 Emil 的 `(0.23,1,0.32,1)` 起手慢、收尾软；新增 `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`、`--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`；`--ease-standard` 本身是强 ease-out（0.2,0,0,1），可保留并注释为"颜色/边界短反馈用" |
| 2 | `frontend/src/styles/tokens.css:128-135` | `prefers-reduced-motion` 把 5 个时长全部归零 | **违规** | 文档自己写了"减少动态：取消大范围镜头、惯性与空间位移，**保留清晰的状态结果及短交接**"（`动效设计v1.0.md:94`）。归零会把按钮/边框/颜色的理解性反馈一起删掉 → 改成不归零：`--dur-fast/base` 保留 120/150ms，只去掉 transform 位移与镜头；`--dur-enter/scene` 可归零 |
| 3 | `GlobeExperience.tsx:159,241,277,328,518,525,533,565,729`；`CityBubble.tsx:133,150`；`coverFlip.ts:121,122,142`；`PreviewViewer.tsx:394,433`；`WorksPage.tsx:107`；`WorkDetailPage.tsx:94`；`AdminWorksPage.tsx:132` | GSAP 到处硬编码秒数（0.18/0.2/0.22/0.28/0.32/0.34/0.42/0.45/0.5/0.52/0.66/1.25）与 `power2.out`/`power3.inOut` | **违规（双轨）** | 违反"扩展 token，不许另起平行体系"（`animate` Hard Rule 3）；`动效设计v1.0.md:84` 也要求"共用缓动、时长层级放在 styles/motion 或同类小文件"——该文件目前不存在。建立 `frontend/src/lib/motion.ts` 与 CSS 同源；GSAP 用 `power2.out` 近似 `--ease-out`、`power2.inOut` 近似 `--ease-in-out`；要 1:1 复刻曲线用 `CustomEase`（GSAP 3.13+ 全插件免费），否则保留 power2 更划算 |
| 4 | `GlobeExperience.tsx:277-278` | 气泡关闭 `duration 0.18, ease: 'power2.in'` | **违规** | `ease-in` 是禁止项；且退出不该在"用户盯着看"的那一刻变慢。改 `power2.out`；退出可保持 180ms（快于进入的 340ms，符合非对称） |
| 5 | `GlobeExperience.tsx:712-744`（`handlePointerEnd`，惯性 gsap 在 `:721-730`） | 惯性用 `drag.lastDx`（最后一帧位移）当速度，固定 `duration: 0.28` | **需改** | 慢拖后停住再松手也会"甩"；轻甩与慢拖惯性一样。改为记录 `pointerup` 时间与位移求速度 `|Δ|/Δt`，按 §3.5 投影落点（`d≈0.998`）再交给 spring/`power2.out`；地球是连续轴，可只做"速度→目标经度"投射，时长随速度变化 |
| 6 | `GlobeExperience.tsx:638-744` | `pointerdown` 即起手、`setPointerCapture`、多点保护、5px 迟滞、拖动中直接写 `view.longitude/latitude`（无 React state） | **正例** | 符合 §9.1/9.2/9.3；5px 迟滞比 Apple 的 ~10px 略灵敏，可接受（地球是连续对象）。保持 |
| 7 | `GlobeExperience.tsx:751`（`handleKeyDown`） | 键盘方向键直接改 `view.longitude`，无动画 | **正例** | 键盘触发 = 不动画（§2.1） |
| 8 | `GlobeExperience.module.css:80` | `.bubbleLayer { will-change: transform }` 常驻 | **基本可接受** | 单元素、且确实在动；但按 §8.4 只在实测掉帧时保留，不要推广到列表项 |
| 9 | `frontend/src/components/works/WorkCard.module.css:89-99` | hover：`translateY(-3px)` + `scale(1.025)` + 阴影，180ms `--ease-out`，且门控 `(hover:hover) and (pointer:fine)` | **正例** | 幅度小、有门控、有 `:active`；可作为全站 hover 范例 |
| 10 | `frontend/src/components/works/WorkCard.module.css:104` | `.card:active { transform: scale(0.995) }` | **偏小** | 0.995 视觉上几乎不可见（Emil 区间 0.95–0.98，标准 0.97）。改 `scale(0.97)`，时长 160ms |
| 11 | `frontend/src/components/works/WorkCard.module.css:16-19` | 过渡含 `box-shadow 180ms` | **paint 档** | 每帧重绘。改为伪元素（`::after` 阴影/渐变）只过渡 `opacity`，或 `filter: drop-shadow()`；若机器实测无掉帧可标"已知风险"不阻塞 |
| 12 | `frontend/src/components/uploads/UploadField.module.css:177` | `transition: width var(--dur-base) var(--ease-standard)` | **违规** | 上传进度条动 layout 属性 → `transform: scaleX()` + `transform-origin: left`；进度是"进度指示"，缓动应 **linear** 而不是 ease-standard |
| 13 | `frontend/src/components/viewer/ModelViewport.module.css:247` | `transition: width 120ms linear` | **违规** | 同上（若为进度条）：`scaleX` + `linear`；若确实是"条宽随内容自适应"，则改 setTimeout/直接设置、不做过渡 |
| 14 | `frontend/src/pages/HomePage.module.css:73` | 6px 状态点 `animation: pulse 1.2s ease-in-out infinite` | **LOW** | 常驻元素上的无限循环（§7.2）。改为"仅在等待/连接中"运行，或跑 2–3 次后停在亮态；`reduced-motion` 已有兜底 |
| 15 | `frontend/src/components/works/PreviewViewer.module.css:229`、`frontend/src/pages/WorksPage.module.css:48` | `status-pulse`、`skeleton-sweep` 无限循环 | **可保留** | 均为加载/忙碌指示（属于"确实在等待"），且 skeleton 只在 >300ms 的加载中有意义；不要给 <300ms 的操作加 |
| 16 | `WorksPage.tsx:107-109`（520ms + 60ms stagger）；`WorkDetailPage.tsx:94-96`（500ms + 70ms）；`AdminWorksPage.tsx:132-134`（320ms + 35ms）；`CityBubble.tsx:150-153`（280ms + 40ms） | 入场时长与错峰 | **合规/有意为之** | stagger 全部落在 30–80ms；卡片 450–650ms 是 `动效设计v1.0.md:35` 明确写下的设计决定（"don't re-litigate settled decisions"），不报为 finding |
| 17 | `GlobeExperience.tsx:518-535` | 首页开场：导航 0.42s + 镜头 1.25s×2 段 `power2.inOut`，错峰 0.08 | **有意为之** | `动效设计v1.0.md:29` 定 1.2–1.6s、阶段重叠；屏上移动用 ease-in-out 正确。**但要保证资源未就绪时不被动画冒充加载成功**（文档 `:59` 已写明）；拖动/点击立即 `takeOver` 正确 |
| 18 | 全库 grep | 无 `transition: all`、无 `scale(0)`、`transform-origin` 仅 `PublicNav.module.css:77`（导航下划线 `scaleX` 居中，正确） | **正例** | 这三项是 Emil 库最高频的 Block 项，本项目已避开 |
| 19 | `frontend/src/lib/usePrefersReducedMotion.ts`、`lib/prefersReducedMotion.ts`、`WorksPage.tsx:125` | JS 侧有 reduced-motion 分支，GSAP 多处 `if (reducedMotion)` 直接设终态 | **正例** | 符合"reduced motion 随动画交付"；与第 2 条 CSS 归零叠加会导致"动效没了、反馈也没了"，需一起修 |
| 20 | `frontend/src/components/globe/GlobeExperience.module.css:100`、`:129-130` | `opacity 140ms`、`transform 180ms + box-shadow 180ms` | **需确认** | 若 `:129` 是点位/气泡 hover，`box-shadow` 可换伪元素 opacity；180ms 在预算内 |

### 11.2 先改的三个点（按杠杆排序）

**P1｜统一动效数值来源，先删掉"两套体系"**
- 问题：CSS 有 5 档时长令牌，GSAP 在 7 个文件里散着 12 种秒数与 `power2/power3`（第 3 条），改一次节奏要全库搜数字。
- 动作：新建 `frontend/src/lib/motion.ts`，导出与 `tokens.css` 一一对应的常量（`DUR.fast/base/slow/enter/scene`、`EASE.out/inOut/drawer` 的 GSAP 字符串），并在 `tokens.css` 补 `--ease-in-out`、`--ease-drawer`；把 GSAP 时间轴的 `duration: 0.18` 等替换为 `DUR.fast / 1000`。同时改两处明确错误：`GlobeExperience.tsx:278` 的 `power2.in` → `power2.out`；`UploadField.module.css:177`/`ModelViewport.module.css:247` 的 `width` → `scaleX` + `linear`。
- 验证：`grep -rn "duration: 0\." frontend/src` 结果只允许出现在 `lib/motion.ts`；`grep -rn "transition: width\|transition: height" frontend/src` 为空；视觉上按钮/边框反馈不变，气泡关闭不再"先慢后快"。

**P2｜手势惯性从"最后一帧位移"改成"速度 + 投射"**
- 问题：`GlobeExperience.tsx:722-730` 用 `lastDx` 与固定 0.28s，慢拖松手会误甩、轻甩与慢拖手感一样。
- 动作：在 `handlePointerMove` 里记录 `{t, x, y}` 历史（最近 3–5 个 `pointermove`）；`pointerup` 时 `v = |Δ|/Δt`，按 `project(v, 0.998)` 求投射经度/纬度，`duration = clamp(0.2 + v*0.15, 0.2, 0.6)` 或直接 spring `{duration: 0.5, bounce: 0.2}`；保留 `takeOver` 打断与 `rememberView`。
- 验证：慢拖后停 200ms 再松手 → 不产生惯性；快速轻甩 → 明显继续滑；拖动中反向 → 立即接管不回跳（privacy: 真机触屏测）。

**P3｜减少动态从"归零"改成"保留理解性反馈"**
- 问题：`tokens.css:128-135` 把全部时长归零，与自家文档 `动效设计v1.0.md:94` 矛盾；按钮按压、边框、颜色反馈全部消失，属于"reduced-motion 抹掉反馈"。
- 动作：reduced-motion 下 `--dur-fast: 120ms`、`--dur-base: 150ms` 保留；`--dur-enter/scene` 归零；用一条全局规则去掉 transform 类动效：`@media (prefers-reduced-motion: reduce) { .card:hover, .card:active { transform: none } }` 已在 `WorkCard.module.css:132` 做过，补齐到 `PublicNav`、`GlobeExperience`、`PreviewViewer`；保留 opacity/颜色过渡。
- 验证：DevTools Rendering → `prefers-reduced-motion: reduce`，按钮按下仍有 120ms 明暗变化、导航下划线瞬时到位、卡片无位移；`getComputedStyle` 检查 `--dur-enter` 为 `0ms`。

### 11.3 建议代码（未落地，写法即规范）

```css
/* 建议补进 tokens.css（在 :105-111 之后） */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);     /* 强 ease-out */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
--dur-press: 160ms;

/* 按压反馈（任何可点元素） */
.pressable { transition: transform var(--dur-press) var(--ease-out); }
.pressable:active { transform: scale(0.97); }

/* 触发器锚定的浮层 */
.popover {
  transform-origin: var(--transform-origin);
  transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
}
.popover[data-starting-style], .popover[data-ending-style] { opacity: 0; transform: scale(0.95); }

/* 进度条：不要动 width */
.progressBar { transform-origin: left; transform: scaleX(0); transition: transform var(--dur-base) linear; }

/* hover 门控 + reduced-motion 降级（不是归零） */
@media (hover: hover) and (pointer: fine) { .card:hover { transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) {
  .card:hover, .card:active { transform: none; }
  .card { transition: border-color 150ms var(--ease-standard), background-color 150ms var(--ease-standard); }
}
```

```ts
// 建议新建 frontend/src/lib/motion.ts —— 与 tokens.css 同源，禁止第二套数字
export const DUR = { fast: 120, base: 180, slow: 280, enter: 380, scene: 600 } as const
export const EASE = {
  out: 'power2.out',      // ≈ cubic-bezier(0.23,1,0.32,1)
  inOut: 'power2.inOut',  // ≈ cubic-bezier(0.77,0,0.175,1)
  standard: 'power2.out',
} as const

// 拖拽速度与投影（§9.5–9.6）
const project = (v: number, d = 0.998) => (v / 1000) * d / (1 - d)
// pointerup: const v = Math.hypot(dx, dy) / Math.max(dt, 16); const target = current + project(v)
```

### 11.4 与项目自有动效文档的关系

- `UI设计/动效设计v1.0.md` 是**产品级分镜与时长决策**（开场 1.2–1.6s、卡片 450–650ms、气泡 280–380ms、返回 250–450ms…），属于"已结算的决定"，`improve-animations` 硬规则 5 要求尊重，不应拿 Emil 的"UI < 300ms"去覆盖有叙事目的的开场与卡片揭示。
- Emil 的规则主要约束**交互反馈层**（按钮、hover、按压、开关、进度、拖拽惯性）与**工程正确性层**（属性、token、reduced-motion、打断）。
- 两者冲突时的裁决：**叙事/首次进入**按项目文档；**高频交互**按 Emil（更短更轻）；**任何情况下**"退出不比进入慢、不出现 ease-in 入场、不动 layout 属性"按 Emil 硬规则。

---

## 12. 速查表（一页）

**时长**
`按压缩放 100–160ms` · `tooltip 125–200ms` · `dropdown/select 150–250ms` · `modal 250ms` · `drawer 500ms` · `toast 400ms ease` · `accordion 200ms` · `tab 250ms` · `滚动揭示 600ms` · **UI 一律 < 300ms** · `长按 2s linear / 松手 200ms`

**缓动**
进/出 `ease-out` = `cubic-bezier(0.23,1,0.32,1)` · 屏上移动 `ease-in-out` = `cubic-bezier(0.77,0,0.175,1)` · drawer = `cubic-bezier(0.32,0.72,0,1)` · hover/颜色 `ease` · 进度/marquee `linear` · **禁止 `ease-in`**

**幅度**
按压 `scale(0.97)`（0.95–0.98）· 入场 `scale(0.95)`（0.9–0.97）+ `opacity:0` · hover 位移小（项目 -3px）、图片 `scale(1.025)` · 列表 `translateY(8px)` · 自尺寸位移用 `translateY(100%)` · 禁止 `scale(0)` · blur < 20px（2–5px 够）

**Stagger**
每项 `30–80ms`（配方 50ms，单项 300ms）；总时长 > 300ms 就删 stagger 或整组淡入；播放时不许阻塞交互

**Spring**
默认 `{duration:0.5, bounce:0.2}`；传统 `{mass:1, stiffness:100, damping:10}`；Apple 默认 damping `1.0` + response `0.3–0.4`；只有手势带惯性才 `0.8`；bounce 0.1–0.3

**手势**
pointerdown 即响应（不等 click）· 1:1 + 尊重抓取偏移 + `setPointerCapture` · 速度关闭阈值 `|Δ|/Δt > 0.11` · 投射 `(v/1000)·0.998/(1−0.998)` · 相对速度 `v/(target−current)` · 边界阻尼常数 `0.55` · 方向迟滞 ~10px · 从 presentation 值开始动画 · 速度不硬切 · 2D 拆 XY

**性能**
只 `transform`/`opacity`（+clip-path）· 影子用 `filter: drop-shadow()` · 不要父级 CSS 变量驱动子 transform · 不要逐帧 setState · CSS 跑主线程外、rAF 在主线程 · 16.7ms（60Hz）/ 8ms（120Hz）· `will-change` 最后再加、只加在动画元素

**可访问性**
`prefers-reduced-motion`：保留 opacity/颜色，去掉位移（**不是归零**）· hover 动效必须 `(hover:hover) and (pointer:fine)` · Apple 另两个信号：`prefers-reduced-transparency`、`prefers-contrast`

**红旗 13 条**
`transition: all` / `scale(0)` / UI `ease-in` / 键盘或 100+ 次/天动效 / >300ms 无理由 / popover `origin: center` / toast 用 keyframes / 动 layout 属性 / 繁忙期 Motion 简写 / 父级变量驱动子 transform / 缺 reduced-motion / 未门控 hover / 按压进出对称

**决策两问**
① 频率够低吗？（键盘=不；100+/天=不；几十/天=几乎不可察；偶尔=标准；罕见=愉悦）
② 能说出六个目的之一吗？（Feedback / Spatial consistency / State indication / Preventing jarring change / Explanation / Delight）说不出就不做。

---

## 13. 来源与抓取记录

**主来源**

| 内容 | URL |
| --- | --- |
| 仓库首页 / skill 索引 / 安装方式 | https://github.com/emilkowalski/skills （`README.md`） |
| UI 速查 | `ui-cheatsheet.md` |
| 性能速查 | `performance-cheatsheet.md` |
| 构建动效（核心） | `skills/animate/SKILL.md` |
| 动效配方 | `skills/animate/RECIPES.md` |
| 评审（10 条标准 / 输出格式） | `skills/review-animations/SKILL.md`、`STANDARDS.md` |
| 审计 + 计划模板 | `skills/improve-animations/SKILL.md`、`AUDIT.md`、`PLAN-TEMPLATE.md` |
| 找机会 | `skills/find-animation-opportunities/SKILL.md` |
| 删动画 | `skills/remove-animations/SKILL.md` |
| 性能 | `skills/animation-performance/SKILL.md` |
| 词汇 | `skills/animation-vocabulary/SKILL.md` |
| Apple 流体交互 | `skills/apple-design/SKILL.md` |
| 主设计工程 skill | `skills/emil-design-eng/SKILL.md` |
| React Native 版（未精读，仅列名） | `skills/animate-expo/SKILL.md`、`RECIPES.md` |

**抓取方式（重要，供复现）**

- 本机网络环境中 `raw.githubusercontent.com`、`github.com`、`cdn.jsdelivr.net` 均不可达（`curl` 返回 `000` / `Recv failure: Connection reset by peer`，超时 20s+）；`api.github.com` 可达。
- 因此改用 GitHub REST contents API 拉取 base64 内容再解码：
  `curl -sL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/emilkowalski/skills/contents/<path>"`，用 Python `base64.b64decode(d["content"])` 还原。
- 目录树用 `https://api.github.com/repos/emilkowalski/skills/git/trees/main?recursive=1` 获取。
- 分支：`main`；抓取日期：**2026-10-29**；共 18 个文件（Web 动效相关 15 个 + Expo 2 个 + 性能速查 1 个），合计约 25 万字节。
- 若将来要复核数值，优先比对 `skills/animate/SKILL.md`、`skills/review-animations/STANDARDS.md`、`skills/improve-animations/AUDIT.md` 三处，它们互为副本、数值一致；`RECIPES.md` 提供可直接抄的实现。

**与项目相关的本地依据**

- `UI设计/动效设计v1.0.md`（分镜、时长、工程接入、reduced-motion 策略）
- `UI设计/视觉规范v1.0（深色）.md`（配色/尺寸/材质，未在本文展开）
- `frontend/src/styles/tokens.css`、`frontend/src/styles/global.css`
- `frontend/src/components/**/*.module.css`、`frontend/src/pages/**/*.module.css`
- `frontend/src/components/globe/GlobeExperience.tsx`、`CityBubble.tsx`、`frontend/src/lib/coverFlip.ts`、`frontend/src/components/works/PreviewViewer.tsx`、`frontend/src/pages/WorksPage.tsx`、`WorkDetailPage.tsx`、`frontend/src/pages/admin/AdminWorksPage.tsx`

> 说明：本文只新增这一个文件，未改动 `frontend/` 任何代码、未改 `UI设计/动效设计v1.0.md` 与 `视觉规范v1.0（深色）.md`、未提交 git。"建议代码"均未落地。
