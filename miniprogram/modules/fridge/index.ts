import { createWxCloudClient } from '../../repositories/cloud-client'
import { CloudFridgeAdapter } from './cloud-adapter'

export const fridgeModule = new CloudFridgeAdapter(createWxCloudClient())
export * from './interface'
