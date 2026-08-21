import { runtimeConfig } from '../../config/runtime'
import { createWxCloudClient } from '../../repositories/cloud-client'
import { CloudSessionAdapter } from './cloud-session-adapter'
import { CompleteOnboardingInput, SessionModule, SessionSnapshot } from './interface'
import { LocalSessionAdapter } from './local-session-adapter'

function createSessionModule(): SessionModule {
  if (runtimeConfig.repositoryMode === 'cloud') {
    return new CloudSessionAdapter(createWxCloudClient())
  }
  return new LocalSessionAdapter()
}

export const sessionModule = createSessionModule()

// 会话是页面守卫的唯一真相源。云端模式下本地缓存不再代表登录状态，
// 页面若各自判断是否已加入家庭，就会出现互相跳转的死循环。
let snapshot: SessionSnapshot | null = null
let pending: Promise<SessionSnapshot> | null = null

export function getSession() {
  return snapshot
}

export function ensureSession(): Promise<SessionSnapshot> {
  if (snapshot) return Promise.resolve(snapshot)
  if (!pending) {
    pending = sessionModule
      .bootstrap()
      .then((result) => {
        snapshot = result
        return result
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}

export async function completeOnboarding(input: CompleteOnboardingInput) {
  snapshot = await sessionModule.completeOnboarding(input)
  return snapshot
}

export function clearSession() {
  snapshot = null
  pending = null
}

export * from './interface'
