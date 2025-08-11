/**
 * Configuration Manager
 * Central configuration management following SOLID principles
 * Provides dependency injection and caching capabilities
 */

import {
    getEnvVar,
    getRequiredEnvVar,
    getBooleanEnvVar,
    getNumericEnvVar,
    getFloatEnvVar,
    getListEnvVar,
    isGitHubActionEnvironment,
    getGitHubContext,
    ENV_VARS
} from "./environment-loader.js";
import {
    DEFAULT_HTTP_CONFIG,
    DEFAULT_LABEL_CONFIG,
    DEFAULT_LLM_PROVIDERS,
    DEFAULT_LLM_COST_CONTROLS,
    DEFAULT_PROCESSING_CONFIG,
    PLATFORM_DEFAULTS
} from "./defaults.js";
import { validateApplicationConfig, validatePrivateKey } from "./validation.js";
import type {
    ApplicationConfig,
    AppStoreConnectConfig,
    GitHubConfig,
    LinearConfig,
    LLMConfig,
    ConfigValidationResult,
    ConfigSource,
    Environment,
    LogLevel,
    LLMProvider,
    LLMProviderConfig
} from "./types.js";

/**
 * Configuration Manager Class
 * Implements Singleton pattern with dependency injection capabilities
 */
export class ConfigurationManager {
    private cachedConfig: ApplicationConfig | null = null;
    private configSources: Map<string, ConfigSource> = new Map();
    private lastLoadTime: Date | null = null;

    /**
     * Loads the complete application configuration
     */
    public loadConfiguration(): ApplicationConfig {
        if (this.cachedConfig && this.shouldUseCachedConfig()) {
            return this.cachedConfig;
        }

        const config = this.buildConfiguration();
        const validationResult = validateApplicationConfig(config);

        if (!validationResult.isValid) {
            throw new Error(
                `Configuration validation failed:\n${validationResult.errors.join('\n')}`
            );
        }

        // Log warnings if any
        if (validationResult.warnings.length > 0) {
            console.warn('Configuration warnings:', validationResult.warnings.join('\n'));
        }

        this.cachedConfig = config;
        this.lastLoadTime = new Date();

        return config;
    }

    /**
     * Validates configuration without loading it
     */
    public validateConfiguration(): ConfigValidationResult {
        const config = this.buildConfiguration();
        return validateApplicationConfig(config);
    }

    /**
     * Clears the cached configuration (useful for testing)
     */
    public clearCache(): void {
        this.cachedConfig = null;
        this.configSources.clear();
        this.lastLoadTime = null;
    }

    /**
     * Gets configuration sources for debugging
     */
    public getConfigSources(): Map<string, ConfigSource> {
        return new Map(this.configSources);
    }

    /**
     * Builds the complete configuration from environment variables and defaults
     */
    private buildConfiguration(): ApplicationConfig {
        const isGitHubAction = isGitHubActionEnvironment();

        return {
            environment: this.getEnvironment(),
            logLevel: this.getLogLevel(isGitHubAction),
            isGitHubAction,
            debug: getBooleanEnvVar("DEBUG", undefined, false),
            dryRun: getBooleanEnvVar(ENV_VARS.DRY_RUN, ENV_VARS.DRY_RUN, false),

            appStoreConnect: this.buildAppStoreConnectConfig(isGitHubAction),
            github: this.buildGitHubConfig(isGitHubAction),
            linear: this.buildLinearConfig(),
            webhook: this.buildWebhookConfig(isGitHubAction),
            llm: this.buildLLMConfig(),
            processing: this.buildProcessingConfig(),
        };
    }

