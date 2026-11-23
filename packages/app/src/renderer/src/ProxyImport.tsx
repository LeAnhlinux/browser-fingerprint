import type { ProxyImportResult, ProxyProtocol } from '@bf/core'
import { useState } from 'react'
import { api } from './api'

interface Props {
  run: (fn: () => Promise<unknown>) => Promise<boolean>
}

export function ProxyImport({ run }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [protocol, setProtocol] = useState<ProxyProtocol>('http')
  const [result, setResult] = useState<ProxyImportResult | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (busy || text.trim() === '') return
    setBusy(true)
    setResult(null)
    const box: { value: ProxyImportResult | null } = { value: null }
    const ok = await run(async () => {
      box.value = await api.importProxies(text, protocol)
    })
    setBusy(false)
    if (!ok || !box.value) return
    setResult(box.value)
    // Chỉ xoá ô nhập khi không còn dòng lỗi nào để người dùng sửa.
    if (box.value.errors.length === 0) setText('')
  }

  return (
    <div className="import-box">
      <div className="field">
        <label>
          Dán danh sách proxy, mỗi dòng một proxy: giao_thức://user:pass@host:port,
          user:pass@host:port, host:port:user:pass hoặc host:port
        </label>
        <textarea
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder={'socks5://user:pass@1.2.3.4:1080\n5.6.7.8:8080:user:pass'}
        />
      </div>
      <div className="row">
        <select value={protocol} onChange={(e) => setProtocol(e.target.value as ProxyProtocol)}>
          <option value="http">Mặc định HTTP</option>
          <option value="socks5">Mặc định SOCKS5</option>
        </select>
        <button disabled={busy || text.trim() === ''} onClick={() => void submit()}>
          {busy ? 'Đang nhập…' : 'Nhập danh sách'}
        </button>
      </div>
      {result && (
        <div className="import-result">
          <p>
            Đã thêm {result.created.length} proxy
            {result.skipped > 0 ? `, bỏ qua ${result.skipped} proxy trùng` : ''}
            {result.errors.length > 0 ? `, ${result.errors.length} dòng lỗi` : ''}.
          </p>
          {result.errors.map((e) => (
            <p className="error" key={e.line}>
              Dòng {e.line}: {e.reason}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
