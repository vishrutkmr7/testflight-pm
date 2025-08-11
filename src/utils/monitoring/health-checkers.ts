/**
 * Concrete Health Checker Implementations
 * Each class follows Single Responsibility Principle
 */

import { getCodebaseAnalyzer } from "../../analysis/codebase-analyzer.js";
import { getGitHubClient } from "../../api/github-client.js";
import { getLinearClient } from "../../api/linear-client.js";
import { getLLMClient } from "../../api/llm-client.js";
import { getTestFlightClient } from "../../api/testflight-client.js";
import { getStateManager } from "../state-manager.js";
import { BaseHealthChecker, BasePlatformAwareHealthChecker, type HealthCheckResult } from "./health-check-base.js";
import { EnvironmentValidator } from "./environment-validator.js";
import { getPlatformDetector } from "./platform-detector.js";

/**
 * GitHub Integration Health Checker
 */
export class GitHubHealthChecker extends BasePlatformAwareHealthChecker {
    public getComponentName(): string {
        return "GitHub Integration";
    }

    public isRequiredForPlatform(platform: string): boolean {
        return platform === "github" || platform === "both";
    }

    protected async performCheck(): Promise<HealthCheckResult> {
        const platformConfig = getPlatformDetector().getPlatformConfig();

        // Skip if not required for current platform
        if (!this.isRequiredForPlatform(platformConfig.platform)) {
            return this.createPlatformNotRequiredResult(
                platformConfig.platform,
                "GitHub not required for Linear-only platform"
            );
        }

        const client = getGitHubClient();
        const health = await client.healthCheck();

        // Adjust status based on platform configuration
        const adjustedStatus = this.adjustStatusForPlatform(health.status, platformConfig.platform);

        const recommendations = this.generateRecommendations(health, platformConfig.platform);

        return this.createSuccessResult(
            adjustedStatus,
            {
                ...health.details,
                platform: platformConfig.platform,
                originalStatus: health.status,
            },
            recommendations
        );
    }

    protected override createErrorResult(error: Error): HealthCheckResult {
        const platformConfig = getPlatformDetector().getPlatformConfig();

        // Skip if not required for current platform
        if (!this.isRequiredForPlatform(platformConfig.platform)) {
            return this.createPlatformNotRequiredResult(
                platformConfig.platform,
                "GitHub not required for Linear-only platform"
            );
        }

        const status = this.adjustStatusForPlatform("unhealthy", platformConfig.platform);
        const recommendations = [
            "Check GitHub token configuration",
            "Verify GitHub API connectivity",
        ];

        if (platformConfig.isMultiPlatform) {
            recommendations.push("Linear integration will continue to work regardless of GitHub issues");
        }

        return {
            component: this.getComponentName(),
            status,
            responseTime: Date.now() - this.startTime,
            error: error.message,
            details: {
                platform: platformConfig.platform,
                timestamp: new Date().toISOString(),
            },
            recommendations,
            lastChecked: new Date().toISOString(),
        };
    }

    private generateRecommendations(health: any, platform: string): string[] {
        if (health.details.rateLimit?.remaining < 100) {
            return ["GitHub rate limit running low - consider reducing request frequency"];
        }

        if (health.status === "unhealthy" && platform === "both") {
            return [
                "Check GitHub token configuration",
                "Verify GitHub API connectivity",
                "Linear integration will continue to work regardless of GitHub issues",
            ];
        }

        return [];
    }
}

/**
 * Linear Integration Health Checker
 */
export class LinearHealthChecker extends BasePlatformAwareHealthChecker {
    public getComponentName(): string {
        return "Linear Integration";
    }

    public isRequiredForPlatform(platform: string): boolean {
        return platform === "linear" || platform === "both";
    }

