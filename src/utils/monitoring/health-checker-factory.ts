/**
 * Health Checker Factory
 * Creates and manages health checker instances
 * Follows Dependency Inversion and Factory patterns
 */

import type { HealthChecker, HealthCheckerFactory } from "./health-check-base.js";
import {
	CodebaseAnalysisHealthChecker,
	EnvironmentConfigurationHealthChecker,
	GitHubHealthChecker,
	LinearHealthChecker,
	LLMHealthChecker,
	StateManagementHealthChecker,
	TestFlightHealthChecker,
} from "./health-checkers.js";

/**
 * Default factory implementation for health checkers
 * Follows Open/Closed Principle - new checkers can be added without modifying existing code
 */
export class DefaultHealthCheckerFactory implements HealthCheckerFactory {
	public createHealthCheckers(): HealthChecker[] {
		return [
			new GitHubHealthChecker(),
			new LinearHealthChecker(),
			new TestFlightHealthChecker(),
			new LLMHealthChecker(),
			new StateManagementHealthChecker(),
			new CodebaseAnalysisHealthChecker(),
			new EnvironmentConfigurationHealthChecker(),
		];
	}
}

/**
 * Factory for creating specific health checkers
 * Useful for testing or custom configurations
 */
export class CustomHealthCheckerFactory implements HealthCheckerFactory {
	private readonly checkerTypes: Array<new () => HealthChecker>;

	constructor(checkerTypes: Array<new () => HealthChecker>) {
		this.checkerTypes = checkerTypes;
	}

	public createHealthCheckers(): HealthChecker[] {
		return this.checkerTypes.map(CheckerType => new CheckerType());
	}
}

// Singleton factory instance
let _factoryInstance: HealthCheckerFactory | null = null;

export function getHealthCheckerFactory(): HealthCheckerFactory {
	if (!_factoryInstance) {
		_factoryInstance = new DefaultHealthCheckerFactory();
	}
	return _factoryInstance;
}

export function setHealthCheckerFactory(factory: HealthCheckerFactory): void {
	_factoryInstance = factory;
}

export function clearHealthCheckerFactory(): void {
	_factoryInstance = null;
}
