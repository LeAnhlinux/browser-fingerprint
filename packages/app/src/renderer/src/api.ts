import type {
  BulkCreateInput,
  CoreInfo,
  LocaleApplyResult,
  ProxyImportResult,
  ProxyProtocol,
  Group,
  NewProxy,
  Profile,
  ProfileFilter,
  ProfileInput,
  ProfileUpdate,
  CookieImportResult,
  Extension,
  ProfileView,
  ProxyPatch,
  ProxyView,
  RunInfo,
  FingerprintSnapshot,
  CapMonsterStatus
} from '@bf/core'

const call = <T>(method: string, ...args: unknown[]): Promise<T> =>
  window.bf.call(method, ...args) as Promise<T>

export interface ApiStatus {
  enabled: boolean
  running: boolean
  port: number
  error: string | null
}

export const api = {
  info: () => call<CoreInfo>('info'),
  installEngine: () => window.bf.installEngine(),
  listProfiles: (filter: ProfileFilter = {}) => call<ProfileView[]>('listProfiles', filter),
  createProfile: (input: ProfileInput) => call<Profile>('createProfile', input),
  updateProfile: (id: string, patch: ProfileUpdate) => call<Profile>('updateProfile', id, patch),
  importCookies: (id: string, text: string) => call<CookieImportResult>('importCookies', id, text),
  exportCookies: (id: string) =>
    window.bf.exportCookies(id) as Promise<{ saved: boolean; count: number }>,
  listExtensions: () => call<Extension[]>('listExtensions'),
  addExtension: (kind: 'folder' | 'file') =>
    window.bf.addExtension(kind) as Promise<Extension | null>,
  deleteExtension: (id: string) => call<void>('deleteExtension', id),
  updateExtension: (id: string, kind: 'folder' | 'file') =>
    window.bf.updateExtension(id, kind) as Promise<{ before: Extension; after: Extension } | null>,
  setProfileExtensions: (id: string, extensionIds: string[]) =>
    call<void>('setProfileExtensions', id, extensionIds),
  setGroupExtensions: (groupId: string, extensionIds: string[]) =>
    call<void>('setGroupExtensions', groupId, extensionIds),
  listGroupExtensions: () => call<Record<string, string[]>>('listGroupExtensions'),
  deleteProfile: (id: string) => call<void>('deleteProfile', id),
  measureFingerprint: (id: string) => call<FingerprintSnapshot>('measureFingerprint', id),
  regenerateFingerprint: (id: string) => call<Profile>('regenerateFingerprint', id),
  listGroups: () => call<Group[]>('listGroups'),
  createGroup: (name: string) => call<Group>('createGroup', name),
  renameGroup: (id: string, name: string) => call<void>('renameGroup', id, name),
  deleteGroup: (id: string) => call<void>('deleteGroup', id),
  listProxies: () => call<ProxyView[]>('listProxies'),
  createProxy: (input: NewProxy) => call<ProxyView>('createProxy', input),
  updateProxy: (id: string, patch: ProxyPatch) => call<ProxyView>('updateProxy', id, patch),
  deleteProxy: (id: string) => call<void>('deleteProxy', id),
  importProxies: (text: string, defaultProtocol: ProxyProtocol) =>
    call<ProxyImportResult>('importProxies', text, defaultProtocol),
  checkProxy: (id: string) => call<ProxyView>('checkProxy', id),
  checkProxies: (ids: string[]) => call<void>('checkProxies', ids),
  createProfilesBulk: (input: BulkCreateInput) => call<Profile[]>('createProfilesBulk', input),
  updateProfilesBulk: (
    ids: string[],
    patch: { groupId?: string | null; proxyId?: string | null }
  ) => call<number>('updateProfilesBulk', ids, patch),
  assignUnusedProxies: (ids: string[]) => call<number>('assignUnusedProxies', ids),
  applyProxyLocale: (ids: string[]) => call<LocaleApplyResult>('applyProxyLocale', ids),
  apiStatus: () => window.bf.apiStatus() as Promise<ApiStatus>,
  revealApiToken: () => window.bf.revealApiToken() as Promise<boolean>,
  capmonsterStatus: () => call<CapMonsterStatus>('capmonsterStatus'),
  setCapMonsterKey: (key: string | null) => call<void>('setCapMonsterKey', key),
  capmonsterBalance: () => call<number>('capmonsterBalance'),
  installCapMonsterExtension: () => call<Extension>('installCapMonsterExtension'),
  launch: (id: string) => call<RunInfo>('launch', id),
  stop: (id: string) => call<void>('stop', id)
}

export function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': /, '').replace(/^\w*Error: /, '')
}
