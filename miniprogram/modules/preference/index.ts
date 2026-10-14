import { runtimeConfig } from '../../config/runtime'
import { createWxCloudClient } from '../../repositories/cloud-client'
import { CloudPreferenceAdapter } from './cloud-adapter'
import { LocalPreferenceAdapter } from './local-adapter'
import { PreferenceModule } from './interface'
export const preferenceModule: PreferenceModule = runtimeConfig.repositoryMode === 'cloud' ? new CloudPreferenceAdapter(createWxCloudClient()) : new LocalPreferenceAdapter()
export * from './interface'
