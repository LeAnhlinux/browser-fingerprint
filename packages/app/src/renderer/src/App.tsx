import type { CoreInfo, Extension, Group, ProfileView, ProxyView } from '@bf/core'
import { useCallback, useEffect, useState } from 'react'
import { EngineGate } from './EngineGate'
import { ExtensionsPage } from './pages/ExtensionsPage'
import { GroupsPage } from './pages/GroupsPage'
import { ProfilesPage } from './pages/ProfilesPage'
import { ProxiesPage } from './pages/ProxiesPage'
import { SettingsPage } from './pages/SettingsPage'
import { Sidebar, type Page } from './Sidebar'
import { api, cleanError, type ApiStatus } from './api'
import { Banner } from './ui'

export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<CoreInfo | null>(null)
  const [profiles, setProfiles] = useState<ProfileView[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [proxies, setProxies] = useState<ProxyView[]>([])
  const [extensions, setExtensions] = useState<Extension[]>([])
  const [groupExtensions, setGroupExtensions] = useState<Record<string, string[]>>({})
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [error, setError] = useState('')
  const [apiInfo, setApiInfo] = useState<ApiStatus | null>(null)
  const [page, setPage] = useState<Page>('profiles')

  const reload = useCallback(async () => {
    const filter = {
      search: search.trim() || undefined,
      ...(groupFilter === 'all' ? {} : { groupId: groupFilter === 'none' ? null : groupFilter })
    }
    try {
      const [i, p, g, x, e, ge] = await Promise.all([
        api.info(),
        api.listProfiles(filter),
        api.listGroups(),
        api.listProxies(),
        api.listExtensions(),
        api.listGroupExtensions()
      ])
      setInfo(i)
      setProfiles(p)
      setGroups(g)
      setProxies(x)
      setExtensions(e)
      setGroupExtensions(ge)
      if (
        groupFilter !== 'all' &&
        groupFilter !== 'none' &&
        !g.some((grp) => grp.id === groupFilter)
      ) {
        setGroupFilter('all')
      }
    } catch (e) {
      setError(cleanError(e))
    }
  }, [search, groupFilter])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải dữ liệu ban đầu và khi bộ lọc đổi
    void reload()
    return window.bf.onChange(() => void reload())
  }, [reload])

  useEffect(() => {
    void api
      .apiStatus()
      .then(setApiInfo)
      .catch(() => setApiInfo(null))
  }, [])

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      let ok = false
      try {
        setError('')
        await fn()
        ok = true
      } catch (e) {
        setError(cleanError(e))
      }
      await reload()
      return ok
    },
    [reload]
  )

  const clearError = useCallback(() => setError(''), [])

  if (!info) {
    if (!error) return <div className="loading">Đang tải…</div>
    return (
      <div className="gate">
        <div className="card">
          <Banner kind="error">{error}</Banner>
          <button
            className="btn"
            onClick={() => {
              setError('')
              void reload()
            }}
          >
            Thử lại
          </button>
        </div>
      </div>
    )
  }
  if (!info.engineInstalled) return <EngineGate info={info} onInstalled={() => void reload()} />

  const go = (next: Page): void => {
    setError('')
    setPage(next)
  }
  const shared = { run, error, clearError }

  return (
    <div className="shell">
      <Sidebar
        page={page}
        onNavigate={go}
        runningCount={profiles.filter((p) => p.run !== null).length}
        proxyCount={proxies.length}
        groupCount={groups.length}
        extensionCount={extensions.length}
        info={info}
        apiInfo={apiInfo}
      />
      <main className="main">
        {page === 'profiles' && (
          <ProfilesPage
            {...shared}
            profiles={profiles}
            groups={groups}
            proxies={proxies}
            extensions={extensions}
            groupExtensions={groupExtensions}
            hostPlatform={info.hostPlatform}
            search={search}
            onSearch={setSearch}
            groupFilter={groupFilter}
            onGroupFilter={setGroupFilter}
          />
        )}
        {page === 'proxies' && <ProxiesPage {...shared} proxies={proxies} />}
        {page === 'groups' && <GroupsPage {...shared} groups={groups} />}
        {page === 'extensions' && (
          <ExtensionsPage
            extensions={extensions}
            groups={groups}
            groupExtensions={groupExtensions}
          />
        )}
        {page === 'settings' && <SettingsPage info={info} apiInfo={apiInfo} />}
      </main>
    </div>
  )
}
