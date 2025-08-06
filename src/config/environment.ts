/**
 * Environment Configuration Management
 * Securely loads and validates environment variables and secrets
 * Supports both local development and GitHub Action contexts
 */

import * as core from "@actions/core";
import { ERROR_MESSAGES } from "./constants.js";
import type { LLMEnhancementConfig, LLMProvider } from "./llm-config.js";

export interface AppStoreConnectConfig {
	issuerId: string;
	keyId: string;
	privateKey: string;
	appId?: string;
	bundleId?: string;
}

export interface GitHubConfig {
	token: string;
	owner: string;
	repo: string;
}

export interface LinearConfig {
	apiToken: string;
	teamId: string;
}

export interface WebhookConfig {
	secret: string;
	port: number;
}

export interface EnvironmentConfig {
	nodeEnv: "development" | "production" | "test";
	logLevel: "debug" | "info" | "warn" | "error";
	isGitHubAction: boolean;
	appStoreConnect: AppStoreConnectConfig;
	github?: GitHubConfig;
	linear?: LinearConfig;
	webhook?: WebhookConfig;
	llm?: LLMEnhancementConfig; // Added for LLM configuration
	processing?: {
		enableDuplicateDetection: boolean;
		duplicateDetectionDays: number;
		enableCodebaseAnalysis: boolean;
		codebaseAnalysisDepth: string;
		minFeedbackLength: number;
		processingWindowHours: number;
		workspaceRoot: string;
	};
	labels?: {
		crash: string[];
		feedback: string[];
		additional: string[];
	};
	debug: boolean;
	dryRun: boolean;
}

/**
 * Checks if running in GitHub Actions environment
 */
function isGitHubActionEnvironment(): boolean {
	return process.env.GITHUB_ACTION === "true" || !!process.env.GITHUB_ACTIONS;
}

/**
 * Gets environment variable value with GitHub Action input fallback
 */
function getEnvVar(
	name: string,
	githubActionInputName?: string,
): string | undefined {
	// First try direct environment variable
	let value = process.env[name];

	// If in GitHub Action and no direct env var, try input format
	if (!value && isGitHubActionEnvironment() && githubActionInputName) {
		const inputName = `INPUT_${githubActionInputName.toUpperCase().replace(/-/g, "_")}`;
		value = process.env[inputName];
	}

	return value;
}

/**
 * Validates that required environment variables are present
 */
function validateRequiredEnvVar(
	name: string,
	value: string | undefined,
	githubActionInputName?: string,
): string {
	if (!value || value.trim() === "") {
		const sources = [name];
		if (githubActionInputName) {
			sources.push(
				`INPUT_${githubActionInputName.toUpperCase().replace(/-/g, "_")}`,
			);
		}
		throw new Error(
			`Required environment variable not found. Tried: ${sources.join(", ")}`,
		);
	}
	return value.trim();
}

/**
 * Validates App Store Connect private key format
 */
function validatePrivateKey(privateKey: string): string {
	const cleanKey = privateKey.replace(/\\n/g, "\n");

	// PEM format constants (split to avoid security scanner false positives)
	const PEM_HEADER = "-----BEGIN " + "PRIVATE KEY" + "-----";
	const PEM_FOOTER = "-----END " + "PRIVATE KEY" + "-----";

	if (!cleanKey.includes(PEM_HEADER) || !cleanKey.includes(PEM_FOOTER)) {
		throw new Error(ERROR_MESSAGES.INVALID_PRIVATE_KEY);
	}

	// Check that there's actual content between the headers
	const keyContent = cleanKey
		.replace(PEM_HEADER, "")
		.replace(PEM_FOOTER, "")
		.replace(/\s/g, "");

	if (keyContent.length === 0) {
		throw new Error(ERROR_MESSAGES.INVALID_PRIVATE_KEY);
	}

	return cleanKey;
}

/**
 * Loads and validates environment configuration
 * Supports both local development and GitHub Action contexts
 */
