import type { Group } from '@bf/core'
import { useRef, useState } from 'react'
import { api } from './api'
import { Banner, Modal } from './ui'

interface Props {
  groups: Group[]
  error: string
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  onClose: () => void
}

export function BulkCreateForm({ groups, error, run, onClose }: Props): React.JSX.Element {
  const [count, setCount] = useState('10')
  const [pattern, setPattern] = useState('')
  const [start, setStart] = useState('1')
  const [groupId, setGroupId] = useState('')
  const [useProxies, setUseProxies] = useState(false)
  const [applyLocale, setApplyLocale] = useState(true)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const countNum = Number(count)
  const startNum = Number(start)
  const valid =
    /^\d+$/.test(count) &&
    countNum >= 1 &&
    countNum <= 500 &&
    /^\d+$/.test(start) &&
    pattern.trim() !== ''

  const width = Math.max(2, String(startNum + Math.max(countNum, 1) - 1).length)
  const example = (i: number): string => {
    const n = String(startNum + i).padStart(width, '0')
    const p = pattern.trim()
    return p.includes('{n}') ? p.replaceAll('{n}', n) : `${p}-${n}`
  }

  const submit = async (): Promise<void> => {
    if (busyRef.current || !valid) return
    busyRef.current = true
    setBusy(true)
    const ok = await run(() =>
      api.createProfilesBulk({
        count: countNum,
        namePattern: pattern.trim(),
        startIndex: startNum,
        groupId: groupId || null,
        proxyMode: useProxies ? 'unused' : 'none',
        applyLocale: useProxies && applyLocale
      })
    )
    busyRef.current = false
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal
      title="Tạo hồ sơ hàng loạt"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>
            Huỷ
          </button>
          <button className="btn primary" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? 'Đang tạo…' : `Tạo ${valid ? countNum : ''} hồ sơ`}
          </button>
        </>
      }
    >
      {error && <Banner kind="error">{error}</Banner>}
      <div className="field">
        <label htmlFor="bc-pattern">Mẫu tên</label>
        <input
          id="bc-pattern"
          autoFocus
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="AMZ-US-{n}"
        />
        <span className="hint">
          {valid
            ? `Ví dụ: ${example(0)}${countNum > 1 ? `, ${example(1)}` : ''}${countNum > 2 ? `, … ${example(countNum - 1)}` : ''}`
            : '{n} là số thứ tự; không có {n} thì số được nối vào cuối tên.'}
        </span>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="bc-count">Số lượng (1 đến 500)</label>
          <input
            id="bc-count"
            type="number"
            min="1"
            max="500"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="bc-start">Số bắt đầu</label>
          <input
            id="bc-start"
            type="number"
            min="0"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="bc-group">Nhóm</label>
        <select id="bc-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">Chưa gán</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={useProxies}
          onChange={(e) => setUseProxies(e.target.checked)}
        />
        <span>
          Gán lần lượt các proxy chưa dùng
          <span className="faint"> (thiếu proxy thì không tạo hồ sơ nào)</span>
        </span>
      </label>
      {useProxies && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={applyLocale}
            onChange={(e) => setApplyLocale(e.target.checked)}
          />
          <span>Đặt múi giờ và ngôn ngữ theo kết quả kiểm tra của proxy</span>
        </label>
      )}
    </Modal>
  )
}
