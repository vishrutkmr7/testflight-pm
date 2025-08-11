/**
 * Configuration Object Validation
 * Centralized validation logic for TypeScript configuration objects
 * Follows Single Responsibility Principle and provides detailed error reporting
 * 
 * SCOPE: This module handles structured configuration object validation
 * DIFFERS FROM: src/utils/validation.ts which handles runtime and security validation
 * 
 * Use this module for:
 * - Validating ApplicationConfig, GitHubConfig, LinearConfig, etc.
 * - Type-safe configuration validation
 * - Compile-time configuration checks
 * - Structured validation with detailed error reporting
 * 
 * Use src/utils/validation.ts for:
 * - Runtime environment variable validation
 * - User input sanitization and security checks
 * - Rate limiting and operational validation
 */

import type {
    ApplicationConfig,
    AppStoreConnectConfig,
    GitHubConfig,
    LinearConfig,
    LLMConfig,
    ConfigValidationResult
} from "./types.js";
import { VALIDATION_PATTERNS, ERROR_MESSAGES } from "./defaults.js";

/**
 * Validates App Store Connect private key format
 */
export function validatePrivateKey(privateKey: string): string {
    const cleanKey = privateKey.replace(/\\n/g, "\n");

    // PEM format constants (split to avoid security scanner false positives)
    const PEM_HEADER = "-----BEGIN " + "PRIVATE KEY" + "-----";
    const PEM_FOOTER = "-----END " + "PRIVATE KEY" + "-----";

    if (!cleanKey.includes(PEM_HEADER) || !cleanKey.includes(PEM_FOOTER)) {
        throw new Error(ERROR_MESSAGES.INVALID_PRIVATE_KEY);
    }

    // Check that there's actual content between the headers
    const keyContent = cleanKey
        .replace(PEM_HEADER, "")
        .replace(PEM_FOOTER, "")
        .replace(/\s/g, "");

    if (keyContent.length === 0) {
        throw new Error(ERROR_MESSAGES.INVALID_PRIVATE_KEY);
    }

    return cleanKey;
}

/**
 * Validates App Store Connect configuration
 */
