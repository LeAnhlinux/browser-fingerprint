import type { Group, ProxyProtocol, ProxyView } from '@bf/core'
import { useState } from 'react'
import { api } from './api'

interface Props {
  groups: Group[]
  proxies: ProxyView[]
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  error: string
  onClose: () => void
}

export function SettingsPanel({ groups, proxies, run, error, onClose }: Props): React.JSX.Element {
  const [groupName, setGroupName] = useState('')
  const [protocol, setProtocol] = useState<ProxyProtocol>('http')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const addGroup = async (): Promise<void> => {
    const name = groupName.trim()
    if (!name) return
    if (await run(() => api.createGroup(name))) setGroupName('')
  }

  const startRename = (g: Group): void => {
    setRenamingId(g.id)
    setRenameValue(g.name)
  }

  const commitRename = async (g: Group): Promise<void> => {
    const name = renameValue.trim()
    setRenamingId(null)
    if (name && name !== g.name) await run(() => api.renameGroup(g.id, name))
  }

  const proxyValid = host.trim() !== '' && Number(port) > 0 && Number(port) < 65536
  const addProxy = async (): Promise<void> => {
    if (!proxyValid) return
    const ok = await run(() =>
      api.createProxy({
        protocol,
        host: host.trim(),
        port: Number(port),
        username: username.trim() || null,
        password: password || null
      })
    )
    if (ok) {
      setHost('')
      setPort('')
      setUsername('')
      setPassword('')
    }
  }

  return (
    <div className="overlay">
      <div className="dialog">
        {error && <p className="error">{error}</p>}
        <h2>Nhóm</h2>
        {groups.length === 0 && <p className="muted">Chưa có nhóm.</p>}
        {groups.map((g) => (
          <div className="list-item" key={g.id}>
            {renamingId === g.id ? (
              <>
                <input
                  className="grow"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename(g)
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                />
                <button className="primary" onClick={() => void commitRename(g)}>
                  Lưu
                </button>
                <button onClick={() => setRenamingId(null)}>Huỷ</button>
              </>
            ) : (
              <>
                <span className="grow">{g.name}</span>
                <button onClick={() => startRename(g)}>Đổi tên</button>
              </>
            )}
            <button className="danger" onClick={() => void run(() => api.deleteGroup(g.id))}>
              Xoá
            </button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Tên nhóm"
          />
          <button disabled={!groupName.trim()} onClick={() => void addGroup()}>
            Thêm nhóm
          </button>
        </div>

        <h2 style={{ marginTop: 22 }}>Proxy</h2>
        {proxies.length === 0 && <p className="muted">Chưa có proxy.</p>}
        {proxies.map((x) => (
          <div className="list-item" key={x.id}>
            <span className="grow">
              {`${x.protocol}://${x.host}:${x.port}`}
              {x.username && (
                <span className="muted">
                  {' '}
                  · {x.username}
                  {x.hasPassword ? ' · có mật khẩu' : ''}
                </span>
              )}
            </span>
            <button className="danger" onClick={() => void run(() => api.deleteProxy(x.id))}>
              Xoá
            </button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <select value={protocol} onChange={(e) => setProtocol(e.target.value as ProxyProtocol)}>
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </select>
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Địa chỉ" />
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="Cổng"
          />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Tài khoản (nếu có)"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mật khẩu (nếu có)"
          />
          <button disabled={!proxyValid} onClick={() => void addProxy()}>
            Thêm proxy
          </button>
        </div>

        <div className="dialog-actions">
          <button onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  )
}
