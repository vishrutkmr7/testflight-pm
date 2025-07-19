/**
 * Environment Configuration Management
 * Securely loads and validates environment variables and secrets
 */

export interface AppStoreConnectConfig {
    issuerId: string;
    keyId: string;
    privateKey: string;
    appId?: string;
    bundleId?: string;
}

export interface GitHubConfig {
    token: string;
    owner: string;
    repo: string;
}

export interface LinearConfig {
    apiToken: string;
    teamId: string;
}

export interface WebhookConfig {
    secret: string;
    port: number;
}

export interface EnvironmentConfig {
    nodeEnv: 'development' | 'production' | 'test';
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    appStoreConnect: AppStoreConnectConfig;
    github?: GitHubConfig;
    linear?: LinearConfig;
    webhook?: WebhookConfig;
}

/**
 * Validates that required environment variables are present
 */
function validateRequiredEnvVar(name: string, value: string | undefined): string {
    if (!value || value.trim() === '') {
        throw new Error(`Required environment variable ${name} is not set or is empty`);
    }
    return value.trim();
}

/**
 * Validates App Store Connect private key format
 */
function validatePrivateKey(privateKey: string): string {
    const cleanKey = privateKey.replace(/\\n/g, '\n');

    if (!cleanKey.includes('-----BEGIN PRIVATE KEY-----') ||
        !cleanKey.includes('-----END PRIVATE KEY-----')) {
        throw new Error('Invalid private key format. Must be a PEM formatted private key.');
    }

    // Check that there's actual content between the headers
    const keyContent = cleanKey
        .replace('-----BEGIN PRIVATE KEY-----', '')
        .replace('-----END PRIVATE KEY-----', '')
        .replace(/\s/g, '');

    if (keyContent.length === 0) {
        throw new Error('Invalid private key format. Private key appears to be empty.');
    }

    return cleanKey;
}

/**
 * Loads and validates environment configuration
 * Throws descriptive errors for missing or invalid configuration
 */
export function loadEnvironmentConfig(): EnvironmentConfig {
    try {
        // Core App Store Connect configuration (always required)
        const issuerId = validateRequiredEnvVar('APP_STORE_CONNECT_ISSUER_ID', process.env.APP_STORE_CONNECT_ISSUER_ID);
        const keyId = validateRequiredEnvVar('APP_STORE_CONNECT_KEY_ID', process.env.APP_STORE_CONNECT_KEY_ID);

        // Private key can come from environment variable or file path
        let privateKey: string;
        if (process.env.APP_STORE_CONNECT_PRIVATE_KEY) {
            privateKey = validatePrivateKey(process.env.APP_STORE_CONNECT_PRIVATE_KEY);
        } else if (process.env.APP_STORE_CONNECT_PRIVATE_KEY_PATH) {
            const keyPath = process.env.APP_STORE_CONNECT_PRIVATE_KEY_PATH;
            try {
                // Use synchronous file reading for simplicity
                const fs = require('fs');
                const keyContent = fs.readFileSync(keyPath, 'utf8');
                privateKey = validatePrivateKey(keyContent);
            } catch (error) {
                throw new Error(`Failed to read private key from ${keyPath}: ${error}`);
            }
        } else {
            throw new Error('Either APP_STORE_CONNECT_PRIVATE_KEY or APP_STORE_CONNECT_PRIVATE_KEY_PATH must be set');
        }

        const appStoreConnect: AppStoreConnectConfig = {
            issuerId,
            keyId,
            privateKey,
            appId: process.env.TESTFLIGHT_APP_ID,
            bundleId: process.env.TESTFLIGHT_BUNDLE_ID,
        };

        // Optional GitHub configuration
        let github: GitHubConfig | undefined;
        if (process.env.GITHUB_TOKEN) {
            github = {
                token: validateRequiredEnvVar('GITHUB_TOKEN', process.env.GITHUB_TOKEN),
                owner: validateRequiredEnvVar('GITHUB_OWNER', process.env.GITHUB_OWNER),
                repo: validateRequiredEnvVar('GITHUB_REPO', process.env.GITHUB_REPO),
            };
        }

        // Optional Linear configuration
        let linear: LinearConfig | undefined;
        if (process.env.LINEAR_API_TOKEN) {
            linear = {
                apiToken: validateRequiredEnvVar('LINEAR_API_TOKEN', process.env.LINEAR_API_TOKEN),
                teamId: validateRequiredEnvVar('LINEAR_TEAM_ID', process.env.LINEAR_TEAM_ID),
            };
        }

        // Optional webhook configuration
        let webhook: WebhookConfig | undefined;
        if (process.env.WEBHOOK_SECRET) {
            webhook = {
                secret: validateRequiredEnvVar('WEBHOOK_SECRET', process.env.WEBHOOK_SECRET),
                port: parseInt(process.env.WEBHOOK_PORT || '3000', 10),
            };
        }

        // Validate that at least one issue tracker is configured
        if (!github && !linear) {
            console.warn('Warning: Neither GitHub nor Linear configuration found. Issue creation will be disabled.');
        }

        const config: EnvironmentConfig = {
            nodeEnv: (process.env.NODE_ENV as any) || 'development',
            logLevel: (process.env.LOG_LEVEL as any) || 'info',
            appStoreConnect,
            github,
            linear,
            webhook,
        };

        return config;
    } catch (error) {
        console.error('Environment configuration error:', error);
        throw new Error(`Failed to load environment configuration: ${error}`);
    }
}

/**
 * Global configuration instance
 * Loaded once and cached for the application lifetime
 */
let _cachedConfig: EnvironmentConfig | null = null;

export function getConfig(): EnvironmentConfig {
    if (!_cachedConfig) {
        _cachedConfig = loadEnvironmentConfig();
    }
    return _cachedConfig;
}

/**
 * Clears the cached configuration (useful for testing)
 */
export function clearConfigCache(): void {
    _cachedConfig = null;
} 