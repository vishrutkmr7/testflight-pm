/**
 * Configuration Types and Interfaces
 * Centralized type definitions for all configuration structures
 * Follows Interface Segregation Principle - clients depend only on what they need
 */

export type Environment = "development" | "production" | "test";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LLMProvider = "openai" | "anthropic" | "google";

/**
 * Base configuration interfaces that follow common patterns
 */
export interface BaseApiConfig {
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    rateLimitBuffer?: number;
}

export interface BaseLabelConfig {
    defaultLabels: string[];
    crashLabels: string[];
    feedbackLabels: string[];
    additionalLabels?: string[];
}

export interface BaseDuplicateDetectionConfig {
    enableDuplicateDetection: boolean;
    duplicateDetectionDays: number;
}

/**
 * Platform-specific configurations extending base interfaces
 */
export interface AppStoreConnectConfig extends BaseApiConfig {
    issuerId: string;
    keyId: string;
    privateKey: string;
    appId?: string;
    bundleId?: string;
}

export interface GitHubConfig extends BaseApiConfig, BaseLabelConfig, BaseDuplicateDetectionConfig {
    token: string;
    owner: string;
    repo: string;
    defaultAssignee?: string;
    defaultMilestone?: number;
    enableScreenshotUpload?: boolean;
    maxScreenshotSize?: number;
}

export interface LinearConfig extends BaseApiConfig, BaseLabelConfig, BaseDuplicateDetectionConfig {
    apiToken: string;
    teamId: string;
    defaultPriority?: number;
    autoAssigneeId?: string;
    defaultProjectId?: string;
}

export interface WebhookConfig {
    secret: string;
    port: number;
    maxPayloadSize?: number;
}

export interface LLMProviderConfig {
    apiKey: string;
    model: string;
    maxTokens: number;
    temperature: number;
    timeout: number;
    maxRetries: number;
}

export interface LLMCostControls {
    maxCostPerRun: number;
    maxCostPerMonth: number;
    maxTokensPerIssue: number;
    enableCostAlerts: boolean;
    preventOverage: boolean;
}

export interface LLMConfig {
    enabled: boolean;
    primaryProvider: LLMProvider;
    fallbackProviders: LLMProvider[];
    providers: Record<LLMProvider, LLMProviderConfig>;
    costControls: LLMCostControls;
    features: {
        codebaseAnalysis: boolean;
        screenshotAnalysis: boolean;
        priorityClassification: boolean;
        labelGeneration: boolean;
        assigneeRecommendation: boolean;
    };
    security: {
        anonymizeData: boolean;
        excludeSensitiveInfo: boolean;
        logRequestsResponses: boolean;
        enableDataRetentionPolicy: boolean;
    };
}

export interface ProcessingConfig {
    enableDuplicateDetection: boolean;
    duplicateDetectionDays: number;
    enableCodebaseAnalysis: boolean;
    codebaseAnalysisDepth: string;
    minFeedbackLength: number;
    processingWindowHours: number;
    workspaceRoot: string;
}

/**
 * Complete application configuration
 */
export interface ApplicationConfig {
    environment: Environment;
    logLevel: LogLevel;
    isGitHubAction: boolean;
    debug: boolean;
    dryRun: boolean;

    // Required services
    appStoreConnect: AppStoreConnectConfig;

    // Optional services
    github?: GitHubConfig;
    linear?: LinearConfig;
    webhook?: WebhookConfig;
    llm?: LLMConfig;
    processing?: ProcessingConfig;
}

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Configuration source metadata
 */
export interface ConfigSource {
    type: "environment" | "default" | "override";
    source: string;
    timestamp: Date;
}
