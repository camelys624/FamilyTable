import type { RepositoryMode, RuntimeConfig, RuntimeStage } from './runtime'

export const environmentProfiles: Record<RuntimeStage, RuntimeConfig> = {
  dev: {
    stage: 'dev',
    repositoryMode: 'local',
    cloudEnvId: 'dev1',
    apiVersion: 'v1',
  },
  test: {
    stage: 'test',
    repositoryMode: 'cloud',
    cloudEnvId: 'cloud1-d3g26za1sf043b587',
    apiVersion: 'v1',
  },
  prod: {
    stage: 'prod',
    repositoryMode: 'cloud',
    cloudEnvId: 'prod1',
    apiVersion: 'v1',
  },
}

export const activeStage: RuntimeStage = 'test'

export function getEnvironmentProfile(stage: RuntimeStage) {
  return { ...environmentProfiles[stage] }
}

export function assertRepositoryMode(mode: RepositoryMode, stage: RuntimeStage) {
  if (stage === 'prod' && mode !== 'cloud') {
    throw new Error('prod 环境必须使用 cloud repository')
  }
}
