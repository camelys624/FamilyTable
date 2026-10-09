"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../../modules/recipe/index");
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
function normalizeIngredientName(value) {
    return value.trim().toLocaleLowerCase().replace(/\s+/g, '');
}
function confidenceLabel(value) {
    if (value === 'high')
        return '较确定';
    if (value === 'medium')
        return '可能';
    return '待确认';
}
function toDisplaySuggestion(suggestion, id, selected) {
    return {
        ...suggestion,
        id,
        selected,
        confidenceLabel: confidenceLabel(suggestion.confidence),
        evidenceLabel: suggestion.evidenceStepIndexes.length
            ? `第 ${suggestion.evidenceStepIndexes[0] + 1} 步`
            : '步骤中未提及',
        evidenceText: suggestion.evidenceQuotes[0] || '',
    };
}
function draftFingerprint(steps, ingredients) {
    return JSON.stringify({
        steps,
        ingredients: ingredients.map((ingredient) => ({
            name: ingredient.name.trim(),
            usedUp: ingredient.usedUp,
        })),
    });
}
function buildAiReview(result) {
    // 用量仅是 AI 提取的附带信息，不修改菜谱的“用完 / 有剩”标记。
    const add = result.diff.add.map((suggestion, index) => toDisplaySuggestion(suggestion, `add-${index}-${normalizeIngredientName(suggestion.name)}`, true));
    const remove = result.diff.removeCandidates.map((suggestion, index) => toDisplaySuggestion(suggestion, `remove-${index}-${normalizeIngredientName(suggestion.name)}`, false));
    return { add, remove };
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
        aiExtracting: false,
        aiReviewVisible: false,
        aiReviewEmpty: false,
        aiReviewMessage: '',
        aiReviewWarnings: [],
        aiReviewAdd: [],
        aiReviewRemove: [],
        aiReviewFingerprint: '',
        ingredients: [],
        usedUpCount: 0,
        steps: [{ id: 'step-0', text: '' }],
    },
    async onLoad(options) {
        try {
            const savedRecipes = await index_1.recipeModule.listRecipes();
            const ingredientOptions = Array.from(new Set([
                ...DEFAULT_INGREDIENT_OPTIONS,
                ...savedRecipes.flatMap((recipe) => recipe.ingredients.map((ingredient) => ingredient.name)),
            ])).sort((left, right) => left.localeCompare(right, 'zh-CN'));
            this.setData({ ingredientOptions });
            this.refreshIngredientPicker(this.data.ingredients, '');
            if (!options.id)
                return;
            const recipe = await index_1.recipeModule.getRecipe(options.id);
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
    async extractIngredients() {
        if (this.data.aiExtracting)
            return;
        const steps = this.data.steps.map((step) => step.text.trim()).filter(Boolean);
        if (!steps.length) {
            wx.showToast({ title: '先写下至少一个操作步骤', icon: 'none' });
            return;
        }
        const existingIngredients = this.data.ingredients.map((ingredient) => ({
            name: ingredient.name.trim(),
            amount: null,
            unit: '',
        }));
        const fingerprint = draftFingerprint(steps, this.data.ingredients);
        this.setData({
            aiExtracting: true,
            aiReviewVisible: false,
            aiReviewEmpty: false,
            aiReviewMessage: '',
            aiReviewWarnings: [],
        });
        try {
            const result = await index_1.recipeModule.extractIngredients({ steps, existingIngredients });
            const currentFingerprint = draftFingerprint(this.data.steps.map((step) => step.text.trim()).filter(Boolean), this.data.ingredients);
            if (currentFingerprint !== fingerprint) {
                this.setData({
                    aiExtracting: false,
                    aiReviewMessage: '内容已经变过了，请重新整理',
                });
                return;
            }
            const review = buildAiReview(result);
            const hasReview = Boolean(review.add.length || review.remove.length);
            this.setData({
                aiExtracting: false,
                aiReviewVisible: hasReview,
                aiReviewEmpty: !hasReview,
                aiReviewMessage: hasReview
                    ? ''
                    : result.detected.length
                        ? '步骤里的食材和当前清单一致'
                        : '没有找到明确的食材，原有清单没有改变',
                aiReviewWarnings: result.warnings,
                aiReviewAdd: review.add,
                aiReviewRemove: review.remove,
                aiReviewFingerprint: fingerprint,
            });
        }
        catch (error) {
            this.setData({
                aiExtracting: false,
                aiReviewVisible: false,
                aiReviewEmpty: false,
                aiReviewMessage: error instanceof Error ? error.message : '暂时没整理出来，原有食材没有改变',
            });
        }
    },
    toggleAiSuggestion(event) {
        const group = event.currentTarget.dataset.group;
        const index = Number(event.currentTarget.dataset.index);
        if (group === 'add') {
            const list = [...this.data.aiReviewAdd];
            if (list[index])
                list[index] = { ...list[index], selected: !list[index].selected };
            this.setData({ aiReviewAdd: list });
            return;
        }
        if (group === 'remove') {
            const list = [...this.data.aiReviewRemove];
            if (list[index])
                list[index] = { ...list[index], selected: !list[index].selected };
            this.setData({ aiReviewRemove: list });
        }
    },
    discardAiReview() {
        this.setData({
            aiReviewVisible: false,
            aiReviewEmpty: false,
            aiReviewMessage: '',
            aiReviewWarnings: [],
            aiReviewAdd: [],
            aiReviewRemove: [],
            aiReviewFingerprint: '',
        });
    },
    applyAiReview() {
        const currentFingerprint = draftFingerprint(this.data.steps.map((step) => step.text.trim()).filter(Boolean), this.data.ingredients);
        if (currentFingerprint !== this.data.aiReviewFingerprint) {
            this.setData({
                aiReviewVisible: false,
                aiReviewMessage: '内容已经变过了，请重新整理',
            });
            return;
        }
        const removeNames = new Set(this.data.aiReviewRemove
            .filter((suggestion) => suggestion.selected)
            .map((suggestion) => normalizeIngredientName(suggestion.name)));
        const ingredients = this.data.ingredients
            .filter((ingredient) => !removeNames.has(normalizeIngredientName(ingredient.name)))
            .map((ingredient) => ({ ...ingredient }));
        for (const suggestion of this.data.aiReviewAdd) {
            if (!suggestion.selected)
                continue;
            const exists = ingredients.some((ingredient) => normalizeIngredientName(ingredient.name) === normalizeIngredientName(suggestion.name));
            if (exists)
                continue;
            ingredients.push({
                id: `ingredient-${Date.now()}-${ingredients.length}`,
                name: suggestion.name,
                usedUp: true,
            });
        }
        const ingredientOptions = Array.from(new Set([
            ...this.data.ingredientOptions,
            ...ingredients.map((ingredient) => ingredient.name),
        ])).sort((left, right) => left.localeCompare(right, 'zh-CN'));
        this.refreshIngredientPicker(ingredients, '', ingredientOptions);
        this.discardAiReview();
        wx.showToast({ title: '已应用选中建议', icon: 'success' });
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
            const existing = this.data.recipeId ? await index_1.recipeModule.getRecipe(this.data.recipeId) : undefined;
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
                await index_1.recipeModule.updateRecipe(recipe);
            else
                await index_1.recipeModule.createRecipe(recipe);
            wx.showToast({ title: existing ? '菜谱已更新' : '已收入菜谱簿', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 500);
        }
        catch (error) {
            wx.showToast({ title: error instanceof Error ? error.message : '保存失败，请重试', icon: 'none' });
        }
    },
});
