import type { CapMonsterStatus } from '@bf/core'
import { IconDownload, IconRefresh } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { api, cleanError } from './api'
import { Banner } from './ui'

/** Thẻ CapMonster trong trang Cài đặt: key (không bao giờ hiện lại), số dư, cài/cập nhật extension. */
export function CapMonsterCard(): React.JSX.Element {
  const [status, setStatus] = useState<CapMonsterStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'key' | 'balance' | 'install' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [balance, setBalance] = useState<number | null>(null)

  const reload = useCallback(async () => {
    try {
      setStatus(await api.capmonsterStatus())
    } catch (e) {
      setError(cleanError(e))
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải trạng thái ban đầu và khi dữ liệu đổi
    void reload()
    return window.bf.onChange(() => void reload())
  }, [reload])

  const run = async (what: NonNullable<typeof busy>, fn: () => Promise<void>): Promise<void> => {
    setBusy(what)
    setError(null)
    setNotice(null)
    try {
      await fn()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(null)
    }
  }

  const saveKey = (): Promise<void> =>
    run('key', async () => {
      await api.setCapMonsterKey(key)
      setKey('')
      await reload()
      try {
        setBalance(await api.capmonsterBalance())
        setNotice('Đã lưu key.')
      } catch (e) {
        setBalance(null)
        setError(`Đã lưu key, nhưng kiểm tra với CapMonster thất bại: ${cleanError(e)}`)
      }
    })

  const removeKey = (): void => {
    if (
      !window.confirm(
        'Xoá API key CapMonster khỏi app? Extension trong các hồ sơ sẽ không còn key từ lần mở sau.'
      )
    )
      return
    void run('key', async () => {
      await api.setCapMonsterKey(null)
      setBalance(null)
      await reload()
    })
  }

  const checkBalance = (): Promise<void> =>
    run('balance', async () => {
      setBalance(await api.capmonsterBalance())
    })

  const install = (): Promise<void> =>
    run('install', async () => {
      const ext = await api.installCapMonsterExtension()
      setNotice(`Đã cài extension ${ext.name} ${ext.version}.`)
      await reload()
    })

  const ext = status?.extension ?? null
  return (
    <div className="card card-pad">
      <div className="card-head">
        <h2>CapMonster (giải captcha)</h2>
        {status?.hasKey ? (
          <span className="pill ok">
            <span className="dot ok" />
            Đã có key
          </span>
        ) : (
          <span className="pill">
            <span className="dot idle" />
            Chưa có key
          </span>
        )}
      </div>
      {error && (
        <Banner kind="error" onClose={() => setError(null)}>
          {error}
        </Banner>
      )}
      {status?.keyUnreadable && (
        <Banner kind="warn">
          Không đọc được API key đã lưu (có thể do máy đổi keychain). Hãy nhập lại key; trong lúc đó
          hồ sơ vẫn mở được nhưng extension không có key.
        </Banner>
      )}
      {notice && (
        <Banner kind="ok" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      <div className="field">
        <label htmlFor="cm-key">API key</label>
        <div className="inline-form">
          <input
            id="cm-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={
              status?.hasKey
                ? 'Đã lưu. Nhập key mới để thay'
                : 'Dán API key từ trang capmonster.cloud'
            }
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && key.trim()) void saveKey()
            }}
          />
          <button
            className="btn primary"
            disabled={busy !== null || !key.trim()}
            onClick={() => void saveKey()}
          >
            Lưu
          </button>
          {status?.hasKey && (
            <button className="btn" disabled={busy !== null} onClick={removeKey}>
              Xoá
            </button>
          )}
        </div>
        <span className="hint">Key được mã hoá trong app và không bao giờ hiện lại.</span>
      </div>

      <dl className="kv" style={{ marginBottom: 14 }}>
        <dt>Số dư</dt>
        <dd>
          {balance !== null ? `$${balance}` : '—'}{' '}
          {status?.hasKey && (
            <button
              className="link-btn"
              disabled={busy !== null}
              onClick={() => void checkBalance()}
            >
              {busy === 'balance' ? 'Đang kiểm tra…' : 'Kiểm tra'}
            </button>
          )}
        </dd>
        <dt>Extension</dt>
        <dd>{ext ? `${ext.name} ${ext.version}` : 'Chưa cài'}</dd>
      </dl>

      <button className="btn" disabled={busy !== null} onClick={() => void install()}>
        {ext ? <IconRefresh size={15} /> : <IconDownload size={15} />}
        {busy === 'install' ? 'Đang tải…' : ext ? 'Cập nhật extension' : 'Cài extension'}
      </button>
      <p className="faint" style={{ marginTop: 12 }}>
        Gán extension CapMonster cho nhóm (trang Extension) hoặc cho từng hồ sơ; mỗi lần mở hồ sơ,
        app tự nạp key vào extension. Hồ sơ nào đã tự gõ key trong cửa sổ extension thì dùng key đó.
        Script gọi giải captcha qua lệnh <span className="mono">bf captcha</span>, MCP hoặc REST
        (xem hướng dẫn).
      </p>
    </div>
  )
}
