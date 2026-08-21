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
function filterIngredientOptions(options, query) {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword)
        return options.slice(0, 6);
    return options
        .filter((name) => name.toLocaleLowerCase().includes(keyword))
        .slice(0, 6);
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
        filteredIngredientOptions: DEFAULT_INGREDIENT_OPTIONS.slice(0, 6),
        activeIngredientIndex: -1,
        ingredientQuery: '',
        canCreateIngredient: false,
        ingredients: [{
                id: 'ingredient-0',
                name: '',
                amount: '',
                unit: '克',
            }],
        steps: [{ id: 'step-0', text: '' }],
    },
    async onLoad(options) {
        try {
            const savedRecipes = await recipe_1.recipeModule.listRecipes();
            const savedIngredientNames = savedRecipes.flatMap((recipe) => recipe.ingredients.map((ingredient) => ingredient.name));
            const ingredientOptions = Array.from(new Set([
                ...DEFAULT_INGREDIENT_OPTIONS,
                ...savedIngredientNames,
            ])).sort((left, right) => left.localeCompare(right, 'zh-CN'));
            this.setData({
                ingredientOptions,
                filteredIngredientOptions: filterIngredientOptions(ingredientOptions, ''),
            });
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
                amount: String(ingredient.amount),
                unit: ingredient.unit,
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
                ingredients,
                steps,
            });
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
    toggleIngredientCombobox(event) {
        const index = Number(event.currentTarget.dataset.index);
        if (this.data.activeIngredientIndex === index) {
            this.closeIngredientCombobox();
            return;
        }
        const query = this.data.ingredients[index].name;
        this.setData({
            activeIngredientIndex: index,
            ingredientQuery: query,
            filteredIngredientOptions: filterIngredientOptions(this.data.ingredientOptions, query),
            canCreateIngredient: Boolean(query)
                && !this.data.ingredientOptions.some((name) => name === query.trim()),
        });
    },
    onIngredientQuery(event) {
        const index = Number(event.currentTarget.dataset.index);
        const query = event.detail.value;
        const normalized = query.trim();
        this.setData({
            [`ingredients[${index}].name`]: query,
            activeIngredientIndex: index,
            ingredientQuery: query,
            filteredIngredientOptions: filterIngredientOptions(this.data.ingredientOptions, query),
            canCreateIngredient: Boolean(normalized)
                && !this.data.ingredientOptions.some((name) => name === normalized),
        });
    },
    selectIngredient(event) {
        const index = Number(event.currentTarget.dataset.index);
        const name = event.currentTarget.dataset.name;
        if (!name)
            return;
        this.setData({
            [`ingredients[${index}].name`]: name,
            [`ingredients[${index}].unit`]: '克',
            activeIngredientIndex: -1,
            ingredientQuery: '',
            canCreateIngredient: false,
        });
    },
    createIngredient() {
        const index = this.data.activeIngredientIndex;
        const name = this.data.ingredientQuery.trim();
        if (index < 0 || !name)
            return;
        const ingredientOptions = Array.from(new Set([
            ...this.data.ingredientOptions,
            name,
        ])).sort((left, right) => left.localeCompare(right, 'zh-CN'));
        this.setData({
            [`ingredients[${index}].name`]: name,
            [`ingredients[${index}].unit`]: '克',
            ingredientOptions,
            filteredIngredientOptions: filterIngredientOptions(ingredientOptions, name),
            activeIngredientIndex: -1,
            ingredientQuery: '',
            canCreateIngredient: false,
        });
    },
    closeIngredientCombobox() {
        this.setData({
            activeIngredientIndex: -1,
            ingredientQuery: '',
            canCreateIngredient: false,
        });
    },
    onIngredientAmount(event) {
        const index = Number(event.currentTarget.dataset.index);
        this.setData({ [`ingredients[${index}].amount`]: event.detail.value });
    },
    addIngredient() {
        const activeIngredientIndex = this.data.ingredients.length;
        this.setData({
            ingredients: [...this.data.ingredients, {
                    id: `ingredient-${Date.now()}`,
                    name: '',
                    amount: '',
                    unit: '克',
                }],
            activeIngredientIndex,
            ingredientQuery: '',
            filteredIngredientOptions: filterIngredientOptions(this.data.ingredientOptions, ''),
            canCreateIngredient: false,
        });
    },
    removeIngredient(event) {
        if (this.data.ingredients.length === 1) {
            wx.showToast({ title: '至少保留一行食材', icon: 'none' });
            return;
        }
        const index = Number(event.currentTarget.dataset.index);
        this.setData({
            ingredients: this.data.ingredients.filter((_, rowIndex) => rowIndex !== index),
            activeIngredientIndex: -1,
            ingredientQuery: '',
            canCreateIngredient: false,
        });
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
        const ingredientRows = this.data.ingredients
            .map((ingredient) => ({
            name: ingredient.name.trim(),
            amount: ingredient.amount.trim(),
            unit: ingredient.unit || '克',
        }))
            .filter((ingredient) => ingredient.name || ingredient.amount);
        if (!ingredientRows.length) {
            wx.showToast({ title: '至少添加一种食材', icon: 'none' });
            return;
        }
        if (ingredientRows.some((ingredient) => !ingredient.name)) {
            wx.showToast({ title: '请选择或填写食材名称', icon: 'none' });
            return;
        }
        if (ingredientRows.some((ingredient) => {
            const amount = Number(ingredient.amount);
            return !Number.isFinite(amount) || amount <= 0 || amount > 100000;
        })) {
            wx.showToast({ title: '克数需大于 0，且不能超过 100000', icon: 'none' });
            return;
        }
        const ingredients = ingredientRows.map((ingredient) => ({
            name: ingredient.name,
            amount: Number(ingredient.amount),
            unit: ingredient.unit,
        }));
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
    },
});
