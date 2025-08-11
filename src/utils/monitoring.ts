/**
 * Production Monitoring and Health Check System
 * Comprehensive monitoring for all system components
 */

import { getCodebaseAnalyzer } from "../analysis/codebase-analyzer.js";
import { getGitHubClient } from "../api/github-client.js";
import { getLinearClient } from "../api/linear-client.js";
import { getLLMClient } from "../api/llm-client.js";
import { getTestFlightClient } from "../api/testflight-client.js";
import { getStateManager } from "./state-manager.js";

export interface HealthCheck {
	component: string;
	status: "healthy" | "degraded" | "unhealthy";
	responseTime?: number;
	details: Record<string, unknown>;
	error?: string;
	recommendations?: string[];
	lastChecked: string;
}

export interface SystemHealth {
	overall: "healthy" | "degraded" | "unhealthy";
	components: HealthCheck[];
	metrics: {
		totalResponseTime: number;
		healthyComponents: number;
		degradedComponents: number;
		unhealthyComponents: number;
	};
	environment: {
		nodeEnv: string;
		version: string;
		uptime: number;
		memory: {
			used: number;
			total: number;
			percentage: number;
		};
	};
	recommendations: string[];
	lastChecked: string;
}

export interface MonitoringConfig {
	enableDetailedChecks: boolean;
	timeoutMs: number;
	includeMetrics: boolean;
	environment: "development" | "production" | "test";
}

/**
 * Comprehensive system health monitor
 */
export class SystemHealthMonitor {
	private config: MonitoringConfig;

	constructor(config?: Partial<MonitoringConfig>) {
		this.config = {
			enableDetailedChecks: true,
			timeoutMs: 30000,
			includeMetrics: true,
			environment: (process.env.NODE_ENV as "development" | "production" | "test") || "development",
			...config,
		};
	}

	/**
	 * Perform comprehensive system health check
	 */
	public async checkSystemHealth(): Promise<SystemHealth> {
		const startTime = Date.now();
		const checks: HealthCheck[] = [];

		// Core component checks
		const componentChecks = [
			this.checkGitHubIntegration(),
			this.checkLinearIntegration(),
			this.checkTestFlightIntegration(),
			this.checkLLMIntegration(),
			this.checkStateManagement(),
			this.checkCodebaseAnalysis(),
			this.checkEnvironmentConfiguration(),
		];

		// Run all checks with timeout protection
		const checkResults = await Promise.allSettled(
			componentChecks.map((check) =>
				Promise.race([check, this.timeoutPromise(this.config.timeoutMs)]),
			),
		);

		// Process results
		checkResults.forEach((result, index) => {
			const componentNames = [
				"GitHub Integration",
				"Linear Integration",
				"TestFlight Integration",
				"LLM Integration",
				"State Management",
				"Codebase Analysis",
				"Environment Configuration",
			];

			if (result.status === "fulfilled") {
				checks.push(result.value);
			} else {
				checks.push({
					component: componentNames[index] || "Unknown",
					status: "unhealthy",
					error: result.reason?.message || "Health check failed",
					details: {},
					lastChecked: new Date().toISOString(),
					recommendations: [
						"Investigate component failure",
						"Check configuration and connectivity",
					],
				});
			}
		});

		// Calculate overall health
		const healthyCount = checks.filter((c) => c.status === "healthy").length;
		const degradedCount = checks.filter((c) => c.status === "degraded").length;
		const unhealthyCount = checks.filter(
			(c) => c.status === "unhealthy",
		).length;

		let overallStatus: "healthy" | "degraded" | "unhealthy";
		if (unhealthyCount > 0) {
			overallStatus = "unhealthy";
		} else if (degradedCount > 0) {
			overallStatus = "degraded";
		} else {
			overallStatus = "healthy";
		}

		// Generate system recommendations
		const recommendations = this.generateSystemRecommendations(
			checks,
			overallStatus,
		);

		// Gather environment metrics
		const environment = await this.gatherEnvironmentMetrics();

		return {
			overall: overallStatus,
			components: checks,
			metrics: {
				totalResponseTime: Date.now() - startTime,
				healthyComponents: healthyCount,
				degradedComponents: degradedCount,
				unhealthyComponents: unhealthyCount,
			},
			environment,
			recommendations,
			lastChecked: new Date().toISOString(),
		};
	}

