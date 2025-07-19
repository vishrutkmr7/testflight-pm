/**
 * TestFlight API Client
 * Secure utility for fetching TestFlight crash reports, screenshots, and feedback
 */

import { getAuthInstance } from './app-store-connect-auth.js';
import { getConfig } from '../config/environment.js';
import type {
    TestFlightCrashReport,
    TestFlightScreenshotFeedback,
    TestFlightApiResponse,
    TestFlightQueryParams,
    TestFlightErrorResponse,
    ProcessedFeedbackData,
} from '../../types/testflight.js';

export interface RateLimitInfo {
    remaining: number;
    reset: Date;
    limit: number;
}

export interface ApiRequestOptions {
    retries?: number;
    retryDelay?: number;
    timeout?: number;
}

/**
 * TestFlight API Client with rate limiting, retry logic, and secure authentication
 */
export class TestFlightClient {
    private readonly baseUrl = 'https://api.appstoreconnect.apple.com/v1';
    private readonly defaultTimeout = 30000; // 30 seconds
    private readonly defaultRetries = 3;
    private readonly defaultRetryDelay = 1000; // 1 second

    private rateLimitInfo: RateLimitInfo | null = null;

    /**
     * Fetches crash reports for the configured app
     */
    public async getCrashReports(params?: TestFlightQueryParams): Promise<TestFlightCrashReport[]> {
        const queryParams = {
            limit: 50,
            sort: '-submittedAt',
            ...params,
        };

        const response = await this.makeApiRequest<TestFlightApiResponse<TestFlightCrashReport>>(
            '/betaFeedbackCrashSubmissions',
            queryParams
        );

        return response.data;
    }

    /**
     * Fetches screenshot feedback for the configured app
     */
    public async getScreenshotFeedback(params?: TestFlightQueryParams): Promise<TestFlightScreenshotFeedback[]> {
        const queryParams = {
            limit: 50,
            sort: '-submittedAt',
            ...params,
        };

        const response = await this.makeApiRequest<TestFlightApiResponse<TestFlightScreenshotFeedback>>(
            '/betaFeedbackScreenshotSubmissions',
            queryParams
        );

        return response.data;
    }

    /**
     * Fetches all feedback (crashes and screenshots) and returns processed data
     */
    public async getAllFeedback(params?: TestFlightQueryParams): Promise<ProcessedFeedbackData[]> {
        try {
            const [crashes, screenshots] = await Promise.all([
                this.getCrashReports(params),
                this.getScreenshotFeedback(params),
            ]);

            const processedData: ProcessedFeedbackData[] = [];

            // Process crash reports
            for (const crash of crashes) {
                processedData.push(this.processCrashReport(crash));
            }

            // Process screenshot feedback
            for (const screenshot of screenshots) {
                processedData.push(this.processScreenshotFeedback(screenshot));
            }

            // Sort by submission date (newest first)
            processedData.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

            return processedData;
        } catch (error) {
            throw new Error(`Failed to fetch all feedback: ${error}`);
        }
    }

    /**
     * Fetches recent feedback since a specific date
     */
    public async getRecentFeedback(since: Date): Promise<ProcessedFeedbackData[]> {
        const isoDate = since.toISOString();

        const params: TestFlightQueryParams = {
            filter: {
                submittedAt: `>${isoDate}`,
            },
            limit: 100,
        };

        return await this.getAllFeedback(params);
    }

    /**
     * Downloads crash logs from the provided URLs
     */
    public async downloadCrashLogs(crashReport: TestFlightCrashReport): Promise<string[]> {
        const logs: string[] = [];

        for (const logInfo of crashReport.attributes.crashLogs) {
            try {
                // Check if URL hasn't expired
                const expiresAt = new Date(logInfo.expiresAt);
                if (expiresAt <= new Date()) {
                    console.warn(`Crash log URL expired: ${logInfo.url}`);
                    continue;
                }

                const response = await fetch(logInfo.url, {
                    headers: {
                        'User-Agent': 'TestFlight-PM/1.0',
                    },
                    signal: AbortSignal.timeout(this.defaultTimeout),
                });

                if (!response.ok) {
                    console.warn(`Failed to download crash log: ${response.status} ${response.statusText}`);
                    continue;
                }

                const logContent = await response.text();
                logs.push(logContent);
            } catch (error) {
                console.warn(`Error downloading crash log from ${logInfo.url}:`, error);
            }
        }

        return logs;
    }

