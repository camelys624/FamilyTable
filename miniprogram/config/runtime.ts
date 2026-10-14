import { activeStage, getEnvironmentProfile } from './environments'

export type RuntimeStage = 'dev' | 'test' | 'prod'
export type RepositoryMode = 'local' | 'cloud'

export interface RuntimeConfig {
  stage: RuntimeStage
  repositoryMode: RepositoryMode
  cloudEnvId: string
  apiVersion: 'v1'
}

// 当前个人使用直接连接已确认的开发云环境，数据来源仍为 cloud。
export const runtimeConfig: RuntimeConfig = getEnvironmentProfile(activeStage)

function getMiniProgramAppId() {
  if (typeof wx.getAccountInfoSync !== 'function') return ''
  return wx.getAccountInfoSync()?.miniProgram?.appId || ''
}

export function initializeCloudRuntime() {
  if (runtimeConfig.stage === 'prod' && runtimeConfig.repositoryMode !== 'cloud') {
    throw new Error('prod 环境禁止使用 local repository')
  }
  if (runtimeConfig.repositoryMode !== 'cloud') return
  if (!runtimeConfig.cloudEnvId) throw new Error('cloud 模式缺少 cloudEnvId')
  if (runtimeConfig.cloudEnvId.startsWith('__')) throw new Error('cloudEnvId 仍是占位符')
  const appId = getMiniProgramAppId()
  if (appId === 'touristappid') throw new Error('正式 CloudBase 模式不能使用 touristappid')
  if (!wx.cloud) throw new Error('当前微信基础库不支持 CloudBase')
  wx.cloud.init({ env: runtimeConfig.cloudEnvId, traceUser: true })
}
