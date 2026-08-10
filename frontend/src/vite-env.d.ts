/// <reference types="vite/client" />

/**
 * vite.config.ts 用 define 注入的代理目标（20260810-21）。
 * 只用于「后端是不是本地」的判据，见 utils/devEnv.ts。
 */
declare const __API_TARGET__: string
