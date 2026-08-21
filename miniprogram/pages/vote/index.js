"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const store_1 = require("../../services/store");
Page({
    data: {
        candidates: [],
        votedRecipeId: '',
        totalVotes: 0,
        participantCount: 0,
        voters: [],
    },
    onShow() {
        this.loadData();
    },
    loadData() {
        const state = (0, store_1.getState)();
        const candidateRecipes = state.recipes.slice(0, 3);
        const baseVotes = candidateRecipes.map(() => 0);
        state.members.slice(1).forEach((_, index) => {
            if (baseVotes.length)
                baseVotes[index % baseVotes.length] += 1;
        });
        const candidates = candidateRecipes.map((recipe, index) => ({
            ...recipe,
            votes: baseVotes[index] + (state.votedRecipeId === recipe.id ? 1 : 0),
            percent: 0,
            selected: state.votedRecipeId === recipe.id,
        }));
        const totalVotes = candidates.reduce((sum, item) => sum + item.votes, 0);
        candidates.forEach((item) => {
            item.percent = totalVotes ? Math.round((item.votes / totalVotes) * 100) : 0;
        });
        const participantNames = candidates.length
            ? [...state.members.slice(1), ...(state.votedRecipeId ? state.members.slice(0, 1) : [])]
            : [];
        const tones = ['voter-one', 'voter-two', 'voter-three'];
        const voters = participantNames.map((name, index) => ({ name, initial: name.slice(0, 1), tone: tones[index % tones.length] }));
        this.setData({
            candidates,
            votedRecipeId: state.votedRecipeId,
            totalVotes,
            participantCount: voters.length,
            voters,
        });
    },
    vote(event) {
        const recipeId = event.currentTarget.dataset.id;
        if (this.data.votedRecipeId) {
            wx.showToast({ title: '每人只能投一票', icon: 'none' });
            return;
        }
        (0, store_1.castVote)(recipeId);
        this.loadData();
        wx.showToast({ title: '这一票记下了', icon: 'success' });
    },
    openRecipes() {
        wx.switchTab({ url: '/pages/recipes/index' });
    },
});
