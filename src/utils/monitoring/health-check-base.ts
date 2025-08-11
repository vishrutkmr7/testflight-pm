/**
 * Health Check Base Classes and Interfaces
 * Defines contracts and common functionality for health checks
 * Follows Interface Segregation and Dependency Inversion Principles
 */

export interface HealthCheckResult {
    component: string;
    status: "healthy" | "degraded" | "unhealthy";
    responseTime?: number;
    details: Record<string, unknown>;
    error?: string;
    recommendations?: string[];
    lastChecked: string;
}

export interface HealthChecker {
    check(): Promise<HealthCheckResult>;
    getComponentName(): string;
}

export interface PlatformAwareHealthChecker extends HealthChecker {
    isRequiredForPlatform(platform: string): boolean;
    adjustStatusForPlatform(status: "healthy" | "degraded" | "unhealthy", platform: string): "healthy" | "degraded" | "unhealthy";
}

/**
 * Base class for health checks with common functionality
 * Follows Template Method pattern and DRY principle
 */
export abstract class BaseHealthChecker implements HealthChecker {
    protected startTime: number = 0;

    public async check(): Promise<HealthCheckResult> {
        this.startTime = Date.now();

        try {
            return await this.performCheck();
        } catch (error) {
            return this.createErrorResult(error as Error);
        }
    }

    public abstract getComponentName(): string;

    protected abstract performCheck(): Promise<HealthCheckResult>;

    protected createSuccessResult(
        status: "healthy" | "degraded" | "unhealthy",
        details: Record<string, unknown>,
        recommendations: string[] = []
    ): HealthCheckResult {
        return {
            component: this.getComponentName(),
            status,
            responseTime: Date.now() - this.startTime,
            details: {
                ...details,
                timestamp: new Date().toISOString(),
            },
            recommendations,
            lastChecked: new Date().toISOString(),
        };
    }

    protected createErrorResult(error: Error): HealthCheckResult {
        return {
            component: this.getComponentName(),
            status: "unhealthy",
            responseTime: Date.now() - this.startTime,
            error: error.message,
            details: {
                timestamp: new Date().toISOString(),
            },
            recommendations: [
                `Check ${this.getComponentName()} configuration`,
                `Verify ${this.getComponentName()} connectivity`,
            ],
            lastChecked: new Date().toISOString(),
        };
    }
}

/**
 * Base class for platform-aware health checks
 * Encapsulates platform-specific logic
 */
export abstract class BasePlatformAwareHealthChecker extends BaseHealthChecker implements PlatformAwareHealthChecker {
    public abstract isRequiredForPlatform(platform: string): boolean;

    public adjustStatusForPlatform(
        status: "healthy" | "degraded" | "unhealthy",
        platform: string
    ): "healthy" | "degraded" | "unhealthy" {
        // Default implementation: degrade unhealthy to degraded in multi-platform mode
        if (platform === "both" && status === "unhealthy") {
            return "degraded";
        }
        return status;
    }

    protected createPlatformNotRequiredResult(platform: string, reason: string): HealthCheckResult {
        return this.createSuccessResult(
            "healthy",
            {
                configured: false,
                reason,
                platform,
            },
            []
        );
    }
}

/**
 * Configuration for health check execution
 */
export interface HealthCheckConfig {
    timeoutMs: number;
    enableDetailedChecks: boolean;
}

/**
 * Factory interface for creating health checkers
 * Follows Dependency Inversion Principle
 */
export interface HealthCheckerFactory {
    createHealthCheckers(): HealthChecker[];
}
