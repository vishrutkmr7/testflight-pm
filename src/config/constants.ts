/**
 * Centralized Constants Configuration
 * Universal constants used across the TestFlight PM application
 * All API endpoints, timeouts, retries, labels, and default values are defined here for easy maintenance
 */

/**
 * API Endpoints and Base URLs
 */
export const API_ENDPOINTS = {
	GITHUB: "https://api.github.com",
	APP_STORE_CONNECT: "https://api.appstoreconnect.apple.com/v1",
	LINEAR_GRAPHQL: "https://api.linear.app/graphql",
} as const;

/**
 * HTTP Configuration
 */
export const HTTP_CONFIG = {
	DEFAULT_TIMEOUT: 30000, // 30 seconds
	DEFAULT_RETRIES: 3,
	DEFAULT_RETRY_DELAY: 1000, // 1 second
	RATE_LIMIT_BUFFER: 100, // Leave buffer for rate limits
} as const;

/**
 * Cache Configuration
 */
export const CACHE_CONFIG = {
	LABELS_TTL: 300000, // 5 minutes
	MILESTONES_TTL: 300000, // 5 minutes
	TEAM_TTL: 600000, // 10 minutes
	USER_TTL: 600000, // 10 minutes
} as const;

/**
 * Default Issue Labels
 */
export const DEFAULT_LABELS = {
	BASE: ["testflight", "feedback"],
	CRASH: ["bug", "crash", "urgent"],
	FEEDBACK: ["enhancement", "user-feedback"],
	PRIORITY: {
		URGENT: "priority:urgent",
		HIGH: "priority:high",
		NORMAL: "priority:normal",
		LOW: "priority:low",
	},
	PLATFORM: {
		IOS: "platform:ios",
		TESTFLIGHT: "testflight",
	},
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
export const TESTFLIGHT_CONFIG = {
	DEFAULT_LIMIT: 50,
	MAX_LIMIT: 200,
	DEFAULT_SORT: "-submittedAt",
	FETCH_LOOKBACK_HOURS: 24,
} as const;

/**
 * GitHub Action Defaults
 */
export const ACTION_DEFAULTS = {
	MAX_ISSUES_PER_RUN: 10,
	FEEDBACK_TYPES: "all" as const,
	INCLUDE_DEVICE_INFO: true,
	INCLUDE_APP_VERSION: true,
	DUPLICATE_DETECTION: true,
	DRY_RUN: false,
} as const;

/**
 * Error Messages
 */
export const ERROR_MESSAGES = {
	INVALID_PRIVATE_KEY:
		"Invalid private key format. Must be a PEM formatted private key.",
	MISSING_ENV_VAR: "Required environment variable not found",
	GITHUB_CONFIG_MISSING:
		"GitHub configuration not found. Please set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO.",
	LINEAR_CONFIG_MISSING:
		"Linear configuration not found. Please set LINEAR_API_TOKEN and LINEAR_TEAM_ID.",
	APP_STORE_CONFIG_MISSING:
		"App Store Connect configuration not found. Please set APP_STORE_CONNECT_ISSUER_ID, APP_STORE_CONNECT_KEY_ID, and APP_STORE_CONNECT_PRIVATE_KEY.",
	RATE_LIMIT_EXCEEDED:
		"API rate limit exceeded. Please wait before making more requests.",
	AUTHENTICATION_FAILED:
		"Authentication failed. Please check your credentials.",
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
 * File and Path Constants
 */
export const PATHS = {
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
	GITHUB_TOKEN: /^gh[ps]_[A-Za-z0-9_]{36,255}$/,
} as const;

/**
 * Emojis for CLI output
 */
export const EMOJIS = {
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
} as const;