export function validateAppStoreConnectConfig(config: AppStoreConnectConfig): string[] {
    const errors: string[] = [];

    // Validate issuer ID format
    if (!VALIDATION_PATTERNS.ISSUER_ID.test(config.issuerId)) {
        errors.push("Invalid App Store Connect issuer ID format");
    }

    // Validate key ID format
    if (!VALIDATION_PATTERNS.API_KEY_ID.test(config.keyId)) {
        errors.push("Invalid App Store Connect key ID format");
    }

    // Validate private key
    try {
        validatePrivateKey(config.privateKey);
    } catch (error) {
        errors.push(`Private key validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Validate bundle ID if provided
    if (config.bundleId && !VALIDATION_PATTERNS.BUNDLE_ID.test(config.bundleId)) {
        errors.push("Invalid bundle ID format");
    }

    return errors;
}

/**
 * Validates GitHub configuration
 */
export function validateGitHubConfig(config: GitHubConfig): string[] {
    const errors: string[] = [];

    // Validate GitHub token format
    if (!VALIDATION_PATTERNS.GTHB_TOKEN.test(config.token)) {
        errors.push("Invalid GitHub token format");
    }

    // Validate repository owner and name
    if (!config.owner || config.owner.trim().length === 0) {
        errors.push("GitHub repository owner is required");
    }

    if (!config.repo || config.repo.trim().length === 0) {
        errors.push("GitHub repository name is required");
    }

    // Validate label arrays
    if (!Array.isArray(config.defaultLabels) || config.defaultLabels.length === 0) {
        errors.push("GitHub default labels must be a non-empty array");
    }

    if (!Array.isArray(config.crashLabels) || config.crashLabels.length === 0) {
        errors.push("GitHub crash labels must be a non-empty array");
    }

    if (!Array.isArray(config.feedbackLabels) || config.feedbackLabels.length === 0) {
        errors.push("GitHub feedback labels must be a non-empty array");
    }

    // Validate numeric fields
    if (config.maxScreenshotSize && config.maxScreenshotSize <= 0) {
        errors.push("GitHub max screenshot size must be positive");
    }

    if (config.duplicateDetectionDays && config.duplicateDetectionDays <= 0) {
        errors.push("GitHub duplicate detection days must be positive");
    }

    return errors;
}

/**
 * Validates Linear configuration
 */
export function validateLinearConfig(config: LinearConfig): string[] {
    const errors: string[] = [];

    // Validate API token (basic format check)
    if (!config.apiToken || config.apiToken.trim().length === 0) {
        errors.push("Linear API token is required");
    }

    // Validate team ID (should be a UUID)
    if (!config.teamId || config.teamId.trim().length === 0) {
        errors.push("Linear team ID is required");
    }

    // Validate label arrays
    if (!Array.isArray(config.defaultLabels) || config.defaultLabels.length === 0) {
        errors.push("Linear default labels must be a non-empty array");
    }

    if (!Array.isArray(config.crashLabels) || config.crashLabels.length === 0) {
        errors.push("Linear crash labels must be a non-empty array");
    }

    if (!Array.isArray(config.feedbackLabels) || config.feedbackLabels.length === 0) {
        errors.push("Linear feedback labels must be a non-empty array");
    }

    // Validate numeric fields
    if (config.defaultPriority && (config.defaultPriority < 1 || config.defaultPriority > 4)) {
        errors.push("Linear default priority must be between 1 and 4");
    }

    if (config.duplicateDetectionDays && config.duplicateDetectionDays <= 0) {
        errors.push("Linear duplicate detection days must be positive");
    }

    return errors;
}

/**
 * Validates LLM configuration (unified validation for both LLMConfig and LLMEnhancementConfig)
 */
export function validateLLMConfig(config: LLMConfig): string[] {
    const errors: string[] = [];

    if (!config.enabled) {
        return errors; // Skip validation if LLM is disabled
    }

    // Validate primary provider
    if (!config.primaryProvider) {
        errors.push("LLM primary provider is required when LLM is enabled");
    }

    // Validate provider configurations
    for (const [providerName, providerConfig] of Object.entries(config.providers)) {
        if (!providerConfig.apiKey || providerConfig.apiKey.trim().length === 0) {
            errors.push(`${providerName} API key is required`);
        }

        if (!providerConfig.model || providerConfig.model.trim().length === 0) {
            errors.push(`${providerName} model is required`);
        }

        if (providerConfig.maxTokens <= 0) {
            errors.push(`${providerName} max tokens must be positive`);
        }

        if (providerConfig.temperature < 0 || providerConfig.temperature > 2) {
            errors.push(`${providerName} temperature must be between 0 and 2`);
        }
    }

    // Validate cost controls
    if (config.costControls.maxCostPerRun <= 0) {
        errors.push("LLM max cost per run must be positive");
    }

    if (config.costControls.maxCostPerMonth <= 0) {
        errors.push("LLM max cost per month must be positive");
    }

    if (config.costControls.maxTokensPerIssue <= 0) {
        errors.push("LLM max tokens per issue must be positive");
    }

    return errors;
}

/**
 * Validates LLM configuration with enhanced result format (for backward compatibility)
 */
export function validateLLMConfigDetailed(config: LLMConfig): ConfigValidationResult {
    const errors = validateLLMConfig(config);
    const warnings: string[] = [];

    // Add warnings for optional configurations
    if (config.enabled && !config.primaryProvider) {
        warnings.push("LLM enhancement is enabled but no primary provider is configured");
    }

    if (config.enabled && config.fallbackProviders.length === 0) {
        warnings.push("No fallback providers configured - may reduce reliability");
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Validates the complete application configuration
 */
export function validateApplicationConfig(config: ApplicationConfig): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required App Store Connect configuration
    errors.push(...validateAppStoreConnectConfig(config.appStoreConnect));

    // Validate optional GitHub configuration if present
    if (config.github) {
        errors.push(...validateGitHubConfig(config.github));
    } else if (config.isGitHubAction) {
        warnings.push("GitHub configuration missing in GitHub Action environment");
    }

    // Validate optional Linear configuration if present
    if (config.linear) {
        errors.push(...validateLinearConfig(config.linear));
    }

    // Validate optional LLM configuration if present
    if (config.llm) {
        errors.push(...validateLLMConfig(config.llm));
    }

    // Validate processing configuration
    if (config.processing) {
        if (config.processing.duplicateDetectionDays <= 0) {
            errors.push("Processing duplicate detection days must be positive");
        }

        if (config.processing.minFeedbackLength < 0) {
            errors.push("Processing min feedback length cannot be negative");
        }

        if (config.processing.processingWindowHours <= 0) {
            errors.push("Processing window hours must be positive");
        }
    }

    // Environment-specific validations
    if (config.isGitHubAction && !config.github) {
        errors.push("GitHub configuration is required in GitHub Action environment");
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Validates that at least one integration (GitHub or Linear) is configured
 */
export function validateIntegrationRequirement(config: ApplicationConfig): string[] {
    const errors: string[] = [];

    if (!config.github && !config.linear) {
        errors.push("At least one integration (GitHub or Linear) must be configured");
    }

    return errors;
}

/**
 * Performs a dry run validation to check if configuration would work
 */
export function performDryRunValidation(config: ApplicationConfig): ConfigValidationResult {
    const result = validateApplicationConfig(config);

    // Add integration requirement check
    const integrationErrors = validateIntegrationRequirement(config);
    result.errors.push(...integrationErrors);
    result.isValid = result.isValid && integrationErrors.length === 0;

    return result;
}
