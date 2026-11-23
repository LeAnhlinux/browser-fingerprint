import type { CoreInfo } from '@bf/core'
import { IconDownload, IconFingerprint } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { api, cleanError } from './api'
import { Banner } from './ui'

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
      <div className="card">
        <div className="brand-mark">
          <IconFingerprint size={24} />
        </div>
        <h1>Chào mừng đến Browser Fingerprint</h1>
        <p>
          Trước khi tạo hồ sơ, app cần tải nhân trình duyệt: bản Chromium đã vá dấu vân tay
          (fingerprint-chromium {info.engineVersion}), khoảng 140–190 MB. File được tải từ GitHub
          Releases và kiểm tra SHA-256 trước khi cài. Chỉ cần làm một lần.
        </p>
        {error && <Banner kind="error">{error}</Banner>}
        {busy && (
          <>
            <div className="progress">
              <div style={{ width: `${percent}%` }} />
            </div>
            <p className="faint" style={{ fontSize: 12 }}>
              {progress
                ? `Đang tải ${mb(progress.received)} / ${mb(progress.total)} MB (${percent}%)`
                : 'Đang bắt đầu tải…'}
            </p>
          </>
        )}
        <button className="btn primary" disabled={busy} onClick={() => void install()}>
          <IconDownload size={15} />
          {busy ? 'Đang cài…' : 'Tải và cài nhân'}
        </button>
      </div>
    </div>
  )
}
