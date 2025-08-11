/**
 * Platform Detection Service
 * Handles platform configuration detection and validation
 * Follows Single Responsibility Principle
 */

import { getEnvVar } from "../../config/environment-loader.js";

export type Platform = "github" | "linear" | "both";

export interface PlatformConfig {
	platform: Platform;
	requiresGitHub: boolean;
	requiresLinear: boolean;
	isMultiPlatform: boolean;
}

/**
 * Service for detecting and managing platform configuration
 */
export class PlatformDetector {
	private _cachedConfig: PlatformConfig | null = null;

	/**
	 * Get the current platform configuration
	 */
	public getPlatformConfig(): PlatformConfig {
		if (this._cachedConfig) {
			return this._cachedConfig;
		}

		const platform = this.detectPlatform();
		this._cachedConfig = {
			platform,
			requiresGitHub: platform === "github" || platform === "both",
			requiresLinear: platform === "linear" || platform === "both",
			isMultiPlatform: platform === "both",
		};

		return this._cachedConfig;
	}

	/**
	 * Detect the current platform from environment
	 */
	private detectPlatform(): Platform {
		const platformValue = (getEnvVar("PLATFORM", "platform") || "github").toLowerCase();
		
		if (platformValue === "linear" || platformValue === "both") {
			return platformValue as Platform;
		}
		
		return "github"; // Default fallback
	}

	/**
	 * Check if a specific integration is required for the current platform
	 */
	public isIntegrationRequired(integration: "github" | "linear"): boolean {
		const config = this.getPlatformConfig();
		return integration === "github" ? config.requiresGitHub : config.requiresLinear;
	}

	/**
	 * Check if a specific integration is optional for the current platform
	 */
	public isIntegrationOptional(integration: "github" | "linear"): boolean {
		const config = this.getPlatformConfig();
		// In multi-platform mode, individual integrations are optional
		return config.isMultiPlatform;
	}

	/**
	 * Clear cached configuration (useful for testing)
	 */
	public clearCache(): void {
		this._cachedConfig = null;
	}
}

// Singleton instance
let _platformDetectorInstance: PlatformDetector | null = null;

export function getPlatformDetector(): PlatformDetector {
	if (!_platformDetectorInstance) {
		_platformDetectorInstance = new PlatformDetector();
	}
	return _platformDetectorInstance;
}

export function clearPlatformDetectorInstance(): void {
	_platformDetectorInstance = null;
}
