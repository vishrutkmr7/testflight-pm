/**
 * LLM Configuration Management
 * Secure configuration for LLM providers with BYOK support and cost controls
 */

import { getConfiguration } from "./index.js";
import { DEFAULT_LLM_MODELS } from "./defaults.js";

export type LLMProvider = "openai" | "anthropic" | "google";

export interface LLMProviderConfig {
	apiKey: string;
	model: string;
	maxTokens: number;
	temperature: number;
	timeout: number;
	maxRetries: number;
}

export interface LLMCostControls {
	maxTokensPerIssue: number;
	maxCostPerRun: number;
	maxCostPerMonth: number;
	enableCostAlerts: boolean;
	preventOverage: boolean;
}

export interface LLMEnhancementConfig {
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

export interface LLMUsageStats {
	totalTokensUsed: number;
	totalCostAccrued: number;
	requestCount: number;
	lastResetDate: Date;
	monthlyUsage: {
		tokens: number;
		cost: number;
		requests: number;
	};
	providerUsage: Record<
		LLMProvider,
		{
			tokens: number;
			cost: number;
			requests: number;
			successRate: number;
		}
	>;
}

/**
 * Model pricing information (cost per 1K tokens) - Latest Models Only
 * Only includes the current latest models defined in DEFAULT_LLM_MODELS
 * Users cannot choose different models - only provider and API key
 */
export const LLM_MODEL_PRICING: Record<
	string,
	{ input: number; output: number }
> = {
	// Latest OpenAI model - gpt-5.2
	[DEFAULT_LLM_MODELS.openai]: { input: 0.00015, output: 0.0006 },

	// Latest Anthropic model - claude-sonnet-4-5
	[DEFAULT_LLM_MODELS.anthropic]: { input: 0.003, output: 0.015 },

	// Latest Google model - gemini-3-flash-preview ($0.50/$3.00 per million tokens)
	[DEFAULT_LLM_MODELS.google]: { input: 0.0005, output: 0.003 },
} as const;

/**
 * Default LLM configuration - Updated 2025
 */
export const DEFAULT_LLM_CONFIG: LLMEnhancementConfig = {
	enabled: false,
	primaryProvider: "openai",
	fallbackProviders: ["anthropic", "google"],
	providers: {
		openai: {
			apiKey: "",
			model: DEFAULT_LLM_MODELS.openai,  // Uses centralized default
			maxTokens: 4000,
			temperature: 0.7,
			timeout: 30000,
			maxRetries: 3,
		},
		anthropic: {
			apiKey: "",
			model: DEFAULT_LLM_MODELS.anthropic,  // Uses centralized default
			maxTokens: 4000,
			temperature: 0.7,
			timeout: 30000,
			maxRetries: 3,
		},
		google: {
			apiKey: "",
			model: DEFAULT_LLM_MODELS.google,  // Uses centralized default
			maxTokens: 4000,
			temperature: 0.7,
			timeout: 30000,
			maxRetries: 3,
		},

	},
	costControls: {
		maxTokensPerIssue: 8000,
		maxCostPerRun: 2.0,
		maxCostPerMonth: 50.0,
		enableCostAlerts: true,
		preventOverage: true,
	},
	features: {
		codebaseAnalysis: true,
		screenshotAnalysis: true,
		priorityClassification: true,
		labelGeneration: true,
		assigneeRecommendation: false,
	},
	security: {
		anonymizeData: false,
		excludeSensitiveInfo: true,
		logRequestsResponses: false,
		enableDataRetentionPolicy: true,
	},
};

/**
 * Environment variable names for LLM configuration
 */
export const LLM_ENV_VARS = {
	ENABLE_LLM_ENHANCEMENT: "ENABLE_LLM_ENHANCEMENT",
	LLM_PROVIDER: "LLM_PROVIDER",
	LLM_FALLBACK_PROVIDERS: "LLM_FALLBACK_PROVIDERS",

	// API Keys
	OPENAI_API_KEY: "OPENAI_API_KEY",
	ANTHROPIC_API_KEY: "ANTHROPIC_API_KEY",
	GOOGLE_API_KEY: "GOOGLE_API_KEY",

	// Models
	OPENAI_MODEL: "OPENAI_MODEL",
	ANTHROPIC_MODEL: "ANTHROPIC_MODEL",
	GOOGLE_MODEL: "GOOGLE_MODEL",

	// Cost Controls
	MAX_LLM_COST_PER_RUN: "MAX_LLM_COST_PER_RUN",
	MAX_LLM_COST_PER_MONTH: "MAX_LLM_COST_PER_MONTH",
	MAX_TOKENS_PER_ISSUE: "MAX_TOKENS_PER_ISSUE",

	// Features
	ENABLE_CODEBASE_ANALYSIS: "ENABLE_CODEBASE_ANALYSIS",
	ENABLE_SCREENSHOT_ANALYSIS: "ENABLE_SCREENSHOT_ANALYSIS",
	ANALYSIS_DEPTH: "ANALYSIS_DEPTH",

	// Security
	ANONYMIZE_LLM_DATA: "ANONYMIZE_LLM_DATA",
	EXCLUDE_SENSITIVE_INFO: "EXCLUDE_SENSITIVE_INFO",
} as const;

/**
 * GitHub Action input names for LLM configuration
 */
export const LLM_ACTION_INPUTS = {
	ENABLE_LLM_ENHANCEMENT: "enable-llm-enhancement",
	LLM_PROVIDER: "llm-provider",
	LLM_API_KEY: "llm-api-key",
	LLM_MODEL: "llm-model",
	MAX_LLM_COST_PER_RUN: "max-llm-cost-per-run",
	ENABLE_CODEBASE_ANALYSIS: "enable-codebase-analysis",
	ANALYSIS_DEPTH: "analysis-depth",
	INCLUDE_RECENT_CHANGES: "include-recent-changes",
} as const;

/**
 * Loads LLM configuration from environment variables and GitHub Action inputs
 */
export function loadLLMConfig(): LLMEnhancementConfig {
	const envConfig = getConfiguration();
	const config = { ...DEFAULT_LLM_CONFIG };

	// Helper function to get environment variable with GitHub Action fallback
	function getEnvVar(
		envName: string,
		actionInput?: string,
	): string | undefined {
		// Check GitHub Action input first (if running in GitHub Actions)
		if (envConfig.isGitHubAction && actionInput) {
			const actionValue =
				process.env[`INPUT_${actionInput.toUpperCase().replace(/-/g, "_")}`];
			if (actionValue) {
				return actionValue;
			}
		}

		// Fall back to environment variable
		return process.env[envName];
	}

	// Basic configuration
	const enableLLM = getEnvVar(
		LLM_ENV_VARS.ENABLE_LLM_ENHANCEMENT,
		LLM_ACTION_INPUTS.ENABLE_LLM_ENHANCEMENT,
	);
	config.enabled = enableLLM === "true" || enableLLM === "1";

	if (!config.enabled) {
		return config;
	}

	// Provider configuration
	const primaryProvider = getEnvVar(
		LLM_ENV_VARS.LLM_PROVIDER,
		LLM_ACTION_INPUTS.LLM_PROVIDER,
	) as LLMProvider;
	if (
		primaryProvider &&
		["openai", "anthropic", "google"].includes(primaryProvider)
	) {
		config.primaryProvider = primaryProvider;
	}

	const fallbackProviders = getEnvVar(LLM_ENV_VARS.LLM_FALLBACK_PROVIDERS);
	if (fallbackProviders) {
		config.fallbackProviders = fallbackProviders
			.split(",")
			.map((p) => p.trim()) as LLMProvider[];
	}

	// API Keys
	const openaiKey = getEnvVar(LLM_ENV_VARS.OPENAI_API_KEY);
	if (openaiKey) {
		config.providers.openai.apiKey = openaiKey;
	}

	const anthropicKey = getEnvVar(LLM_ENV_VARS.ANTHROPIC_API_KEY);
	if (anthropicKey) {
		config.providers.anthropic.apiKey = anthropicKey;
	}

	const googleKey = getEnvVar(LLM_ENV_VARS.GOOGLE_API_KEY);
	if (googleKey) {
		config.providers.google.apiKey = googleKey;
	}

	// Models are fixed to latest versions - not user-configurable
	// Users can only choose provider and API key, not specific models
	// All providers use the latest models defined in DEFAULT_LLM_MODELS

	// Cost Controls
	const maxCostPerRun = getEnvVar(
		LLM_ENV_VARS.MAX_LLM_COST_PER_RUN,
		LLM_ACTION_INPUTS.MAX_LLM_COST_PER_RUN,
	);
	if (maxCostPerRun) {
		const cost = Number.parseFloat(maxCostPerRun);
		if (!Number.isNaN(cost) && cost > 0) {
			config.costControls.maxCostPerRun = cost;
		}
	}

	const maxCostPerMonth = getEnvVar(LLM_ENV_VARS.MAX_LLM_COST_PER_MONTH);
	if (maxCostPerMonth) {
		const cost = Number.parseFloat(maxCostPerMonth);
		if (!Number.isNaN(cost) && cost > 0) {
			config.costControls.maxCostPerMonth = cost;
		}
	}

	const maxTokensPerIssue = getEnvVar(LLM_ENV_VARS.MAX_TOKENS_PER_ISSUE);
	if (maxTokensPerIssue) {
		const tokens = Number.parseInt(maxTokensPerIssue, 10);
		if (!Number.isNaN(tokens) && tokens > 0) {
			config.costControls.maxTokensPerIssue = tokens;
		}
	}

	// Features
	const enableCodebaseAnalysis = getEnvVar(
		LLM_ENV_VARS.ENABLE_CODEBASE_ANALYSIS,
		LLM_ACTION_INPUTS.ENABLE_CODEBASE_ANALYSIS,
	);
	config.features.codebaseAnalysis =
		enableCodebaseAnalysis !== "false" && enableCodebaseAnalysis !== "0";

	const enableScreenshotAnalysis = getEnvVar(
		LLM_ENV_VARS.ENABLE_SCREENSHOT_ANALYSIS,
	);
	if (enableScreenshotAnalysis !== undefined) {
		config.features.screenshotAnalysis =
			enableScreenshotAnalysis === "true" || enableScreenshotAnalysis === "1";
	}

	// Security
	const anonymizeData = getEnvVar(LLM_ENV_VARS.ANONYMIZE_LLM_DATA);
	if (anonymizeData !== undefined) {
		config.security.anonymizeData =
			anonymizeData === "true" || anonymizeData === "1";
	}

	const excludeSensitiveInfo = getEnvVar(LLM_ENV_VARS.EXCLUDE_SENSITIVE_INFO);
	if (excludeSensitiveInfo !== undefined) {
		config.security.excludeSensitiveInfo =
			excludeSensitiveInfo === "true" || excludeSensitiveInfo === "1";
	}

	return config;
}

/**
 * Validates LLM configuration with enhanced LLM-specific checks
 * Uses the centralized validation from config/validation.ts and adds LLM-specific validations
 */
export function validateLLMConfig(config: LLMEnhancementConfig): {
	valid: boolean;
	errors: string[];
	warnings: string[];
} {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!config.enabled) {
		return { valid: true, errors, warnings: ["LLM enhancement is disabled"] };
	}

