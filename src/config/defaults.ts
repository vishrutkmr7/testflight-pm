/**
 * Default Configuration Values
 * Static, compile-time constants that don't change based on environment
 * Centralized defaults following DRY principle
 */

import type {
    BaseApiConfig,
    BaseLabelConfig,
    LLMProviderConfig,
    LLMCostControls,
    ProcessingConfig
} from "./types.js";

/**
 * API Endpoints - External service URLs
 */
export const API_ENDPOINTS = {
    GITHUB: "https://api.github.com",
    APP_STORE_CONNECT: "https://api.appstoreconnect.apple.com/v1",
    LINEAR_GRAPHQL: "https://api.linear.app/graphql",
} as const;

/**
 * Default HTTP configuration for all API clients
 */
export const DEFAULT_HTTP_CONFIG: Required<BaseApiConfig> = {
    timeout: 30000, // 30 seconds
    retries: 3,
    retryDelay: 1000, // 1 second
    rateLimitBuffer: 100, // Leave buffer for rate limits
} as const;

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG = {
    LABELS_TTL: 300000, // 5 minutes
    MILESTONES_TTL: 300000, // 5 minutes
    TEAM_TTL: 600000, // 10 minutes
    USER_TTL: 600000, // 10 minutes
} as const;

/**
 * Default label configuration following consistent patterns
 */
export const DEFAULT_LABEL_CONFIG: Required<BaseLabelConfig> = {
    defaultLabels: ["testflight", "testflight-pm", "feedback"],
    crashLabels: ["bug", "crash", "urgent"],
    feedbackLabels: ["enhancement", "user-feedback"],
    additionalLabels: [],
} as const;

/**
 * Issue Priority Mapping
 */
export const PRIORITY_LEVELS = {
    URGENT: 4,
    HIGH: 3,
    NORMAL: 2,
    LOW: 1,
} as const;

/**
 * TestFlight Query Defaults
 */
export const DEFAULT_TESTFLIGHT_CONFIG = {
    DEFAULT_LIMIT: 50,
    MAX_LIMIT: 200,
    DEFAULT_SORT: "-createdDate",
    FETCH_LOOKBACK_HOURS: 24,
} as const;

// Legacy export for backward compatibility
export const TESTFLIGHT_CONFIG = DEFAULT_TESTFLIGHT_CONFIG;

/**
 * GitHub Action Defaults
 */
export const DEFAULT_ACTION_CONFIG = {
    MAX_ISSUES_PER_RUN: 10,
    FEEDBACK_TYPES: "all" as const,
    INCLUDE_DEVICE_INFO: true,
    INCLUDE_APP_VERSION: true,
    DUPLICATE_DETECTION: true,
    DRY_RUN: false,
} as const;

/**
 * File and Path Constants
 */
export const DEFAULT_PATHS = {
    TEMP_DIR: "/tmp/testflight-pm",
    SCREENSHOTS_DIR: "/tmp/testflight-pm/screenshots",
    LOGS_DIR: "/tmp/testflight-pm/logs",
} as const;

/**
 * Validation Patterns
 */
export const VALIDATION_PATTERNS = {
    BUNDLE_ID: /^[a-zA-Z0-9.-]+\.[a-zA-Z0-9.-]+$/,
    API_KEY_ID: /^[A-Z0-9]{10}$/,
    ISSUER_ID: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
    GTHB_TOKEN: /^gh[ps]_[A-Za-z0-9_]{36,255}$/,
} as const;

/**
 * Centralized LLM Model Constants - Single Source of Truth
 * All other configuration files should reference these constants
 */
export const DEFAULT_LLM_MODELS = {
    openai: "gpt-5.2",
    anthropic: "claude-sonnet-4-5",
    google: "gemini-3-flash-preview",
} as const;

/**
 * Default LLM Provider Configurations
 * Uses centralized model constants to ensure consistency
 */
