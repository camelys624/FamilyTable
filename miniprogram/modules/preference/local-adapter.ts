import { getState, updatePreferences } from '../../services/store'
import { Preference, PreferenceModule } from './interface'
export class LocalPreferenceAdapter implements PreferenceModule {
  async getMine() { const state = getState(); return { spicyLevel: state.spicyLevel, avoidFoods: state.avoidFood.split(/[、，,]/).map((name) => name.trim()).filter(Boolean), allergies: Array.isArray(state.allergies) ? state.allergies.slice() : [], notes: '' } }
  async updateMine(input: Preference) { updatePreferences(input.spicyLevel, input.avoidFoods.join('、'), input.allergies || []); return { ...input, allergies: input.allergies || [] } }
}
