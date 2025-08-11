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
import { Validation } from "./validation.js";

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
			environment: (process.env.NODE_ENV as any) || "development",
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
			const client = getGitHubClient();
			const health = await client.healthCheck();

			return {
				component: "GitHub Integration",
				status: health.status,
				responseTime: Date.now() - startTime,
				details: health.details,
				recommendations:
					(health.details.rateLimit as any)?.remaining < 100
						? [
							"GitHub rate limit running low - consider reducing request frequency",
						]
						: [],
				lastChecked: new Date().toISOString(),
			};
		} catch (error) {
			return {
				component: "GitHub Integration",
				status: "unhealthy",
				responseTime: Date.now() - startTime,
				error: (error as Error).message,
				details: {},
				recommendations: [
					"Check GitHub token configuration",
					"Verify GitHub API connectivity",
				],
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

			// If Linear is not required for this platform, treat as healthy but not configured
			if (platform === "github") {
				return {
					component: "Linear Integration",
					status: "healthy",
					responseTime: Date.now() - startTime,
					details: {
						configured: false,
						reason: "Linear not required for GitHub-only platform",
						timestamp: new Date().toISOString(),
					},
					recommendations: [],
					lastChecked: new Date().toISOString(),
				};
			}

			// If no Linear token provided but Linear is expected, treat as degraded
			if (!linearToken) {
				return {
					component: "Linear Integration",
					status: platform === "both" ? "degraded" : "unhealthy",
					responseTime: Date.now() - startTime,
					details: {
						configured: false,
						error: "Linear API token not provided",
						timestamp: new Date().toISOString(),
					},
					recommendations: [
						"Set LINEAR_API_TOKEN environment variable",
						"Set LINEAR_TEAM_ID environment variable",
					],
					lastChecked: new Date().toISOString(),
				};
			}

			// Test actual Linear integration
			const client = getLinearClient();
			const health = await client.healthCheck();

			// For Linear health, keep the original status from the Linear client
			const { status } = health;

			return {
				component: "Linear Integration",
				status,
				responseTime: Date.now() - startTime,
				details: health.details,
				recommendations:
					health.status === "unhealthy"
						? ["Check Linear API token configuration", "Verify Linear team ID"]
						: [],
				lastChecked: new Date().toISOString(),
			};
		} catch (error) {
			const platform = (process.env.INPUT_PLATFORM || process.env.PLATFORM || "github").toLowerCase();

			return {
				component: "Linear Integration",
				status: platform === "both" ? "degraded" : "unhealthy",
				responseTime: Date.now() - startTime,
				error: (error as Error).message,
				details: {},
				recommendations: [
					"Check Linear API token configuration",
					"Verify Linear API connectivity",
				],
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
			// Check if LLM enhancement is enabled
			const llmEnabled = process.env.ENABLE_LLM_ENHANCEMENT === "true" ||
				process.env.INPUT_ENABLE_LLM_ENHANCEMENT === "true";

			if (!llmEnabled) {
				return {
					component: "LLM Integration",
					status: "healthy", // Changed from degraded to healthy when disabled
					responseTime: Date.now() - startTime,
					details: {
						enabled: false,
						reason: "LLM enhancement is disabled",
					},
					recommendations: [],
					lastChecked: new Date().toISOString(),
				};
			}

			const client = getLLMClient();
			const health = await client.healthCheck();

			// LLM issues should generally be degraded, not unhealthy, since LLM is optional
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
					providers: health.providers,
					usage: health.usage,
					costStatus: health.costStatus,
				},
				recommendations: health.costStatus.withinLimits
					? []
					: ["LLM cost limits exceeded - review usage"],
				lastChecked: new Date().toISOString(),
			};
		} catch (error) {
			return {
				component: "LLM Integration",
				status: "degraded", // LLM is optional
				responseTime: Date.now() - startTime,
				error: (error as Error).message,
				details: {},
				recommendations: [
					"LLM integration is optional - system can operate without it",
					"Check LLM provider API keys if enhancement is needed",
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

			// Validate core environment configuration
			const envConfig = {
				NODE_ENV: process.env.NODE_ENV,
				APP_STORE_CONNECT_ISSUER_ID: process.env.APP_STORE_CONNECT_ISSUER_ID,
				APP_STORE_CONNECT_KEY_ID: process.env.APP_STORE_CONNECT_KEY_ID,
				APP_STORE_CONNECT_PRIVATE_KEY: process.env.APP_STORE_CONNECT_PRIVATE_KEY,
			};

			// Add platform-specific configurations
			const extendedEnvConfig: Record<string, string | undefined> = { ...envConfig };
			if (platform === "github" || platform === "both") {
				extendedEnvConfig.GTHB_TOKEN = process.env.GTHB_TOKEN;
			}
			if (platform === "linear" || platform === "both") {
				extendedEnvConfig.LINEAR_API_TOKEN = process.env.LINEAR_API_TOKEN;
			}

			const validation = Validation.environment(extendedEnvConfig);

			// Check API secrets only for configured platforms
			const secrets: Record<string, string> = {};
			if ((platform === "github" || platform === "both") && process.env.GTHB_TOKEN) {
				secrets.GTHB_TOKEN = process.env.GTHB_TOKEN;
			}
			if ((platform === "linear" || platform === "both") && process.env.LINEAR_API_TOKEN) {
				secrets.LINEAR_API_TOKEN = process.env.LINEAR_API_TOKEN;
			}

			// Only validate secrets if we have any configured
			let secretValidation: { valid: boolean; errors: string[]; warnings: string[]; securityRisk: "low" | "medium" | "high"; recommendations: string[] } = {
				valid: true,
				errors: [],
				warnings: [],
				securityRisk: "low",
				recommendations: []
			};
			if (Object.keys(secrets).length > 0) {
				secretValidation = Validation.apiSecrets(secrets);
			}

			// More lenient status calculation - prioritize core functionality
			let status: "healthy" | "degraded" | "unhealthy";
			const coreConfigValid = envConfig.APP_STORE_CONNECT_ISSUER_ID &&
				envConfig.APP_STORE_CONNECT_KEY_ID &&
				envConfig.APP_STORE_CONNECT_PRIVATE_KEY;

			if (!coreConfigValid) {
				status = "unhealthy";
			} else if (!validation.valid || !secretValidation.valid) {
				// Secondary validation failures are degraded, not unhealthy
				status = "degraded";
			} else if (validation.warnings.length > 0 || secretValidation.warnings.length > 0) {
				status = "degraded";
			} else {
				status = "healthy";
			}

			return {
				component: "Environment Configuration",
				status,
				responseTime: Date.now() - startTime,
				details: {
					environment: envConfig.NODE_ENV,
					platform,
					coreConfigValid,
					validationErrors: validation.errors,
					validationWarnings: validation.warnings,
					securityRisk: secretValidation.securityRisk,
				},
				recommendations: [
					...validation.errors.map((e) => `Config Error: ${e}`),
					...validation.warnings.map((w) => `Config Warning: ${w}`),
					...secretValidation.recommendations,
				],
				lastChecked: new Date().toISOString(),
			};
		} catch (error) {
			return {
				component: "Environment Configuration",
				status: "degraded", // Changed from unhealthy to degraded for config issues
				responseTime: Date.now() - startTime,
				error: (error as Error).message,
				details: {},
				recommendations: ["Review environment variable configuration"],
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

		// If platform is explicitly GitHub-only, don't mark Linear as critical
		const platform = (process.env.INPUT_PLATFORM || process.env.PLATFORM || "github").toLowerCase();
		const criticalIssues = health.components
			.filter((c) => {
				if (c.status !== "unhealthy") {
					return false;
				}
				if (platform === "github" && c.component === "Linear Integration") {
					return false;
				}
				return true;
			})
			.map((c) => `${c.component}: ${c.error || "unhealthy"}`);

		// Adjust overall status based on filtered critical issues
		let adjustedStatus: "healthy" | "degraded" | "unhealthy" = health.overall;
		if (criticalIssues.length === 0) {
			adjustedStatus = "healthy";
		} else if (adjustedStatus !== "unhealthy") {
			adjustedStatus = health.overall; // keep degraded if any
		}

		let message = "System operational";
		if (adjustedStatus === "unhealthy") {
			message = `System has ${criticalIssues.length} critical issues`;
		} else if (adjustedStatus === "degraded") {
			message = `System functional with ${health.metrics.degradedComponents} warnings`;
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
