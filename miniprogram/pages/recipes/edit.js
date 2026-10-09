"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const recipe_1 = require("../../modules/recipe/index");
const DEFAULT_INGREDIENT_OPTIONS = [
    '大米',
    '小葱',
    '大蒜',
    '猪肉',
    '牛肉',
    '生姜',
    '番茄',
    '菜心',
    '鸡肉',
    '鸡蛋',
    '鲈鱼',
    '香菇',
];
const SUGGESTION_LIMIT = 8;
const INGREDIENT_NAME_MAX = 20;
/** 候选只给还没加进这道菜的食材，避免同一样食材加两次。 */
function suggestIngredients(options, rows, query) {
    const added = new Set(rows.map((row) => row.name));
    const keyword = query.trim().toLocaleLowerCase();
    return options
        .filter((name) => !added.has(name))
        .filter((name) => !keyword || name.toLocaleLowerCase().includes(keyword))
        .slice(0, SUGGESTION_LIMIT);
}
Page({
    data: {
        recipeId: '',
        isEditing: false,
        heading: '今天添什么菜？',
        submitText: '收进家庭菜谱簿',
        name: '',
        category: '家常菜',
        duration: '20',
        difficulty: '简单',
        note: '',
        imagePath: '',
        categories: ['家常菜', '快手菜', '拿手菜', '素菜', '早餐'],
        difficulties: ['简单', '适中', '费点功夫'],
        categoryIndex: 0,
        ingredientOptions: [...DEFAULT_INGREDIENT_OPTIONS],
        ingredientSuggestions: DEFAULT_INGREDIENT_OPTIONS.slice(0, SUGGESTION_LIMIT),
        ingredientQuery: '',
        canCreateIngredient: false,
        ingredients: [],
        usedUpCount: 0,
        steps: [{ id: 'step-0', text: '' }],
    },
    async onLoad(options) {
        try {
            const savedRecipes = await recipe_1.recipeModule.listRecipes();
            const ingredientOptions = Array.from(new Set([
                ...DEFAULT_INGREDIENT_OPTIONS,
                ...savedRecipes.flatMap((recipe) => recipe.ingredients.map((ingredient) => ingredient.name)),
            ])).sort((left, right) => left.localeCompare(right, 'zh-CN'));
            this.setData({ ingredientOptions });
            this.refreshIngredientPicker(this.data.ingredients, '');
            if (!options.id)
                return;
            const recipe = await recipe_1.recipeModule.getRecipe(options.id);
            if (!recipe) {
                wx.showToast({ title: '这道菜找不到了', icon: 'none' });
                setTimeout(() => wx.navigateBack(), 400);
                return;
            }
            const categoryIndex = Math.max(0, this.data.categories.indexOf(recipe.category));
            const ingredients = recipe.ingredients.map((ingredient, index) => ({
                id: `ingredient-${index}`,
                name: ingredient.name,
                usedUp: ingredient.usedUp,
            }));
            const steps = recipe.steps.length
                ? recipe.steps.map((text, index) => ({ id: `step-${index}`, text }))
                : [{ id: 'step-0', text: '' }];
            this.setData({
                recipeId: recipe.id,
                isEditing: true,
                heading: '把这道菜记得更清楚',
                submitText: '保存这次修改',
                name: recipe.name,
                category: recipe.category,
                categoryIndex,
                duration: String(recipe.duration),
                difficulty: recipe.difficulty,
                note: recipe.note,
                imagePath: recipe.imagePath || '',
                steps,
            });
            this.refreshIngredientPicker(ingredients, '');
            wx.setNavigationBarTitle({ title: '编辑菜谱' });
        }
        catch (error) {
            wx.showToast({ title: error instanceof Error ? error.message : '菜谱暂时加载失败，请重试', icon: 'none' });
        }
    },
    onName(event) { this.setData({ name: event.detail.value }); },
    onDuration(event) { this.setData({ duration: event.detail.value }); },
    onNote(event) { this.setData({ note: event.detail.value }); },
    chooseRecipeImage() {
        wx.chooseImage({
            count: 1,
            sizeType: ['compressed'],
            sourceType: ['album', 'camera'],
            success: (result) => {
                const tempFilePath = result.tempFilePaths?.[0];
                if (!tempFilePath)
                    return;
                wx.saveFile({
                    tempFilePath,
                    success: (saved) => {
                        if (!saved.savedFilePath) {
                            wx.showToast({ title: '图片保存失败，请重试', icon: 'none' });
                            return;
                        }
                        this.setData({ imagePath: saved.savedFilePath });
                    },
                    fail: () => wx.showToast({ title: '图片保存失败，请重试', icon: 'none' }),
                });
            },
            fail: (error) => {
                if (error?.errMsg?.includes('cancel'))
                    return;
                wx.showToast({ title: '选择图片失败，请重试', icon: 'none' });
            },
        });
    },
    clearRecipeImage() {
        this.setData({ imagePath: '' });
    },
    setDifficulty(event) {
        const difficulty = event.currentTarget.dataset.value;
        if (difficulty)
            this.setData({ difficulty });
    },
    onCategory(event) {
        const categoryIndex = Number(event.detail.value);
        this.setData({ categoryIndex, category: this.data.categories[categoryIndex] });
    },
    /** 食材列表、候选和"新建"入口一起刷新，保证三者对同一份已选食材说话。 */
    refreshIngredientPicker(ingredients, query, nextOptions) {
        const ingredientOptions = nextOptions || this.data.ingredientOptions;
        const name = query.trim();
        this.setData({
            ingredients,
            ingredientOptions,
            ingredientQuery: query,
            ingredientSuggestions: suggestIngredients(ingredientOptions, ingredients, query),
            canCreateIngredient: Boolean(name)
                && !ingredientOptions.includes(name)
                && !ingredients.some((row) => row.name === name),
            usedUpCount: ingredients.filter((row) => row.usedUp).length,
        });
    },
    onIngredientQuery(event) {
        this.refreshIngredientPicker(this.data.ingredients, event.detail.value);
    },
    addIngredientByName(rawName) {
        const name = rawName.trim().slice(0, INGREDIENT_NAME_MAX);
        if (!name)
            return;
        if (this.data.ingredients.some((row) => row.name === name)) {
            wx.showToast({ title: `“${name}”已经加过了`, icon: 'none' });
            return;
        }
        const ingredients = [...this.data.ingredients, { id: `ingredient-${Date.now()}`, name, usedUp: true }];
        const options = this.data.ingredientOptions;
        const ingredientOptions = options.includes(name)
            ? options
            : [...options, name].sort((left, right) => left.localeCompare(right, 'zh-CN'));
        this.refreshIngredientPicker(ingredients, '', ingredientOptions);
    },
    pickIngredient(event) {
        this.addIngredientByName(event.currentTarget.dataset.name || '');
    },
    createIngredient() {
        this.addIngredientByName(this.data.ingredientQuery);
    },
    toggleIngredientUsedUp(event) {
        const index = Number(event.currentTarget.dataset.index);
        const ingredients = this.data.ingredients.map((row, rowIndex) => rowIndex === index ? { ...row, usedUp: !row.usedUp } : row);
        this.refreshIngredientPicker(ingredients, this.data.ingredientQuery);
    },
    removeIngredient(event) {
        const index = Number(event.currentTarget.dataset.index);
        const ingredients = this.data.ingredients.filter((_, rowIndex) => rowIndex !== index);
        this.refreshIngredientPicker(ingredients, this.data.ingredientQuery);
    },
    onStepInput(event) {
        const index = Number(event.currentTarget.dataset.index);
        this.setData({ [`steps[${index}].text`]: event.detail.value });
    },
    addStep() {
        this.setData({
            steps: [...this.data.steps, { id: `step-${Date.now()}`, text: '' }],
        });
    },
    removeStep(event) {
        if (this.data.steps.length === 1) {
            wx.showToast({ title: '至少保留一个步骤', icon: 'none' });
            return;
        }
        const index = Number(event.currentTarget.dataset.index);
        this.setData({
            steps: this.data.steps.filter((_, rowIndex) => rowIndex !== index),
        });
    },
    async saveRecipe() {
        const name = this.data.name.trim();
        if (!name) {
            wx.showToast({ title: '先写下菜名', icon: 'none' });
            return;
        }
        const ingredients = this.data.ingredients.map((row) => ({
            name: row.name,
            usedUp: row.usedUp,
        }));
        if (!ingredients.length) {
            wx.showToast({ title: '至少添加一种食材', icon: 'none' });
            return;
        }
        const steps = this.data.steps
            .map((step) => step.text.trim())
            .filter(Boolean);
        if (!steps.length) {
            wx.showToast({ title: '至少添加一个操作步骤', icon: 'none' });
            return;
        }
        const duration = Number(this.data.duration);
        if (!Number.isFinite(duration) || duration < 1 || duration > 1440) {
            wx.showToast({ title: '用时请填写 1～1440 分钟', icon: 'none' });
            return;
        }
        try {
            const tones = ['green', 'tomato', 'ocean', 'grain', 'berry'];
            const existing = this.data.recipeId ? await recipe_1.recipeModule.getRecipe(this.data.recipeId) : undefined;
            const recipe = {
                id: existing?.id || `recipe-${Date.now()}`,
                name,
                initial: name.slice(0, 1),
                category: this.data.category,
                duration: Math.round(duration),
                difficulty: this.data.difficulty,
                tone: existing?.tone || tones[Date.now() % tones.length],
                note: this.data.note.trim() || '这是家里新记下的一道菜。',
                imagePath: this.data.imagePath || '',
                ingredients,
                steps,
            };
            if (existing)
                await recipe_1.recipeModule.updateRecipe(recipe);
            else
                await recipe_1.recipeModule.createRecipe(recipe);
            wx.showToast({ title: existing ? '菜谱已更新' : '已收入菜谱簿', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 500);
        }
        catch (error) {
            wx.showToast({ title: error instanceof Error ? error.message : '保存失败，请重试', icon: 'none' });
        }
    },
});
