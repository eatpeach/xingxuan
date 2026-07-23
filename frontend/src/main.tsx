import React from 'react'
import ReactDOM from 'react-dom/client'
import 'dayjs/locale/zh-cn'
import './index.css'
import App from './App'
import { initThemeColor } from './theme'

initThemeColor()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