    /**
     * Downloads screenshots from the provided URLs
     */
    public async downloadScreenshots(screenshotFeedback: TestFlightScreenshotFeedback): Promise<Uint8Array[]> {
        const images: Uint8Array[] = [];

        for (const imageInfo of screenshotFeedback.attributes.screenshots) {
            try {
                // Check if URL hasn't expired
                const expiresAt = new Date(imageInfo.expiresAt);
                if (expiresAt <= new Date()) {
                    console.warn(`Screenshot URL expired: ${imageInfo.url}`);
                    continue;
                }

                const response = await fetch(imageInfo.url, {
                    headers: {
                        'User-Agent': 'TestFlight-PM/1.0',
                    },
                    signal: AbortSignal.timeout(this.defaultTimeout),
                });

                if (!response.ok) {
                    console.warn(`Failed to download screenshot: ${response.status} ${response.statusText}`);
                    continue;
                }

                const imageData = new Uint8Array(await response.arrayBuffer());
                images.push(imageData);
            } catch (error) {
                console.warn(`Error downloading screenshot from ${imageInfo.url}:`, error);
            }
        }

        return images;
    }

    /**
     * Gets current rate limit information
     */
    public getRateLimitInfo(): RateLimitInfo | null {
        return this.rateLimitInfo;
    }