	/**
	 * Check GitHub integration health
	 */
	private async checkGitHubIntegration(): Promise<HealthCheck> {
		const startTime = Date.now();

		try {
			const platform = (process.env.INPUT_PLATFORM || process.env.PLATFORM || "github").toLowerCase();
			const client = getGitHubClient();
			const health = await client.healthCheck();

			// For multi-platform setup, GitHub issues should be degraded not unhealthy
			let adjustedStatus: "healthy" | "degraded" | "unhealthy" = health.status;
			if (platform === "both" && health.status === "unhealthy") {
				adjustedStatus = "degraded"; // Don't fail entire system for GitHub issues in multi-platform
			}

			return {
				component: "GitHub Integration",
				status: adjustedStatus,
				responseTime: Date.now() - startTime,
				details: {
					...health.details,
					platform,
					originalStatus: health.status,
				},
				recommendations:
					health.details.rateLimit &&
						typeof health.details.rateLimit === 'object' &&
						'remaining' in health.details.rateLimit &&
						(health.details.rateLimit as { remaining: number }).remaining < 100
						? [
							"GitHub rate limit running low - consider reducing request frequency",
						]
						: health.status === "unhealthy" && platform === "both"
							? [
								"Check GitHub token configuration",
								"Verify GitHub API connectivity",
								"Linear integration will continue to work regardless of GitHub issues",
							]
							: [],
				lastChecked: new Date().toISOString(),
			};
		} catch (error) {
			const platform = (process.env.INPUT_PLATFORM || process.env.PLATFORM || "github").toLowerCase();

			// For multi-platform, GitHub failures should be degraded not unhealthy
			const status = platform === "both" ? "degraded" : "unhealthy";

			return {
				component: "GitHub Integration",
				status,
				responseTime: Date.now() - startTime,
				error: (error as Error).message,
				details: {
					platform,
				},
				recommendations: [
					"Check GitHub token configuration",
					"Verify GitHub API connectivity",
					platform === "both" ? "Linear integration will continue to work regardless of GitHub issues" : "",
				].filter(Boolean),
				lastChecked: new Date().toISOString(),
			};
		}
	}

	/**
	 * Check Linear integration health
	 */
	private async checkLinearIntegration(): Promise<HealthCheck> {
		const startTime = Date.now();

		try {
			// Check if Linear configuration is available
			const platform = (process.env.INPUT_PLATFORM || process.env.PLATFORM || "github").toLowerCase();
			const linearToken = process.env.LINEAR_API_TOKEN || process.env.INPUT_LINEAR_API_TOKEN;
			const linearTeamId = process.env.LINEAR_TEAM_ID || process.env.INPUT_LINEAR_TEAM_ID;

			// If Linear is not required for this platform, treat as healthy but not configured
			if (platform === "github") {
				return {
					component: "Linear Integration",
					status: "healthy",
					responseTime: Date.now() - startTime,
					details: {
						configured: false,
						reason: "Linear not required for GitHub-only platform",
						platform,
						timestamp: new Date().toISOString(),
					},
					recommendations: [],
					lastChecked: new Date().toISOString(),
				};
			}

			// For platform "both" or "linear", Linear is optional but should be configured properly if tokens are provided
			const isLinearExpected = platform === "linear" || platform === "both";

			// If no Linear token provided but Linear is expected
			if (!linearToken) {
				return {
					component: "Linear Integration",
					status: platform === "linear" ? "degraded" : "healthy", // degraded for linear-only, healthy for "both" when not configured
					responseTime: Date.now() - startTime,
					details: {
						configured: false,
						platform,
						reason: isLinearExpected ? "Linear API token not provided" : "Linear not configured",
						timestamp: new Date().toISOString(),
					},
					recommendations: isLinearExpected ? [
						"Set linear_api_token in GitHub Action inputs or LINEAR_API_TOKEN environment variable",
						"Set linear_team_id in GitHub Action inputs or LINEAR_TEAM_ID environment variable",
					] : [],
					lastChecked: new Date().toISOString(),
				};
			}

			// If Linear token provided but missing team ID
			if (!linearTeamId) {
				return {
					component: "Linear Integration",
					status: "degraded",
					responseTime: Date.now() - startTime,
					details: {
						configured: false,
						platform,
						error: "Linear API token provided but team ID missing",
						timestamp: new Date().toISOString(),
					},
					recommendations: [
						"Set linear_team_id in GitHub Action inputs or LINEAR_TEAM_ID environment variable",
					],
					lastChecked: new Date().toISOString(),
				};
			}

			// Test actual Linear integration
			const client = getLinearClient();
			const health = await client.healthCheck();

			// For multi-platform setup, Linear issues should be degraded not unhealthy
			let adjustedStatus: "healthy" | "degraded" | "unhealthy" = health.status;
			if (platform === "both" && health.status === "unhealthy") {
				adjustedStatus = "degraded"; // Don't fail entire system for Linear issues in multi-platform
			}

			return {
				component: "Linear Integration",
				status: adjustedStatus,
				responseTime: Date.now() - startTime,
				details: {
					...health.details,
					platform,
					configured: true,
					originalStatus: health.status,
				},
				recommendations:
					health.status === "unhealthy"
						? ["Check Linear API token configuration", "Verify Linear team ID", "Linear issues won't prevent GitHub integration from working"]
						: [],
				lastChecked: new Date().toISOString(),
			};
		} catch (error) {
			const platform = (process.env.INPUT_PLATFORM || process.env.PLATFORM || "github").toLowerCase();

			// If Linear is not expected (github-only platform), don't treat this as critical
			// For multi-platform, Linear failures should be degraded not unhealthy
			const status = platform === "github" ? "healthy" : "degraded";

			return {
				component: "Linear Integration",
				status,
				responseTime: Date.now() - startTime,
				error: (error as Error).message,
				details: {
					platform,
					configured: false,
				},
				recommendations: [
					"Check Linear API token configuration",
					"Verify Linear API connectivity",
					platform === "both" ? "GitHub integration will continue to work regardless of Linear issues" : "",
				].filter(Boolean),
				lastChecked: new Date().toISOString(),
			};
		}
	}

