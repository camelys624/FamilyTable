"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.shoppingModule = void 0;
const runtime_1 = require("../../config/runtime");
const cloud_client_1 = require("../../repositories/cloud-client");
const cloud_adapter_1 = require("./cloud-adapter");
const local_adapter_1 = require("./local-adapter");
exports.shoppingModule = runtime_1.runtimeConfig.repositoryMode === 'cloud' ? new cloud_adapter_1.CloudShoppingAdapter((0, cloud_client_1.createWxCloudClient)()) : new local_adapter_1.LocalShoppingAdapter();
__exportStar(require("./interface"), exports);
