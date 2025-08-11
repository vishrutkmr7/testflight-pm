/**
 * Environment Configuration Validator
 * Handles environment variable validation logic
 * Follows Single Responsibility Principle
 */

import { getEnvVar } from "../../config/environment-loader.js";
import type { PlatformConfig } from "./platform-detector.js";

export interface EnvironmentValidationResult {
	isValid: boolean;
	missingCoreConfig: string[];
	platformIssues: string[];
	platformWarnings: string[];
	errorMessage: string;
	recommendations: string[];
}

export interface ConfigVariable {
	key: string;
	envName: string;
	inputName: string;
	displayName: string;
}

/**
 * Service for validating environment configuration
 */
export class EnvironmentValidator {
	private readonly coreVariables: ConfigVariable[] = [
		{ key: "TESTFLIGHT_ISSUER_ID", envName: "TESTFLIGHT_ISSUER_ID", inputName: "testflight_issuer_id", displayName: "TestFlight Issuer ID" },
		{ key: "TESTFLIGHT_KEY_ID", envName: "TESTFLIGHT_KEY_ID", inputName: "testflight_key_id", displayName: "TestFlight Key ID" },
		{ key: "TESTFLIGHT_PRIVATE_KEY", envName: "TESTFLIGHT_PRIVATE_KEY", inputName: "testflight_private_key", displayName: "TestFlight Private Key" },
		{ key: "TESTFLIGHT_APP_ID", envName: "TESTFLIGHT_APP_ID", inputName: "app_id", displayName: "TestFlight App ID" },
	];

	private readonly githubVariables: ConfigVariable[] = [
		{ key: "GTHB_TOKEN", envName: "GTHB_TOKEN", inputName: "gthb_token", displayName: "GitHub Token" },
		{ key: "GITHUB_OWNER", envName: "GITHUB_OWNER", inputName: "github_owner", displayName: "GitHub Owner" },
		{ key: "GITHUB_REPO", envName: "GITHUB_REPO", inputName: "github_repo", displayName: "GitHub Repo" },
	];

	private readonly linearVariables: ConfigVariable[] = [
		{ key: "LINEAR_API_TOKEN", envName: "LINEAR_API_TOKEN", inputName: "linear_api_token", displayName: "Linear API Token" },
		{ key: "LINEAR_TEAM_ID", envName: "LINEAR_TEAM_ID", inputName: "linear_team_id", displayName: "Linear Team ID" },
	];

	/**
	 * Validate environment configuration for the given platform
	 */
	public validateEnvironment(platformConfig: PlatformConfig): EnvironmentValidationResult {
		const coreConfig = this.validateConfigVariables(this.coreVariables);
		const githubConfig = this.validateConfigVariables(this.githubVariables);
		const linearConfig = this.validateConfigVariables(this.linearVariables);

		const missingCoreConfig = this.getMissingVariables(coreConfig);
		const platformIssues: string[] = [];
		const platformWarnings: string[] = [];

		// Check platform-specific requirements
		if (platformConfig.requiresGitHub) {
			const missingGitHub = this.getMissingVariables(githubConfig);
			if (missingGitHub.length > 0) {
				if (platformConfig.isMultiPlatform) {
					platformWarnings.push(...missingGitHub.map(key => `Missing GitHub config: ${key} (GitHub integration will be disabled)`));
				} else {
					platformIssues.push(...missingGitHub.map(key => `Missing required GitHub config: ${key}`));
				}
			}
		}

		if (platformConfig.requiresLinear) {
			const missingLinear = this.getMissingVariables(linearConfig);
			if (missingLinear.length > 0) {
				if (platformConfig.isMultiPlatform) {
					platformWarnings.push(...missingLinear.map(key => `Missing Linear config: ${key} (Linear integration will be disabled)`));
				} else {
					platformIssues.push(...missingLinear.map(key => `Missing required Linear config: ${key}`));
				}
			}
		}

		const recommendations = this.generateRecommendations(missingCoreConfig, platformIssues, platformWarnings, platformConfig);
		const errorMessage = this.buildErrorMessage(missingCoreConfig, platformIssues, platformWarnings);
		const isValid = missingCoreConfig.length === 0 && platformIssues.length === 0;

		return {
			isValid,
			missingCoreConfig,
			platformIssues,
			platformWarnings,
			errorMessage,
			recommendations,
		};
	}

	/**
	 * Get configuration values for all variables
	 */
	public getConfigurationValues(): Record<string, unknown> {
		const coreConfig = this.validateConfigVariables(this.coreVariables);
		const githubConfig = this.validateConfigVariables(this.githubVariables, true);
		const linearConfig = this.validateConfigVariables(this.linearVariables);

		return {
			core: coreConfig,
			github: githubConfig,
			linear: linearConfig,
		};
	}

	/**
	 * Validate a set of configuration variables
	 */
	private validateConfigVariables(variables: ConfigVariable[], includeContextualValues: boolean = false): Record<string, string | undefined> {
		const config: Record<string, string | undefined> = {};

		for (const variable of variables) {
			let value = getEnvVar(variable.envName, variable.inputName);

			// For GitHub variables, add contextual auto-population
			if (includeContextualValues && !value) {
				const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
				if (variable.key === "GITHUB_OWNER" && isGitHubActions) {
					value = process.env.GITHUB_REPOSITORY_OWNER;
				} else if (variable.key === "GITHUB_REPO" && isGitHubActions && process.env.GITHUB_REPOSITORY) {
					value = process.env.GITHUB_REPOSITORY.split('/')[1];
				}
			}

			config[variable.key] = value;
		}

		return config;
	}

	/**
	 * Get missing variables from a configuration object
	 */
	private getMissingVariables(config: Record<string, string | undefined>): string[] {
		return Object.entries(config)
			.filter(([, value]) => !value || value.trim() === "")
			.map(([key]) => key);
	}

	/**
	 * Generate recommendations based on missing configuration
	 */
	private generateRecommendations(
		missingCoreConfig: string[],
		platformIssues: string[],
		platformWarnings: string[],
		platformConfig: PlatformConfig
	): string[] {
		const recommendations: string[] = [];

		if (missingCoreConfig.length > 0) {
			recommendations.push("Configure required TestFlight credentials:");
			for (const key of missingCoreConfig) {
				const variable = this.coreVariables.find(v => v.key === key);
				if (variable) {
					recommendations.push(`  - Set ${variable.envName} environment variable or ${variable.inputName} in GitHub Action inputs`);
				}
			}
		}

		if (platformIssues.length > 0) {
			if (platformConfig.isMultiPlatform) {
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

		if (missingCoreConfig.length === 0 && platformIssues.length === 0 && platformWarnings.length === 0) {
			recommendations.push("All required configuration is present and valid");
		}

		return recommendations;
	}

	/**
	 * Build error message from validation results
	 */
	private buildErrorMessage(
		missingCoreConfig: string[],
		platformIssues: string[],
		platformWarnings: string[]
	): string {
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

		return errorMessage.trim() || "Configuration validation failed";
	}
}
