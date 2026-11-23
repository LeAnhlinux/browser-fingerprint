import type { Group } from '@bf/core'
import { useRef, useState } from 'react'
import { api } from './api'

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
    <div className="overlay">
      <div className="dialog">
        <h2>Tạo hồ sơ hàng loạt</h2>
        <div className="row">
          <div className="field">
            <label>Số lượng (1 đến 500)</label>
            <input
              type="number"
              min="1"
              max="500"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Số bắt đầu</label>
            <input type="number" min="0" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Mẫu tên ({'{n}'} là số thứ tự; không có thì số được nối vào cuối)</label>
          <input
            autoFocus
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="AMZ-US-{n}"
          />
        </div>
        {valid && (
          <p className="muted">
            Ví dụ: {example(0)}
            {countNum > 1 ? `, ${example(1)}` : ''}
            {countNum > 2 ? `, … ${example(countNum - 1)}` : ''}
          </p>
        )}
        <div className="field">
          <label>Nhóm</label>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Chưa gán</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <label>
          <input
            type="checkbox"
            checked={useProxies}
            onChange={(e) => setUseProxies(e.target.checked)}
          />{' '}
          Gán lần lượt các proxy chưa dùng (thiếu proxy thì không tạo hồ sơ nào)
        </label>
        {useProxies && (
          <p>
            <label>
              <input
                type="checkbox"
                checked={applyLocale}
                onChange={(e) => setApplyLocale(e.target.checked)}
              />{' '}
              Đặt múi giờ và ngôn ngữ theo kết quả kiểm tra của proxy
            </label>
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button disabled={busy} onClick={onClose}>
            Huỷ
          </button>
          <button className="primary" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? 'Đang tạo…' : 'Tạo'}
          </button>
        </div>
      </div>
    </div>
  )
}
