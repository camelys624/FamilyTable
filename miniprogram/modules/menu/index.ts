import { runtimeConfig } from '../../config/runtime'
import { createWxCloudClient } from '../../repositories/cloud-client'
import { CloudMenuAdapter } from './cloud-adapter'
import { LocalMenuAdapter } from './local-adapter'
import { MenuModule } from './interface'

function createMenuModule(): MenuModule {
  if (runtimeConfig.repositoryMode === 'cloud') return new CloudMenuAdapter(createWxCloudClient())
  return new LocalMenuAdapter()
}

export const menuModule = createMenuModule()

export * from './interface'
