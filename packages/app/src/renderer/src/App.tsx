import type { CoreInfo, Group, NewProfile, ProfileView, ProxyView } from '@bf/core';
import { useCallback, useEffect, useState } from 'react';
import { EngineGate } from './EngineGate';
import { ProfileForm } from './ProfileForm';
import { ProfileList } from './ProfileList';
import { SettingsPanel } from './SettingsPanel';
import { api, cleanError } from './api';

export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<CoreInfo | null>(null);
  const [profiles, setProfiles] = useState<ProfileView[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [proxies, setProxies] = useState<ProxyView[]>([]);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [editing, setEditing] = useState<ProfileView | 'new' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const filter = {
      search: search.trim() || undefined,
      ...(groupFilter === 'all' ? {} : { groupId: groupFilter === 'none' ? null : groupFilter }),
    };
    const [i, p, g, x] = await Promise.all([api.info(), api.listProfiles(filter), api.listGroups(), api.listProxies()]);
    setInfo(i);
    setProfiles(p);
    setGroups(g);
    setProxies(x);
  }, [search, groupFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải dữ liệu ban đầu và khi bộ lọc đổi
    void reload();
    return window.bf.onChange(() => void reload());
  }, [reload]);

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      try {
        setError('');
        await fn();
      } catch (e) {
        setError(cleanError(e));
      }
      await reload();
    },
    [reload],
  );

  if (!info) return <div className="app muted">Đang tải…</div>;
  if (!info.engineInstalled) return <EngineGate info={info} onInstalled={() => void reload()} />;

  const save = (input: NewProfile): void => {
    const target = editing;
    setEditing(null);
    void run(() => (target && target !== 'new' ? api.updateProfile(target.id, input) : api.createProfile(input)));
  };

  const remove = (p: ProfileView): void => {
    if (window.confirm(`Xoá hồ sơ "${p.name}" cùng toàn bộ dữ liệu trình duyệt của nó? Không khôi phục được.`)) {
      void run(() => api.deleteProfile(p.id));
    }
  };

  return (
    <div className="app">
      <div className="toolbar">
        <input className="grow" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm theo tên hồ sơ" />
        <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
          <option value="all">Tất cả nhóm</option>
          <option value="none">Chưa gán</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <button onClick={() => setShowSettings(true)}>Nhóm và proxy</button>
        <button className="primary" onClick={() => setEditing('new')}>Hồ sơ mới</button>
      </div>
      {error && <p className="error">{error}</p>}
      <ProfileList
        profiles={profiles}
        groups={groups}
        proxies={proxies}
        onStart={(id) => void run(() => api.launch(id))}
        onStop={(id) => void run(() => api.stop(id))}
        onEdit={setEditing}
        onDelete={remove}
      />
      <p className="muted">Nhân: fingerprint-chromium {info.engineVersion}</p>
      {editing && (
        <ProfileForm
          profile={editing === 'new' ? null : editing}
          groups={groups}
          proxies={proxies}
          hostPlatform={info.hostPlatform}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      {showSettings && <SettingsPanel groups={groups} proxies={proxies} run={run} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
