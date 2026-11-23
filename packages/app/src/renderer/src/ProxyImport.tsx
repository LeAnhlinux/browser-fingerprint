import type { ProxyImportResult, ProxyProtocol } from '@bf/core'
import { useState } from 'react'
import { api, cleanError } from './api'
import { Banner } from './ui'

interface Props {
  run: (fn: () => Promise<unknown>) => Promise<boolean>
}

export function ProxyImport({ run }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [protocol, setProtocol] = useState<ProxyProtocol>('http')
  const [result, setResult] = useState<ProxyImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  const submit = async (): Promise<void> => {
    if (busy || text.trim() === '') return
    setBusy(true)
    const submitted = text
    setResult(null)
    setFailure('')
    const box: { value: ProxyImportResult | null } = { value: null }
    const ok = await run(async () => {
      try {
        box.value = await api.importProxies(submitted, protocol)
      } catch (e) {
        // Hiện lỗi ngay trong ngăn nhập, không đẩy ra trang.
        setFailure(cleanError(e))
      }
    })
    setBusy(false)
    if (!ok || !box.value) return
    setResult(box.value)
    // Chỉ xoá ô nhập khi không còn dòng lỗi nào để người dùng sửa.
    if (box.value.errors.length === 0) setText((cur) => (cur === submitted ? '' : cur))
  }

  return (
    <>
      <div className="drawer-body">
        {failure && <Banner kind="error">{failure}</Banner>}
        {result && (
          <Banner kind={result.errors.length === 0 ? 'ok' : 'warn'}>
            <strong>Đã thêm {result.created.length} proxy.</strong>
            {result.skipped > 0 && ` Bỏ qua ${result.skipped} proxy trùng.`}
            {result.errors.length > 0 && (
              <div className="result-list">
                {result.errors.map((e) => (
                  <p key={e.line}>
                    Dòng {e.line}: {e.reason}
                  </p>
                ))}
              </div>
            )}
          </Banner>
        )}
        <div className="field">
          <label htmlFor="pi-text">Mỗi dòng một proxy</label>
          <textarea
            id="pi-text"
            className="mono"
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder={
              'socks5://user:pass@1.2.3.4:1080\n5.6.7.8:8080:user:pass\nuser:pass@9.9.9.9:3128\n10.0.0.1:8080'
            }
          />
          <span className="hint">
            Nhận các dạng giao_thức://user:pass@host:port, user:pass@host:port, host:port:user:pass
            và host:port. Dòng trống và dòng bắt đầu bằng # bị bỏ qua; proxy trùng không được thêm
            lần hai.
          </span>
        </div>
        <div className="field">
          <label htmlFor="pi-proto">Giao thức cho dòng không ghi giao thức</label>
          <select
            id="pi-proto"
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as ProxyProtocol)}
          >
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </div>
      </div>
      <div className="drawer-foot">
        <span className="spacer" />
        <button
          className="btn primary"
          disabled={busy || text.trim() === ''}
          onClick={() => void submit()}
        >
          {busy ? 'Đang nhập…' : 'Nhập danh sách'}
        </button>
      </div>
    </>
  )
}