    protected async performCheck(): Promise<HealthCheckResult> {
        const platformConfig = getPlatformDetector().getPlatformConfig();

        // Skip if not required for current platform
        if (!this.isRequiredForPlatform(platformConfig.platform)) {
            return this.createPlatformNotRequiredResult(
                platformConfig.platform,
                "Linear not required for GitHub-only platform"
            );
        }

        // Check for required environment variables
        const linearToken = process.env.LINEAR_API_TOKEN || process.env.INPUT_LINEAR_API_TOKEN;
        const linearTeamId = process.env.LINEAR_TEAM_ID || process.env.INPUT_LINEAR_TEAM_ID;

        if (!linearToken) {
            const status = platformConfig.platform === "linear" ? "degraded" : "healthy";
            return this.createSuccessResult(
                status,
                {
                    configured: false,
                    platform: platformConfig.platform,
                    reason: "Linear API token not provided",
                },
                this.isRequiredForPlatform(platformConfig.platform) ? [
                    "Set LINEAR_API_TOKEN environment variable or linear_api_token in GitHub Action inputs",
                    "Set LINEAR_TEAM_ID environment variable or linear_team_id in GitHub Action inputs",
                ] : []
            );
        }

        if (!linearTeamId) {
            return this.createSuccessResult(
                "degraded",
                {
                    configured: false,
                    platform: platformConfig.platform,
                    error: "Linear API token provided but team ID missing",
                },
                ["Set LINEAR_TEAM_ID environment variable or linear_team_id in GitHub Action inputs"]
            );
        }

        // Test actual Linear integration
        const client = getLinearClient();
        const health = await client.healthCheck();

        const adjustedStatus = this.adjustStatusForPlatform(health.status, platformConfig.platform);

        return this.createSuccessResult(
            adjustedStatus,
            {
                ...health.details,
                platform: platformConfig.platform,
                configured: true,
                originalStatus: health.status,
            },
            health.status === "unhealthy" ? [
                "Check Linear API token configuration",
                "Verify Linear team ID",
                "Linear issues won't prevent GitHub integration from working"
            ] : []
        );
    }

    protected override createErrorResult(error: Error): HealthCheckResult {
        const platformConfig = getPlatformDetector().getPlatformConfig();

        // Skip if not required for current platform
        if (!this.isRequiredForPlatform(platformConfig.platform)) {
            return this.createPlatformNotRequiredResult(
                platformConfig.platform,
                "Linear not required for GitHub-only platform"
            );
        }

        const status = this.adjustStatusForPlatform("unhealthy", platformConfig.platform);
        const recommendations = [
            "Check Linear API token configuration",
            "Verify Linear API connectivity",
        ];

        if (platformConfig.isMultiPlatform) {
            recommendations.push("GitHub integration will continue to work regardless of Linear issues");
        }

        return {
            component: this.getComponentName(),
            status,
            responseTime: Date.now() - this.startTime,
            error: error.message,
            details: {
                platform: platformConfig.platform,
                configured: false,
                timestamp: new Date().toISOString(),
            },
            recommendations,
            lastChecked: new Date().toISOString(),
        };
    }
}

/**
 * TestFlight Integration Health Checker
 */
export class TestFlightHealthChecker extends BaseHealthChecker {
    public getComponentName(): string {
        return "TestFlight Integration";
    }

    protected async performCheck(): Promise<HealthCheckResult> {
        const client = getTestFlightClient();
        const rateLimitInfo = client.getRateLimitInfo();

        const recommendations = rateLimitInfo?.remaining && rateLimitInfo.remaining < 10
            ? ["TestFlight rate limit running low"]
            : [];

        return this.createSuccessResult(
            "healthy",
            {
                rateLimitInfo: rateLimitInfo || "No rate limit data available",
                configured: true,
            },
            recommendations
        );
    }

    protected override createErrorResult(error: Error): HealthCheckResult {
        return {
            component: this.getComponentName(),
            status: "unhealthy",
            responseTime: Date.now() - this.startTime,
            error: error.message,
            details: {
                timestamp: new Date().toISOString(),
            },
            recommendations: [
                "Check App Store Connect credentials",
                "Verify TestFlight API connectivity",
            ],
            lastChecked: new Date().toISOString(),
        };
    }
}

/**
 * LLM Integration Health Checker
 */
