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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
const subscription_server_1 = require("../utils/subscription-server");
async function run() {
    console.log("=== VERIFYING GNR HOMES QUOTA LIMIT BYPASS ===");
    // GNR Admin Account ID
    const gnrAdminId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
    // GNR Agent Account ID (Balraj)
    const gnrAgentId = 'ecee58d3-b402-47be-8f55-cbd5ad044a9a';
    console.log("Checking checkLimitAndIncrement for Admin (should return true immediately)...");
    const adminResult = await (0, subscription_server_1.checkLimitAndIncrement)(gnrAdminId, 'videos');
    console.log("Admin Result:", adminResult);
    console.log("Checking checkLimitAndIncrement for Agent (should resolve primaryUserId and return true immediately)...");
    const agentResult = await (0, subscription_server_1.checkLimitAndIncrement)(gnrAgentId, 'videos');
    console.log("Agent Result:", agentResult);
    console.log("✅ Verification script execution completed successfully!");
}
run().catch(console.error);