export const DEFAULT_LLM_PROVIDERS: Record<string, Partial<LLMProviderConfig>> = {
    openai: {
        model: DEFAULT_LLM_MODELS.openai,
        maxTokens: 4000,
        temperature: 0.2,
        timeout: 30000,
        maxRetries: 3,
    },
    anthropic: {
        model: DEFAULT_LLM_MODELS.anthropic,
        maxTokens: 4000,
        temperature: 0.2,
        timeout: 30000,
        maxRetries: 3,
    },
    google: {
        model: DEFAULT_LLM_MODELS.google,
        maxTokens: 4000,
        temperature: 0.2,
        timeout: 30000,
        maxRetries: 3,
    },
} as const;

/**
 * Default LLM Cost Controls
 */
export const DEFAULT_LLM_COST_CONTROLS: LLMCostControls = {
    maxCostPerRun: 5.00,
    maxCostPerMonth: 200.00,
    maxTokensPerIssue: 4000,
    enableCostAlerts: true,
    preventOverage: true,
} as const;

/**
 * Default Processing Configuration
 */
export const DEFAULT_PROCESSING_CONFIG: ProcessingConfig = {
    enableDuplicateDetection: true,
    duplicateDetectionDays: 7,
    enableCodebaseAnalysis: true,
    codebaseAnalysisDepth: "moderate",
    minFeedbackLength: 10,
    processingWindowHours: 24,
    workspaceRoot: ".",
} as const;

/**
 * Error Messages - Centralized error message templates
 */
export const ERROR_MESSAGES = {
    INVALID_PRIVATE_KEY: "Invalid private key format. Must be a PEM formatted private key.",
    MISSING_ENV_VAR: "Required environment variable not found",
    GITHUB_CONFIG_MISSING: "GitHub configuration not found. Please set GTHB_TOKEN, GITHUB_OWNER, and GITHUB_REPO.",
    LINEAR_CONFIG_MISSING: "Linear configuration not found. Please set LINEAR_API_TOKEN and LINEAR_TEAM_ID.",
    APP_STORE_CONFIG_MISSING: "App Store Connect configuration not found. Please set GitHub Action inputs: testflight_issuer_id, testflight_key_id, testflight_private_key, and app_id.",
    RATE_LIMIT_EXCEEDED: "API rate limit exceeded. Please wait before making more requests.",
    AUTHENTICATION_FAILED: "Authentication failed. Please check your credentials.",
    INVALID_CONFIGURATION: "Configuration validation failed",
} as const;

/**
 * Success Messages
 */
export const SUCCESS_MESSAGES = {
    AUTHENTICATION_SUCCESS: "Authentication successful",
    ISSUE_CREATED: "Issue created successfully",
    WEBHOOK_STARTED: "Webhook server started successfully",
    CONFIG_LOADED: "Configuration loaded successfully",
} as const;

/**
 * GitHub Action Output Names
 */
export const ACTION_OUTPUTS = {
    ISSUES_CREATED: "issues-created",
    CRASHES_PROCESSED: "crashes-processed",
    FEEDBACK_PROCESSED: "feedback-processed",
    ERRORS_ENCOUNTERED: "errors-encountered",
    SUMMARY: "summary",
} as const;

/**
 * UI Elements for CLI output
 */
export const UI_ELEMENTS = {
    EMOJIS: {
        SUCCESS: "✅",
        WARNING: "⚠️",
        ERROR: "❌",
        INFO: "ℹ️",
        ROCKET: "🚀",
        BUG: "🐛",
        CRASH: "💥",
        FEEDBACK: "📱",
        GITHUB: "🐙",
        LINEAR: "🔗",
        TESTFLIGHT: "✈️",
        SECURITY: "🔐",
        HEALTH: "🔍",
        CONFIG: "⚙️",
        WEBHOOK: "📡",
    },
} as const;

/**
 * GitHub and Linear specific defaults that can be overridden
 */
export const PLATFORM_DEFAULTS = {
    github: {
        enableScreenshotUpload: true,
        maxScreenshotSize: 25 * 1024 * 1024, // 25MB (GitHub's limit)
        enableDuplicateDetection: true,
        duplicateDetectionDays: 7,
    },
    linear: {
        defaultPriority: PRIORITY_LEVELS.NORMAL,
        enableDuplicateDetection: true,
        duplicateDetectionDays: 7,
    },
    webhook: {
        maxPayloadSize: 10 * 1024 * 1024, // 10MB max payload
    },
} as const;
