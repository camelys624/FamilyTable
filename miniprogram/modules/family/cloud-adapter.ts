import { CloudClient } from '../../repositories/cloud-client'
import { CurrentFamily, FamilyInvitation, FamilyModule } from './interface'

export class CloudFamilyAdapter implements FamilyModule {
  constructor(private readonly client: CloudClient) {}

  async getCurrentFamily() {
    const current = await this.client.call<CurrentFamily>('family', 'family.current')
    return { ...current, invitation: current.invitation || { active: false, expiresAt: '' } }
  }

  createInvitation(requestId: string) {
    return this.client.call<FamilyInvitation>('family', 'family.invite', { expiresInHours: 72 }, requestId)
  }
}