	// Delegate core validation to centralized validator
	// Note: This will be imported from validation.ts when circular dependency is resolved
	// For now, we maintain LLM-specific validation logic here

	// Validate primary provider API key
	const primaryProviderConfig = config.providers[config.primaryProvider];
	if (
		!primaryProviderConfig.apiKey ||
		primaryProviderConfig.apiKey.trim() === ""
	) {
		errors.push(
			`API key missing for primary provider: ${config.primaryProvider}`,
		);
	}

	// Validate model configuration
	if (
		!primaryProviderConfig.model ||
		primaryProviderConfig.model.trim() === ""
	) {
		errors.push(
			`Model not specified for primary provider: ${config.primaryProvider}`,
		);
	}

	// LLM-specific validation: Check if model pricing is available
	if (
		primaryProviderConfig.model &&
		!LLM_MODEL_PRICING[primaryProviderConfig.model]
	) {
		warnings.push(
			`Pricing information not available for model: ${primaryProviderConfig.model}`,
		);
	}

	// Validate fallback providers
	for (const fallbackProvider of config.fallbackProviders) {
		const fallbackConfig = config.providers[fallbackProvider];
		if (!fallbackConfig.apiKey || fallbackConfig.apiKey.trim() === "") {
			warnings.push(
				`API key missing for fallback provider: ${fallbackProvider}`,
			);
		}
	}

