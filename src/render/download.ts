/**
 * 触发浏览器下载 + 文件名清洗。
 *
 * ⚠️ 这十几行单独一个模块，不能放回 exporters.ts：
 * 作品库只需要"下载一个 json"，如果从 exporters 引，就会把
 * PDF 排版 + jsPDF + html2canvas 整条链拖进首屏（P2-26）。
 */

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0)
      return code < 32 || code === 127 || code === 0x2028 || code === 0x2029 ? '_' : char
    })
    .join('')
  return (cleaned || '作品').slice(0, 60)
}

/** 导出包内主文件的统一命名：编号 + 作品名 + 输出类型。 */
export function exportFilename(order: number, base: string, label: string, extension: string): string {
  return `${order}.${base}（${label}）.${extension}`
}
