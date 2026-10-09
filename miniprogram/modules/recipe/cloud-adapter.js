"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toneForRecipe = exports.toDraft = exports.toRecipe = exports.CloudRecipeAdapter = void 0;
const difficultyToRemote = {
    '简单': 'easy',
    '适中': 'medium',
    '困难': 'hard',
    '费点功夫': 'hard',
};
function toneForRecipe(id) {
    const tones = ['green', 'tomato', 'ocean', 'grain', 'berry'];
    let value = 0;
    for (const character of id)
        value = (value * 31 + character.charCodeAt(0)) >>> 0;
    return tones[value % tones.length];
}
exports.toneForRecipe = toneForRecipe;
function toRecipe(remote) {
    return {
        id: remote.id,
        name: remote.name,
        initial: remote.name.slice(0, 1),
        imagePath: remote.imagePath || '',
        category: remote.category,
        duration: remote.durationMinutes || remote.duration || 20,
        difficulty: ['easy', '简单'].includes(remote.difficulty)
            ? '简单'
            : ['medium', '适中'].includes(remote.difficulty)
                ? '适中'
                : '困难',
        tone: toneForRecipe(remote.id),
        note: remote.note || '',
        ingredients: (remote.ingredients || []).map((ingredient) => ({
            name: ingredient.name,
            usedUp: ingredient.usedUp,
        })),
        steps: remote.steps || [],
    };
}
exports.toRecipe = toRecipe;
function toDraft(recipe) {
    return {
        name: recipe.name,
        category: recipe.category,
        durationMinutes: recipe.duration,
        difficulty: difficultyToRemote[recipe.difficulty] || 'easy',
        note: recipe.note,
        ingredients: recipe.ingredients.map((ingredient) => ({
            name: ingredient.name,
            usedUp: ingredient.usedUp,
        })),
        steps: recipe.steps,
    };
}
exports.toDraft = toDraft;
class CloudRecipeAdapter {
    constructor(client) {
        this.client = client;
    }
    async listRecipes(input = {}) {
        const result = await this.client.call('recipe', 'recipe.list', {
            keyword: input.keyword || '',
            category: input.category || '',
            pageSize: 100,
        });
        return result.items.map(toRecipe);
    }
    async getRecipe(recipeId) {
        const result = await this.client.call('recipe', 'recipe.detail', { recipeId });
        return toRecipe(result.recipe);
    }
    async createRecipe(recipe) {
        const result = await this.client.call('recipe', 'recipe.create', toDraft(recipe));
        return { ...toRecipe(result.recipe), imagePath: recipe.imagePath || '' };
    }
    async updateRecipe(recipe) {
        const result = await this.client.call('recipe', 'recipe.update', {
            recipeId: recipe.id,
            patch: toDraft(recipe),
        });
        return { ...toRecipe(result.recipe), imagePath: recipe.imagePath || '' };
    }
    async deleteRecipe(recipeId) {
        await this.client.call('recipe', 'recipe.delete', { recipeId });
    }
}
exports.CloudRecipeAdapter = CloudRecipeAdapter;