	/**
	 * Check TestFlight integration health
	 */
	private async checkTestFlightIntegration(): Promise<HealthCheck> {
		const startTime = Date.now();

		try {
			const client = getTestFlightClient();

			// Simple connectivity check
			const rateLimitInfo = client.getRateLimitInfo();

			return {
				component: "TestFlight Integration",
				status: "healthy",
				responseTime: Date.now() - startTime,
				details: {
					rateLimitInfo: rateLimitInfo || "No rate limit data available",
					configured: true,
				},
				recommendations:
					rateLimitInfo?.remaining && rateLimitInfo.remaining < 10
						? ["TestFlight rate limit running low"]
						: [],
				lastChecked: new Date().toISOString(),
			};
		} catch (error) {
			return {
				component: "TestFlight Integration",
				status: "unhealthy",
				responseTime: Date.now() - startTime,
				error: (error as Error).message,
				details: {},
				recommendations: [
					"Check App Store Connect credentials",
					"Verify TestFlight API connectivity",
				],
				lastChecked: new Date().toISOString(),
			};
		}
	}

	/**
	 * Check LLM integration health
	 */
	private async checkLLMIntegration(): Promise<HealthCheck> {
		const startTime = Date.now();

		try {
			// Check if LLM enhancement is enabled via GitHub Actions input or environment
			const llmEnabled =
				process.env.ENABLE_LLM_ENHANCEMENT === "true" ||
				process.env.INPUT_ENABLE_LLM_ENHANCEMENT === "true" ||
				process.env.LLM_ENHANCEMENT === "true";

			if (!llmEnabled) {
				return {
					component: "LLM Integration",
					status: "healthy", // Healthy when disabled - LLM is optional
					responseTime: Date.now() - startTime,
					details: {
						enabled: false,
						reason: "LLM enhancement is disabled or not configured",
						checkedVars: ["ENABLE_LLM_ENHANCEMENT", "INPUT_ENABLE_LLM_ENHANCEMENT", "LLM_ENHANCEMENT"],
						timestamp: new Date().toISOString(),
					},
					recommendations: [
						"LLM enhancement is optional. Enable with enable_llm_enhancement: true in GitHub Actions",
					],
					lastChecked: new Date().toISOString(),
				};
			}

			// Check for available API keys
			const apiKeys = {
				openai: process.env.OPENAI_API_KEY || process.env.INPUT_OPENAI_API_KEY,
				anthropic: process.env.ANTHROPIC_API_KEY || process.env.INPUT_ANTHROPIC_API_KEY,
				google: process.env.GOOGLE_API_KEY || process.env.INPUT_GOOGLE_API_KEY,
			};

			const availableProviders = Object.entries(apiKeys)
				.filter(([, key]) => key && key.trim().length > 0)
				.map(([provider]) => provider);

			if (availableProviders.length === 0) {
				return {
					component: "LLM Integration",
					status: "degraded", // Degraded when enabled but no keys provided
					responseTime: Date.now() - startTime,
					details: {
						enabled: true,
						configured: false,
						reason: "LLM enhancement enabled but no API keys provided",
						availableProviders: [],
						timestamp: new Date().toISOString(),
					},
					recommendations: [
						"Provide at least one LLM provider API key:",
						"- openai_api_key for OpenAI GPT models",
						"- anthropic_api_key for Anthropic Claude models",
						"- google_api_key for Google Gemini models",
					],
					lastChecked: new Date().toISOString(),
				};
			}

			// Try to initialize LLM client and check health
			const client = getLLMClient();
			const health = await client.healthCheck();

			// LLM issues should generally be degraded, not unhealthy, since LLM is optional enhancement
			let { status } = health;
			if (status === "unhealthy") {
				status = "degraded";
			}

			return {
				component: "LLM Integration",
				status,
				responseTime: Date.now() - startTime,
				details: {
					enabled: true,
					configured: true,
					availableProviders,
					providers: health.providers,
					usage: health.usage,
					costStatus: health.costStatus,
					timestamp: new Date().toISOString(),
				},
				recommendations: health.costStatus.withinLimits
					? []
					: ["LLM cost limits exceeded - review usage"],
				lastChecked: new Date().toISOString(),
			};
		} catch (error) {
			// Always treat LLM issues as degraded since it's optional
			return {
				component: "LLM Integration",
				status: "degraded", // LLM is optional enhancement
				responseTime: Date.now() - startTime,
				error: (error as Error).message,
				details: {
					enabled: true,
					configured: false,
					timestamp: new Date().toISOString(),
				},
				recommendations: [
					"LLM integration is optional - system can operate without it",
					"Check LLM provider API keys if enhancement is needed",
					"Verify LLM configuration and try again",
				],
				lastChecked: new Date().toISOString(),
			};
		}
	}

