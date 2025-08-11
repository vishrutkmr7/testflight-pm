/**
 * Configuration Module Public API
 * Centralized exports for all configuration functionality
 * Provides clean interface following Interface Segregation Principle
 */

// Main configuration management
export {
    getConfiguration,
    validateConfiguration,
    getConfigManager,
    clearConfigManager,
    type ConfigurationManager
} from "./manager.js";

// Import utilities for use in legacy exports and helpers
import { getConfiguration, clearConfigManager } from "./manager.js";
import { DEFAULT_HTTP_CONFIG, DEFAULT_LABEL_CONFIG, UI_ELEMENTS } from "./defaults.js";
import type { ApplicationConfig } from "./types.js";

// Configuration types (what clients need to know)
export type {
    ApplicationConfig,
    AppStoreConnectConfig,
    GitHubConfig,
    LinearConfig,
    LLMConfig,
    ProcessingConfig,
    WebhookConfig,
    ConfigValidationResult,
    Environment,
    LogLevel,
    LLMProvider,
    BaseApiConfig,
    BaseLabelConfig,
} from "./types.js";

// Essential defaults and constants (for API clients)
export {
    API_ENDPOINTS,
    DEFAULT_HTTP_CONFIG,
    DEFAULT_LABEL_CONFIG,
    DEFAULT_TESTFLIGHT_CONFIG,
    PRIORITY_LEVELS,
    ERROR_MESSAGES,
    SUCCESS_MESSAGES,
    UI_ELEMENTS,
    VALIDATION_PATTERNS,
    // Legacy exports
    TESTFLIGHT_CONFIG,
} from "./defaults.js";

// Validation utilities (for custom validation needs)
export {
    validateApplicationConfig,
    validateAppStoreConnectConfig,
    validateGitHubConfig,
    validateLinearConfig,
    validateLLMConfig,
    validateLLMConfigDetailed,
    validatePrivateKey,
} from "./validation.js";

// Environment utilities (for advanced use cases)
export {
    isGitHubActionEnvironment,
    getEnvVar,
    getRequiredEnvVar,
    getBooleanEnvVar,
    getNumericEnvVar,
    getGitHubContext,
} from "./environment-loader.js";

/**
 * Backward compatibility exports
 * These maintain compatibility with existing code while encouraging migration to new structure
 */

// Legacy environment.ts exports
export const getConfig = getConfiguration;
export const clearConfigCache = clearConfigManager;

// Legacy constants.ts exports  
export const HTTP_CONFIG = DEFAULT_HTTP_CONFIG;
export const DEFAULT_LABELS = DEFAULT_LABEL_CONFIG;
export const PATHS = {
    TEMP_DIR: "/tmp/testflight-pm",
    SCREENSHOTS_DIR: "/tmp/testflight-pm/screenshots",
    LOGS_DIR: "/tmp/testflight-pm/logs",
} as const;
export const { EMOJIS } = UI_ELEMENTS;

/**
 * LLM Configuration utilities (avoiding circular imports)
 */
export {
    getLLMConfig,
    clearLLMConfigCache,
    calculateEstimatedCost,
    checkCostLimits,
    sanitizeDataForLLM,
} from "./llm-config.js";

/**
 * Configuration presets for common scenarios
 */
export const CONFIG_PRESETS = {
    /**
     * Minimal configuration for GitHub-only setup
     */
    GITHUB_ONLY: {
        requiredEnvVars: [
            "APP_STORE_CONNECT_ISSUER_ID",
            "APP_STORE_CONNECT_KEY_ID",
            "APP_STORE_CONNECT_PRIVATE_KEY",
            "GTHB_TOKEN",
        ],
        optionalEnvVars: [
            "GITHUB_OWNER",
            "GITHUB_REPO",
            "CRASH_LABELS",
            "FEEDBACK_LABELS",
        ],
    },

    /**
     * Minimal configuration for Linear-only setup
     */
    LINEAR_ONLY: {
        requiredEnvVars: [
            "APP_STORE_CONNECT_ISSUER_ID",
            "APP_STORE_CONNECT_KEY_ID",
            "APP_STORE_CONNECT_PRIVATE_KEY",
            "LINEAR_API_TOKEN",
            "LINEAR_TEAM_ID",
        ],
        optionalEnvVars: [
            "CRASH_LABELS",
            "FEEDBACK_LABELS",
        ],
    },

    /**
     * Full configuration with LLM enhancement
     */
    FULL_FEATURED: {
        requiredEnvVars: [
            "APP_STORE_CONNECT_ISSUER_ID",
            "APP_STORE_CONNECT_KEY_ID",
            "APP_STORE_CONNECT_PRIVATE_KEY",
            "GTHB_TOKEN",
            "LINEAR_API_TOKEN",
            "LINEAR_TEAM_ID",
        ],
        optionalEnvVars: [
            "ENABLE_LLM_ENHANCEMENT",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "GOOGLE_API_KEY",
            "ENABLE_CODEBASE_ANALYSIS",
        ],
    },
} as const;

/**
 * Configuration helpers
 */
export const CONFIG_HELPERS = {
    /**
     * Checks if GitHub integration is available
     */
    hasGitHubIntegration: (config?: ApplicationConfig): boolean => {
        const currentConfig = config || getConfiguration();
        return !!currentConfig.github;
    },

    /**
     * Checks if Linear integration is available
     */
    hasLinearIntegration: (config?: ApplicationConfig): boolean => {
        const currentConfig = config || getConfiguration();
        return !!currentConfig.linear;
    },

    /**
     * Checks if LLM enhancement is enabled
     */
    hasLLMIntegration: (config?: ApplicationConfig): boolean => {
        const currentConfig = config || getConfiguration();
        return !!currentConfig.llm?.enabled;
    },

    /**
     * Gets the active integrations
     */
    getActiveIntegrations: (config?: ApplicationConfig): string[] => {
        const currentConfig = config || getConfiguration();
        const integrations: string[] = [];

        if (currentConfig.github) {
            integrations.push("github");
        }
        if (currentConfig.linear) {
            integrations.push("linear");
        }
        if (currentConfig.llm?.enabled) {
            integrations.push("llm");
        }
        if (currentConfig.webhook) {
            integrations.push("webhook");
        }

        return integrations;
    },
} as const;
