/**
 * 任务代际控制：每次加载/替换递增 generation，旧任务的回调在写场景或
 * setState 前必须核对代际；AbortController 只负责网络/读流停止。
 * 重型解析本身不能强杀，因此解析完成后仍要由调用方检查并释放迟到结果。
 */
export class TaskGate {
  private generation = 0
  private controller: AbortController | null = null

  begin(): { generation: number; signal: AbortSignal } {
    this.controller?.abort()
    this.controller = new AbortController()
    this.generation += 1
    return { generation: this.generation, signal: this.controller.signal }
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation
  }

  cancel(): void {
    this.generation += 1
    this.controller?.abort()
    this.controller = null
  }

  get signal(): AbortSignal | null {
    return this.controller?.signal ?? null
  }
}

/**
 * 同一页面内重型解析串行执行。队列中的任务在开始前检查 signal；
 * 已开始的任务会跑完，但结果由代际检查决定是否释放。
 */
export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const run = this.tail.then(async () => {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      return task()
    })
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
