import type { Group } from '@bf/core'
import { IconCheck, IconFolders, IconPencil, IconPlus, IconTrash, IconX } from '@tabler/icons-react'
import { useState } from 'react'
import { api } from '../api'
import { Banner } from '../ui'

interface Props {
  groups: Group[]
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  error: string
  clearError: () => void
}

export function GroupsPage({ groups, run, error, clearError }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const add = async (): Promise<void> => {
    const n = name.trim()
    if (!n) return
    if (await run(() => api.createGroup(n))) setName('')
  }

  const commitRename = async (g: Group): Promise<void> => {
    const n = renameValue.trim()
    setRenamingId(null)
    if (n && n !== g.name) await run(() => api.renameGroup(g.id, n))
  }

  const remove = (g: Group): void => {
    if (
      window.confirm(
        `Xoá nhóm "${g.name}"? Các hồ sơ trong nhóm không bị xoá, chỉ chuyển về "Chưa gán nhóm".`
      )
    ) {
      void run(() => api.deleteGroup(g.id))
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Nhóm</h1>
      </div>
      <p className="page-sub">
        Nhóm để lọc hồ sơ và gán extension cho nhiều hồ sơ một lần (ở trang Extension).
      </p>

      {error && (
        <Banner kind="error" onClose={clearError}>
          {error}
        </Banner>
      )}

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tên nhóm mới, ví dụ Airdrop"
            aria-label="Tên nhóm mới"
          />
          <button className="btn primary" type="submit" disabled={!name.trim()}>
            <IconPlus size={15} />
            Thêm nhóm
          </button>
        </form>
      </div>

      <div className="card">
        {groups.length === 0 ? (
          <div className="empty">
            <IconFolders size={36} stroke={1.5} />
            <h2>Chưa có nhóm</h2>
            <p>Ví dụ: Instagram, Facebook, Airdrop. Một hồ sơ thuộc tối đa một nhóm.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Tên nhóm</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>
                    {renamingId === g.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        aria-label="Tên mới"
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename(g)
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        style={{ width: '100%', maxWidth: 360 }}
                      />
                    ) : (
                      <span className="cell-title">{g.name}</span>
                    )}
                  </td>
                  <td className="col-actions">
                    {renamingId === g.id ? (
                      <>
                        <button
                          className="icon-btn"
                          aria-label="Lưu tên"
                          onClick={() => void commitRename(g)}
                        >
                          <IconCheck size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label="Huỷ đổi tên"
                          onClick={() => setRenamingId(null)}
                        >
                          <IconX size={16} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="icon-btn"
                          title="Đổi tên"
                          aria-label={`Đổi tên ${g.name}`}
                          onClick={() => {
                            setRenamingId(g.id)
                            setRenameValue(g.name)
                          }}
                        >
                          <IconPencil size={16} />
                        </button>
                        <button
                          className="icon-btn danger"
                          title="Xoá"
                          aria-label={`Xoá ${g.name}`}
                          onClick={() => remove(g)}
                        >
                          <IconTrash size={16} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
