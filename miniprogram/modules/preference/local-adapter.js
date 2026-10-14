"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalPreferenceAdapter = void 0;
const store_1 = require("../../services/store");
class LocalPreferenceAdapter {
    async getMine() { const state = (0, store_1.getState)(); return { spicyLevel: state.spicyLevel, avoidFoods: state.avoidFood.split(/[、，,]/).map((name) => name.trim()).filter(Boolean), notes: '' }; }
    async updateMine(input) { (0, store_1.updatePreferences)(input.spicyLevel, input.avoidFoods.join('、')); return input; }
}
exports.LocalPreferenceAdapter = LocalPreferenceAdapter;
