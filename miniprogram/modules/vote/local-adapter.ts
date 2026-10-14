import { AppError } from '../../utils/app-error'
import { VoteModule, VoteResult } from './interface'
export class LocalVoteAdapter implements VoteModule {
  async getCurrent(): Promise<VoteResult> { return { poll: null, summary: { totalVotes: 0, candidates: [], currentMemberVoted: false }, currentVote: null, voters: [], canCreate: false } }
  async createPoll() { throw new AppError('FEATURE_UNAVAILABLE', '家庭投票需要连接云端') }
  async cast() { throw new AppError('FEATURE_UNAVAILABLE', '家庭投票需要连接云端') }
  async close() { throw new AppError('FEATURE_UNAVAILABLE', '家庭投票需要连接云端') }
}
