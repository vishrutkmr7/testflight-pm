/**
 * Monitoring Module Public API
 * Clean interface for the refactored monitoring system
 * Follows Interface Segregation Principle
 */

// Core types and interfaces
export type {
    HealthCheckResult,
    HealthChecker,
    PlatformAwareHealthChecker,
    HealthCheckConfig,
    HealthCheckerFactory,
} from "./health-check-base.js";

export type {
    SystemHealth,
    MonitoringConfig,
} from "./system-health-monitor.js";

export type {
    Platform,
    PlatformConfig,
} from "./platform-detector.js";

export type {
    EnvironmentValidationResult,
} from "./environment-validator.js";

// Main system components
export {
    SystemHealthMonitor,
    getSystemHealthMonitor,
    clearHealthMonitorInstance,
    quickHealthCheck,
} from "./system-health-monitor.js";

export {
    PlatformDetector,
    getPlatformDetector,
    clearPlatformDetectorInstance,
} from "./platform-detector.js";

export {
    EnvironmentValidator,
} from "./environment-validator.js";

// Base classes for extending
export {
    BaseHealthChecker,
    BasePlatformAwareHealthChecker as PlatformAwareHealthCheckerBase,
} from "./health-check-base.js";

// Factory and concrete implementations
export {
    DefaultHealthCheckerFactory,
    CustomHealthCheckerFactory,
    getHealthCheckerFactory,
    setHealthCheckerFactory,
    clearHealthCheckerFactory,
} from "./health-checker-factory.js";

export {
    GitHubHealthChecker,
    LinearHealthChecker,
    TestFlightHealthChecker,
    LLMHealthChecker,
    StateManagementHealthChecker,
    CodebaseAnalysisHealthChecker,
    EnvironmentConfigurationHealthChecker,
} from "./health-checkers.js";

// Legacy compatibility exports
export {
    SystemHealthMonitor as SystemHealthMonitorLegacy,
    quickHealthCheck as quickHealthCheckLegacy,
} from "./system-health-monitor.js";

// Re-export old interface for backward compatibility
export interface HealthCheck extends HealthCheckResult { }
