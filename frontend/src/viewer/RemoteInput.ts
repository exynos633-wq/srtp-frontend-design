/** 视频上的输入统一归一化；节点执行相机更新，浏览器不预测相机。 */
export class RemoteInput {
  touchEnabled = false
  private pointers = new Map<number, { x: number; y: number; button: number }>()
  private keys = new Set<string>()
  private dx = 0
  private dy = 0
  private zoom = 0
  private pan = false
  private timer: ReturnType<typeof setInterval>
  private events = new AbortController()

  private send: (value: object) => void

  constructor(video: HTMLVideoElement, send: (value: object) => void,
    reset: () => void, teleport: (x: number, y: number) => void) {
    this.send = send
    const signal = this.events.signal
    video.addEventListener('contextmenu', (event) => event.preventDefault(), { signal })
    video.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' && !this.touchEnabled) return
      event.preventDefault()
      video.focus({ preventScroll: true })
      video.setPointerCapture?.(event.pointerId)
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, button: event.button })
    }, { signal })
    video.addEventListener('pointermove', (event) => {
      const prev = this.pointers.get(event.pointerId)
      if (!prev) return
      const rect = video.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)?.[1]
      if (other) {
        const oldDistance = Math.hypot(prev.x - other.x, prev.y - other.y)
        const newDistance = Math.hypot(event.clientX - other.x, event.clientY - other.y)
        if (oldDistance > 0 && newDistance > 0) this.zoom += Math.log(oldDistance / newDistance)
        this.pan = true
        this.dx += (event.clientX - prev.x) / rect.width / 2
        this.dy += (event.clientY - prev.y) / rect.height / 2
      } else {
        this.pan = prev.button !== 0
        this.dx += (event.clientX - prev.x) / rect.width
        this.dy += (event.clientY - prev.y) / rect.height
      }
      this.pointers.set(event.pointerId, { ...prev, x: event.clientX, y: event.clientY })
    }, { signal })
    const release = (event: PointerEvent) => { this.pointers.delete(event.pointerId); this.flush() }
    video.addEventListener('pointerup', release, { signal })
    video.addEventListener('pointercancel', () => this.clear(), { signal })
    video.addEventListener('lostpointercapture', release, { signal })
    video.addEventListener('wheel', (event) => {
      event.preventDefault()
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? video.clientHeight : 1)
      this.zoom += Math.max(-1, Math.min(1, pixels / 600))
    }, { passive: false, signal })
    video.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase()
      if (event.metaKey || event.altKey || !['w', 'a', 's', 'd', 'q', 'e', 'shift', 'control', 'f'].includes(key)) return
      event.preventDefault()
      if (key === 'f') { if (!event.repeat) reset(); return }
      this.keys.add(key)
    }, { signal })
    window.addEventListener('keyup', (event) => {
      if (this.keys.delete(event.key.toLowerCase())) this.flush()
    }, { signal })
    video.addEventListener('dblclick', (event) => {
      const rect = video.getBoundingClientRect()
      if (rect.width && rect.height) teleport((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
    }, { signal })
    video.addEventListener('blur', () => this.clear(), { signal })
    window.addEventListener('blur', () => this.clear(), { signal })
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear() }, { signal })
    this.timer = setInterval(() => this.flush(), 1000 / 30)
  }

  private flush() {
    this.send({ v: 1, type: 'input', dx: this.dx, dy: this.dy, zoom: this.zoom,
      pan: this.pan, keys: [...this.keys] })
    this.dx = this.dy = this.zoom = 0
  }

  clear() {
    this.pointers.clear()
    this.keys.clear()
    this.dx = this.dy = this.zoom = 0
    this.flush()
  }

  dispose() { this.clear(); clearInterval(this.timer); this.events.abort() }
}
