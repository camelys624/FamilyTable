import { runtimeConfig } from '../../config/runtime'
import { createWxCloudClient } from '../../repositories/cloud-client'
import { CloudFamilyAdapter } from './cloud-adapter'
import { FamilyModule } from './interface'
import { LocalFamilyAdapter } from './local-adapter'

export const familyModule: FamilyModule = runtimeConfig.repositoryMode === 'cloud'
  ? new CloudFamilyAdapter(createWxCloudClient())
  : new LocalFamilyAdapter()

export * from './interface'
