import { CloudClient } from '../../repositories/cloud-client'
import { CurrentFamily, FamilyInfo, FamilyInvitation, FamilyModule } from './interface'

export class CloudFamilyAdapter implements FamilyModule {
  constructor(private readonly client: CloudClient) {}

  async getCurrentFamily() {
    const current = await this.client.call<CurrentFamily>('family', 'family.current')
    return { ...current, family: { ...current.family, infoVersion: current.family.infoVersion || 0 }, invitation: current.invitation || { active: false, expiresAt: '' } }
  }

  createInvitation(requestId: string) {
    return this.client.call<FamilyInvitation>('family', 'family.invite', { expiresInHours: 72 }, requestId)
  }

  updateFamily(name: string, expectedVersion: number, requestId: string) {
    return this.client.call<{ family: FamilyInfo }>('family', 'family.update', { name, expectedVersion }, requestId)
  }
}
