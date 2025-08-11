/**
 * Environment Variable Loader
 * Handles loading and basic validation of environment variables
 * Follows Single Responsibility Principle - only concerns environment variable access
 */

import * as core from "@actions/core";

/**
 * Checks if running in GitHub Actions environment
 */
export function isGitHubActionEnvironment(): boolean {
    return process.env.GITHUB_ACTION === "true" || !!process.env.GITHUB_ACTIONS;
}

/**
 * Gets environment variable value with GitHub Action input fallback
 */
export function getEnvVar(
    name: string,
    githubActionInputName?: string,
): string | undefined {
    // First try direct environment variable
    let value = process.env[name];

    // If in GitHub Action and no direct env var, try input format
    if (!value && isGitHubActionEnvironment() && githubActionInputName) {
        const inputName = `INPUT_${githubActionInputName.toUpperCase().replace(/-/g, "_")}`;
        value = process.env[inputName];
    }

    return value;
}

/**
 * Gets a required environment variable, throwing if not found
 */
export function getRequiredEnvVar(
    name: string,
    githubActionInputName?: string,
): string {
    const value = getEnvVar(name, githubActionInputName);

    if (!value || value.trim() === "") {
        const sources = [name];
        if (githubActionInputName) {
            sources.push(
                `INPUT_${githubActionInputName.toUpperCase().replace(/-/g, "_")}`,
            );
        }
        throw new Error(
            `Required environment variable not found. Tried: ${sources.join(", ")}`,
        );
    }

    return value.trim();
}

/**
 * Gets a boolean environment variable with default fallback
 */
export function getBooleanEnvVar(
    name: string,
    githubActionInputName?: string,
    defaultValue: boolean = false,
): boolean {
    const value = getEnvVar(name, githubActionInputName);

    if (!value) {
        return defaultValue;
    }

    // Handle GitHub Actions boolean inputs
    if (isGitHubActionEnvironment() && githubActionInputName) {
        return core.getBooleanInput(githubActionInputName) || defaultValue;
    }

    return value.toLowerCase() === "true";
}

/**
 * Gets a numeric environment variable with default fallback
 */
export function getNumericEnvVar(
    name: string,
    githubActionInputName?: string,
    defaultValue: number = 0,
): number {
    const value = getEnvVar(name, githubActionInputName);

    if (!value) {
        return defaultValue;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Gets a float environment variable with default fallback
 */
export function getFloatEnvVar(
    name: string,
    githubActionInputName?: string,
    defaultValue: number = 0,
): number {
    const value = getEnvVar(name, githubActionInputName);

    if (!value) {
        return defaultValue;
    }

    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Gets a comma-separated list from environment variable
 */
export function getListEnvVar(
    name: string,
    githubActionInputName?: string,
    defaultValue: string[] = [],
): string[] {
    const value = getEnvVar(name, githubActionInputName);

    if (!value) {
        return defaultValue;
    }

    return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

/**
 * Environment variable definitions for type safety
 */
export const ENV_VARS = {
    // Core App Store Connect - FIXED to match action.yml inputs
    APP_STORE_CONNECT_ISSUER_ID: "testflight-issuer-id",
    APP_STORE_CONNECT_KEY_ID: "testflight-key-id", 
    APP_STORE_CONNECT_PRIVATE_KEY: "testflight-private-key",
    APP_STORE_CONNECT_PRIVATE_KEY_PATH: undefined, // No GitHub Action input
    TESTFLIGHT_APP_ID: "app-id",
    TESTFLIGHT_BUNDLE_ID: "testflight-bundle-id",

    // GitHub - FIXED to match action.yml inputs
    GITHUB_TOKEN: "gthb_token",
    GITHUB_OWNER: "github_owner", 
    GITHUB_REPO: "github_repo",

    // Linear - FIXED to match action.yml inputs  
    LINEAR_API_TOKEN: "linear_api_token",
    LINEAR_TEAM_ID: "linear_team_id",

    // Webhook (local dev only)
    WEBHOOK_SECRET: undefined,
    WEBHOOK_PORT: undefined,

    // LLM
    ENABLE_LLM_ENHANCEMENT: "enable_llm_enhancement",
    LLM_PROVIDER: "llm_provider",
    LLM_FALLBACK_PROVIDERS: "llm_fallback_providers",
    OPENAI_API_KEY: "openai_api_key",
    OPENAI_MODEL: "openai_model",
    ANTHROPIC_API_KEY: "anthropic_api_key",
    ANTHROPIC_MODEL: "anthropic_model",
    GOOGLE_API_KEY: "google_api_key",
    GOOGLE_MODEL: "google_model",

    // Cost controls
    MAX_LLM_COST_PER_RUN: "max_llm_cost_per_run",
    MAX_LLM_COST_PER_MONTH: "max_llm_cost_per_month",
    MAX_TOKENS_PER_ISSUE: "max_tokens_per_issue",

    // Processing
    ENABLE_DUPLICATE_DETECTION: "enable_duplicate_detection",
    DUPLICATE_DETECTION_DAYS: "duplicate_detection_days",
    ENABLE_CODEBASE_ANALYSIS: "enable_codebase_analysis",
    CODEBASE_ANALYSIS_DEPTH: "codebase_analysis_depth",
    MIN_FEEDBACK_LENGTH: "min_feedback_length",
    PROCESSING_WINDOW_HOURS: "processing_window_hours",
    WORKSPACE_ROOT: "workspace_root",

    // Labels
    CRASH_LABELS: "crash_labels",
    FEEDBACK_LABELS: "feedback_labels",
    ADDITIONAL_LABELS: "additional_labels",

    // General
    NODE_ENV: undefined,
    LOG_LEVEL: undefined,
    DEBUG: undefined,
    DRY_RUN: "dry_run",
} as const;

/**
 * GitHub Actions context helpers
 */
export function getGitHubContext() {
    if (!isGitHubActionEnvironment()) {
        return null;
    }

    return {
        repository: process.env.GITHUB_REPOSITORY,
        repositoryOwner: process.env.GITHUB_REPOSITORY_OWNER,
        repositoryName: process.env.GITHUB_REPOSITORY?.split("/")[1],
        ref: process.env.GITHUB_REF,
        sha: process.env.GITHUB_SHA,
        actor: process.env.GITHUB_ACTOR,
        workflow: process.env.GITHUB_WORKFLOW,
        runId: process.env.GITHUB_RUN_ID,
        runNumber: process.env.GITHUB_RUN_NUMBER,
    };
}
