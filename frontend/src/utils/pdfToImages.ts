/**
 * 前端把 PDF 转成 JPEG 图片 → 绕过服务器 poppler / open_basedir 限制
 * 使用 pdfjs-dist；按需动态导入避免初始 bundle 膨胀
 */

let pdfjsLib: any = null

async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib
  pdfjsLib = await import('pdfjs-dist')
  // 配置 worker（用 CDN 上的 worker，避免本地构建复杂化）
  const v = pdfjsLib.version || '4.0.379'
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/build/pdf.worker.min.mjs`
  return pdfjsLib
}

/**
 * 把 PDF 的指定页转成 JPEG Blob
 * @param file PDF 文件
 * @param page 第几页（从 1 开始），默认 1
 * @param scale 渲染倍数（越大越清晰但越大），默认 2
 */
export async function pdfPageToJpeg(file: File, page = 1, scale = 2): Promise<Blob> {
  const pdfjs = await loadPdfjs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise

  if (page > pdf.numPages) page = 1
  const pdfPage = await pdf.getPage(page)
  const viewport = pdfPage.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await pdfPage.render({ canvasContext: ctx, viewport }).promise

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('PDF 转 JPEG 失败'))),
      'image/jpeg',
      0.92,
    )
  })
}

/**
 * 把 PDF 的所有页转成 JPEG Blob 数组（最多 maxPages 页）
 */
export async function pdfAllPagesToJpegs(
  file: File,
  maxPages = 5,
  scale = 2,
): Promise<Blob[]> {
  const pdfjs = await loadPdfjs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const pages = Math.min(pdf.numPages, maxPages)

  const blobs: Blob[] = []
  for (let i = 1; i <= pages; i++) {
    const pdfPage = await pdf.getPage(i)
    const viewport = pdfPage.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await pdfPage.render({ canvasContext: ctx, viewport }).promise
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PDF 转 JPEG 失败'))),
        'image/jpeg',
        0.92,
      )
    })
    blobs.push(blob)
  }
  return blobs
}

/**
 * 把 PDF 所有页拼成一张长图 JPEG（PDF 多页报价单适合用这个）
 */
export async function pdfToSingleLongJpeg(
  file: File,
  maxPages = 5,
  scale = 2,
): Promise<Blob> {
  const blobs = await pdfAllPagesToJpegs(file, maxPages, scale)
  if (blobs.length === 1) return blobs[0]

  // 多页 → 拼成一张
  const images = await Promise.all(
    blobs.map((b) => {
      const url = URL.createObjectURL(b)
      const img = new Image()
      return new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => {
          URL.revokeObjectURL(url)
          resolve(img)
        }
        img.onerror = reject
        img.src = url
      })
    }),
  )
  const width = Math.max(...images.map((i) => i.width))
  const totalHeight = images.reduce((s, i) => s + i.height, 0)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = totalHeight
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  let y = 0
  for (const img of images) {
    ctx.drawImage(img, 0, y)
    y += img.height
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('合并失败'))),
      'image/jpeg',
      0.9,
    )
  })
}

/** 判断 File 是 PDF */
export function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    /\.pdf$/i.test(file.name)
  )
}

/**
 * 自动转换：是 PDF 就转图，其他直接返回原 file
 * 返回新的 File 对象，可以直接当 image 上传
 */
export async function convertPdfToImageIfNeeded(file: File): Promise<File> {
  if (!isPdfFile(file)) return file
  const blob = await pdfToSingleLongJpeg(file, 5, 2)
  const newName = file.name.replace(/\.pdf$/i, '.jpg')
  return new File([blob], newName, { type: 'image/jpeg' })
}

/**
 * 把 PDF 逐页转成独立的 File（20260824）
 *
 * 取代 convertPdfToImageIfNeeded 的「竖向拼成一张长图」做法。
 * 拼长图会被 OpenAI 视觉接口缩到 2048px 以内：一张 5 页的 A4 长图缩完
 * 每页只剩 289px 宽，字全糊了 —— 这就是「PDF/表格识别经常漏行」的主因。
 * 一页一张分开传，每页都保住原分辨率。
 *
 * 非 PDF 原样返回单元素数组，调用方一套代码走到底。
 */
export async function pdfToImageFiles(file: File, maxPages = 6): Promise<File[]> {
  if (!isPdfFile(file)) return [file]
  const blobs = await pdfAllPagesToJpegs(file, maxPages, 2)
  const base = file.name.replace(/\.pdf$/i, '')
  return blobs.map((b, i) => new File([b], `${base}_p${i + 1}.jpg`, { type: 'image/jpeg' }))
}

/**
 * 把（可能多页的）文件塞进 FormData：file / file_2 / file_3 …
 * 后端 _aiUploadedImages() 按这个约定收。
 */
export async function appendFilesToForm(fd: FormData, file: File, maxPages = 6): Promise<number> {
  const files = await pdfToImageFiles(file, maxPages)
  files.forEach((f, i) => fd.append(i === 0 ? 'file' : `file_${i + 1}`, f))
  // PDF 自带文字层（不是扫描件）就把文字一起传：数字以文字为准，不靠 AI 看图认（20261123）
  if (isPdfFile(file)) {
    try {
      const text = await pdfToLayoutText(file, maxPages)
      if (text.replace(/\s/g, '').length >= 80) fd.append('pdf_text', text)
    } catch {
      // 读不出文字层就只传图，不影响识别
    }
  }
  return files.length
}

/**
 * 读 PDF 的文字层，按版面还原成一行一行的文本（同一行的格子之间用空格隔开）。
 * 扫描件没有文字层，返回空串。
 */
export async function pdfToLayoutText(file: File, maxPages = 6): Promise<string> {
  const pdfjs = await loadPdfjs()
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const out: string[] = []
  for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    const cells = (tc.items as any[])
      .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
      .map((it) => ({ s: it.str as string, x: it.transform[4] as number, y: it.transform[5] as number, w: (it.width as number) || 0 }))
    // 纵坐标相近的归成一行（表格里同一行的格子基线会差一两个点）
    cells.sort((a, b) => b.y - a.y || a.x - b.x)
    const lines: { y: number; cells: typeof cells }[] = []
    for (const c of cells) {
      const last = lines[lines.length - 1]
      if (last && Math.abs(last.y - c.y) <= 3) last.cells.push(c)
      else lines.push({ y: c.y, cells: [c] })
    }
    if (pdf.numPages > 1) out.push(`===== 第 ${p} 页 =====`)
    for (const ln of lines) {
      ln.cells.sort((a, b) => a.x - b.x)
      let s = ''
      let end = -1
      for (const c of ln.cells) {
        const gap = end < 0 ? 0 : c.x - end
        s += (gap > 10 ? '    ' : gap > 1.5 ? ' ' : '') + c.s
        end = c.x + c.w
      }
      out.push(s)
    }
  }
  return out.join('\n')
}