export class LLMHealthChecker extends BaseHealthChecker {
    public getComponentName(): string {
        return "LLM Integration";
    }

    protected async performCheck(): Promise<HealthCheckResult> {
        // Check if LLM enhancement is enabled
        const llmEnabled = this.isLLMEnabled();

        if (!llmEnabled) {
            return this.createSuccessResult(
                "healthy",
                {
                    enabled: false,
                    reason: "LLM enhancement is disabled or not configured",
                    checkedVars: ["ENABLE_LLM_ENHANCEMENT", "INPUT_ENABLE_LLM_ENHANCEMENT", "LLM_ENHANCEMENT"],
                },
                ["LLM enhancement is optional. Enable with enable_llm_enhancement: true in GitHub Actions"]
            );
        }

        // Check for available API keys
        const availableProviders = this.getAvailableProviders();

        if (availableProviders.length === 0) {
            return this.createSuccessResult(
                "degraded",
                {
                    enabled: true,
                    configured: false,
                    reason: "LLM enhancement enabled but no API keys provided",
                    availableProviders: [],
                },
                [
                    "Provide at least one LLM provider API key:",
                    "- openai_api_key for OpenAI GPT models",
                    "- anthropic_api_key for Anthropic Claude models",
                    "- google_api_key for Google Gemini models",
                ]
            );
        }

        // Test LLM client health
        const client = getLLMClient();
        const health = await client.healthCheck();

        // LLM issues should be degraded, not unhealthy (it's optional)
        const status = health.status === "unhealthy" ? "degraded" : health.status;

        return this.createSuccessResult(
            status,
            {
                enabled: true,
                configured: true,
                availableProviders,
                providers: health.providers,
                usage: health.usage,
                costStatus: health.costStatus,
            },
            health.costStatus.withinLimits ? [] : ["LLM cost limits exceeded - review usage"]
        );
    }

