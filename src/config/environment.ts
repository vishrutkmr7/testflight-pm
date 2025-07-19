/**
 * Environment Configuration Management
 * Securely loads and validates environment variables and secrets
 * Supports both local development and GitHub Action contexts
 */

import { ERROR_MESSAGES } from "./constants.js";

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

	if (
		!cleanKey.includes("-----BEGIN PRIVATE KEY-----") ||
		!cleanKey.includes("-----END PRIVATE KEY-----")
	) {
		throw new Error(ERROR_MESSAGES.INVALID_PRIVATE_KEY);
	}

	// Check that there's actual content between the headers
	const keyContent = cleanKey
		.replace("-----BEGIN PRIVATE KEY-----", "")
		.replace("-----END PRIVATE KEY-----", "")
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
		const githubToken = getEnvVar("GITHUB_TOKEN", "github-token");

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
					port: parseInt(getEnvVar("WEBHOOK_PORT") || "3000", 10),
				};
			}
		}

		// Validate that at least one issue tracker is configured
		if (!github && !linear) {
			const message =
				"Neither GitHub nor Linear configuration found. Issue creation will be disabled.";
			if (isGitHubAction) {
				throw new Error(message);
			} else {
				console.warn(`Warning: ${message}`);
			}
		}

		const config: EnvironmentConfig = {
			nodeEnv:
				(process.env.NODE_ENV as any) ||
				(isGitHubAction ? "production" : "development"),
			logLevel:
				(process.env.LOG_LEVEL as any) || (isGitHubAction ? "info" : "debug"),
			isGitHubAction,
			appStoreConnect,
			github,
			linear,
			webhook,
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
