import { runtimeConfig } from '../../config/runtime'
import { createWxCloudClient } from '../../repositories/cloud-client'
import { CloudShoppingAdapter } from './cloud-adapter'
import { LocalShoppingAdapter } from './local-adapter'
import { ShoppingModule } from './interface'
export const shoppingModule: ShoppingModule = runtimeConfig.repositoryMode === 'cloud' ? new CloudShoppingAdapter(createWxCloudClient()) : new LocalShoppingAdapter()
export * from './interface'