    /**
     * Makes an authenticated API request with retry logic and rate limiting
     */
    private async makeApiRequest<T>(
        endpoint: string,
        params?: TestFlightQueryParams,
        options?: ApiRequestOptions
    ): Promise<T> {
        const { retries = this.defaultRetries, retryDelay = this.defaultRetryDelay, timeout = this.defaultTimeout } = options || {};

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                // Wait for rate limit reset if necessary
                await this.waitForRateLimit();

                // Get valid authentication token
                const authInstance = getAuthInstance();
                const token = await authInstance.getValidToken();

                // Build URL with query parameters
                const url = this.buildUrl(endpoint, params);

                // Make the request
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json',
                        'User-Agent': 'TestFlight-PM/1.0',
                    },
                    signal: AbortSignal.timeout(timeout),
                });

                // Update rate limit info
                this.updateRateLimitInfo(response);

                // Handle error responses
                if (!response.ok) {
                    const errorText = await response.text();
                    let errorData: TestFlightErrorResponse;

                    try {
                        errorData = JSON.parse(errorText);
                    } catch {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    const errorMessage = errorData.errors.map(e => `${e.title}: ${e.detail}`).join('; ');
                    throw new Error(`API Error: ${errorMessage}`);
                }

                // Parse and return response
                const data = await response.json();
                return data as T;

            } catch (error) {
                lastError = error as Error;

                // Don't retry on authentication errors
                if (lastError.message.includes('authentication') || lastError.message.includes('unauthorized')) {
                    throw lastError;
                }

                // Don't retry on the last attempt
                if (attempt === retries) {
                    break;
                }

                // Wait before retrying (exponential backoff)
                const delay = retryDelay * Math.pow(2, attempt);
                await this.sleep(delay);
            }
        }

        throw new Error(`Request failed after ${retries + 1} attempts: ${lastError?.message}`);
    }

    /**
     * Builds a complete URL with query parameters
     */
    private buildUrl(endpoint: string, params?: TestFlightQueryParams): string {
        const url = new URL(endpoint, this.baseUrl);

        if (params) {
            if (params.limit) url.searchParams.set('limit', params.limit.toString());
            if (params.sort) url.searchParams.set('sort', params.sort);
            if (params.include) url.searchParams.set('include', params.include);

            // Add filter parameters
            if (params.filter) {
                for (const [key, value] of Object.entries(params.filter)) {
                    url.searchParams.set(`filter[${key}]`, value);
                }
            }

            // Add fields parameters
            if (params.fields) {
                for (const [key, value] of Object.entries(params.fields)) {
                    url.searchParams.set(`fields[${key}]`, value);
                }
            }
        }

        return url.toString();
    }

    /**
     * Updates rate limit information from response headers
     */
    private updateRateLimitInfo(response: Response): void {
        const remaining = response.headers.get('X-RateLimit-Remaining');
        const reset = response.headers.get('X-RateLimit-Reset');
        const limit = response.headers.get('X-RateLimit-Limit');

        if (remaining && reset && limit) {
            this.rateLimitInfo = {
                remaining: parseInt(remaining, 10),
                reset: new Date(parseInt(reset, 10) * 1000),
                limit: parseInt(limit, 10),
            };
        }
    }

    /**
     * Waits if we're close to hitting rate limits
     */
    private async waitForRateLimit(): Promise<void> {
        if (!this.rateLimitInfo) return;

        // If we have very few requests remaining, wait until reset
        if (this.rateLimitInfo.remaining <= 5) {
            const now = new Date();
            const waitTime = this.rateLimitInfo.reset.getTime() - now.getTime();

            if (waitTime > 0) {
                console.log(`Rate limit approaching. Waiting ${Math.ceil(waitTime / 1000)} seconds...`);
                await this.sleep(waitTime);
            }
        }
    }

    /**
     * Processes raw crash report data into standardized format
     */
    private processCrashReport(crash: TestFlightCrashReport): ProcessedFeedbackData {
        return {
            id: crash.id,
            type: 'crash',
            submittedAt: new Date(crash.attributes.submittedAt),
            appVersion: crash.attributes.appVersion,
            buildNumber: crash.attributes.buildNumber,
            deviceInfo: {
                family: crash.attributes.deviceFamily,
                model: crash.attributes.deviceModel,
                osVersion: crash.attributes.osVersion,
                locale: crash.attributes.locale,
            },
            bundleId: crash.attributes.bundleId,
            crashData: {
                trace: crash.attributes.crashTrace,
                type: crash.attributes.crashType,
                exceptionType: crash.attributes.exceptionType,
                exceptionMessage: crash.attributes.exceptionMessage,
                logs: crash.attributes.crashLogs.map(log => ({
                    url: log.url,
                    expiresAt: new Date(log.expiresAt),
                })),
            },
        };
    }

    /**
     * Processes raw screenshot feedback data into standardized format
     */
    private processScreenshotFeedback(screenshot: TestFlightScreenshotFeedback): ProcessedFeedbackData {
        return {
            id: screenshot.id,
            type: 'screenshot',
            submittedAt: new Date(screenshot.attributes.submittedAt),
            appVersion: screenshot.attributes.appVersion,
            buildNumber: screenshot.attributes.buildNumber,
            deviceInfo: {
                family: screenshot.attributes.deviceFamily,
                model: screenshot.attributes.deviceModel,
                osVersion: screenshot.attributes.osVersion,
                locale: screenshot.attributes.locale,
            },
            bundleId: screenshot.attributes.bundleId,
            screenshotData: {
                text: screenshot.attributes.feedbackText,
                images: screenshot.attributes.screenshots.map(img => ({
                    url: img.url,
                    fileName: img.fileName,
                    fileSize: img.fileSize,
                    expiresAt: new Date(img.expiresAt),
                })),
                annotations: screenshot.attributes.annotations,
            },
        };
    }

    /**
     * Utility function for sleeping/waiting
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Global client instance
 * Singleton pattern for API client management
 */
let _clientInstance: TestFlightClient | null = null;

export function getTestFlightClient(): TestFlightClient {
    if (!_clientInstance) {
        _clientInstance = new TestFlightClient();
    }
    return _clientInstance;
}

/**
 * Clears the global client instance (useful for testing)
 */
export function clearClientInstance(): void {
    _clientInstance = null;
} 