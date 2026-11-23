import type { ProxyView } from '@bf/core'

/** Nhãn ngắn cho ô chọn proxy: quốc gia (nếu đã kiểm tra) và địa chỉ. */
export function proxyOption(x: ProxyView): string {
  const where = x.lastStatus === 'ok' && x.lastCountry ? `${x.lastCountry} · ` : ''
  const dead = x.lastStatus === 'fail' ? ' (lỗi)' : ''
  return `${where}${x.host}:${x.port}${dead}`
}

/** Tên GPU gọn từ chuỗi WebGL, ví dụ "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x2560) Direct3D11…)" → "NVIDIA GeForce RTX 3060". */
export function gpuShort(renderer: string | null | undefined): string | null {
  if (!renderer) return null
  const m = /^ANGLE \([^,]+,\s*(.+?)(?:\s*\(0x[0-9A-Fa-f]+\))?(?:\s+Direct3D.*|,\s*.*)?\)$/.exec(
    renderer
  )
  const name = (m ? m[1] : renderer)
    .replace(/^ANGLE Metal Renderer:\s*/, '')
    .replace(/\(R\)|\(TM\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return name || null
}

export interface ScreenPreset {
  label: string
  width: number
  height: number
  scale: number
}

/** Các màn hình phổ biến theo hệ điều hành giả. Kích thước là điểm CSS (đã chia cho tỉ lệ điểm ảnh). */
export const SCREEN_PRESETS: Record<'macos' | 'windows' | 'linux', ScreenPreset[]> = {
  windows: [
    { label: 'Full HD 1920×1080', width: 1920, height: 1080, scale: 1 },
    { label: 'Laptop 1366×768', width: 1366, height: 768, scale: 1 },
    { label: 'Laptop Full HD, phóng 125% (1536×864)', width: 1536, height: 864, scale: 1.25 },
    { label: 'Laptop 1600×900', width: 1600, height: 900, scale: 1 },
    { label: '2K 2560×1440', width: 2560, height: 1440, scale: 1 },
    { label: 'Laptop 1440×900', width: 1440, height: 900, scale: 1 }
  ],
  macos: [
    { label: 'MacBook Air 13" (1470×956, Retina)', width: 1470, height: 956, scale: 2 },
    { label: 'MacBook Pro 14" (1512×982, Retina)', width: 1512, height: 982, scale: 2 },
    { label: 'MacBook Pro 16" (1728×1117, Retina)', width: 1728, height: 1117, scale: 2 },
    { label: 'MacBook cũ 1440×900 (Retina)', width: 1440, height: 900, scale: 2 },
    { label: 'Màn rời Full HD 1920×1080', width: 1920, height: 1080, scale: 1 },
    { label: 'Màn rời 2K 2560×1440', width: 2560, height: 1440, scale: 1 }
  ],
  linux: [
    { label: 'Full HD 1920×1080', width: 1920, height: 1080, scale: 1 },
    { label: 'Laptop 1366×768', width: 1366, height: 768, scale: 1 },
    { label: '2K 2560×1440', width: 2560, height: 1440, scale: 1 }
  ]
}

export function screenLabel(
  w: number | null,
  h: number | null,
  scale: number | null
): string | null {
  if (!w || !h) return null
  const s = scale ?? 1
  return s === 1 ? `${w}×${h}` : `${w}×${h} · tỉ lệ ${s}×`
}