    /**
     * Builds App Store Connect configuration
     */
    private buildAppStoreConnectConfig(isGitHubAction: boolean): AppStoreConnectConfig {
        const issuerId = getRequiredEnvVar(
            "APP_STORE_CONNECT_ISSUER_ID",
            ENV_VARS.APP_STORE_CONNECT_ISSUER_ID
        );

        const keyId = getRequiredEnvVar(
            "APP_STORE_CONNECT_KEY_ID",
            ENV_VARS.APP_STORE_CONNECT_KEY_ID
        );

        // Handle private key from environment or file
        let privateKey: string;
        const privateKeyEnv = getEnvVar(
            "APP_STORE_CONNECT_PRIVATE_KEY",
            ENV_VARS.APP_STORE_CONNECT_PRIVATE_KEY
        );
        const privateKeyPathEnv = getEnvVar("APP_STORE_CONNECT_PRIVATE_KEY_PATH");

        if (privateKeyEnv) {
            privateKey = validatePrivateKey(privateKeyEnv);
            this.recordConfigSource("appStoreConnect.privateKey", "environment");
        } else if (privateKeyPathEnv && !isGitHubAction) {
            // Only allow file path in local development
            try {
                const fs = require("node:fs");
                const keyContent = fs.readFileSync(privateKeyPathEnv, "utf8");
                privateKey = validatePrivateKey(keyContent);
                this.recordConfigSource("appStoreConnect.privateKey", "file", privateKeyPathEnv);
            } catch (error) {
                throw new Error(
                    `Failed to read private key from ${privateKeyPathEnv}: ${error}`
                );
            }
        } else {
            throw new Error(
                "APP_STORE_CONNECT_PRIVATE_KEY must be set (file paths not supported in GitHub Actions)"
            );
        }

        return {
            issuerId,
            keyId,
            privateKey,
            appId: getEnvVar("TESTFLIGHT_APP_ID", ENV_VARS.TESTFLIGHT_APP_ID),
            bundleId: getEnvVar("TESTFLIGHT_BUNDLE_ID", ENV_VARS.TESTFLIGHT_BUNDLE_ID),
            ...DEFAULT_HTTP_CONFIG,
        };
    }

    /**
     * Builds GitHub configuration if available
     */
    private buildGitHubConfig(isGitHubAction: boolean): GitHubConfig | undefined {
        const githubToken = getEnvVar("GTHB_TOKEN", ENV_VARS.GITHUB_TOKEN);

        if (!githubToken) {
            return undefined;
        }

        // In GitHub Actions, use context defaults if not explicitly provided
        const context = getGitHubContext();
        const githubOwner =
            getEnvVar("GITHUB_OWNER", ENV_VARS.GITHUB_OWNER) ||
            (isGitHubAction ? context?.repositoryOwner : undefined);
        const githubRepo =
            getEnvVar("GITHUB_REPO", ENV_VARS.GITHUB_REPO) ||
            (isGitHubAction ? context?.repositoryName : undefined);

        if (!githubOwner || !githubRepo) {
            if (isGitHubAction) {
                throw new Error("GitHub configuration incomplete in GitHub Action environment");
            }
            return undefined;
        }

        // Get labels from environment or use defaults
        const crashLabels = getListEnvVar(
            "CRASH_LABELS",
            ENV_VARS.CRASH_LABELS,
            DEFAULT_LABEL_CONFIG.crashLabels
        );
        const feedbackLabels = getListEnvVar(
            "FEEDBACK_LABELS",
            ENV_VARS.FEEDBACK_LABELS,
            DEFAULT_LABEL_CONFIG.feedbackLabels
        );
        const additionalLabels = getListEnvVar(
            "ADDITIONAL_LABELS",
            ENV_VARS.ADDITIONAL_LABELS,
            []
        );

        return {
            token: githubToken,
            owner: githubOwner,
            repo: githubRepo,
            defaultLabels: [...DEFAULT_LABEL_CONFIG.defaultLabels, ...additionalLabels],
            crashLabels,
            feedbackLabels,
            ...DEFAULT_HTTP_CONFIG,
            ...PLATFORM_DEFAULTS.github,
            enableDuplicateDetection: getBooleanEnvVar(
                "ENABLE_DUPLICATE_DETECTION",
                ENV_VARS.ENABLE_DUPLICATE_DETECTION,
                PLATFORM_DEFAULTS.github.enableDuplicateDetection
            ),
            duplicateDetectionDays: getNumericEnvVar(
                "DUPLICATE_DETECTION_DAYS",
                ENV_VARS.DUPLICATE_DETECTION_DAYS,
                PLATFORM_DEFAULTS.github.duplicateDetectionDays
            ),
        };
    }

    /**
     * Builds Linear configuration if available
     */
    private buildLinearConfig(): LinearConfig | undefined {
        const linearToken = getEnvVar("LINEAR_API_TOKEN", ENV_VARS.LINEAR_API_TOKEN);

        if (!linearToken) {
            return undefined;
        }

        const linearTeamId = getEnvVar("LINEAR_TEAM_ID", ENV_VARS.LINEAR_TEAM_ID);
        if (!linearTeamId) {
            throw new Error("LINEAR_TEAM_ID is required when LINEAR_API_TOKEN is provided");
        }

        // Get labels from environment or use defaults
        const crashLabels = getListEnvVar(
            "CRASH_LABELS",
            ENV_VARS.CRASH_LABELS,
            DEFAULT_LABEL_CONFIG.crashLabels
        );
        const feedbackLabels = getListEnvVar(
            "FEEDBACK_LABELS",
            ENV_VARS.FEEDBACK_LABELS,
            DEFAULT_LABEL_CONFIG.feedbackLabels
        );
        const additionalLabels = getListEnvVar(
            "ADDITIONAL_LABELS",
            ENV_VARS.ADDITIONAL_LABELS,
            []
        );

        return {
            apiToken: linearToken,
            teamId: linearTeamId,
            defaultLabels: [...DEFAULT_LABEL_CONFIG.defaultLabels, ...additionalLabels],
            crashLabels,
            feedbackLabels,
            ...DEFAULT_HTTP_CONFIG,
            ...PLATFORM_DEFAULTS.linear,
            enableDuplicateDetection: getBooleanEnvVar(
                "ENABLE_DUPLICATE_DETECTION",
                ENV_VARS.ENABLE_DUPLICATE_DETECTION,
                PLATFORM_DEFAULTS.linear.enableDuplicateDetection
            ),
            duplicateDetectionDays: getNumericEnvVar(
                "DUPLICATE_DETECTION_DAYS",
                ENV_VARS.DUPLICATE_DETECTION_DAYS,
                PLATFORM_DEFAULTS.linear.duplicateDetectionDays
            ),
        };
    }

