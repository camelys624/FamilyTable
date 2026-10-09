"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudRecipeAdapter = void 0;
exports.toRecipe = toRecipe;
exports.toDraft = toDraft;
exports.toneForRecipe = toneForRecipe;
exports.toIngredientExtractionResult = toIngredientExtractionResult;
function toIngredientSuggestion(remote) {
    return {
        name: remote.name,
        amount: remote.quantity === null || remote.quantity === undefined ? null : Number(remote.quantity),
        unit: remote.unit || '',
        amountText: remote.quantityText || '',
        evidenceStepIndexes: remote.evidenceStepIndexes || [],
        evidenceQuotes: remote.evidenceQuotes || [],
        confidence: remote.confidence || 'low',
    };
}
function toIngredientExtractionResult(remote) {
    return {
        detected: (remote.detected || []).map(toIngredientSuggestion),
        diff: {
            add: (remote.diff?.add || []).map(toIngredientSuggestion),
            update: (remote.diff?.update || []).map((item) => ({
                existing: toIngredientSuggestion(item.existing),
                suggested: toIngredientSuggestion(item.suggested),
                reason: item.reason || '',
            })),
            removeCandidates: (remote.diff?.removeCandidates || []).map(toIngredientSuggestion),
            needsQuantity: (remote.diff?.needsQuantity || []).map(toIngredientSuggestion),
        },
        warnings: remote.warnings || [],
    };
}
const difficultyToRemote = {
    简单: 'easy',
    适中: 'medium',
    困难: 'hard',
    '费点功夫': 'hard',
};
function toneForRecipe(id) {
    const tones = ['green', 'tomato', 'ocean', 'grain', 'berry'];
    let value = 0;
    for (const character of id)
        value = (value * 31 + character.charCodeAt(0)) >>> 0;
    return tones[value % tones.length];
}
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
    async extractIngredients(input) {
        const result = await this.client.call('recipe', 'recipe.extractIngredients', {
            steps: input.steps,
            existingIngredients: input.existingIngredients.map((ingredient) => ({
                name: ingredient.name,
                quantity: ingredient.amount,
                unit: ingredient.unit,
            })),
        });
        return toIngredientExtractionResult(result);
    }
    async deleteRecipe(recipeId) {
        await this.client.call('recipe', 'recipe.delete', { recipeId });
    }
}
exports.CloudRecipeAdapter = CloudRecipeAdapter;
