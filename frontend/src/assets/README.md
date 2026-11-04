# 演示地球纹理

`earth-demo.png` 是 P07 的**演示用**等距圆柱纹理，不是正式地理素材。

- 来源：Natural Earth `ne_110m_land` 公共领域陆地数据
  <https://www.naturalearthdata.com/downloads/110m-physical-vectors/110m-land/>
- 制作：用 Natural Earth 陆地多边形按 `#0D1D27` 海洋、`#28454B` 陆地、`#395962`
  海岸线的深色规范色绘成 4096×2048 PNG；南极洲保留在底部。
- 使用限制：只用于验证球体、城市中心点位与交互路径。边界、地形、光照和真实
  地球影像均未交付，不能据此声明正式地理效果已验收。正式纹理到位后替换本文件，
  并同步更新视觉验收记录。

## 2026-10-31：低空视界彩色地球与展示字体

- `earth-color.webp`（4096×2048）与 `earth-color-mobile.webp`（2048×1024）：来自 NASA Earth Observatory Blue Marble Next Generation with Topography and Bathymetry，2004 年 7 月全球合成图。仅调整分辨率并编码为 WebP，未改变地理位置；并非实时卫星影像。
- 来源：https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/
- 原文件：https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x5400x2700.jpg
- 致谢：NASA Earth Observatory / Blue Marble Next Generation。使用说明：https://www.nasa.gov/nasa-brand-center/images-and-media/ 。不包含 NASA 标识，不表示 NASA 对本站背书。
- 首版使用过得意黑 Smiley Sans v2.0.1；第二轮视觉校准已移除该字体文件并替换为下述直立标题字体。
- 字体来源：https://github.com/atelier-anchor/smiley-sans/releases/tag/v2.0.1 。字体只用于品牌与首页大标题，正文继续使用系统中文黑体栈。

## 2026-10-31：第二轮视觉校准

- 展示字体改为直立的 Noto Sans SC 800，替代首版倾斜得意黑。`fonts/DisplaySansSC.woff2` 仅包含“低空视界之上另见世界”所需字形，由 Google Fonts 的 text 子集接口取得后转换为 WOFF2；仅用于品牌与固定首页标题，其他文字回退至正文黑体。
- 字体源：https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@800 ，许可来自 https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE ，副本为 `fonts/NotoSansSC-OFL.txt`。不依赖运行时外网字体服务。
- `earth-clouds.webp`：NASA Blue Marble 云层合成图，来源 https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg ，记录页 https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/ 。转为 2048×1024 灰度 WebP，作为白色云层的透明度使用；不是实时天气。
- 云层和底图年代不同，仅用于地球视觉展示，不提供气象或测绘用途。

## 2026-11-01：云层空间分层

- 继续复用原有陆地与云层纹理，不新增图片请求。地表半径为 1，云层基础半径为 1.022，密度纹理提供最多约 0.006 的局部起伏，大气外壳扩大到 1.045；这些比例为首页可读性作了视觉夸张，不代表真实云高。
- 云纹理同时用于透明度、表面凹凸与轻微几何起伏。地表附近增加按主光方向投影的近似云影；云层缓慢独立漂移，云影同步纹理偏移。系统减少动态效果时停止漂移。
- 这是轻量球壳云层与近似云影，不是体积云或实时气象渲染。
