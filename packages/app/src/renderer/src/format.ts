import type { ProxyView } from '@bf/core'

/** Nhãn ngắn cho ô chọn proxy: quốc gia (nếu đã kiểm tra) và địa chỉ. */
export function proxyOption(x: ProxyView): string {
  const where = x.lastStatus === 'ok' && x.lastCountry ? `${x.lastCountry} · ` : ''
  const dead = x.lastStatus === 'fail' ? ' (lỗi)' : ''
  return `${where}${x.host}:${x.port}${dead}`
}
