import type { ProfileView } from '@bf/core'
import { IconArrowsShuffle, IconRefresh } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { api, cleanError } from './api'
import { gpuShort, screenLabel } from './format'
import { Banner } from './ui'

interface Props {
  profile: ProfileView
  /** Biểu mẫu có thay đổi chưa lưu ảnh hưởng tới vân tay. */
  dirty: boolean
  onBusyChange?: (busy: boolean) => void
}

/** Hiện những gì trang web đọc được từ hồ sơ, đo bằng nhân thật. */
export function FingerprintCard({ profile, dirty, onBusyChange }: Props): React.JSX.Element {
  const fp = profile.fingerprint
  const [busy, setBusy] = useState<'measure' | 'shuffle' | null>(null)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  // Chỉ tự đo một lần cho mỗi seed, để lỗi đo không gây vòng lặp.
  const autoTried = useRef<string | null>(null)

  const guarded = async (
    kind: 'measure' | 'shuffle',
    fn: () => Promise<unknown>
  ): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(kind)
    onBusyChange?.(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      busyRef.current = false
      setBusy(null)
      onBusyChange?.(false)
    }
  }

  const measure = (): Promise<void> => guarded('measure', () => api.measureFingerprint(profile.id))

  useEffect(() => {
    const key = `${profile.id}|${profile.seed}`
    if (fp || autoTried.current === key) return
    autoTried.current = key
    void measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, profile.seed, fp])

  const shuffle = (): void => {
    const used = profile.lastLaunchedAt !== null
    if (
      used &&
      !window.confirm(
        'Đổi vân tay thì GPU, CPU, RAM, canvas, âm thanh… đều đổi. Trang đã đăng nhập sẽ thấy như một máy khác. Tiếp tục?'
      )
    ) {
      return
    }
    void guarded('shuffle', async () => {
      await api.regenerateFingerprint(profile.id)
      await api.measureFingerprint(profile.id)
    })
  }

  const screen = screenLabel(profile.screenWidth, profile.screenHeight, profile.screenScale)

  return (
    <div className="fp-card">
      <div className="fp-head">
        <span className="fp-title">Trang web sẽ thấy</span>
        <button
          className="btn sm"
          type="button"
          disabled={busy !== null}
          onClick={() => void measure()}
          title="Mở ẩn nhân với thiết lập đã lưu và đọc lại"
        >
          <IconRefresh size={14} />
          {busy === 'measure' ? 'Đang đo…' : 'Đo lại'}
        </button>
        <button
          className="btn sm"
          type="button"
          disabled={busy !== null}
          onClick={shuffle}
          title="Tạo seed mới: GPU, CPU, RAM và nhiễu canvas, âm thanh đổi theo"
        >
          <IconArrowsShuffle size={14} />
          {busy === 'shuffle' ? 'Đang đổi…' : 'Đổi vân tay'}
        </button>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      {dirty && (
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Bạn có thay đổi chưa lưu. Kết quả dưới đây theo thiết lập đã lưu.
        </p>
      )}
      {fp ? (
        <dl className="kv fp-kv">
          <dt>GPU</dt>
          <dd>
            <div>{gpuShort(fp.gpuRenderer) ?? 'Không có WebGL'}</div>
            {fp.gpuVendor && <div className="faint mono fp-raw">{fp.gpuRenderer}</div>}
          </dd>
          <dt>CPU</dt>
          <dd>{fp.cores ?? '?'} nhân</dd>
          <dt>RAM</dt>
          <dd>{fp.memory ? `${fp.memory} GB` : '?'}</dd>
          <dt>Màn hình</dt>
          <dd>{screen ?? <span className="warn-text">Màn hình thật của máy (không giả)</span>}</dd>
          <dt>Hệ điều hành</dt>
          <dd className="mono">{fp.platform}</dd>
          <dt>Múi giờ</dt>
          <dd>{fp.timezone}</dd>
          <dt>Ngôn ngữ</dt>
          <dd className="mono">{fp.languages.join(', ')}</dd>
          <dt>User-Agent</dt>
          <dd className="mono fp-raw">{fp.userAgent}</dd>
        </dl>
      ) : (
        <p className="faint" style={{ margin: 0 }}>
          {busy ? 'Đang mở ẩn nhân để đo, mất vài giây…' : 'Chưa đo.'}
        </p>
      )}
      <p className="faint" style={{ margin: '8px 0 0' }}>
        GPU, CPU, RAM do nhân chọn theo seed <span className="mono">{profile.seed}</span>, không gõ
        tay được. Muốn bộ khác thì bấm Đổi vân tay.
      </p>
    </div>
  )
}
