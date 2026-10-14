export interface Preference { spicyLevel: number; avoidFoods: string[]; notes: string }
export interface PreferenceModule { getMine(): Promise<Preference>; updateMine(input: Preference, requestId: string): Promise<Preference> }
