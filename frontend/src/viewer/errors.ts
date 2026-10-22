import type { ViewerErrorCode, ViewerErrorInfo } from './types'

const COPY: Record<ViewerErrorCode, Omit<ViewerErrorInfo, 'code'>> = {
  NO_SOURCE: {
    title: '尚未配置模型资源',
    message: '该作品没有提供模型 URL 或本地文件，因此没有可加载的真实资源。',
    advice: '生产环境需由宿主显式提供带版本的模型 URL；开发时可使用独立测试台选择本地文件。',
    retryable: false,
  },
  UNSUPPORTED_SOURCE: {
    title: '模型来源不可用',
    message: '模型来源类型不受支持，或 File 已被释放。',
    advice: '重新选择本地文件，或让宿主提供有效的 URL 来源。',
    retryable: false,
  },
  WEBGL2_UNAVAILABLE: {
    title: '当前浏览器不支持 WebGL2',
    message: '模型查看器需要 WebGL2；当前上下文无法创建。',
    advice: '结束预览后重新开始会创建新的查看器；若仍不可用，请更新浏览器、启用硬件加速或刷新页面。',
    retryable: false,
  },
  CONTEXT_LOST: {
    title: '渲染上下文已丢失',
    message: '显卡或浏览器回收了 WebGL 上下文，当前画面不能继续更新。',
    advice: '请结束预览后重新开始，以创建新的查看器与上下文；不要在当前丢失的 renderer 上重试。',
    retryable: false,
  },
  NETWORK: {
    title: '模型下载失败',
    message: '网络请求在完成前中断，没有取得完整文件。',
    advice: '检查网络或本地开发服务器是否可访问，然后手动重试。',
    retryable: true,
  },
  HTTP: {
    title: '模型地址不可用',
    message: '模型请求返回了错误状态，未开始解析。',
    advice: '确认模型地址、资源版本和开发映射是否存在；模拟替换绑定不会产生真实文件，缺少映射时不会回退旧模型。',
    retryable: true,
  },
  ABORTED: {
    title: '加载已取消',
    message: '本次加载被新的任务或结束操作取消。',
    advice: '等待当前操作完成，或重新开始一次预览。',
    retryable: true,
  },
  MAGIC: {
    title: '无法识别模型内容',
    message: '文件头既不是 GLB（glTF 二进制）也不是标准 3DGS PLY。',
    advice: '只支持 glTF 2.0 GLB 与二进制小端 3DGS PLY；请核对文件本身，而不是只看后缀。',
    retryable: false,
  },
  PLY_HEADER: {
    title: 'PLY 文件头不完整',
    message: '没有找到合法的 ply 头或 end_header。',
    advice: '请提供未截断的标准 PLY 文件。',
    retryable: false,
  },
  PLY_FORMAT: {
    title: 'PLY 编码不受支持',
    message: '首期只接受 binary_little_endian 1.0 的 3DGS PLY。',
    advice: 'ASCII、binary_big_endian、压缩或未知 PLY 需要先转换为标准 3DGS 二进制小端格式。',
    retryable: false,
  },
  PLY_FIELDS: {
    title: 'PLY 不是标准 3DGS',
    message: '缺少 x/y/z、f_dc_0..2、f_rest 标准组合、opacity、scale_0..2 或 rot_0..3。',
    advice: '普通点云不能当作高斯泼溅。请提供完整 3DGS 属性（球谐 0/9/24/45 个系数）。',
    retryable: false,
  },
  PLY_LENGTH: {
    title: 'PLY 数据长度不一致',
    message: '文件长度与头部声明的顶点数、每行字节数不匹配。',
    advice: '文件可能被截断或并非二进制 PLY，请重新导出。',
    retryable: false,
  },
  PLY_VALUES: {
    title: 'PLY 含无效数值',
    message: '顶点数据中存在 NaN、Infinity 或零四元数。',
    advice: '请在导出端检查高斯参数；查看器不会用 0 或猜测值替代损坏数据。',
    retryable: false,
  },
  GLB_HEADER: {
    title: 'GLB 文件头不合法',
    message: 'magic、glTF 版本或 chunk 长度与文件实际长度不一致。',
    advice: '请提供 glTF 2.0 二进制 GLB；不自动修复或猜测损坏文件。',
    retryable: false,
  },
  GLB_JSON: {
    title: 'GLB JSON 无法解析',
    message: '第一个 chunk 不是合法 JSON，或缺少 asset.version。',
    advice: '请从建模工具重新导出 GLB。',
    retryable: false,
  },
  GLB_EXTERNAL: {
    title: 'GLB 引用了外部资源',
    message: '文件包含外部 buffer 或图片 URI，本地查看器不会自动发起额外网络请求。',
    advice: '请导出为内嵌资源的单文件 GLB，或由宿主显式提供受控资源地址。',
    retryable: false,
  },
  GLB_EXTENSION: {
    title: 'GLB 需要未支持的扩展',
    message: '文件声明了无法安全忽略的 required 扩展。',
    advice: '请移除该扩展后重新导出；未知必要扩展不会被静默丢弃。',
    retryable: false,
  },
  DECODER_REQUIRED: {
    title: 'GLB 需要额外解码器',
    message: '文件使用了 Draco、Meshopt 或 KTX2/BasisU，而首期没有配置对应解码器。',
    advice: '请导出未压缩 GLB 或内嵌常规 JPEG/PNG 贴图，或在后续版本显式接入解码器。',
    retryable: false,
  },
  PARSE: {
    title: '模型解析失败',
    message: '文件结构通过了初步检查，但解析器未能完成读取。',
    advice: '请查看具体原因并重新导出模型；可手动重试一次。',
    retryable: true,
  },
  SPARK: {
    title: '高斯初始化失败',
    message: 'Spark 未能初始化该高斯文件。',
    advice: '确认文件是完整 3DGS PLY，并检查浏览器 WebGL2 与内存情况。',
    retryable: true,
  },
  EMPTY_MODEL: {
    title: '模型没有可显示内容',
    message: '解析成功但没有有效包围盒或可见对象。',
    advice: '请确认模型包含可见网格或高斯点。',
    retryable: false,
  },
  INVALID_BOUNDS: {
    title: '模型边界无效',
    message: '模型几何或包围盒包含 NaN/Infinity，或尺寸退化为零。',
    advice: '请检查导出文件中的顶点与变换；查看器不会用无效边界生成相机或继续显示。',
    retryable: false,
  },
  RECORDING_UNSUPPORTED: {
    title: '当前浏览器不能录制',
    message: 'MediaRecorder 或 captureStream 不可用，未创建任何视频文件。',
    advice: '请使用最新版 Chrome；录制需要 WebM 或 MP4 编码支持。',
    retryable: false,
  },
  RECORDING_BUSY: {
    title: '上一段录制正在结束',
    message: '录制资源尚未完全释放，本次没有开始新的录制。',
    advice: '等待上一段停止完成后再开始；停止期间旧 track 与事件会被清理。',
    retryable: true,
  },
  SCREENSHOT_FAILED: {
    title: '截图未生成',
    message: '画布没有返回有效 PNG 数据。',
    advice: '请等待模型就绪后重试；若持续失败，检查 WebGL 与浏览器内存。',
    retryable: true,
  },
  UNKNOWN: {
    title: '模型加载失败',
    message: '发生了未分类错误，没有进入可交互状态。',
    advice: '请手动重试；若仍失败，记录具体错误信息后再排查。',
    retryable: true,
  },
}

export class ViewerError extends Error {
  readonly code: ViewerErrorCode
  readonly advice: string
  readonly retryable: boolean

  constructor(code: ViewerErrorCode, detail?: string, cause?: unknown) {
    const copy = COPY[code]
    super(detail ? `${copy.message} ${detail}` : copy.message, { cause })
    this.name = 'ViewerError'
    this.code = code
    this.advice = copy.advice
    this.retryable = copy.retryable
  }

  toInfo(): ViewerErrorInfo {
    const copy = COPY[this.code]
    return {
      code: this.code,
      title: copy.title,
      message: this.message,
      advice: this.advice,
      retryable: copy.retryable,
    }
  }
}

export function toViewerErrorInfo(error: unknown): ViewerErrorInfo {
  if (error instanceof ViewerError) return error.toInfo()
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ViewerError('ABORTED').toInfo()
  }
  return new ViewerError('UNKNOWN', error instanceof Error ? error.message : undefined).toInfo()
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}