	/**
	 * Check state management health
	 */
	private async checkStateManagement(): Promise<HealthCheck> {
		const startTime = Date.now();

		try {
			const stateManager = getStateManager();
			const stats = await stateManager.getStats();

			return {
				component: "State Management",
				status: "healthy",
				responseTime: Date.now() - startTime,
				details: stats,
				recommendations:
					stats.currentlyCached > 10000
						? ["Large cache size - consider cleanup"]
						: [],
				lastChecked: new Date().toISOString(),
			};
		} catch (error) {
			return {
				component: "State Management",
				status: "degraded",
				responseTime: Date.now() - startTime,
				error: (error as Error).message,
				details: {},
				recommendations: [
					"State management issues may cause duplicate processing",
				],
				lastChecked: new Date().toISOString(),
			};
		}
	}

	/**
	 * Check codebase analysis health
	 */
	private async checkCodebaseAnalysis(): Promise<HealthCheck> {
		const startTime = Date.now();

		try {
			const analyzer = getCodebaseAnalyzer();
			const stats = analyzer.getCacheStats();

			return {
				component: "Codebase Analysis",
				status: "healthy",
				responseTime: Date.now() - startTime,
				details: {
					cacheSize: stats.size,
					cachedFiles: stats.files.length,
					workspaceRoot: analyzer.workspaceRoot,
				},
				recommendations: [],
				lastChecked: new Date().toISOString(),
			};
		} catch (error) {
			return {
				component: "Codebase Analysis",
				status: "degraded",
				responseTime: Date.now() - startTime,
				error: (error as Error).message,
				details: {},
				recommendations: [
					"Codebase analysis issues may reduce enhancement quality",
				],
				lastChecked: new Date().toISOString(),
			};
		}
	}