	// Validate cost controls
	if (config.costControls.maxCostPerRun <= 0) {
		errors.push("Max cost per run must be greater than 0");
	}

	if (config.costControls.maxCostPerMonth <= 0) {
		errors.push("Max cost per month must be greater than 0");
	}

	if (config.costControls.maxTokensPerIssue <= 0) {
		errors.push("Max tokens per issue must be greater than 0");
	}

	// LLM-specific validation: Validate feature flags
	if (config.features.codebaseAnalysis && !config.features.screenshotAnalysis) {
		warnings.push(
			"Codebase analysis enabled but screenshot analysis disabled - may reduce accuracy",
		);
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Calculates estimated cost for a request
 */
export function calculateEstimatedCost(
	_provider: LLMProvider,
	model: string,
	inputTokens: number,
	outputTokens: number = 0,
): number {
	const pricing = LLM_MODEL_PRICING[model];
	if (!pricing) {
		console.warn(`Pricing information not available for model: ${model}`);
		return 0;
	}

	const inputCost = (inputTokens / 1000) * pricing.input;
	const outputCost = (outputTokens / 1000) * pricing.output;

	return inputCost + outputCost;
}

/**
 * Checks if cost limits would be exceeded
 */
export function checkCostLimits(
	config: LLMEnhancementConfig,
	currentUsage: LLMUsageStats,
	estimatedAdditionalCost: number,
): {
	withinLimits: boolean;
	exceededLimits: string[];
	remainingBudget: {
		run: number;
		month: number;
	};
} {
	const exceededLimits: string[] = [];

	// Check per-run limit
	const remainingRunBudget =
		config.costControls.maxCostPerRun - estimatedAdditionalCost;
	if (remainingRunBudget < 0) {
		exceededLimits.push(
			`Per-run cost limit: $${config.costControls.maxCostPerRun}`,
		);
	}

	// Check monthly limit
	const remainingMonthlyBudget =
		config.costControls.maxCostPerMonth -
		currentUsage.monthlyUsage.cost -
		estimatedAdditionalCost;
	if (remainingMonthlyBudget < 0) {
		exceededLimits.push(
			`Monthly cost limit: $${config.costControls.maxCostPerMonth}`,
		);
	}

	return {
		withinLimits: exceededLimits.length === 0,
		exceededLimits,
		remainingBudget: {
			run: Math.max(0, remainingRunBudget),
			month: Math.max(0, remainingMonthlyBudget),
		},
	};
}

/**
 * Sanitizes sensitive data for LLM requests
 */
export function sanitizeDataForLLM(
	data: string,
	config: LLMEnhancementConfig,
): string {
	if (!config.security.excludeSensitiveInfo) {
		return data;
	}

	let sanitized = data;

	// Remove common sensitive patterns
	const sensitivePatterns = [
		// API keys and tokens
		/(?:api[_-]?key|token|secret)["\s]*[:=]["\s]*[a-zA-Z0-9_\-.]{10,}/gi,
		// Email addresses (if anonymization is enabled)
		...(config.security.anonymizeData
			? [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g]
			: []),
		// Credit card numbers
		/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
		// Social security numbers
		/\b\d{3}-\d{2}-\d{4}\b/g,
		// Phone numbers (if anonymization is enabled)
		...(config.security.anonymizeData
			? [/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g]
			: []),
	];

	for (const pattern of sensitivePatterns) {
		sanitized = sanitized.replace(pattern, "[REDACTED]");
	}

	return sanitized;
}

/**
 * Global LLM configuration instance
 */
let _llmConfig: LLMEnhancementConfig | null = null;

export function getLLMConfig(): LLMEnhancementConfig {
	if (!_llmConfig) {
		_llmConfig = loadLLMConfig();
	}
	return _llmConfig;
}

/**
 * Clears the global LLM configuration instance (useful for testing)
 */
export function clearLLMConfigCache(): void {
	_llmConfig = null;
}
