import type { CookieImportResult, ProfileView } from '@bf/core'
import { useRef, useState } from 'react'
import { api, cleanError } from './api'

interface Props {
  profile: ProfileView
  onClose: () => void
}

const MAX_CHARS = 5_000_000
const MAX_SHOWN_ERRORS = 50

export function CookieDialog({ profile, onClose }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'import' | 'export' | null>(null)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CookieImportResult | null>(null)
  const [notice, setNotice] = useState('')
  const running = profile.run !== null && !profile.run.headless

  const guarded = async (kind: 'import' | 'export', fn: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(kind)
    setError('')
    setResult(null)
    setNotice('')
    try {
      await fn()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  const loadFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    if (file.size > MAX_CHARS) {
      setError('File quá lớn (tối đa 5 MB)')
      return
    }
    setError('')
    setText(await file.text())
  }

  const doImport = (): Promise<void> =>
    guarded('import', async () => {
      const r = await api.importCookies(profile.id, text)
      setResult(r)
      if (r.imported > 0) setText('')
    })

  const doExport = (): Promise<void> =>
    guarded('export', async () => {
      const r = await api.exportCookies(profile.id)
      setNotice(r.saved ? `Đã lưu ${r.count} cookie ra file.` : 'Đã huỷ, chưa lưu gì.')
    })

  const unit = result?.format === 'netscape' ? 'Dòng' : 'Mục'

  return (
    <div className="overlay">
      <div className="dialog">
        <h2>Cookie: {profile.name}</h2>
        {!running && (
          <p className="muted">
            Hồ sơ chưa chạy: app sẽ mở ẩn hồ sơ (vẫn qua proxy của nó), thao tác xong rồi đóng.
            Cookie phiên (không có hạn) sẽ bị bỏ qua vì chúng mất khi đóng trình duyệt; muốn nhập cả
            cookie phiên thì khởi động hồ sơ trước.
          </p>
        )}
        <div className="field import-box">
          <label>Dán cookie dạng JSON hoặc Netscape cookies.txt</label>
          <textarea
            rows={8}
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            placeholder={'[{"domain": ".example.com", "name": "sid", "value": "…"}]'}
          />
        </div>
        <div className="field">
          <label>Hoặc chọn file (.json, .txt)</label>
          <input
            type="file"
            accept=".json,.txt"
            disabled={busy !== null}
            onChange={(e) => {
              void loadFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
        {error && <p className="error">{error}</p>}
        {notice && <p className="check-ok">{notice}</p>}
        {result && (
          <div className="import-result">
            <p className={result.imported > 0 ? 'check-ok' : 'muted'}>
              Đã nhập {result.imported} cookie.
            </p>
            {result.failed > 0 && (
              <p className="error">{result.failed} cookie bị trình duyệt từ chối.</p>
            )}
            {result.sessionSkipped > 0 && (
              <p className="warn">
                Bỏ qua {result.sessionSkipped} cookie phiên vì hồ sơ không chạy.
              </p>
            )}
            {result.errors.slice(0, MAX_SHOWN_ERRORS).map((e) => (
              <p className="error" key={e.index}>
                {unit} {e.index}: {e.reason}
              </p>
            ))}
            {result.errors.length > MAX_SHOWN_ERRORS && (
              <p className="error">… và {result.errors.length - MAX_SHOWN_ERRORS} lỗi khác.</p>
            )}
          </div>
        )}
        <div className="dialog-actions">
          <button disabled={busy !== null} onClick={() => void doExport()}>
            {busy === 'export' ? 'Đang xuất…' : 'Xuất ra file JSON…'}
          </button>
          <span className="grow" />
          <button disabled={busy !== null} onClick={onClose}>
            Đóng
          </button>
          <button
            className="primary"
            disabled={busy !== null || text.trim() === ''}
            onClick={() => void doImport()}
          >
            {busy === 'import' ? 'Đang nhập…' : 'Nhập cookie'}
          </button>
        </div>
      </div>
    </div>
  )
}