    /**
     * Builds webhook configuration for local development
     */
    private buildWebhookConfig(isGitHubAction: boolean): undefined {
        if (isGitHubAction) {
            return undefined; // Webhooks not supported in GitHub Actions
        }

        const webhookSecret = getEnvVar("WEBHOOK_SECRET");
        if (!webhookSecret) {
            return undefined;
        }

        return {
            secret: webhookSecret,
            port: getNumericEnvVar("WEBHOOK_PORT", undefined, 3000),
            ...PLATFORM_DEFAULTS.webhook,
        };
    }

    /**
     * Builds LLM configuration if enabled
     */
    private buildLLMConfig(): LLMConfig | undefined {
        const enabled = getBooleanEnvVar(
            "ENABLE_LLM_ENHANCEMENT",
            ENV_VARS.ENABLE_LLM_ENHANCEMENT,
            false
        );

        if (!enabled) {
            return undefined;
        }

        const primaryProvider = (getEnvVar("LLM_PROVIDER", ENV_VARS.LLM_PROVIDER) || "openai") as LLMProvider;
        const fallbackProviders = getListEnvVar(
            "LLM_FALLBACK_PROVIDERS",
            ENV_VARS.LLM_FALLBACK_PROVIDERS,
            ["anthropic", "google"]
        ) as LLMProvider[];

        // Build provider configurations
        const providers: Record<LLMProvider, LLMProviderConfig> = {
            openai: {
                apiKey: getEnvVar("OPENAI_API_KEY", ENV_VARS.OPENAI_API_KEY) || "",
                model: getEnvVar("OPENAI_MODEL", ENV_VARS.OPENAI_MODEL) || DEFAULT_LLM_PROVIDERS.openai.model,
                ...DEFAULT_LLM_PROVIDERS.openai,
            },
            anthropic: {
                apiKey: getEnvVar("ANTHROPIC_API_KEY", ENV_VARS.ANTHROPIC_API_KEY) || "",
                model: getEnvVar("ANTHROPIC_MODEL", ENV_VARS.ANTHROPIC_MODEL) || DEFAULT_LLM_PROVIDERS.anthropic.model,
                ...DEFAULT_LLM_PROVIDERS.anthropic,
            },
            google: {
                apiKey: getEnvVar("GOOGLE_API_KEY", ENV_VARS.GOOGLE_API_KEY) || "",
                model: getEnvVar("GOOGLE_MODEL", ENV_VARS.GOOGLE_MODEL) || DEFAULT_LLM_PROVIDERS.google.model,
                ...DEFAULT_LLM_PROVIDERS.google,
            },
        };

        return {
            enabled: true,
            primaryProvider,
            fallbackProviders,
            providers,
            costControls: {
                maxCostPerRun: getFloatEnvVar(
                    "MAX_LLM_COST_PER_RUN",
                    ENV_VARS.MAX_LLM_COST_PER_RUN,
                    DEFAULT_LLM_COST_CONTROLS.maxCostPerRun
                ),
                maxCostPerMonth: getFloatEnvVar(
                    "MAX_LLM_COST_PER_MONTH",
                    ENV_VARS.MAX_LLM_COST_PER_MONTH,
                    DEFAULT_LLM_COST_CONTROLS.maxCostPerMonth
                ),
                maxTokensPerIssue: getNumericEnvVar(
                    "MAX_TOKENS_PER_ISSUE",
                    ENV_VARS.MAX_TOKENS_PER_ISSUE,
                    DEFAULT_LLM_COST_CONTROLS.maxTokensPerIssue
                ),
                ...DEFAULT_LLM_COST_CONTROLS,
            },
            features: {
                codebaseAnalysis: getBooleanEnvVar(
                    "ENABLE_CODEBASE_ANALYSIS",
                    ENV_VARS.ENABLE_CODEBASE_ANALYSIS,
                    true
                ),
                screenshotAnalysis: true,
                priorityClassification: true,
                labelGeneration: true,
                assigneeRecommendation: false,
            },
            security: {
                anonymizeData: false,
                excludeSensitiveInfo: true,
                logRequestsResponses: false,
                enableDataRetentionPolicy: false,
            },
        };
    }

