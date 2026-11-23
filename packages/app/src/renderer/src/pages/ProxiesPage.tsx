import type { ProxyProtocol, ProxyView } from '@bf/core'
import {
  IconList,
  IconPlus,
  IconRefresh,
  IconServer,
  IconTrash,
  IconWorld
} from '@tabler/icons-react'
import { useState } from 'react'
import { ProxyImport } from '../ProxyImport'
import { api, cleanError } from '../api'
import { Banner, CloseButton, Drawer, ProxyStatus } from '../ui'

interface Props {
  proxies: ProxyView[]
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  error: string
  clearError: () => void
}

type AddTab = 'one' | 'list'

export function ProxiesPage({ proxies, run, error, clearError }: Props): React.JSX.Element {
  const [checking, setChecking] = useState<Set<string>>(new Set())
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState<AddTab | null>(null)

  const check = async (ids: string[], single: boolean): Promise<void> => {
    setChecking((prev) => new Set([...prev, ...ids]))
    setCheckErrors((prev) => {
      const next = { ...prev }
      for (const id of ids) delete next[id]
      return next
    })
    await run(async () => {
      try {
        if (single) await api.checkProxy(ids[0])
        else await api.checkProxies(ids)
      } catch (e) {
        // Lỗi của lần kiểm tra một proxy hiện ngay trên dòng proxy đó.
        if (single) setCheckErrors((prev) => ({ ...prev, [ids[0]]: cleanError(e) }))
        else throw e
      }
    })
    setChecking((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
  }

  const remove = (x: ProxyView): void => {
    if (window.confirm(`Xoá proxy ${x.host}:${x.port}?`)) void run(() => api.deleteProxy(x.id))
  }

  const alive = proxies.filter((x) => x.lastStatus === 'ok').length
  const dead = proxies.filter((x) => x.lastStatus === 'fail').length

  return (
    <div className="page">
      <div className="page-head">
        <h1>Proxy</h1>
        <button
          className="btn"
          disabled={proxies.length === 0 || checking.size > 0}
          onClick={() =>
            void check(
              proxies.map((x) => x.id),
              false
            )
          }
        >
          <IconRefresh size={15} />
          {checking.size > 0 ? 'Đang kiểm tra…' : 'Kiểm tra tất cả'}
        </button>
        <button
          className="btn primary"
          onClick={() => {
            clearError()
            setAdding('one')
          }}
        >
          <IconPlus size={15} />
          Thêm proxy
        </button>
      </div>
      {proxies.length > 0 && (
        <p className="page-sub">
          {proxies.length} proxy · <span className="text-ok">{alive} sống</span>
          {dead > 0 && (
            <>
              {' '}
              · <span className="text-danger">{dead} lỗi</span>
            </>
          )}{' '}
          · Kiểm tra gửi một request tra IP qua chính proxy đó.
        </p>
      )}

      {error && !adding && (
        <Banner kind="error" onClose={clearError}>
          {error}
        </Banner>
      )}

      <div className="card">
        {proxies.length === 0 ? (
          <div className="empty">
            <IconWorld size={36} stroke={1.5} />
            <h2>Thêm proxy để mỗi hồ sơ có IP riêng</h2>
            <p>Thêm từng proxy, hoặc dán cả danh sách mỗi dòng một proxy.</p>
            <button className="btn primary" onClick={() => setAdding('one')}>
              <IconPlus size={15} />
              Thêm proxy
            </button>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Địa chỉ</th>
                <th>Tài khoản</th>
                <th>Kiểm tra gần nhất</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {proxies.map((x) => (
                <tr key={x.id}>
                  <td>
                    <div className="cell-title mono">
                      {x.host}:{x.port}
                    </div>
                    <div className="cell-sub">{x.protocol.toUpperCase()}</div>
                  </td>
                  <td>
                    {x.username ? (
                      <span>
                        <span className="mono">{x.username}</span>
                        {x.hasPassword ? <span className="faint"> · có mật khẩu</span> : ''}
                      </span>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td>
                    <ProxyStatus
                      proxy={x}
                      checking={checking.has(x.id)}
                      error={checkErrors[x.id]}
                    />
                  </td>
                  <td className="col-actions">
                    <button
                      className="icon-btn"
                      title="Kiểm tra"
                      aria-label={`Kiểm tra ${x.host}:${x.port}`}
                      disabled={checking.has(x.id)}
                      onClick={() => void check([x.id], true)}
                    >
                      <IconRefresh size={16} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Xoá"
                      aria-label={`Xoá ${x.host}:${x.port}`}
                      onClick={() => remove(x)}
                    >
                      <IconTrash size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {adding && (
        <Drawer
          onClose={() => {
            clearError()
            setAdding(null)
          }}
        >
          <div className="drawer-head">
            <div className="drawer-title">
              <h2>Thêm proxy</h2>
              <CloseButton
                onClick={() => {
                  clearError()
                  setAdding(null)
                }}
              />
            </div>
            <div className="tabs" role="tablist">
              <button
                role="tab"
                aria-selected={adding === 'one'}
                className={`tab${adding === 'one' ? ' active' : ''}`}
                onClick={() => setAdding('one')}
              >
                <IconServer size={15} />
                Một proxy
              </button>
              <button
                role="tab"
                aria-selected={adding === 'list'}
                className={`tab${adding === 'list' ? ' active' : ''}`}
                onClick={() => setAdding('list')}
              >
                <IconList size={15} />
                Dán danh sách
              </button>
            </div>
          </div>
          {adding === 'one' ? (
            <AddOne run={run} error={error} onDone={() => setAdding(null)} />
          ) : (
            <ProxyImport run={run} />
          )}
        </Drawer>
      )}
    </div>
  )
}

function AddOne({
  run,
  error,
  onDone
}: {
  run: Props['run']
  error: string
  onDone: () => void
}): React.JSX.Element {
  const [protocol, setProtocol] = useState<ProxyProtocol>('http')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const portNum = Number(port)
  const valid =
    host.trim() !== '' &&
    /^\d+$/.test(port.trim()) &&
    Number.isInteger(portNum) &&
    portNum >= 1 &&
    portNum <= 65535

  const add = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    const ok = await run(() =>
      api.createProxy({
        protocol,
        host: host.trim(),
        port: portNum,
        username: username.trim() || null,
        password: password || null
      })
    )
    setBusy(false)
    if (ok) onDone()
  }

  return (
    <>
      <div className="drawer-body">
        {error && <Banner kind="error">{error}</Banner>}
        <div className="field">
          <label htmlFor="px-proto">Giao thức</label>
          <select
            id="px-proto"
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as ProxyProtocol)}
          >
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </div>
        <div className="grid-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <div className="field">
            <label htmlFor="px-host">Địa chỉ</label>
            <input
              id="px-host"
              autoFocus
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="1.2.3.4 hoặc proxy.example.com"
            />
          </div>
          <div className="field">
            <label htmlFor="px-port">Cổng</label>
            <input
              id="px-port"
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="8080"
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="px-user">Tài khoản</label>
            <input
              id="px-user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Nếu có"
            />
          </div>
          <div className="field">
            <label htmlFor="px-pass">Mật khẩu</label>
            <input
              id="px-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nếu có"
            />
          </div>
        </div>
        <p className="faint">
          Mật khẩu được mã hoá bằng kho khoá của hệ điều hành và không bao giờ hiện lại.
        </p>
      </div>
      <div className="drawer-foot">
        <span className="spacer" />
        <button className="btn primary" disabled={!valid || busy} onClick={() => void add()}>
          {busy ? 'Đang thêm…' : 'Thêm proxy'}
        </button>
      </div>
    </>
  )
}