	/**
	 * Check environment configuration
	 */
	private async checkEnvironmentConfiguration(): Promise<HealthCheck> {
		const startTime = Date.now();

		try {
			// Check platform to understand what's required vs optional
			const platform = (process.env.INPUT_PLATFORM || process.env.PLATFORM || "github").toLowerCase();

			// Core required configuration (TestFlight)
			const coreConfig = {
				TESTFLIGHT_ISSUER_ID: process.env.TESTFLIGHT_ISSUER_ID || process.env.INPUT_TESTFLIGHT_ISSUER_ID,
				TESTFLIGHT_KEY_ID: process.env.TESTFLIGHT_KEY_ID || process.env.INPUT_TESTFLIGHT_KEY_ID,
				TESTFLIGHT_PRIVATE_KEY: process.env.TESTFLIGHT_PRIVATE_KEY || process.env.INPUT_TESTFLIGHT_PRIVATE_KEY,
				TESTFLIGHT_APP_ID: process.env.TESTFLIGHT_APP_ID || process.env.INPUT_APP_ID,
			};

			// Platform-specific configuration with auto-population from GitHub Actions context
			const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
			const platformConfig = {
				github: {
					GTHB_TOKEN: process.env.GTHB_TOKEN || process.env.INPUT_GTHB_TOKEN,
					// Auto-populate GitHub owner/repo from GitHub Actions context when available
					GITHUB_OWNER: process.env.GITHUB_OWNER || process.env.INPUT_GITHUB_OWNER || 
						(isGitHubActions ? process.env.GITHUB_REPOSITORY_OWNER : undefined),
					GITHUB_REPO: process.env.GITHUB_REPO || process.env.INPUT_GITHUB_REPO || 
						(isGitHubActions && process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split('/')[1] : undefined),
				},
				linear: {
					LINEAR_API_TOKEN: process.env.LINEAR_API_TOKEN || process.env.INPUT_LINEAR_API_TOKEN,
					LINEAR_TEAM_ID: process.env.LINEAR_TEAM_ID || process.env.INPUT_LINEAR_TEAM_ID,
				},
			};

			// Check core configuration validity
			const missingCoreConfig = Object.entries(coreConfig)
				.filter(([, value]) => !value || value.trim() === "")
				.map(([key]) => key);

			// Check platform-specific configuration
			const platformIssues: string[] = [];
			const platformWarnings: string[] = [];

			if (platform === "github" || platform === "both") {
				const missingGitHub = Object.entries(platformConfig.github)
					.filter(([, value]) => !value || value.trim() === "")
					.map(([key]) => key);

				if (missingGitHub.length > 0) {
					if (platform === "github") {
						platformIssues.push(...missingGitHub.map(key => `Missing required GitHub config: ${key}`));
					} else {
						platformWarnings.push(...missingGitHub.map(key => `Missing GitHub config: ${key} (GitHub integration will be disabled)`));
					}
				}
			}

			if (platform === "linear" || platform === "both") {
				const missingLinear = Object.entries(platformConfig.linear)
					.filter(([, value]) => !value || value.trim() === "")
					.map(([key]) => key);

				if (missingLinear.length > 0) {
					if (platform === "linear") {
						platformIssues.push(...missingLinear.map(key => `Missing required Linear config: ${key}`));
					} else {
						platformWarnings.push(...missingLinear.map(key => `Missing Linear config: ${key} (Linear integration will be disabled)`));
					}
				}
			}

			// Determine overall status - be more lenient for multi-platform setups
			let status: "healthy" | "degraded" | "unhealthy";
			if (missingCoreConfig.length > 0) {
				status = "unhealthy"; // Core config missing = unhealthy
			} else if (platform === "both" && platformIssues.length > 0) {
				// For multi-platform, missing one platform's config is degraded not unhealthy
				status = "degraded";
			} else if (platformIssues.length > 0) {
				status = "unhealthy"; // Required platform config missing = unhealthy (for single platform)
			} else if (platformWarnings.length > 0) {
				status = "degraded"; // Optional platform config missing = degraded
			} else {
				status = "healthy";
			}

			// Build recommendations
			const recommendations: string[] = [];
			if (missingCoreConfig.length > 0) {
				recommendations.push("Configure required TestFlight credentials:");
				missingCoreConfig.forEach(key => {
					const inputName = key.replace('TESTFLIGHT_', '').toLowerCase();
					const actionInputName = inputName === 'app_id' ? 'app_id' : `testflight_${inputName}`;
					recommendations.push(`  - Set ${key} or use GitHub Action input: ${actionInputName}`);
				});
			}

			if (platformIssues.length > 0) {
				if (platform === "both") {
					recommendations.push("Some platform configurations are missing (system will continue with available platforms):");
				} else {
					recommendations.push("Configure required platform credentials:");
				}
				platformIssues.forEach(issue => recommendations.push(`  - ${issue}`));
			}

			if (platformWarnings.length > 0) {
				recommendations.push("Optional platform configurations (can be added later):");
				platformWarnings.forEach(warning => recommendations.push(`  - ${warning}`));
			}

			if (status === "healthy") {
				recommendations.push("All required configuration is present and valid");
			}

			// Build detailed error message for debugging
			let errorMessage = "";
			if (missingCoreConfig.length > 0) {
				errorMessage += `Missing core config: ${missingCoreConfig.join(", ")}. `;
			}
			if (platformIssues.length > 0) {
				errorMessage += `Platform issues: ${platformIssues.join(", ")}. `;
			}
			if (platformWarnings.length > 0) {
				errorMessage += `Platform warnings: ${platformWarnings.join(", ")}. `;
			}

			return {
				component: "Environment Configuration",
				status,
				responseTime: Date.now() - startTime,
				error: status !== "healthy" ? errorMessage.trim() || "Configuration validation failed" : undefined,
				details: {
					environment: process.env.NODE_ENV || "production",
					platform,
					coreConfigComplete: missingCoreConfig.length === 0,
					missingCoreConfig,
					platformIssues,
					platformWarnings,
					detectedInputs: {
						core: Object.fromEntries(
							Object.entries(coreConfig).map(([key, value]) => [key, !!value])
						),
						platform: platform === "github" || platform === "both" ? {
							github: Object.fromEntries(
								Object.entries(platformConfig.github).map(([key, value]) => [key, !!value])
							)
						} : platform === "linear" || platform === "both" ? {
							linear: Object.fromEntries(
								Object.entries(platformConfig.linear).map(([key, value]) => [key, !!value])
							)
						} : {},
					},
					// Debug info for exact environment variable checking
					environmentVariables: {
						core: {
							TESTFLIGHT_ISSUER_ID: !!process.env.TESTFLIGHT_ISSUER_ID,
							INPUT_TESTFLIGHT_ISSUER_ID: !!process.env.INPUT_TESTFLIGHT_ISSUER_ID,
							TESTFLIGHT_KEY_ID: !!process.env.TESTFLIGHT_KEY_ID,
							INPUT_TESTFLIGHT_KEY_ID: !!process.env.INPUT_TESTFLIGHT_KEY_ID,
							TESTFLIGHT_PRIVATE_KEY: !!process.env.TESTFLIGHT_PRIVATE_KEY,
							INPUT_TESTFLIGHT_PRIVATE_KEY: !!process.env.INPUT_TESTFLIGHT_PRIVATE_KEY,
							TESTFLIGHT_APP_ID: !!process.env.TESTFLIGHT_APP_ID,
							INPUT_APP_ID: !!process.env.INPUT_APP_ID,
						},
						github: {
							// Action input variables
							GTHB_TOKEN: !!process.env.GTHB_TOKEN,
							INPUT_GTHB_TOKEN: !!process.env.INPUT_GTHB_TOKEN,
							GITHUB_OWNER: !!process.env.GITHUB_OWNER,
							INPUT_GITHUB_OWNER: !!process.env.INPUT_GITHUB_OWNER,
							GITHUB_REPO: !!process.env.GITHUB_REPO,
							INPUT_GITHUB_REPO: !!process.env.INPUT_GITHUB_REPO,
							
							// GitHub Actions default environment variables
							GITHUB_ACTIONS: !!process.env.GITHUB_ACTIONS,
							GITHUB_REPOSITORY: !!process.env.GITHUB_REPOSITORY,
							GITHUB_REPOSITORY_OWNER: !!process.env.GITHUB_REPOSITORY_OWNER,
							GITHUB_REF: !!process.env.GITHUB_REF,
							GITHUB_REF_NAME: !!process.env.GITHUB_REF_NAME,
							GITHUB_SHA: !!process.env.GITHUB_SHA,
							GITHUB_ACTOR: !!process.env.GITHUB_ACTOR,
							GITHUB_WORKFLOW: !!process.env.GITHUB_WORKFLOW,
							GITHUB_RUN_ID: !!process.env.GITHUB_RUN_ID,
							GITHUB_RUN_NUMBER: !!process.env.GITHUB_RUN_NUMBER,
							GITHUB_EVENT_NAME: !!process.env.GITHUB_EVENT_NAME,
							GITHUB_WORKSPACE: !!process.env.GITHUB_WORKSPACE,
							
							// Show actual values for debugging (truncated for security)
							DEBUG_GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY || 'not set',
							DEBUG_GITHUB_REPOSITORY_OWNER: process.env.GITHUB_REPOSITORY_OWNER || 'not set',
							DEBUG_GITHUB_REF: process.env.GITHUB_REF?.substring(0, 30) || 'not set',
							DEBUG_GITHUB_SHA: process.env.GITHUB_SHA?.substring(0, 8) || 'not set',
							DEBUG_GITHUB_ACTOR: process.env.GITHUB_ACTOR || 'not set',
							DEBUG_GITHUB_WORKFLOW: process.env.GITHUB_WORKFLOW || 'not set',
							DEBUG_GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME || 'not set',
							
							// Runner information
							RUNNER_OS: !!process.env.RUNNER_OS,
							RUNNER_ARCH: !!process.env.RUNNER_ARCH,
							DEBUG_RUNNER_OS: process.env.RUNNER_OS || 'not set',
							DEBUG_RUNNER_ARCH: process.env.RUNNER_ARCH || 'not set',
						}
					},
					timestamp: new Date().toISOString(),
				},
				recommendations,
				lastChecked: new Date().toISOString(),
			};
		} catch (error) {
			return {
				component: "Environment Configuration",
				status: "degraded", // Configuration validation errors are degraded, not unhealthy
				responseTime: Date.now() - startTime,
				error: (error as Error).message,
				details: {
					platform: process.env.INPUT_PLATFORM || process.env.PLATFORM || "github",
					timestamp: new Date().toISOString(),
				},
				recommendations: [
					"Environment configuration validation failed",
					"Check that all required environment variables are set",
					"Verify GitHub Action inputs are correctly configured",
				],
				lastChecked: new Date().toISOString(),
			};
		}
	}

