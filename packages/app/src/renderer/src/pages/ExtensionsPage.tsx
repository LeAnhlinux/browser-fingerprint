import type { Extension, Group } from '@bf/core'
import {
  IconFileZip,
  IconFolderOpen,
  IconPuzzle,
  IconRefresh,
  IconTrash
} from '@tabler/icons-react'
import { useRef, useState } from 'react'
import { api, cleanError } from '../api'
import { Banner } from '../ui'

interface Props {
  extensions: Extension[]
  groups: Group[]
  groupExtensions: Record<string, string[]>
}

export function ExtensionsPage({ extensions, groups, groupExtensions }: Props): React.JSX.Element {
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

  const update = (ext: Extension, kind: 'folder' | 'file'): Promise<void> =>
    guarded(async () => {
      const r = await api.updateExtension(ext.id, kind)
      if (!r) return
      const { before, after } = r
      const renamed = before.name !== after.name ? ` (giờ tên là "${after.name}")` : ''
      setNotice(
        `Đã cập nhật "${before.name}" từ ${before.version} lên ${after.version}${renamed}. Dữ liệu của extension trong các hồ sơ được giữ nguyên.`
      )
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
    <div className="page">
      <div className="page-head">
        <h1>Extension</h1>
        <button className="btn" disabled={busy} onClick={() => void add('folder')}>
          <IconFolderOpen size={15} />
          Thêm từ thư mục…
        </button>
        <button className="btn primary" disabled={busy} onClick={() => void add('file')}>
          <IconFileZip size={15} />
          Thêm file .crx/.zip…
        </button>
      </div>
      <p className="page-sub">
        Thư viện extension dùng chung. Gán riêng cho một hồ sơ trong bảng chi tiết của hồ sơ, hoặc
        cho cả nhóm ở dưới. Có hiệu lực từ lần khởi động sau. Lên bản mới bằng nút cập nhật ở mỗi
        dòng (giữ nguyên dữ liệu ví trong hồ sơ), đừng xoá rồi thêm lại.
      </p>

      {error && (
        <Banner kind="error" onClose={() => setError('')}>
          {error}
        </Banner>
      )}
      {notice && (
        <Banner kind="ok" onClose={() => setNotice('')}>
          {notice}
        </Banner>
      )}

      <div className="card">
        {extensions.length === 0 ? (
          <div className="empty">
            <IconPuzzle size={36} stroke={1.5} />
            <h2>Chưa có extension</h2>
            <p>
              Thêm từ thư mục đã giải nén, hoặc từ file .crx/.zip bạn tự tải về. File .crx giữ ID
              gốc nên dữ liệu ví gắn theo ID không đổi.
            </p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Tên</th>
                <th>Phiên bản</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {extensions.map((ext) => (
                <tr key={ext.id}>
                  <td className="cell-title">{ext.name}</td>
                  <td className="mono">{ext.version}</td>
                  <td className="col-actions">
                    <button
                      className="btn sm"
                      title="Cập nhật từ file .crx/.zip bản mới"
                      aria-label={`Cập nhật ${ext.name} từ file`}
                      disabled={busy}
                      onClick={() => void update(ext, 'file')}
                    >
                      <IconRefresh size={14} />
                      Cập nhật
                    </button>
                    <button
                      className="icon-btn"
                      title="Cập nhật từ thư mục bản mới"
                      aria-label={`Cập nhật ${ext.name} từ thư mục`}
                      disabled={busy}
                      onClick={() => void update(ext, 'folder')}
                    >
                      <IconFolderOpen size={16} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Xoá"
                      aria-label={`Xoá ${ext.name}`}
                      disabled={busy}
                      onClick={() => remove(ext)}
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

      {extensions.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <div className="card-head">
            <h2>Gán theo nhóm</h2>
          </div>
          {groups.length === 0 ? (
            <p className="muted">Tạo nhóm ở trang Nhóm để gán extension cho nhiều hồ sơ một lần.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Nhóm</th>
                  <th>Extension được nạp cho mọi hồ sơ trong nhóm</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td className="cell-title">{g.name}</td>
                    <td>
                      <div className="check-grid">
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
