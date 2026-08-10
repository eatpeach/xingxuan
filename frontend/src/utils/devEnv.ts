/**
 * 「当前是不是一个完全本地的开发环境」——用于决定是否跳过登录页的人机验证滑块。
 * （20260810-21）
 *
 * 🔴 这是一道安全边界，单独成文件是为了能被一眼读完、单独审查。改它之前先读完这段。
 *
 * 滑块（`Login.tsx` 的 `SliderVerify`）的用途是**拦截脚本化登录**，
 * 配合后端登录限流使用。把它去掉的前提只有一个：
 * **它保护的东西一个都不在场** —— 后端是本机跑的、库是 seed 出来的假数据、
 * 账号是建库时生成的。此时"证明操作者是人"没有任何意义。
 *
 * 所以判据必须同时满足两条，缺一不可：
 *
 * 1. **构建期是 dev**（`import.meta.env.DEV`）
 *    Vite 在 `vite build` 时把它静态替换成 `false`，整个分支成为死代码被摇掉——
 *    **生产产物里根本不存在跳过逻辑**，不是"存在但不触发"。这是最强的一层。
 *
 * 2. **API 代理指向环回地址**（`__API_TARGET__`，由 `vite.config.ts` 的 define 注入）
 *    只有 dev 条件是不够的：dev server 也可以用
 *    `VITE_API_TARGET=https://www.xingxuan.cc npm run dev` 指向生产。
 *    那种情况下操作的是真库真账号，滑块必须照常出现。
 *
 * ⚠ 为什么**不用** `location.hostname === 'localhost'`：
 *    那只说明"页面是从本机开的"，代理照样可能指着生产站——
 *    正是最危险的那种组合（本地页面 + 生产数据 + 免滑块）。
 *
 * ⚠ 判据**不读取任何用户可控输入**：没有 URL 参数、没有 localStorage、没有 cookie、
 *    没有请求头。两个值都在开发者自己机器上的构建期确定。
 */

/** 环回地址白名单——只认这三个，不做模糊匹配 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** API 代理目标是不是环回地址 */
export function isLoopbackApiTarget(target: unknown): boolean {
  if (typeof target !== 'string' || target === '') return false
  try {
    const u = new URL(target)
    // 只接受 http/https，避免 file: 之类的奇怪协议绕过主机名判断
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return LOOPBACK_HOSTS.has(u.hostname)
  } catch {
    // 解析不了就当成不是本地 —— 判不准时一律保留滑块
    return false
  }
}

/**
 * 🔴 这里【故意】不导出一个把两个条件都包起来的 isLocalDevEnv()。
 *
 * 试过那种写法，实测生产包里跳过分支**没有被摇掉**：
 * `import.meta.env.DEV` 在函数体内被替换成 false 之后，esbuild 不做跨模块的常量传播，
 * 调用点拿到的仍是一个「函数调用」而不是字面量 false，于是 banner 的 JSX 和文案
 * 照样被打进产物（虽然运行时不可达）。
 *
 * 所以 **`import.meta.env.DEV` 这道门必须写在调用点**（见 Login.tsx）：
 * Vite 把它静态替换成 `false` → `false && ...` 折叠成 `false` → 整个分支被 DCE 删掉。
 * 本文件只留这个纯函数，不碰 import.meta。
 */
