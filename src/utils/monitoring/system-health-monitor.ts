/**
 * Refactored System Health Monitor
 * Orchestrates health checks following SOLID principles
 * Single Responsibility: Coordinates health checks and aggregates results
 */

import type { HealthCheckResult, HealthChecker } from "./health-check-base.js";
import { getHealthCheckerFactory } from "./health-checker-factory.js";
import { getPlatformDetector } from "./platform-detector.js";

export interface SystemHealth {
	overall: "healthy" | "degraded" | "unhealthy";
	components: HealthCheckResult[];
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
 * Refactored System Health Monitor
 * Follows Single Responsibility Principle - only coordinates health checks
 */
export class SystemHealthMonitor {
	private readonly config: MonitoringConfig;
	private readonly healthCheckers: HealthChecker[];

	constructor(config?: Partial<MonitoringConfig>, healthCheckers?: HealthChecker[]) {
		this.config = {
			enableDetailedChecks: true,
			timeoutMs: 30000,
			includeMetrics: true,
			environment: (process.env.NODE_ENV as "development" | "production" | "test") || "development",
			...config,
		};

		this.healthCheckers = healthCheckers || getHealthCheckerFactory().createHealthCheckers();
	}

	/**
	 * Perform comprehensive system health check
	 */
	public async checkSystemHealth(): Promise<SystemHealth> {
		const startTime = Date.now();
		const checks: HealthCheckResult[] = [];

		// Run all health checks with timeout protection
		const checkResults = await Promise.allSettled(
			this.healthCheckers.map((checker) =>
				Promise.race([
					checker.check(),
					this.createTimeoutPromise(this.config.timeoutMs, checker.getComponentName())
				])
			)
		);

		// Process results
		checkResults.forEach((result, index) => {
			if (result.status === "fulfilled") {
				checks.push(result.value);
			} else {
				const checker = this.healthCheckers[index];
				if (checker) {
					checks.push(this.createTimeoutResult(checker, result.reason));
				}
			}
		});

		// Calculate metrics
		const metrics = this.calculateMetrics(checks, startTime);

		// Determine overall status
		const overallStatus = this.calculateOverallStatus(checks);

		// Generate recommendations
		const recommendations = this.generateSystemRecommendations(checks, overallStatus);

		// Gather environment info
		const environment = await this.gatherEnvironmentMetrics();

		return {
			overall: overallStatus,
			components: checks,
			metrics,
			environment,
			recommendations,
			lastChecked: new Date().toISOString(),
		};
	}

	/**
	 * Calculate system metrics from health check results
	 */
	private calculateMetrics(checks: HealthCheckResult[], startTime: number) {
		const healthyComponents = checks.filter(c => c.status === "healthy").length;
		const degradedComponents = checks.filter(c => c.status === "degraded").length;
		const unhealthyComponents = checks.filter(c => c.status === "unhealthy").length;

		return {
			totalResponseTime: Date.now() - startTime,
			healthyComponents,
			degradedComponents,
			unhealthyComponents,
		};
	}

	/**
	 * Calculate overall system status with platform-aware logic
	 */
	private calculateOverallStatus(checks: HealthCheckResult[]): "healthy" | "degraded" | "unhealthy" {
		const platformConfig = getPlatformDetector().getPlatformConfig();

		// Check for critical unhealthy components
		const criticalUnhealthy = checks.filter(c => {
			if (c.status !== "unhealthy") {
				return false;
			}

			// Core components are always critical
			if (c.component === "TestFlight Integration") {
				return true;
			}

			// Platform-specific components are critical only if required
			if (c.component === "GitHub Integration" && platformConfig.requiresGitHub) {
				return true;
			}
			if (c.component === "Linear Integration" && platformConfig.requiresLinear) {
				return true;
			}
			if (c.component === "Environment Configuration") {
				return true;
			}

			// Optional components are never critical for overall status
			return false;
		});

		// Check for degraded components that matter
		const criticalDegraded = checks.filter(c => {
			if (c.status !== "degraded") {
				return false;
			}

			// Core components being degraded is concerning
			if (c.component === "TestFlight Integration") {
				return true;
			}
			if (c.component === "Environment Configuration") {
				// Environment config degraded only matters if core config is missing
				return c.details?.missingCoreConfig && Array.isArray(c.details.missingCoreConfig) && c.details.missingCoreConfig.length > 0;
			}

			// Platform-specific degraded components matter in single-platform mode
			if (!platformConfig.isMultiPlatform) {
				if (c.component === "GitHub Integration" && platformConfig.requiresGitHub) {
					return true;
				}
				if (c.component === "Linear Integration" && platformConfig.requiresLinear) {
					return true;
				}
			}

			// Optional components degraded don't affect overall status
			return false;
		});

		if (criticalUnhealthy.length > 0) {
			return "unhealthy";
		} else if (criticalDegraded.length > 0) {
			return "degraded";
		} else {
			return "healthy";
		}
	}

	/**
	 * Generate system-wide recommendations
	 */
	private generateSystemRecommendations(
		checks: HealthCheckResult[],
		overallStatus: "healthy" | "degraded" | "unhealthy"
	): string[] {
		const recommendations: string[] = [];

		// Collect component-specific recommendations
		checks.forEach(check => {
			if (check.recommendations) {
				recommendations.push(...check.recommendations);
			}
		});

		// Add system-wide recommendations
		if (overallStatus === "unhealthy") {
			recommendations.push(
				"System has critical issues - immediate attention required",
				"Consider running in safe mode until issues are resolved"
			);
		} else if (overallStatus === "degraded") {
			recommendations.push(
				"System is functional but has some issues - monitor closely",
				"Address warnings to improve system reliability"
			);
		}

		// Production-specific recommendations
		if (this.config.environment === "production") {
			recommendations.push(
				"Set up monitoring alerts for system health changes",
				"Review logs regularly for early warning signs",
				"Ensure backup systems are configured"
			);
		}

		// Remove duplicates
		return [...new Set(recommendations)];
	}

