import { runtimeConfig } from '../../config/runtime'
import { createWxCloudClient } from '../../repositories/cloud-client'
import { CloudVoteAdapter } from './cloud-adapter'
import { LocalVoteAdapter } from './local-adapter'
import { VoteModule } from './interface'
export const voteModule: VoteModule = runtimeConfig.repositoryMode === 'cloud' ? new CloudVoteAdapter(createWxCloudClient()) : new LocalVoteAdapter()
export * from './interface'
