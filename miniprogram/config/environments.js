"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeStage = exports.environmentProfiles = void 0;
exports.getEnvironmentProfile = getEnvironmentProfile;
exports.assertRepositoryMode = assertRepositoryMode;
exports.environmentProfiles = {
    dev: {
        stage: 'dev',
        repositoryMode: 'local',
        cloudEnvId: 'dev1',
        apiVersion: 'v1',
    },
    test: {
        stage: 'test',
        repositoryMode: 'cloud',
        cloudEnvId: 'cloud1-d3g26za1sf043b587',
        apiVersion: 'v1',
    },
    prod: {
        stage: 'prod',
        repositoryMode: 'cloud',
        cloudEnvId: 'prod1',
        apiVersion: 'v1',
    },
};
exports.activeStage = 'test';
function getEnvironmentProfile(stage) {
    return { ...exports.environmentProfiles[stage] };
}
function assertRepositoryMode(mode, stage) {
    if (stage === 'prod' && mode !== 'cloud') {
        throw new Error('prod 环境必须使用 cloud repository');
    }
}