	/**
	 * Gather environment metrics
	 */
	private async gatherEnvironmentMetrics(): Promise<SystemHealth["environment"]> {
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
	private createTimeoutPromise(ms: number, componentName: string): Promise<HealthCheckResult> {
		return new Promise((_, reject) => {
			setTimeout(() => {
				reject(new Error(`Health check for ${componentName} timed out after ${ms}ms`));
			}, ms);
		});
	}

	/**
	 * Create a timeout result for failed health checks
	 */
	private createTimeoutResult(checker: HealthChecker, reason: unknown): HealthCheckResult {
		return {
			component: checker.getComponentName(),
			status: "unhealthy",
			error: (reason as Error)?.message || "Health check failed",
			details: {
				timestamp: new Date().toISOString(),
			},
			recommendations: [
				"Investigate component failure",
				"Check configuration and connectivity",
			],
			lastChecked: new Date().toISOString(),
		};
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
				"Implement automatic failover for critical components"
			);
		}

		return recommendations;
	}
}

/**
 * Quick health check for GitHub Actions
 * Follows platform-aware filtering logic
 */
export async function quickHealthCheck(): Promise<{
	status: "healthy" | "degraded" | "unhealthy";
	message: string;
	criticalIssues: string[];
}> {
	try {
		const monitor = new SystemHealthMonitor();
		const health = await monitor.checkSystemHealth();
		const platformConfig = getPlatformDetector().getPlatformConfig();

		// Platform-aware critical issue filtering
		const criticalIssues = health.components
			.filter(c => {
				// Only unhealthy components can be critical
				if (c.status !== "unhealthy") {
					return false;
				}

				// Platform-specific filtering
				if (!platformConfig.requiresGitHub && c.component === "GitHub Integration") {
					return false;
				}
				if (!platformConfig.requiresLinear && c.component === "Linear Integration") {
					return false;
				}

				// Optional components are never critical
				const optionalComponents = ["LLM Integration", "Codebase Analysis", "State Management"];
				if (optionalComponents.includes(c.component)) {
					return false;
				}

				// In multi-platform mode, individual platform failures are not critical
				if (platformConfig.isMultiPlatform &&
					(c.component === "Linear Integration" || c.component === "GitHub Integration")) {
					return false;
				}

				return true;
			})
			.map(c => `${c.component}: ${c.error || "unhealthy"}`);

		// Calculate adjusted status using same logic as full health check
		let adjustedStatus: "healthy" | "degraded" | "unhealthy";
		if (criticalIssues.length === 0) {
			// Check for degraded components that actually matter
			const criticalDegraded = health.components.filter(c => {
				if (c.status !== "degraded") {
					return false;
				}

				// Core components being degraded is concerning
				if (c.component === "TestFlight Integration") {
					return true;
				}
				if (c.component === "Environment Configuration") {
					// Environment config degraded only matters if core config is missing
					return c.details?.missingCoreConfig && Array.isArray(c.details.missingCoreConfig) && c.details.missingCoreConfig.length > 0;
				}

				// Platform-specific degraded components matter in single-platform mode
				if (!platformConfig.isMultiPlatform) {
					if (c.component === "GitHub Integration" && platformConfig.requiresGitHub) {
						return true;
					}
					if (c.component === "Linear Integration" && platformConfig.requiresLinear) {
						return true;
					}
				}

				// Optional components degraded don't affect overall status
				return false;
			});

			adjustedStatus = criticalDegraded.length > 0 ? "degraded" : "healthy";
		} else {
			adjustedStatus = "unhealthy";
		}

		// Generate status message
		let message = "System operational";
		if (adjustedStatus === "unhealthy") {
			message = `System has ${criticalIssues.length} critical issue${criticalIssues.length === 1 ? '' : 's'}`;
		} else if (adjustedStatus === "degraded") {
			const criticalDegradedCount = health.components.filter(c => {
				if (c.status !== "degraded") {
					return false;
				}
				if (c.component === "TestFlight Integration") {
					return true;
				}
				if (c.component === "Environment Configuration") {
					return c.details?.missingCoreConfig && Array.isArray(c.details.missingCoreConfig) && c.details.missingCoreConfig.length > 0;
				}
				if (!platformConfig.isMultiPlatform) {
					if (c.component === "GitHub Integration" && platformConfig.requiresGitHub) {
						return true;
					}
					if (c.component === "Linear Integration" && platformConfig.requiresLinear) {
						return true;
					}
				}
				return false;
			}).length;
			message = `System functional with ${criticalDegradedCount} warning${criticalDegradedCount === 1 ? '' : 's'} requiring attention`;
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

// Singleton instance management
let _healthMonitorInstance: SystemHealthMonitor | null = null;

export function getSystemHealthMonitor(): SystemHealthMonitor {
	if (!_healthMonitorInstance) {
		_healthMonitorInstance = new SystemHealthMonitor();
	}
	return _healthMonitorInstance;
}

export function clearHealthMonitorInstance(): void {
	_healthMonitorInstance = null;
}
