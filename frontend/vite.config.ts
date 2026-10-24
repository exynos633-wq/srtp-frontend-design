import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 仅开发服务器：把 Mock 种子作品的资源编号映射到仓库根目录的三件真实模型。
 * 路径由服务端白名单决定，不放开目录、不进 public、不打入构建；未知编号返回 404，
 * 模拟替换绑定后不会继续命中旧文件。
 */
const DEV_MODEL_FILES: Record<string, string> = {
  asset_demo_001_model: 'ancient_chinese_courtyard_park.glb',
  asset_demo_002_model: 'great_wall_survey.glb',
  asset_demo_003_model: '丘陵.ply',
}

function devModelServer(): Plugin {
  return {
    name: 'srtp-dev-model-whitelist',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/models', (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          next()
          return
        }
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const assetId = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] ?? '')
        const file = DEV_MODEL_FILES[assetId]
        if (!file) {
          response.statusCode = 404
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(
            JSON.stringify({
              error: {
                code: 'DEV_MODEL_NOT_MAPPED',
                message: '该资源编号没有本地开发映射；模拟替换上传不含真实文件内容。',
              },
            }),
          )
          return
        }
        const absolute = path.join(projectRoot, file)
        if (!fs.existsSync(absolute)) {
          response.statusCode = 404
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(
            JSON.stringify({
              error: { code: 'DEV_MODEL_FILE_MISSING', message: `本地映射文件不存在：${file}` },
            }),
          )
          return
        }
        const stat = fs.statSync(absolute)
        const contentType = file.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream'
        response.setHeader('Accept-Ranges', 'bytes')
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Content-Type', contentType)
        const range = request.headers.range
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range)
          if (!match) {
            response.statusCode = 416
            response.setHeader('Content-Range', `bytes */${stat.size}`)
            response.end()
            return
          }
          const suffixLength = match[1] === '' ? Number(match[2]) : null
          const start =
            suffixLength !== null ? Math.max(0, stat.size - suffixLength) : Number(match[1])
          const end =
            suffixLength !== null
              ? stat.size - 1
              : match[2] === ''
                ? stat.size - 1
                : Math.min(Number(match[2]), stat.size - 1)
          if (
            !Number.isInteger(start) ||
            !Number.isInteger(end) ||
            start < 0 ||
            start > end ||
            (suffixLength !== null && suffixLength <= 0)
          ) {
            response.statusCode = 416
            response.setHeader('Content-Range', `bytes */${stat.size}`)
            response.end()
            return
          }
          response.statusCode = 206
          response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
          response.setHeader('Content-Length', String(end - start + 1))
          if (request.method === 'HEAD') {
            response.end()
            return
          }
          fs.createReadStream(absolute, { start, end }).pipe(response)
          return
        }
        response.statusCode = 200
        response.setHeader('Content-Length', String(stat.size))
        if (request.method === 'HEAD') {
          response.end()
          return
        }
        fs.createReadStream(absolute).pipe(response)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devModelServer()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/media': 'http://127.0.0.1:8787',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    css: true,
  },
})
