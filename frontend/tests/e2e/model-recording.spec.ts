import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'


async function openReady(page: Page): Promise<void> {
  await page.goto('/works/work_demo_001')
  await page.getByRole('button', { name: '开始预览' }).click()
  await page.waitForFunction(() => window.__srtpModelViewer?.getDebugState().phase === 'ready', undefined, {
    timeout: 120_000,
  })
  await page.waitForTimeout(1500)
}

function remuxedDuration(file: string, outputDir: string): number {
  const remuxed = path.join(outputDir, 'duration-probe.webm')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-c', 'copy', remuxed])
  const output = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    remuxed,
  ])
  return Number(String(output).trim())
}

function frameStats(file: string, seconds: number, outputDir: string): { min: number; max: number; bytes: number } {
  const frame = path.join(outputDir, `frame-${seconds}.png`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(seconds), '-i', file, '-frames:v', '1', frame])
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', frame, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 32 * 1024 * 1024 },
  )
  expect(raw.length).toBeGreaterThan(1000)
  let min = 255
  let max = 0
  for (const value of raw) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max, bytes: raw.length }
}

test.describe('35 秒真实录制与提前结束', () => {
  test('自动录满 35 秒，解码核实媒体时长、帧率与首中尾画面', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReady(page)
    const initial = await page.evaluate(() => window.__srtpModelViewer!.getDebugState())
    expect(initial.autoRotate.enabled).toBe(true)

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByRole('button', { name: '录制 35 秒' }).click()
    await page.waitForTimeout(1200)
    const started = await page.evaluate(() => window.__srtpModelViewer!.getDebugState())
    expect(started.recording).not.toBeNull()
    expect(started.recording!.width % 2).toBe(0)
    expect(started.recording!.height % 2).toBe(0)
    expect(Math.max(started.recording!.width, started.recording!.height)).toBeLessThanOrEqual(1280)
    expect(started.recording!.width / started.recording!.height).toBeCloseTo(
      started.stats!.width / started.stats!.height,
      1,
    )
    expect(started.autoRotate.enabled).toBe(true)
    expect(started.recording!.liveTracks).toBe(1)
    await expect(page.getByRole('button', { name: '停止录制' })).toBeVisible()
    await expect(page.getByText(/录制中 \d/)).toBeVisible()

    await page.waitForTimeout(2500)
    const continued = await page.evaluate(() => window.__srtpModelViewer!.getDebugState())
    const moved = Math.hypot(
      started.camera.position[0]! - continued.camera.position[0]!,
      started.camera.position[1]! - continued.camera.position[1]!,
      started.camera.position[2]! - continued.camera.position[2]!,
    )
    expect(moved).toBeGreaterThan(0.2)
    expect(continued.autoRotate.enabled).toBe(true)

    const download = await downloadPromise
    const suggested = download.suggestedFilename()
    expect(suggested).toContain('院落模型')
    expect(suggested).toMatch(/\d{8}-\d{6}\.(webm|mp4)$/)
    const file = testInfo.outputPath(suggested)
    await download.saveAs(file)
    const size = fs.statSync(file).size
    expect(size).toBeGreaterThan(20_000)

    const result = await page.evaluate(() => {
      const recording = window.__srtpModelViewer!.getLastRecording()
      return recording
        ? {
            mimeType: recording.mimeType,
            extension: recording.extension,
            wallClockMs: recording.wallClockMs,
            complete: recording.complete,
            reason: recording.reason,
            blobSize: recording.blob.size,
          }
        : null
    })
    expect(result).not.toBeNull()
    expect(result!.mimeType).toMatch(/^video\/(webm|mp4)/)
    expect(result!.complete).toBe(true)
    expect(result!.wallClockMs).toBeGreaterThan(34_000)
    expect(result!.wallClockMs).toBeLessThan(36_500)
    expect(result!.blobSize).toBe(size)
    const trackStates = await page.evaluate(() => window.__srtpModelViewer!.getDebugState().lastRecordingTrackStates)
    expect(trackStates).toEqual(['ended'])

    const ext = suggested.split('.').pop()
    expect(result!.extension).toBe(ext)
    const streams = JSON.parse(
      String(
        execFileSync('ffprobe', [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type',
          '-of',
          'json',
          file,
        ]),
      ),
    ) as { streams: Array<{ codec_type: string }> }
    expect(streams.streams).toHaveLength(1)
    expect(streams.streams[0]!.codec_type).toBe('video')
    const duration = remuxedDuration(file, testInfo.outputDir)
    expect(duration).toBeGreaterThan(34)
    expect(duration).toBeLessThan(36.5)

    // 真实 <video> 播放与首中尾 seek；不是只等计时器。
    const playbackPage = await page.context().newPage()
    const playback = await playbackPage.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
      const video = document.createElement('video')
      video.muted = true
      video.src = url
      document.body.append(video)
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve()
        video.onerror = () => reject(new Error('video decode error'))
        window.setTimeout(() => reject(new Error('video loadeddata timeout')), 15_000)
      })
      const dimensions = [video.videoWidth, video.videoHeight]
      await video.play()
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
      const first = video.currentTime
      const seek = (time: number) =>
        new Promise<void>((resolve, reject) => {
          const done = () => {
            cleanup()
            resolve()
          }
          const fail = () => {
            cleanup()
            reject(new Error('video seek error'))
          }
          const cleanup = () => {
            video.removeEventListener('seeked', done)
            video.removeEventListener('error', fail)
          }
          video.addEventListener('seeked', done)
          video.addEventListener('error', fail)
          video.currentTime = time
          window.setTimeout(() => {
            if (Math.abs(video.currentTime - time) < 1) done()
          }, 5000)
        })
      await seek(17)
      const middle = video.currentTime
      await seek(34)
      const last = video.currentTime
      const readyState = video.readyState
      URL.revokeObjectURL(url)
      video.remove()
      return { dimensions, first, middle, last, readyState }
    }, fs.readFileSync(file).toString('base64'))
    await playbackPage.close()
    expect(playback.dimensions).toEqual([started.recording!.width, started.recording!.height])
    expect(playback.first).toBeGreaterThan(0.2)
    expect(playback.middle).toBeCloseTo(17, 0)
    expect(playback.last).toBeCloseTo(34, 0)
    expect(playback.readyState).toBeGreaterThanOrEqual(2)

    const frames = [
      frameStats(file, 1, testInfo.outputDir),
      frameStats(file, 17, testInfo.outputDir),
      frameStats(file, 34, testInfo.outputDir),
    ]
    for (const frame of frames) {
      expect(frame.max - frame.min).toBeGreaterThan(20)
      expect(frame.bytes).toBe(started.recording!.width * started.recording!.height * 3)
    }

    const packets = JSON.parse(
      String(
        execFileSync('ffprobe', [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'packet=pts_time',
          '-of',
          'json',
          file,
        ]),
      ),
    ) as { packets: Array<{ pts_time: string }> }
    expect(packets.packets.length).toBeGreaterThan(34 * 25)
    expect(packets.packets.length).toBeLessThan(36.5 * 31)

    await expect(page.getByText(/已录 3[45]\.?.*完整/)).toBeVisible()
  })

  test('MediaRecorder 异步 error 提前结束，状态清理前禁止重入', async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReady(page)
    const noDownload = page.waitForEvent('download', { timeout: 1200 }).catch(() => null)
    await page.getByRole('button', { name: '录制 35 秒' }).click()
    await page.waitForTimeout(1200)
    await page.evaluate(() => {
      const viewer = window.__srtpModelViewer as unknown as {
        recording?: { recorder: MediaRecorder }
      }
      viewer.recording?.recorder.dispatchEvent(new Event('error'))
    })
    await expect
      .poll(() => page.evaluate(() => window.__srtpModelViewer!.getLastRecording()?.reason ?? null))
      .toBe('error')
    const result = await page.evaluate(() => {
      const recording = window.__srtpModelViewer!.getLastRecording()
      return recording
        ? {
            wallClockMs: recording.wallClockMs,
            complete: recording.complete,
            size: recording.blob.size,
          }
        : null
    })
    expect(result).not.toBeNull()
    expect(result!.complete).toBe(false)
    expect(result!.wallClockMs).toBeLessThan(10_000)
    expect(result!.size).toBeGreaterThan(1000)
    expect(await noDownload).toBeNull()
    await expect.poll(() => page.evaluate(() => window.__srtpModelViewer!.getDebugState().stopping)).toBe(false)
    // error 后可以重新开始，且旧判定的“完整”不会覆盖新状态。
    const recovered = await page.evaluate(async () => {
      const viewer = window.__srtpModelViewer as unknown as {
        startRecording: () => Promise<void>
      }
      await viewer.startRecording()
      const started = window.__srtpModelViewer!.getDebugState()
      return { recording: started.recording !== null }
    })
    expect(recovered.recording).toBe(true)
    await page.evaluate(async () => {
      const viewer = window.__srtpModelViewer as unknown as {
        stopRecording: (reason: string) => Promise<unknown>
      }
      await viewer.stopRecording('end')
    })
  })

  test('停止后同实例替换：旧结果保留旧模型身份，不下载也不覆盖新 UI', async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReady(page)
    const originalName = (await page.evaluate(() => window.__srtpModelViewer!.getDebugState().info?.sourceName)) ?? ''
    await page.getByRole('button', { name: '录制 35 秒' }).click()
    await page.waitForTimeout(800)
    const noDownload = page.waitForEvent('download', { timeout: 2200 }).catch(() => null)
    const result = await page.evaluate(async () => {
      const viewer = window.__srtpModelViewer as unknown as {
        stopRecording: (reason: string) => Promise<{
          reason: string
          sourceName: string
          complete: boolean
        } | null>
        load: (source: unknown, config: unknown) => Promise<void>
      }
      const stopping = viewer.stopRecording('manual')
      await viewer.load(
        {
          kind: 'url',
          url: '/__dev/models/asset_demo_001_model/ancient_chinese_courtyard_park.glb?v=recording-epoch',
          version: 'recording-epoch',
          name: '替换模型',
        },
        {},
      )
      const stopped = await stopping
      return {
        reason: stopped?.reason,
        sourceName: stopped?.sourceName,
        complete: stopped?.complete,
        currentName: window.__srtpModelViewer!.getDebugState().info?.sourceName,
      }
    })
    await expect
      .poll(() => page.evaluate(() => window.__srtpModelViewer!.getPhase()))
      .toBe('ready')
    expect(result.reason).toBe('manual')
    expect(result.sourceName).toBe(originalName)
    expect(result.currentName).toBe('替换模型')
    expect(result.complete).toBe(false)
    expect(await noDownload).toBeNull()
    await expect(page.getByText(/已录 /)).toHaveCount(0)
  })

  test('complete 停止过程中异步 error 优先，不把结果标完整', async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReady(page)
    await page.getByRole('button', { name: '录制 35 秒' }).click()
    await page.waitForTimeout(900)
    const noDownload = page.waitForEvent('download', { timeout: 1800 }).catch(() => null)
    const result = await page.evaluate(async () => {
      const viewer = window.__srtpModelViewer as unknown as {
        recording?: { recorder: MediaRecorder }
        stopRecording: (reason: string) => Promise<{
          reason: string
          complete: boolean
          wallClockMs: number
        } | null>
      }
      const recorder = viewer.recording?.recorder
      const stopping = viewer.stopRecording('complete')
      recorder?.dispatchEvent(new Event('error'))
      const stopped = await stopping
      return stopped ? { reason: stopped.reason, complete: stopped.complete, wallClockMs: stopped.wallClockMs } : null
    })
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('error')
    expect(result!.complete).toBe(false)
    expect(result!.wallClockMs).toBeLessThan(10_000)
    expect(await noDownload).toBeNull()
  })

  test('stop 未完成时 start 被拒绝，停止完成后再启动；卸载期间不下载', async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReady(page)
    await page.getByRole('button', { name: '录制 35 秒' }).click()
    await page.waitForTimeout(1000)
    const busy = await page.evaluate(async () => {
      const viewer = window.__srtpModelViewer as unknown as {
        stopRecording: (reason: string) => Promise<unknown>
        startRecording: () => Promise<void>
      }
      const stopping = viewer.stopRecording('end')
      const code = await viewer.startRecording().then(
        () => 'ok',
        (error: { code?: string }) => error.code ?? 'error',
      )
      await stopping
      return code
    })
    expect(busy).toBe('RECORDING_BUSY')
    await page.evaluate(async () => {
      const viewer = window.__srtpModelViewer as unknown as { startRecording: () => Promise<void>; stopRecording: (reason: string) => Promise<unknown> }
      await viewer.startRecording()
      await viewer.stopRecording('end')
    })

    await page.getByRole('button', { name: '录制 35 秒' }).click()
    await page.waitForTimeout(800)
    const downloadPromise = page.waitForEvent('download', { timeout: 1800 }).catch(() => null)
    await page.evaluate(() => {
      const viewer = window.__srtpModelViewer as unknown as {
        stopRecording: (reason: string) => Promise<unknown>
        dispose: () => void
      }
      void viewer.stopRecording('manual')
      viewer.dispose()
    })
    await page.getByRole('link', { name: '返回全部作品' }).click()
    await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
    expect(await downloadPromise).toBeNull()
  })

  test('隐藏页面提前结束，标记不足 35 秒且不自动下载', async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReady(page)
    await page.getByRole('button', { name: '录制 35 秒' }).click()
    await page.waitForTimeout(2200)
    const downloadPromise = page.waitForEvent('download', { timeout: 1200 }).catch(() => null)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const download = await downloadPromise
    expect(download).toBeNull()
    const result = await page.evaluate(() => {
      const recording = window.__srtpModelViewer?.getLastRecording()
      return recording
        ? {
            wallClockMs: recording.wallClockMs,
            complete: recording.complete,
            reason: recording.reason,
            blobSize: recording.blob.size,
          }
        : null
    })
    expect(result).not.toBeNull()
    expect(result!.complete).toBe(false)
    expect(result!.reason).toBe('hidden')
    expect(result!.wallClockMs).toBeGreaterThan(1_500)
    expect(result!.wallClockMs).toBeLessThan(10_000)
    expect(result!.blobSize).toBeGreaterThan(1000)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
  })

  test('卸载时不自动下载，也不留下录制 track', async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReady(page)
    await page.getByRole('button', { name: '录制 35 秒' }).click()
    await page.waitForTimeout(1500)
    const downloadPromise = page.waitForEvent('download', { timeout: 1500 }).catch(() => null)
    await page.getByRole('link', { name: '返回全部作品' }).click()
    await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
    const download = await downloadPromise
    expect(download).toBeNull()
    expect(await page.evaluate(() => window.__srtpModelViewer === undefined)).toBe(true)
  })
})
