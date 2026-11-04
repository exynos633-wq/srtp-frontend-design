import { viewerMenuItem } from './support/viewer-menu'
import fs from 'node:fs'
import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    __remoteFixture: { commands: string[]; deletes: number; configs: number; modelReads: number;
      disconnect: () => void; stop: () => void }
  }
}

// 浏览器中的独立 WebRTC 对端，以动画 Canvas 提供视频；不假称真实 GPU 渲染。
test('WebRTC 协议桩：真实收流、共用工具栏、PNG、35 秒录制、断流降级与释放', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.goto('/not-found-protocol-test')
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js'
    const domPath = '/node_modules/.vite/deps/react-dom_client.js'
    const componentPath = '/src/components/works/PreviewViewer.tsx'
    const protocolPath = '/src/viewer/RemoteModelViewer.ts'
    const [{ default: React }, { default: ReactDOM }, { PreviewViewer }, { requiredRemoteCommands }] = await Promise.all([
      import(reactPath), import(domPath), import(componentPath), import(protocolPath),
    ])
    const { createElement } = React
    const { createRoot } = ReactDOM
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;background:#101519;z-index:9999;padding:24px;overflow:auto'
    document.body.append(host)
    const root = createRoot(host)
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')!
    const draw = setInterval(() => {
      ctx.fillStyle = '#173e4a'
      ctx.fillRect(0, 0, 640, 360)
      ctx.fillStyle = '#eab366'
      ctx.fillRect((performance.now() / 20) % 500, 100, 100, 120)
    }, 33)
    const stream = canvas.captureStream(30)
    const peer = new RTCPeerConnection({ iceServers: [] })
    peer.addTrack(stream.getVideoTracks()[0]!, stream)
    const fixture = window.__remoteFixture = { commands: [] as string[], deletes: 0, configs: 0, modelReads: 0,
      disconnect: () => peer.close(), stop: () => {
        root.unmount(); peer.close(); clearInterval(draw); stream.getTracks().forEach((track) => track.stop()); host.remove()
      } }
    const info = { format: 'mesh-ply', sourceName: '协议桩网格', bytes: 1, sourceUp: 'y',
      orientation: { x: 0, y: 0, z: 0 }, bounds: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1], center: [0.5, 0.5, 0.5] },
      splats: null, triangles: 1, materials: 1, textures: 0, shDegree: null, hasEmissive: null }
    peer.ondatachannel = ({ channel }) => {
      channel.onopen = () => channel.send(JSON.stringify({ v: 1, type: 'ready', info,
        capabilities: requiredRemoteCommands(info),
        walkDefaults: { ground: 0, eyeHeight: 1, start: [0, 0], area: null, areaTrusted: false } }))
      channel.onmessage = ({ data }) => {
        const msg = JSON.parse(data)
        if (msg.type === 'command') {
          fixture.commands.push(msg.name)
          channel.send(JSON.stringify({ v: 1, type: 'ack', id: msg.id, ok: true }))
        }
      }
    }
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
      const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
      if (url.pathname === '/api/preview-sessions' && init?.method === 'POST') {
        return json({ sessionId: 'fixture-1', status: 'creating', expiresAt: '2030-01-01T00:00:00Z',
          connection: { kind: 'webrtc', protocolVersion: 1, offerUrl: '/rtc/fixture-offer', iceServers: [] } })
      }
      if (url.pathname === '/rtc/fixture-offer') {
        await peer.setRemoteDescription(JSON.parse(String(init?.body)))
        await peer.setLocalDescription(await peer.createAnswer())
        if (peer.iceGatheringState !== 'complete') await new Promise<void>((resolve) => {
          peer.addEventListener('icegatheringstatechange', () => { if (peer.iceGatheringState === 'complete') resolve() })
        })
        return json(peer.localDescription)
      }
      if (url.pathname.endsWith('/fixture-1/heartbeat')) return json({ status: 'ready' })
      if (url.pathname.endsWith('/fixture-1') && init?.method === 'DELETE') { fixture.deletes++; return new Response(null, { status: 204 }) }
      if (url.pathname === '/fixture-model.ply') {
        fixture.modelReads++
        return new Response('ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n')
      }
      return originalFetch(input, init)
    }
    root.render(createElement(PreviewViewer, {
      work: { id: 'fixture-work', name: '协议桩网格', coverUrl: '', modelFormat: 'mesh-ply' },
      resolvePreviewConfig: async () => {
        fixture.configs++
        return { workId: 'fixture-work', mode: 'remote', version: 'v1',
          source: { kind: 'url', url: '/fixture-model.ply', version: 'v1' }, view: {} }
      },
    }))
  })
  await expect(page.getByText('封面待预览')).toBeVisible()
  expect(await page.evaluate(() => window.__remoteFixture.configs)).toBe(0)
  await page.getByRole('button', { name: '开始预览' }).click()
  await expect(page.getByText('真实模型 · GPU 远程渲染')).toBeVisible({ timeout: 35_000 })
  await expect(page.locator('video[data-viewer-video]')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('remote-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('remote-mobile.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 900 })
  expect(await page.evaluate(() => window.__remoteFixture.modelReads)).toBe(0)
  await page.getByRole('button', { name: '复位视角', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__remoteFixture.commands)).toContain('resetView')
  const pngDownload = page.waitForEvent('download')
  await (await viewerMenuItem(page, '保存 PNG 截图')).click()
  const png = await pngDownload
  const data = fs.readFileSync((await png.path())!)
  expect(data.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(data.readUInt32BE(16)).toBe(640)
  await (await viewerMenuItem(page, '录制 35 秒')).click()
  await expect((await viewerMenuItem(page, '停止录制'))).toBeVisible()
  await page.waitForTimeout(500)
  await (await viewerMenuItem(page, '停止录制')).click()
  await expect((await viewerMenuItem(page, '下载视频'))).toBeVisible()
  expect(await page.locator('[data-viewer-video]').evaluate((element) =>
    ((element as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]?.readyState)).toBe('live')
  await (await viewerMenuItem(page, '录制 35 秒')).click()
  await expect((await viewerMenuItem(page, '停止录制'))).toBeVisible()
  await expect((await viewerMenuItem(page, '下载视频'))).toBeVisible({ timeout: 40_000 })
  const videoDownload = page.waitForEvent('download')
  await (await viewerMenuItem(page, '下载视频')).click()
  const recording = await videoDownload
  const bytes = fs.readFileSync((await recording.path())!)
  expect(bytes.length).toBeGreaterThan(1000)
  const decoded = await page.evaluate(async ({ values, mime }) => {
    const blob = new Blob([new Uint8Array(values)], { type: mime })
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.src = url
    try {
      await video.play()
      video.currentTime = 34
      await new Promise<void>((resolve, reject) => { video.onseeked = () => resolve(); video.onerror = () => reject(new Error('decode failed')) })
      return { width: video.videoWidth, time: video.currentTime }
    } finally { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url) }
  }, { values: Array.from(bytes), mime: recording.suggestedFilename().endsWith('.mp4') ? 'video/mp4' : 'video/webm' })
  expect(decoded.width).toBe(640)
  expect(decoded.time).toBeGreaterThan(33)
  await page.evaluate(() => window.__remoteFixture.disconnect())
  await expect(page.getByText('远程预览暂不可用，已切换本机渲染。')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-viewer-phase="ready"]')).toBeVisible()
  expect(await page.evaluate(() => window.__remoteFixture.modelReads)).toBe(1)
  expect(await page.evaluate(() => window.__remoteFixture.configs)).toBe(2)
  await expect.poll(() => page.evaluate(() => window.__remoteFixture.deletes)).toBe(1)
  await (await viewerMenuItem(page, '结束预览')).click()
  await expect(page.locator('[data-viewer-video]')).toHaveCount(0)
  await page.evaluate(() => window.__remoteFixture.stop())
})
