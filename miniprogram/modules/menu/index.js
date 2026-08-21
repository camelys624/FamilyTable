"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.menuModule = void 0;
const runtime_1 = require("../../config/runtime");
const cloud_client_1 = require("../../repositories/cloud-client");
const cloud_adapter_1 = require("./cloud-adapter");
const local_adapter_1 = require("./local-adapter");
function createMenuModule() {
    if (runtime_1.runtimeConfig.repositoryMode === 'cloud')
        return new cloud_adapter_1.CloudMenuAdapter((0, cloud_client_1.createWxCloudClient)());
    return new local_adapter_1.LocalMenuAdapter();
}
exports.menuModule = createMenuModule();
