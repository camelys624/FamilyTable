import { CloudClient } from '../../repositories/cloud-client'
import { Preference, PreferenceModule } from './interface'
export class CloudPreferenceAdapter implements PreferenceModule {
  constructor(private readonly client: CloudClient) {}
  async getMine() { return (await this.client.call<{ preference: Preference }>('preference', 'preference.getMine')).preference }
  async updateMine(input: Preference, requestId: string) { return (await this.client.call<{ preference: Preference }>('preference', 'preference.updateMine', { ...input }, requestId)).preference }
}