	/**
	 * Generate system-wide recommendations
	 */
	private generateSystemRecommendations(
		checks: HealthCheck[],
		overallStatus: "healthy" | "degraded" | "unhealthy",
	): string[] {
		const recommendations: string[] = [];

		// Collect component-specific recommendations
		checks.forEach((check) => {
			if (check.recommendations) {
				recommendations.push(...check.recommendations);
			}
		});

		// Add system-wide recommendations based on overall status
		if (overallStatus === "unhealthy") {
			recommendations.push(
				"System has critical issues - immediate attention required",
			);
			recommendations.push(
				"Consider running in safe mode until issues are resolved",
			);
		} else if (overallStatus === "degraded") {
			recommendations.push(
				"System is functional but has some issues - monitor closely",
			);
			recommendations.push("Address warnings to improve system reliability");
		}

		// Production-specific recommendations
		if (this.config.environment === "production") {
			recommendations.push(
				"Set up monitoring alerts for system health changes",
			);
			recommendations.push("Review logs regularly for early warning signs");
			recommendations.push("Ensure backup systems are configured");
		}

		return [...new Set(recommendations)]; // Remove duplicates
	}

	/**
	 * Gather environment metrics
	 */
	private async gatherEnvironmentMetrics(): Promise<
		SystemHealth["environment"]
	> {
		const memUsage = process.memoryUsage();

		return {
			nodeEnv: process.env.NODE_ENV || "unknown",
			version: process.env.npm_package_version || "unknown",
			uptime: process.uptime(),
			memory: {
				used: memUsage.heapUsed,
				total: memUsage.heapTotal,
				percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
			},
		};
	}