    /**
     * Builds processing configuration
     */
    private buildProcessingConfig(): ProcessingConfig {
        return {
            enableDuplicateDetection: getBooleanEnvVar(
                "ENABLE_DUPLICATE_DETECTION",
                ENV_VARS.ENABLE_DUPLICATE_DETECTION,
                DEFAULT_PROCESSING_CONFIG.enableDuplicateDetection
            ),
            duplicateDetectionDays: getNumericEnvVar(
                "DUPLICATE_DETECTION_DAYS",
                ENV_VARS.DUPLICATE_DETECTION_DAYS,
                DEFAULT_PROCESSING_CONFIG.duplicateDetectionDays
            ),
            enableCodebaseAnalysis: getBooleanEnvVar(
                "ENABLE_CODEBASE_ANALYSIS",
                ENV_VARS.ENABLE_CODEBASE_ANALYSIS,
                DEFAULT_PROCESSING_CONFIG.enableCodebaseAnalysis
            ),
            codebaseAnalysisDepth: getEnvVar(
                "CODEBASE_ANALYSIS_DEPTH",
                ENV_VARS.CODEBASE_ANALYSIS_DEPTH
            ) || DEFAULT_PROCESSING_CONFIG.codebaseAnalysisDepth,
            minFeedbackLength: getNumericEnvVar(
                "MIN_FEEDBACK_LENGTH",
                ENV_VARS.MIN_FEEDBACK_LENGTH,
                DEFAULT_PROCESSING_CONFIG.minFeedbackLength
            ),
            processingWindowHours: getNumericEnvVar(
                "PROCESSING_WINDOW_HOURS",
                ENV_VARS.PROCESSING_WINDOW_HOURS,
                DEFAULT_PROCESSING_CONFIG.processingWindowHours
            ),
            workspaceRoot: getEnvVar(
                "WORKSPACE_ROOT",
                ENV_VARS.WORKSPACE_ROOT
            ) || DEFAULT_PROCESSING_CONFIG.workspaceRoot,
        };
    }

    /**
     * Gets the current environment
     */
    private getEnvironment(): Environment {
        const nodeEnv = process.env.NODE_ENV as Environment;
        if (nodeEnv && ["development", "production", "test"].includes(nodeEnv)) {
            return nodeEnv;
        }
        return isGitHubActionEnvironment() ? "production" : "development";
    }

    /**
     * Gets the appropriate log level
     */
    private getLogLevel(isGitHubAction: boolean): LogLevel {
        const logLevel = process.env.LOG_LEVEL as LogLevel;
        if (logLevel && ["debug", "info", "warn", "error"].includes(logLevel)) {
            return logLevel;
        }
        return isGitHubAction ? "info" : "debug";
    }

    /**
     * Records where a configuration value came from for debugging
     */
    private recordConfigSource(key: string, type: ConfigSource["type"], source?: string): void {
        this.configSources.set(key, {
            type,
            source: source || type,
            timestamp: new Date(),
        });
    }

    /**
     * Determines if we should use the cached configuration
     */
    private shouldUseCachedConfig(): boolean {
        if (!this.lastLoadTime) {
            return false;
        }

        // Cache for 5 minutes in production, always reload in development
        const cacheMaxAge = this.cachedConfig?.environment === "production" ? 5 * 60 * 1000 : 0;
        return Date.now() - this.lastLoadTime.getTime() < cacheMaxAge;
    }
}

/**
 * Global configuration manager instance (Singleton)
 */
let configManager: ConfigurationManager | null = null;

/**
 * Gets the global configuration manager instance
 */
export function getConfigManager(): ConfigurationManager {
    if (!configManager) {
        configManager = new ConfigurationManager();
    }
    return configManager;
}

/**
 * Clears the global configuration manager (useful for testing)
 */
export function clearConfigManager(): void {
    configManager = null;
}

/**
 * Convenience function to get the current configuration
 */
export function getConfiguration(): ApplicationConfig {
    return getConfigManager().loadConfiguration();
}

/**
 * Convenience function to validate configuration
 */
export function validateConfiguration(): ConfigValidationResult {
    return getConfigManager().validateConfiguration();
}
