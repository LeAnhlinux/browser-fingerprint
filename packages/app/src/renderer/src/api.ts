import type {
  BulkCreateInput,
  CoreInfo,
  LocaleApplyResult,
  ProxyImportResult,
  ProxyProtocol,
  Group,
  NewProfile,
  NewProxy,
  Profile,
  ProfileFilter,
  ProfilePatch,
  ProfileView,
  ProxyPatch,
  ProxyView,
  RunInfo
} from '@bf/core'

const call = <T>(method: string, ...args: unknown[]): Promise<T> =>
  window.bf.call(method, ...args) as Promise<T>

export const api = {
  info: () => call<CoreInfo>('info'),
  installEngine: () => window.bf.installEngine(),
  listProfiles: (filter: ProfileFilter = {}) => call<ProfileView[]>('listProfiles', filter),
  createProfile: (input: NewProfile) => call<Profile>('createProfile', input),
  updateProfile: (id: string, patch: ProfilePatch) => call<Profile>('updateProfile', id, patch),
  deleteProfile: (id: string) => call<void>('deleteProfile', id),
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
  launch: (id: string) => call<RunInfo>('launch', id),
  stop: (id: string) => call<void>('stop', id)
}

export function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': /, '').replace(/^\w*Error: /, '')
}
