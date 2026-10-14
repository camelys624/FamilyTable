"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../../modules/vote/index");
const index_2 = require("../../modules/recipe/index");
const cloud_adapter_1 = require("../../modules/recipe/cloud-adapter");
const index_3 = require("../../modules/session/index");
const date_1 = require("../../utils/date");
const app_error_1 = require("../../utils/app-error");
const write_intent_1 = require("../../utils/write-intent");
Page({
    data: { candidates: [], votedRecipeId: '', totalVotes: 0, participantCount: 0, voters: [], pollId: '', pollTitle: '', status: '', deadline: '', canCreate: false, loading: false, saving: false, loadError: '', writeError: '', pending: false, showCreate: false, createCandidates: [], title: '一起商量这顿吃什么', targetDate: '', mealType: 'dinner', mealIndex: 2, mealNames: ['早餐', '午餐', '晚餐'], closeTime: '23:59' },
    writer: new write_intent_1.WriteIntent(),
    async onShow() { await this.loadData(); },
    async onPullDownRefresh() { await this.loadData(); wx.stopPullDownRefresh(); },
    async loadData() {
        if (this.data.loading || this.data.saving)
            return;
        this.setData({ loading: true, loadError: '', targetDate: this.data.targetDate || (0, date_1.getFamilyToday)() });
        try {
            const session = await (0, index_3.ensureSession)();
            if (!session.onboarded) {
                wx.reLaunch({ url: '/pages/onboarding/index' });
                return;
            }
            const [result, recipes] = await Promise.all([index_1.voteModule.getCurrent(this.data.targetDate, this.data.mealType), index_2.recipeModule.listRecipes()]);
            const selected = new Set(this.data.createCandidates.filter((recipe) => recipe.selected).map((recipe) => recipe.id));
            this.setData({ createCandidates: recipes.map((recipe) => ({ ...recipe, selected: selected.has(recipe.id) })) });
            this.renderResult(result);
        }
        catch (error) {
            this.setData({ loadError: (0, app_error_1.toAppError)(error).message });
        }
        finally {
            this.setData({ loading: false });
        }
    },
    renderResult(result) {
        const candidates = (result.poll?.candidates || []).map((entry) => ({ ...(0, cloud_adapter_1.toRecipe)({ ...entry.recipeSnapshot, id: entry.recipeId, duration: 20 }), votes: result.summary.candidates.find((candidate) => candidate.recipeId === entry.recipeId)?.voteCount || 0, percent: 0, selected: result.currentVote?.candidateRecipeId === entry.recipeId }));
        candidates.forEach((candidate) => { candidate.percent = result.summary.totalVotes ? Math.round(candidate.votes / result.summary.totalVotes * 100) : 0; });
        const closesAt = result.poll ? new Date(new Date(result.poll.closesAt).getTime() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '';
        const tones = ['voter-one', 'voter-two', 'voter-three'];
        const voters = result.voters.map((voter, index) => ({ id: voter.id, name: voter.displayName, initial: voter.displayName.slice(0, 1), tone: tones[index % tones.length] }));
        this.setData({ candidates, voters, votedRecipeId: result.currentVote?.candidateRecipeId || '', totalVotes: result.summary.totalVotes, participantCount: voters.length, pollId: result.poll?.id || '', pollTitle: result.poll?.title || '一起商量吃什么', status: result.poll?.status || '', deadline: closesAt ? `${closesAt} 截止（北京时间）` : '家长发起投票，家人一人一票。', canCreate: result.canCreate, showCreate: this.data.showCreate || (!result.poll && result.canCreate) });
    },
    blocked() { return this.data.loading || this.data.saving || this.data.pending || Boolean(this.data.loadError); },
    async vote(event) {
        if (this.blocked())
            return;
        if (this.data.status !== 'open') {
            wx.showToast({ title: '投票已结束', icon: 'none' });
            return;
        }
        if (this.data.votedRecipeId) {
            wx.showToast({ title: '每人只能投一票', icon: 'none' });
            return;
        }
        await this.write('cast', { pollId: this.data.pollId, candidateRecipeId: event.currentTarget.dataset.id });
    },
    openCreate() { if (!this.blocked() && this.data.canCreate)
        this.setData({ showCreate: true }); },
    toggleCandidate(event) {
        if (this.blocked())
            return;
        const candidates = this.data.createCandidates.map((recipe) => recipe.id === event.currentTarget.dataset.id ? { ...recipe, selected: !recipe.selected } : recipe);
        if (candidates.filter((recipe) => recipe.selected).length > 10) {
            wx.showToast({ title: '最多选择 10 道菜', icon: 'none' });
            return;
        }
        this.setData({ createCandidates: candidates });
    },
    onTitle(event) { if (!this.blocked())
        this.setData({ title: event.detail.value }); },
    onCloseTime(event) { if (!this.blocked())
        this.setData({ closeTime: event.detail.value }); },
    async onTargetDate(event) { if (!this.blocked()) {
        this.setData({ targetDate: event.detail.value });
        await this.loadData();
    } },
    async onMeal(event) { if (!this.blocked()) {
        const mealIndex = Number(event.detail.value);
        this.setData({ mealIndex, mealType: ['breakfast', 'lunch', 'dinner'][mealIndex] });
        await this.loadData();
    } },
    async createPoll() {
        if (this.blocked() || !this.data.canCreate)
            return;
        const candidateRecipeIds = this.data.createCandidates.filter((recipe) => recipe.selected).map((recipe) => recipe.id);
        if (candidateRecipeIds.length < 2) {
            wx.showToast({ title: '至少选择两道菜', icon: 'none' });
            return;
        }
        await this.write('createPoll', { title: this.data.title.trim(), targetDate: this.data.targetDate, mealType: this.data.mealType, candidateRecipeIds, closesAt: new Date(`${this.data.targetDate}T${this.data.closeTime}:00+08:00`).toISOString() });
    },
    closePoll() {
        if (this.blocked() || !this.data.canCreate)
            return;
        wx.showModal({ title: '结束当前投票？', content: '已投的票会保留，结束后家人不能继续投票。', confirmText: '结束投票', success: (result) => { if (result.confirm && !this.blocked())
                void this.write('close', { pollId: this.data.pollId }); } });
    },
    async invoke(action, input, requestId) {
        if (action === 'createPoll')
            return index_1.voteModule.createPoll(input, requestId);
        if (action === 'cast')
            return index_1.voteModule.cast(input.pollId, input.candidateRecipeId, requestId);
        return index_1.voteModule.close(input.pollId, requestId);
    },
    async write(action, input) {
        if (this.data.loading || this.data.saving)
            return;
        this.setData({ saving: true, writeError: '' });
        try {
            await this.writer.run(action, input, (requestId) => this.invoke(action, input, requestId));
            this.setData({ pending: false, saving: false, ...(action === 'createPoll' ? { showCreate: false } : {}) });
            wx.showToast({ title: action === 'cast' ? '这一票记下了' : '投票已更新', icon: 'success' });
            await this.loadData();
        }
        catch (error) {
            const failure = (0, app_error_1.toAppError)(error);
            this.setData({ writeError: failure.message, pending: Boolean(this.writer.pending) });
            if (['POLL_CLOSED', 'VOTE_ALREADY_CAST', 'POLL_ALREADY_OPEN'].includes(failure.code)) {
                this.setData({ saving: false });
                await this.loadData();
            }
        }
        finally {
            this.setData({ saving: false });
        }
    },
    async retryPending() { const pending = this.writer.pending; if (pending)
        await this.write(pending.action, pending.input); },
    openRecipes() { wx.switchTab({ url: '/pages/recipes/index' }); },
});
