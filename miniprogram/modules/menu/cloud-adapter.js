"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toneForRecipe = exports.toRecipe = exports.dayView = exports.CloudMenuAdapter = void 0;
function toneForRecipe(id) {
    const tones = ['green', 'tomato', 'ocean', 'grain', 'berry'];
    let value = 0;
    for (const character of id)
        value = (value * 31 + character.charCodeAt(0)) >>> 0;
    return tones[value % tones.length];
}
exports.toneForRecipe = toneForRecipe;
function toRecipe(snapshot) {
    return {
        id: snapshot.recipeId,
        name: snapshot.name,
        initial: snapshot.name.slice(0, 1),
        category: snapshot.category,
        duration: snapshot.durationMinutes || 20,
        difficulty: snapshot.difficulty === 'medium' ? '适中' : snapshot.difficulty === 'hard' ? '困难' : '简单',
        tone: toneForRecipe(snapshot.recipeId),
        note: snapshot.note || '',
        ingredients: (snapshot.ingredients || []).map((ingredient) => ({ name: ingredient.name, amount: ingredient.quantity, unit: ingredient.unit })),
        steps: snapshot.steps || [],
    };
}
exports.toRecipe = toRecipe;
function dayView(day) {
    const date = new Date(`${day.date}T12:00:00`);
    const meta = { key: day.date, weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()], dateLabel: `${date.getMonth() + 1}/${date.getDate()}` };
    const mapItems = (items) => items.map((item) => ({ id: item.id, recipeId: item.recipeId, recipe: toRecipe(item.recipeSnapshot), source: item.source, addedAt: item.addedAt }));
    return { ...meta, breakfast: mapItems(day.breakfast || []), lunch: mapItems(day.lunch || []), dinner: mapItems(day.dinner || []) };
}
exports.dayView = dayView;
class CloudMenuAdapter {
    constructor(client) { this.client = client; }
    async getWeekMenu(weekStart) {
        const result = await this.client.call('menu', 'menu.week', { weekStart });
        return this.mapMenu(result.menu);
    }
    async addRecipe(input) {
        const result = await this.client.call('menu', 'menu.addRecipe', input);
        return this.mapMenu(result.menu);
    }
    async removeRecipe(input) {
        const result = await this.client.call('menu', 'menu.removeRecipe', input);
        return this.mapMenu(result.menu);
    }
    mapMenu(menu) {
        return { id: menu.id, weekStart: menu.weekStart, timezone: menu.timezone, version: menu.version, days: menu.days.map(dayView) };
    }
}
exports.CloudMenuAdapter = CloudMenuAdapter;
