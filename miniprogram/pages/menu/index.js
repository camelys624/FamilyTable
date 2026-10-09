"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../../modules/menu/index");
const index_2 = require("../../modules/recipe/index");
const date_1 = require("../../utils/date");
const app_error_1 = require("../../utils/app-error");
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
Page({
    data: {
        days: [],
        selectedIndex: 0,
        selectedDate: '',
        meals: [],
        recipes: [],
        pickerVisible: false,
        pickerMeal: 'dinner',
        pickerMealLabel: '晚餐',
        weekNumber: (0, date_1.getWeekNumber)(),
        weekStart: '',
        menuId: '',
        menuVersion: 0,
        repeatName: '',
        repeatCount: 0,
        loadError: '',
    },
    async onShow() {
        const todayIndex = (new Date().getDay() || 7) - 1;
        const weekStart = (0, date_1.getCurrentWeekKey)();
        this.setData({ selectedIndex: todayIndex, weekStart, loadError: '' });
        await this.loadData(todayIndex);
    },
    async loadData(selectedIndex) {
        const currentIndex = selectedIndex ?? this.data.selectedIndex;
        const weekStart = this.data.weekStart || (0, date_1.getCurrentWeekKey)();
        try {
            const [menu, recipes] = await Promise.all([
                index_1.menuModule.getWeekMenu(weekStart),
                index_2.recipeModule.listRecipes(),
            ]);
            const day = menu.days[currentIndex] || menu.days[0];
            if (!day)
                return;
            const meals = [
                { key: 'breakfast', label: '早餐', hint: '轻一点，慢慢醒', items: day.breakfast },
                { key: 'lunch', label: '午餐', hint: '吃饱才有力气', items: day.lunch },
                { key: 'dinner', label: '晚餐', hint: '全家坐下来吃', items: day.dinner },
            ];
            const allItems = menu.days.flatMap((menuDay) => MEAL_TYPES.flatMap((mealType) => menuDay[mealType]));
            const recipeCounts = new Map();
            allItems.forEach((item) => recipeCounts.set(item.recipeId, (recipeCounts.get(item.recipeId) || 0) + 1));
            const repeated = Array.from(recipeCounts.entries()).sort((left, right) => right[1] - left[1]).find((entry) => entry[1] > 1);
            const repeatedItem = repeated ? allItems.find((item) => item.recipeId === repeated[0]) : undefined;
            this.setData({
                days: menu.days,
                selectedDate: day.dateLabel,
                meals,
                recipes,
                menuId: menu.id,
                menuVersion: menu.version,
                weekStart: menu.weekStart,
                repeatName: repeatedItem?.recipe.name || '',
                repeatCount: repeated?.[1] || 0,
            });
        }
        catch (error) {
            const message = (0, app_error_1.toAppError)(error).message;
            this.setData({ loadError: message });
            wx.showToast({ title: message, icon: 'none' });
        }
    },
    async retryLoad() {
        await this.loadData();
    },
    async selectDay(event) {
        const selectedIndex = Number(event.currentTarget.dataset.index);
        this.setData({ selectedIndex });
        await this.loadData(selectedIndex);
    },
    openPicker(event) {
        const meal = event.currentTarget.dataset.meal;
        const mealView = this.data.meals.find((item) => item.key === meal);
        this.setData({
            pickerVisible: true,
            pickerMeal: meal,
            pickerMealLabel: mealView?.label || '菜单',
        });
    },
    closePicker() {
        this.setData({ pickerVisible: false });
    },
    async chooseRecipe(event) {
        const recipeId = event.currentTarget.dataset.id;
        const selectedMeal = this.data.meals.find((item) => item.key === this.data.pickerMeal);
        if (selectedMeal?.items.some((item) => item.recipeId === recipeId)) {
            wx.showToast({ title: '这一餐已经有这道菜了', icon: 'none' });
            return;
        }
        const day = this.data.days[this.data.selectedIndex];
        if (!day)
            return;
        try {
            await index_1.menuModule.addRecipe({
                weekStart: this.data.weekStart || (0, date_1.getCurrentWeekKey)(),
                date: day.key,
                mealType: this.data.pickerMeal,
                recipeId,
                expectedVersion: this.data.menuVersion,
            });
            this.setData({ pickerVisible: false });
            await this.loadData();
            wx.showToast({ title: '已放上餐桌', icon: 'success' });
        }
        catch (error) {
            await this.loadData();
            wx.showToast({ title: error instanceof Error ? error.message : '添加菜单失败，请重试', icon: 'none' });
        }
    },
    openCook(event) {
        const itemId = event.currentTarget.dataset.id;
        const mealType = event.currentTarget.dataset.meal;
        const day = this.data.days[this.data.selectedIndex];
        if (!day || !itemId || !this.data.menuId || !MEAL_TYPES.includes(mealType))
            return;
        const params = [
            ['weekStart', this.data.weekStart],
            ['menuId', this.data.menuId],
            ['date', day.key],
            ['mealType', mealType],
            ['itemId', itemId],
        ].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
        wx.navigateTo({ url: `/pages/fridge/cook?${params}` });
    },
    removeRecipe(event) {
        const itemId = event.currentTarget.dataset.id;
        const recipe = this.data.meals
            .flatMap((meal) => meal.items)
            .find((item) => item.id === itemId)?.recipe;
        wx.showModal({
            title: `移除“${recipe?.name || '这道菜'}”？`,
            content: '只会从这一餐移除，菜谱仍会留在家庭菜谱簿里。',
            confirmText: '移除',
            success: async (result) => {
                if (!result.confirm)
                    return;
                try {
                    await index_1.menuModule.removeRecipe({
                        menuId: this.data.menuId,
                        itemId,
                        expectedVersion: this.data.menuVersion,
                    });
                    await this.loadData();
                }
                catch (error) {
                    await this.loadData();
                    wx.showToast({ title: error instanceof Error ? error.message : '移除菜单失败，请重试', icon: 'none' });
                }
            },
        });
    },
});
