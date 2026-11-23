import type { CoreInfo } from '@bf/core'
import { useEffect, useState } from 'react'
import { api, cleanError } from './api'

export function EngineGate({
  info,
  onInstalled
}: {
  info: CoreInfo
  onInstalled: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null)
  const [error, setError] = useState('')

  useEffect(
    () => window.bf.onEngineProgress((received, total) => setProgress({ received, total })),
    []
  )

  const install = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await api.installEngine()
      onInstalled()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(false)
    }
  }

  const mb = (n: number): string => (n / 1024 / 1024).toFixed(0)
  const percent =
    progress && progress.total > 0 ? Math.round((progress.received / progress.total) * 100) : 0

  return (
    <div className="gate">
      <h1>Cần tải nhân trình duyệt</h1>
      <p>
        App dùng bản Chromium đã vá dấu vân tay (fingerprint-chromium {info.engineVersion}), tải từ
        GitHub Releases và kiểm tra SHA-256 trước khi cài. Dung lượng khoảng 140–190 MB.
      </p>
      {busy && progress && (
        <p>
          Đang tải: {mb(progress.received)} / {mb(progress.total)} MB ({percent}%)
        </p>
      )}
      {busy && !progress && <p>Đang bắt đầu tải…</p>}
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy} onClick={() => void install()}>
        {busy ? 'Đang cài…' : 'Tải và cài nhân'}
      </button>
    </div>
  )
}