    protected override createErrorResult(error: Error): HealthCheckResult {
        // Always treat LLM issues as degraded since it's optional
        return {
            component: this.getComponentName(),
            status: "degraded",
            responseTime: Date.now() - this.startTime,
            error: error.message,
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

    private isLLMEnabled(): boolean {
        return process.env.ENABLE_LLM_ENHANCEMENT === "true" ||
            process.env.INPUT_ENABLE_LLM_ENHANCEMENT === "true" ||
            process.env.LLM_ENHANCEMENT === "true";
    }

    private getAvailableProviders(): string[] {
        const apiKeys = {
            openai: process.env.OPENAI_API_KEY || process.env.INPUT_OPENAI_API_KEY,
            anthropic: process.env.ANTHROPIC_API_KEY || process.env.INPUT_ANTHROPIC_API_KEY,
            google: process.env.GOOGLE_API_KEY || process.env.INPUT_GOOGLE_API_KEY,
        };

        return Object.entries(apiKeys)
            .filter(([, key]) => key && key.trim().length > 0)
            .map(([provider]) => provider);
    }
}

/**
 * State Management Health Checker
 */
export class StateManagementHealthChecker extends BaseHealthChecker {
    public getComponentName(): string {
        return "State Management";
    }

    protected async performCheck(): Promise<HealthCheckResult> {
        const stateManager = getStateManager();
        const stats = await stateManager.getStats();

        const recommendations = stats.currentlyCached > 10000
            ? ["Large cache size - consider cleanup"]
            : [];

        return this.createSuccessResult("healthy", stats, recommendations);
    }

    protected override createErrorResult(error: Error): HealthCheckResult {
        return {
            component: this.getComponentName(),
            status: "degraded",
            responseTime: Date.now() - this.startTime,
            error: error.message,
            details: {
                timestamp: new Date().toISOString(),
            },
            recommendations: [
                "State management issues may cause duplicate processing",
            ],
            lastChecked: new Date().toISOString(),
        };
    }
}

/**
 * Codebase Analysis Health Checker
 */
export class CodebaseAnalysisHealthChecker extends BaseHealthChecker {
    public getComponentName(): string {
        return "Codebase Analysis";
    }

    protected async performCheck(): Promise<HealthCheckResult> {
        const analyzer = getCodebaseAnalyzer();
        const stats = analyzer.getCacheStats();

        return this.createSuccessResult(
            "healthy",
            {
                cacheSize: stats.size,
                cachedFiles: stats.files.length,
                workspaceRoot: analyzer.workspaceRoot,
            }
        );
    }

    protected override createErrorResult(error: Error): HealthCheckResult {
        return {
            component: this.getComponentName(),
            status: "degraded",
            responseTime: Date.now() - this.startTime,
            error: error.message,
            details: {
                timestamp: new Date().toISOString(),
            },
            recommendations: [
                "Codebase analysis issues may reduce enhancement quality",
            ],
            lastChecked: new Date().toISOString(),
        };
    }
}

/**
 * Environment Configuration Health Checker
 */
export class EnvironmentConfigurationHealthChecker extends BaseHealthChecker {
    private readonly validator = new EnvironmentValidator();

    public getComponentName(): string {
        return "Environment Configuration";
    }

    protected async performCheck(): Promise<HealthCheckResult> {
        const platformConfig = getPlatformDetector().getPlatformConfig();
        const validation = this.validator.validateEnvironment(platformConfig);

        // Determine status based on validation results
        let status: "healthy" | "degraded" | "unhealthy";
        if (!validation.isValid) {
            status = platformConfig.isMultiPlatform && validation.platformIssues.length > 0 && validation.missingCoreConfig.length === 0
                ? "degraded"  // For multi-platform, missing one platform's config is degraded
                : "unhealthy"; // Core config missing or single platform issues = unhealthy
        } else if (validation.platformWarnings.length > 0) {
            status = "degraded";
        } else {
            status = "healthy";
        }

        const configValues = this.validator.getConfigurationValues();

        return this.createSuccessResult(
            status,
            {
                environment: process.env.NODE_ENV || "production",
                platform: platformConfig.platform,
                coreConfigComplete: validation.missingCoreConfig.length === 0,
                missingCoreConfig: validation.missingCoreConfig,
                platformIssues: validation.platformIssues,
                platformWarnings: validation.platformWarnings,
                detectedInputs: configValues,
                // Debug info for environment variables
                environmentVariables: this.getEnvironmentDebugInfo(),
            },
            validation.recommendations
        );
    }

    protected override createErrorResult(error: Error): HealthCheckResult {
        const platformConfig = getPlatformDetector().getPlatformConfig();

        return {
            component: this.getComponentName(),
            status: "degraded",
            responseTime: Date.now() - this.startTime,
            error: error.message,
            details: {
                platform: platformConfig.platform,
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

    private getEnvironmentDebugInfo(): Record<string, unknown> {
        return {
            core: {
                TESTFLIGHT_ISSUER_ID: !!process.env.TESTFLIGHT_ISSUER_ID,
                TESTFLIGHT_KEY_ID: !!process.env.TESTFLIGHT_KEY_ID,
                TESTFLIGHT_PRIVATE_KEY: !!process.env.TESTFLIGHT_PRIVATE_KEY,
                TESTFLIGHT_APP_ID: !!process.env.TESTFLIGHT_APP_ID,
            },
            github: {
                GTHB_TOKEN: !!process.env.GTHB_TOKEN,
                GITHUB_OWNER: !!process.env.GITHUB_OWNER,
                GITHUB_REPO: !!process.env.GITHUB_REPO,
                GITHUB_ACTIONS: !!process.env.GITHUB_ACTIONS,
                GITHUB_REPOSITORY: !!process.env.GITHUB_REPOSITORY,
                GITHUB_REPOSITORY_OWNER: !!process.env.GITHUB_REPOSITORY_OWNER,
                // Debug values (truncated for security)
                DEBUG_GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY || 'not set',
                DEBUG_GITHUB_REPOSITORY_OWNER: process.env.GITHUB_REPOSITORY_OWNER || 'not set',
                DEBUG_RUNNER_OS: process.env.RUNNER_OS || 'not set',
            }
        };
    }
}