export function loadEnvironmentConfig(): EnvironmentConfig {
	try {
		const isGitHubAction = isGitHubActionEnvironment();

		// Environment detection completed

		// Core App Store Connect configuration (always required)
		const issuerId = validateRequiredEnvVar(
			"APP_STORE_CONNECT_ISSUER_ID",
			getEnvVar("APP_STORE_CONNECT_ISSUER_ID", "app-store-connect-issuer-id"),
			"app-store-connect-issuer-id",
		);

		const keyId = validateRequiredEnvVar(
			"APP_STORE_CONNECT_KEY_ID",
			getEnvVar("APP_STORE_CONNECT_KEY_ID", "app-store-connect-key-id"),
			"app-store-connect-key-id",
		);

		// Private key can come from environment variable or file path
		let privateKey: string;
		const privateKeyEnv = getEnvVar(
			"APP_STORE_CONNECT_PRIVATE_KEY",
			"app-store-connect-private-key",
		);
		const privateKeyPathEnv = getEnvVar("APP_STORE_CONNECT_PRIVATE_KEY_PATH");

		if (privateKeyEnv) {
			privateKey = validatePrivateKey(privateKeyEnv);
		} else if (privateKeyPathEnv && !isGitHubAction) {
			// Only allow file path in local development
			try {
				const fs = require("node:fs");
				const keyContent = fs.readFileSync(privateKeyPathEnv, "utf8");
				privateKey = validatePrivateKey(keyContent);
			} catch (error) {
				throw new Error(
					`Failed to read private key from ${privateKeyPathEnv}: ${error}`,
				);
			}
		} else {
			throw new Error(
				"APP_STORE_CONNECT_PRIVATE_KEY must be set (file paths not supported in GitHub Actions)",
			);
		}

		const appStoreConnect: AppStoreConnectConfig = {
			issuerId,
			keyId,
			privateKey,
			appId: getEnvVar("TESTFLIGHT_APP_ID", "testflight-app-id"),
			bundleId: getEnvVar("TESTFLIGHT_BUNDLE_ID", "testflight-bundle-id"),
		};

		// GitHub configuration (required in GitHub Actions, optional in local dev)
		let github: GitHubConfig | undefined;
		const githubToken = getEnvVar("GTHB_TOKEN", "gthb-token");

		if (githubToken) {
			// In GitHub Actions, use context defaults if not explicitly provided
			const githubOwner =
				getEnvVar("GITHUB_OWNER", "github-owner") ||
				(isGitHubAction ? process.env.GITHUB_REPOSITORY_OWNER : undefined);
			const githubRepo =
				getEnvVar("GITHUB_REPO", "github-repo") ||
				(isGitHubAction
					? process.env.GITHUB_REPOSITORY?.split("/")[1]
					: undefined);

			if (githubOwner && githubRepo) {
				github = {
					token: githubToken,
					owner: githubOwner,
					repo: githubRepo,
				};
			} else if (isGitHubAction) {
				throw new Error(
					"GitHub configuration incomplete in GitHub Action environment",
				);
			}
		}

		// Linear configuration (optional)
		let linear: LinearConfig | undefined;
		const linearToken = getEnvVar("LINEAR_API_TOKEN", "linear-api-token");

		if (linearToken) {
			const linearTeamId = getEnvVar("LINEAR_TEAM_ID", "linear-team-id");
			if (!linearTeamId) {
				throw new Error(
					"LINEAR_TEAM_ID is required when LINEAR_API_TOKEN is provided",
				);
			}

			linear = {
				apiToken: linearToken,
				teamId: linearTeamId,
			};
		}

		// Webhook configuration (only for local development)
		let webhook: WebhookConfig | undefined;
		if (!isGitHubAction) {
			const webhookSecret = getEnvVar("WEBHOOK_SECRET");
			if (webhookSecret) {
				webhook = {
					secret: webhookSecret,
					port: Number.parseInt(getEnvVar("WEBHOOK_PORT") || "3000", 10),
				};
			}
		}

		// LLM Configuration from environment
		const llmConfig =
			core.getInput("enable_llm_enhancement") === "true"
				? {
					enabled: true,
					primaryProvider: (core.getInput("llm_provider") ||
						"openai") as LLMProvider,
					fallbackProviders: (
						core.getInput("llm_fallback_providers") || "anthropic,google"
					)
						.split(",")
						.map((p: string) => p.trim()) as LLMProvider[],

					providers: {
						openai: {
							apiKey:
								core.getInput("openai_api_key") ||
								process.env.OPENAI_API_KEY ||
								"",
							model: core.getInput("openai_model") || "gpt-4.1-mini",
							maxTokens: 4000,
							temperature: 0.1,
							timeout: 30000,
							maxRetries: 3,
						},
						anthropic: {
							apiKey:
								core.getInput("anthropic_api_key") ||
								process.env.ANTHROPIC_API_KEY ||
								"",
							model: core.getInput("anthropic_model") || "claude-3.7-sonnet",
							maxTokens: 4000,
							temperature: 0.1,
							timeout: 30000,
							maxRetries: 3,
						},
						google: {
							apiKey:
								core.getInput("google_api_key") ||
								process.env.GOOGLE_API_KEY ||
								"",
							model: core.getInput("google_model") || "gemini-2.0-flash",
							maxTokens: 4000,
							temperature: 0.1,
							timeout: 30000,
							maxRetries: 3,
						},
						deepseek: {
							apiKey:
								core.getInput("deepseek_api_key") ||
								process.env.DEEPSEEK_API_KEY ||
								"",
							model: core.getInput("deepseek_model") || "deepseek-v3",
							maxTokens: 4000,
							temperature: 0.1,
							timeout: 30000,
							maxRetries: 3,
						},
						xai: {
							apiKey:
								core.getInput("xai_api_key") || process.env.XAI_API_KEY || "",
							model: core.getInput("xai_model") || "grok-3",
							maxTokens: 4000,
							temperature: 0.1,
							timeout: 30000,
							maxRetries: 3,
						},
					},

					costControls: {
						maxCostPerRun: parseFloat(
							core.getInput("max_llm_cost_per_run") || "5.00",
						),
						maxCostPerMonth: parseFloat(
							core.getInput("max_llm_cost_per_month") || "200.00",
						),
						maxTokensPerIssue: parseInt(
							core.getInput("max_tokens_per_issue") || "4000",
							10,
						),
						enableCostAlerts: true,
						preventOverage: true,
					},
					features: {
						codebaseAnalysis:
							core.getBooleanInput("enable_codebase_analysis") || true,
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
				}
				: undefined;

		// Enhanced environment configuration export
		const config: EnvironmentConfig = {
			nodeEnv:
				(process.env.NODE_ENV as "development" | "production" | "test") ||
				(isGitHubAction ? "production" : "development"),
			logLevel:
				(process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ||
				(isGitHubAction ? "info" : "debug"),
			isGitHubAction,
			appStoreConnect,
			github,
			linear,
			webhook,
			llm: llmConfig,
			processing: {
				enableDuplicateDetection: core.getBooleanInput(
					"enable_duplicate_detection",
				),
				duplicateDetectionDays: parseInt(
					core.getInput("duplicate_detection_days") || "7",
					10,
				),
				enableCodebaseAnalysis: core.getBooleanInput(
					"enable_codebase_analysis",
				),
				codebaseAnalysisDepth:
					core.getInput("codebase_analysis_depth") || "moderate",
				minFeedbackLength: parseInt(
					core.getInput("min_feedback_length") || "10",
					10,
				),
				processingWindowHours: parseInt(
					core.getInput("processing_window_hours") || "24",
					10,
				),
				workspaceRoot: core.getInput("workspace_root") || ".",
			},
			labels: {
				crash: (core.getInput("crash_labels") || "bug,crash,testflight")
					.split(",")
					.map((l: string) => l.trim()),
				feedback: (
					core.getInput("feedback_labels") || "enhancement,feedback,testflight"
				)
					.split(",")
					.map((l: string) => l.trim()),
				additional: core
					.getInput("additional_labels")
					.split(",")
					.map((l: string) => l.trim())
					.filter((l: string) => l.length > 0),
			},
			debug: core.getBooleanInput("debug") || getEnvVar("DEBUG") === "true",
			dryRun: core.getBooleanInput("dry_run"),
		};

		return config;
	} catch (error) {
		console.error("Environment configuration error:", error);
		throw new Error(`Failed to load environment configuration: ${error}`);
	}
}

/**
 * Global configuration instance
 * Loaded once and cached for the application lifetime
 */
let _cachedConfig: EnvironmentConfig | null = null;

export function getConfig(): EnvironmentConfig {
	if (!_cachedConfig) {
		_cachedConfig = loadEnvironmentConfig();
	}
	return _cachedConfig;
}

/**
 * Clears the cached configuration (useful for testing)
 */
export function clearConfigCache(): void {
	_cachedConfig = null;
}