	/**
	 * Create a timeout promise for health checks
	 */
	private timeoutPromise(ms: number): Promise<HealthCheck> {
		return new Promise((_, reject) => {
			setTimeout(() => {
				reject(new Error(`Health check timed out after ${ms}ms`));
			}, ms);
		});
	}

	/**
	 * Get monitoring recommendations for the current system state
	 */
	public getMonitoringRecommendations(): string[] {
		const recommendations = [
			"Set up automated health checks to run every 5 minutes",
			"Configure alerts for unhealthy components",
			"Monitor API rate limits to prevent service disruption",
			"Track memory usage and restart if memory leaks detected",
			"Log all health check results for trend analysis",
			"Set up external monitoring from outside the system",
		];

		if (this.config.environment === "production") {
			recommendations.push(
				"Configure multiple alert channels (email, Slack, PagerDuty)",
				"Set up log aggregation and analysis",
				"Monitor response times and set SLA thresholds",
				"Implement automatic failover for critical components",
			);
		}

		return recommendations;
	}
}

// Global health monitor instance
let _healthMonitorInstance: SystemHealthMonitor | null = null;

export function getSystemHealthMonitor(): SystemHealthMonitor {
	if (!_healthMonitorInstance) {
		_healthMonitorInstance = new SystemHealthMonitor();
	}
	return _healthMonitorInstance;
}

