import type { Extension, Group } from '@bf/core'
import { useRef, useState } from 'react'
import { api, cleanError } from './api'

interface Props {
  extensions: Extension[]
  groups: Group[]
  groupExtensions: Record<string, string[]>
}

export function ExtensionsPanel({ extensions, groups, groupExtensions }: Props): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const guarded = async (fn: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const add = (kind: 'folder' | 'file'): Promise<void> =>
    guarded(async () => {
      const ext = await api.addExtension(kind)
      if (ext) setNotice(`Đã thêm "${ext.name}" ${ext.version}.`)
    })

  const remove = (ext: Extension): void => {
    if (
      !window.confirm(
        `Xoá extension "${ext.name}" khỏi thư viện và khỏi mọi hồ sơ, nhóm đang gán? Dữ liệu của extension trong từng hồ sơ không bị xoá.`
      )
    ) {
      return
    }
    void guarded(() => api.deleteExtension(ext.id))
  }

  const toggleGroup = (groupId: string, extId: string, checked: boolean): Promise<void> =>
    guarded(async () => {
      const current = groupExtensions[groupId] ?? []
      const next = checked ? [...current, extId] : current.filter((id) => id !== extId)
      await api.setGroupExtensions(groupId, next)
    })

  return (
    <div>
      <div className="section-head">
        <h2>Extension</h2>
        <span>
          <button disabled={busy} onClick={() => void add('folder')}>
            Thêm từ thư mục…
          </button>{' '}
          <button disabled={busy} onClick={() => void add('file')}>
            Thêm file .crx/.zip…
          </button>
        </span>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="check-ok">{notice}</p>}
      {busy && <p className="muted">Đang xử lý…</p>}
      {extensions.length === 0 && (
        <p className="muted">
          Chưa có extension. Thêm từ thư mục đã giải nén hoặc từ file .crx/.zip bạn tự tải về.
        </p>
      )}
      {extensions.map((ext) => (
        <div className="list-item" key={ext.id}>
          <span className="grow">
            {ext.name} <span className="muted">· {ext.version}</span>
          </span>
          <button className="danger" disabled={busy} onClick={() => remove(ext)}>
            Xoá
          </button>
        </div>
      ))}
      {extensions.length > 0 && groups.length > 0 && (
        <>
          <p className="muted" style={{ marginTop: 12 }}>
            Gán theo nhóm (mọi hồ sơ trong nhóm đều nạp; có hiệu lực từ lần khởi động sau). Gán
            riêng cho từng hồ sơ thì vào form sửa hồ sơ.
          </p>
          {groups.map((g) => (
            <div className="list-item" key={g.id}>
              <span style={{ minWidth: 120 }}>{g.name}</span>
              <span className="grow check-list">
                {extensions.map((ext) => (
                  <label key={ext.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={(groupExtensions[g.id] ?? []).includes(ext.id)}
                      onChange={(e) => void toggleGroup(g.id, ext.id, e.target.checked)}
                    />
                    {ext.name}
                  </label>
                ))}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
