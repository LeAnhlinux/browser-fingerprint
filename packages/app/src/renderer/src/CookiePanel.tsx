import type { CookieImportResult, ProfileView } from '@bf/core'
import { IconDownload, IconFileUpload, IconUpload } from '@tabler/icons-react'
import { useRef, useState } from 'react'
import { api, cleanError } from './api'
import { Banner } from './ui'

interface Props {
  profile: ProfileView
  onBusyChange: (busy: boolean) => void
}

const MAX_BYTES = 5_000_000
const MAX_SHOWN_ERRORS = 50

export function CookiePanel({ profile, onBusyChange }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'import' | 'export' | null>(null)
  const busyRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CookieImportResult | null>(null)
  const [notice, setNotice] = useState('')
  const running = profile.run !== null && !profile.run.headless

  const guarded = async (kind: 'import' | 'export', fn: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(kind)
    onBusyChange(true)
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
      onBusyChange(false)
    }
  }

  const loadFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    if (file.size > MAX_BYTES) {
      setError('File quá lớn (tối đa 5 MB)')
      return
    }
    setError('')
    try {
      setText(await file.text())
    } catch {
      setError('Không đọc được file')
    }
  }

  const doImport = (): Promise<void> =>
    guarded('import', async () => {
      const r = await api.importCookies(profile.id, text)
      setResult(r)
      if (r.imported > 0 && r.failed === 0 && r.sessionSkipped === 0 && r.errors.length === 0) {
        setText('')
      }
    })

  const doExport = (): Promise<void> =>
    guarded('export', async () => {
      const r = await api.exportCookies(profile.id)
      setNotice(r.saved ? `Đã lưu ${r.count} cookie ra file.` : 'Đã huỷ, chưa lưu gì.')
    })

  const unit = result?.format === 'netscape' ? 'Dòng' : 'Mục'

  return (
    <>
      <div className="drawer-body">
        {!running && (
          <Banner kind="info">
            Hồ sơ chưa chạy: app sẽ mở ẩn hồ sơ (vẫn qua proxy của nó), thao tác xong rồi đóng.
            Cookie phiên (không có hạn) sẽ bị bỏ qua vì chúng mất khi đóng trình duyệt; muốn nhập cả
            cookie phiên thì khởi động hồ sơ trước.
          </Banner>
        )}
        {error && <Banner kind="error">{error}</Banner>}
        {notice && <Banner kind="ok">{notice}</Banner>}
        {result && (
          <Banner kind={result.imported > 0 && result.errors.length === 0 ? 'ok' : 'warn'}>
            <strong>Đã nhập {result.imported} cookie.</strong>
            {result.failed > 0 && ` ${result.failed} cookie bị trình duyệt từ chối.`}
            {result.sessionSkipped > 0 &&
              ` Bỏ qua ${result.sessionSkipped} cookie phiên vì hồ sơ không chạy.`}
            {result.errors.length > 0 && (
              <div className="result-list">
                {result.errors.slice(0, MAX_SHOWN_ERRORS).map((e) => (
                  <p key={e.index}>
                    {unit} {e.index}: {e.reason}
                  </p>
                ))}
                {result.errors.length > MAX_SHOWN_ERRORS && (
                  <p>… và {result.errors.length - MAX_SHOWN_ERRORS} lỗi khác.</p>
                )}
              </div>
            )}
          </Banner>
        )}

        <section className="section">
          <h3>Nhập cookie</h3>
          <div className="field">
            <label htmlFor="ck-text">
              Dán JSON (kiểu xuất của các extension cookie) hoặc Netscape cookies.txt
            </label>
            <textarea
              id="ck-text"
              className="mono"
              rows={9}
              value={text}
              spellCheck={false}
              onChange={(e) => setText(e.target.value)}
              placeholder={'[{"domain": ".example.com", "name": "sid", "value": "…"}]'}
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.txt"
            hidden
            onChange={(e) => {
              void loadFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <button
            className="btn sm"
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
          >
            <IconFileUpload size={14} />
            Chọn file .json hoặc .txt…
          </button>
        </section>

        <section className="section">
          <h3>Xuất cookie</h3>
          <p className="muted" style={{ marginBottom: 10 }}>
            Lưu toàn bộ cookie của hồ sơ ra một file JSON nhập lại được. File chứa phiên đăng nhập:
            ai có file là vào được tài khoản, hãy giữ như giữ mật khẩu.
          </p>
          <button className="btn" disabled={busy !== null} onClick={() => void doExport()}>
            <IconDownload size={15} />
            {busy === 'export' ? 'Đang xuất…' : 'Xuất ra file JSON…'}
          </button>
        </section>
      </div>
      <div className="drawer-foot">
        <span className="spacer" />
        <button
          className="btn primary"
          disabled={busy !== null || text.trim() === ''}
          onClick={() => void doImport()}
        >
          <IconUpload size={15} />
          {busy === 'import' ? 'Đang nhập…' : 'Nhập cookie'}
        </button>
      </div>
    </>
  )
}