/**
 * Clear monitor instance (useful for testing)
 */
export function clearHealthMonitorInstance(): void {
	_healthMonitorInstance = null;
}

/**
 * Quick health check for GitHub Actions
 */
export async function quickHealthCheck(): Promise<{
	status: "healthy" | "degraded" | "unhealthy";
	message: string;
	criticalIssues: string[];
}> {
	try {
		const monitor = getSystemHealthMonitor();
		const health = await monitor.checkSystemHealth();

		// Platform-aware critical issue filtering
		const platform = (process.env.INPUT_PLATFORM || process.env.PLATFORM || "github").toLowerCase();
		const criticalIssues = health.components
			.filter((c) => {
				// Only consider truly unhealthy components as critical
				if (c.status !== "unhealthy") {
					return false;
				}

				// Platform-specific filtering
				if (platform === "github" && c.component === "Linear Integration") {
					return false; // Linear not critical for GitHub-only
				}
				if (platform === "linear" && c.component === "GitHub Integration") {
					return false; // GitHub not critical for Linear-only
				}
				// For "both" platform, individual platform failures are not critical
				if (platform === "both" && (c.component === "Linear Integration" || c.component === "GitHub Integration")) {
					return false; // Individual platform failures not critical in multi-platform mode
				}

				// LLM is always optional, never critical
				if (c.component === "LLM Integration") {
					return false;
				}

				// Codebase analysis is optional
				if (c.component === "Codebase Analysis") {
					return false;
				}

				// State management failures are degraded issues, not critical
				if (c.component === "State Management") {
					return false;
				}

				return true;
			})
			.map((c) => `${c.component}: ${c.error || "unhealthy"}`);

		// Adjusted status calculation - be more lenient
		let adjustedStatus: "healthy" | "degraded" | "unhealthy";
		if (criticalIssues.length === 0) {
			// No critical issues - check if we have any degraded components
			const hasDegraded = health.components.some(c => c.status === "degraded");
			adjustedStatus = hasDegraded ? "degraded" : "healthy";
		} else {
			// We have critical issues
			adjustedStatus = "unhealthy";
		}

		let message = "System operational";
		if (adjustedStatus === "unhealthy") {
			message = `System has ${criticalIssues.length} critical issue${criticalIssues.length === 1 ? '' : 's'}`;
		} else if (adjustedStatus === "degraded") {
			const degradedCount = health.components.filter(c => c.status === "degraded").length;
			message = `System functional with ${degradedCount} non-critical warning${degradedCount === 1 ? '' : 's'}`;
		}

		return {
			status: adjustedStatus,
			message,
			criticalIssues,
		};
	} catch (error) {
		return {
			status: "unhealthy",
			message: `Health check failed: ${error}`,
			criticalIssues: ["Health monitoring system failure"],
		};
	}
}

export default {
	SystemHealthMonitor,
	getSystemHealthMonitor,
	quickHealthCheck,
};
