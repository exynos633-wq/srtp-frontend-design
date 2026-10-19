import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from './app/router'
import './styles/global.css'

const container = document.getElementById('root')

if (container === null) {
  throw new Error('找不到根节点 #root，index.html 可能被改动过。')
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
