/**
 * TestFlight API Client
 * Secure utility for fetching TestFlight crash reports, screenshots, and feedback
 */

import type {
	AppBetaFeedbackCrashSubmissionsResponse,
	AppBetaFeedbackScreenshotSubmissionsResponse,
	CrashLogRelationshipsResponse,
	CrashLogResponse,
	DetailedCrashSubmissionResponse,
	DetailedScreenshotSubmissionResponse,
	DetailedTestFlightCrashReport,
	DetailedTestFlightScreenshotFeedback,
	EnhancedScreenshotImage,
	ProcessedFeedbackData,
	TestFlightApp,
	TestFlightAppsResponse,
	TestFlightCrashLog,
	TestFlightCrashReport,
	TestFlightErrorResponse,
	TestFlightQueryParams,
	TestFlightScreenshotFeedback,
} from "../../types/testflight.js";
import {
	API_ENDPOINTS,
	DEFAULT_HTTP_CONFIG,
	DEFAULT_TESTFLIGHT_CONFIG,
} from "../config/index.js";
import { getAuthInstance } from "./app-store-connect-auth.js";

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
	private readonly baseUrl = API_ENDPOINTS.APP_STORE_CONNECT;
	private readonly defaultTimeout = DEFAULT_HTTP_CONFIG.timeout;
	private readonly defaultRetries = DEFAULT_HTTP_CONFIG.retries;
	private readonly defaultRetryDelay = DEFAULT_HTTP_CONFIG.retryDelay;
	private readonly appId: string | null;

	private rateLimitInfo: RateLimitInfo | null = null;

	constructor() {
		// Get app ID from configuration if available
		const { getConfiguration } = require("../config/index.js");
		const config = getConfiguration();
		this.appId = config.appStoreConnect.appId || null;

		// Note: appId is no longer required in constructor since we can resolve from bundle ID
	}

	/**
	 * Fetches screenshot feedback for a specific app (legacy method - use getEnhancedRecentFeedback instead)
	 * @deprecated Use getAppScreenshotFeedback or getEnhancedRecentFeedback instead
	 */
	public async getScreenshotFeedback(
		params?: TestFlightQueryParams,
	): Promise<TestFlightScreenshotFeedback[]> {
		if (!this.appId) {
			throw new Error("App ID is required. Use getAppScreenshotFeedback with explicit app ID instead.");
		}
		return this.getAppScreenshotFeedback(this.appId, params);
	}

	/**
	 * Gets screenshot submissions for a specific app using Apple's app-specific endpoint
	 * Uses /apps/{id}/betaFeedbackScreenshotSubmissions
	 */
	public async getAppScreenshotSubmissions(
		appId: string,
		params?: TestFlightQueryParams,
	): Promise<TestFlightScreenshotFeedback[]> {
		const queryParams = {
			limit: DEFAULT_TESTFLIGHT_CONFIG.DEFAULT_LIMIT,
			sort: DEFAULT_TESTFLIGHT_CONFIG.DEFAULT_SORT,
			...params,
		};

		const response = await this.makeApiRequest<AppBetaFeedbackScreenshotSubmissionsResponse>(
			`/apps/${appId}/betaFeedbackScreenshotSubmissions`,
			queryParams,
		);

		return response.data;
	}

	/**
	 * Gets detailed information about a specific screenshot submission
	 * Uses /betaFeedbackScreenshotSubmissions/{id}
	 */
	public async getDetailedScreenshotSubmission(
		screenshotId: string,
		params?: TestFlightQueryParams,
	): Promise<DetailedTestFlightScreenshotFeedback> {
		const response = await this.makeApiRequest<DetailedScreenshotSubmissionResponse>(
			`/betaFeedbackScreenshotSubmissions/${screenshotId}`,
			params,
		);

		return response.data;
	}

	/**
	 * Gets screenshot feedback for a specific app (legacy method - use getAppScreenshotSubmissions instead)
	 * @deprecated Use getAppScreenshotSubmissions for better performance and proper API endpoint
	 */
	public async getAppScreenshotFeedback(
		appId: string,
		params?: TestFlightQueryParams,
	): Promise<TestFlightScreenshotFeedback[]> {
		return this.getAppScreenshotSubmissions(appId, params);
	}

	/**
	 * Downloads crash logs from the provided URLs
	 */
	public async downloadCrashLogs(
		crashReport: TestFlightCrashReport,
	): Promise<string[]> {
		const logs: string[] = [];

		// Check if crashLogs exists before iterating
		const { crashLogs } = crashReport.attributes;
		if (!crashLogs || crashLogs.length === 0) {
			return logs;
		}

		for (const logInfo of crashLogs) {
			try {
				// Check if URL hasn't expired
				const expiresAt = new Date(logInfo.expiresAt);
				if (expiresAt <= new Date()) {
					console.warn(`Crash log URL expired: ${logInfo.url}`);
					continue;
				}

				const response = await fetch(logInfo.url, {
					headers: {
						"User-Agent": "TestFlight-PM/1.0",
					},
					signal: AbortSignal.timeout(this.defaultTimeout),
				});

				if (!response.ok) {
					console.warn(
						`Failed to download crash log: ${response.status} ${response.statusText}`,
					);
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
	 * Downloads screenshots from the provided URLs with enhanced error handling
	 * @deprecated Use downloadEnhancedScreenshots for better performance and metadata
	 */
	public async downloadScreenshots(
		screenshotFeedback: TestFlightScreenshotFeedback,
	): Promise<Uint8Array[]> {
		const { screenshots } = screenshotFeedback.attributes;
		return await this.downloadScreenshotImages(screenshots);
	}

	/**
	 * Downloads enhanced screenshots with metadata and validation
	 */
	public async downloadEnhancedScreenshots(
		screenshotFeedback: DetailedTestFlightScreenshotFeedback,
	): Promise<{ data: Uint8Array; metadata: EnhancedScreenshotImage }[]> {
		const results: { data: Uint8Array; metadata: EnhancedScreenshotImage }[] = [];

		const enhancedImages = await this.processEnhancedScreenshotImages(
			screenshotFeedback.attributes.screenshots
		);

		for (const imageMetadata of enhancedImages) {
			try {
				const imageData = await this.downloadSingleScreenshotImage(imageMetadata);
				if (imageData) {
					results.push({
						data: imageData,
						metadata: imageMetadata,
					});
				}
			} catch (error) {
				console.warn(
					`Error downloading enhanced screenshot ${imageMetadata.fileName}:`,
					error,
				);
			}
		}

		return results;
	}

	/**
	 * Downloads screenshot images from URL array (DRY helper method)
	 */
	private async downloadScreenshotImages(
		screenshots: TestFlightScreenshotFeedback["attributes"]["screenshots"],
	): Promise<Uint8Array[]> {
		const images: Uint8Array[] = [];

		for (const imageInfo of screenshots) {
			try {
				const imageData = await this.downloadSingleScreenshotImage({
					url: imageInfo.url,
					fileName: imageInfo.fileName,
					fileSize: imageInfo.fileSize,
					expiresAt: new Date(imageInfo.expiresAt),
				});

				if (imageData) {
					images.push(imageData);
				}
			} catch (error) {
				console.warn(
					`Error downloading screenshot from ${imageInfo.url}:`,
					error,
				);
			}
		}

		return images;
	}

	/**
	 * Downloads a single screenshot image with validation (Single Responsibility)
	 */
	private async downloadSingleScreenshotImage(
		imageInfo: { url: string; fileName: string; fileSize: number; expiresAt: Date },
	): Promise<Uint8Array | null> {
		// Check if URL hasn't expired
		if (imageInfo.expiresAt <= new Date()) {
			console.warn(`Screenshot URL expired: ${imageInfo.url}`);
			return null;
		}

		const response = await fetch(imageInfo.url, {
			headers: {
				"User-Agent": "TestFlight-PM/1.0",
			},
			signal: AbortSignal.timeout(this.defaultTimeout),
		});

		if (!response.ok) {
			console.warn(
				`Failed to download screenshot: ${response.status} ${response.statusText}`,
			);
			return null;
		}

		const imageData = new Uint8Array(await response.arrayBuffer());

		// Validate file size if specified
		if (imageInfo.fileSize > 0 && imageData.length !== imageInfo.fileSize) {
			console.warn(
				`Screenshot size mismatch for ${imageInfo.fileName}: expected ${imageInfo.fileSize}, got ${imageData.length}`,
			);
		}

		return imageData;
	}

	/**
	 * Gets current rate limit information
	 */
	public getRateLimitInfo(): RateLimitInfo | null {
		return this.rateLimitInfo;
	}

	/**
	 * Gets the configured app ID for health checking
	 */
	public getConfiguredAppId(): string | null {
		return this.appId || null;
	}

	/**
	 * Tests authentication without making a full API request
	 * Used by health checkers to verify credentials
	 */
	public async testAuthentication(): Promise<boolean> {
		try {
			const authInstance = getAuthInstance();
			await authInstance.getValidToken();
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Lists all apps in the App Store Connect account
	 */
	public async getApps(params?: TestFlightQueryParams): Promise<TestFlightApp[]> {
		const queryParams = {
			limit: DEFAULT_TESTFLIGHT_CONFIG.DEFAULT_LIMIT,
			...params,
		};

		const response = await this.makeApiRequest<TestFlightAppsResponse>(
			"/apps",
			queryParams,
		);

		return response.data;
	}

	/**
	 * Finds an app by its bundle ID using reliable unfiltered search + manual matching
	 * Note: Bundle ID filtering via API query parameters appears to be unreliable,
	 * so we fetch all apps and filter manually for better reliability
	 */
	public async findAppByBundleId(bundleId: string): Promise<TestFlightApp | null> {
		console.log(`🔍 Searching for app with bundle ID: ${bundleId}`);

		try {
			// First try the filtered approach (may fail with some API key configurations)
			const params: TestFlightQueryParams = {
				filter: {
					bundleId: bundleId,
				},
				limit: 1,
			};

			console.log(`🔄 Attempting filtered search first...`);
			const filteredApps = await this.getApps(params);

			if (filteredApps.length > 0 && filteredApps[0]) {
				console.log(`✅ Filtered search successful: ${filteredApps[0].attributes.name}`);
				return filteredApps[0];
			}

			console.log(`⚠️ Filtered search returned no results, falling back to manual search`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.log(`⚠️ Filtered search failed (${errorMessage}), falling back to manual search`);
		}

		// Fallback: Get all apps and search manually (more reliable)
		console.log(`🔄 Performing manual search across all apps...`);
		try {
			const allApps = await this.getApps({ limit: 200 }); // Increase limit to catch more apps

			console.log(`📋 Searching through ${allApps.length} apps for bundle ID: ${bundleId}`);

			const matchingApp = allApps.find(app =>
				app.attributes.bundleId === bundleId
			);

			if (matchingApp) {
				console.log(`✅ Manual search successful: ${matchingApp.attributes.name} (${matchingApp.id})`);
				return matchingApp;
			}

			console.log(`❌ No app found with bundle ID: ${bundleId}`);
			console.log(`📋 Available apps:`);
			allApps.forEach(app => {
				console.log(`  - ${app.attributes.name}: ${app.attributes.bundleId} (${app.id})`);
			});

			return null;
		} catch (fallbackError) {
			const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
			console.error(`❌ Manual search also failed: ${fallbackErrorMessage}`);
			throw fallbackError;
		}
	}

	/**
	 * Gets a specific app by its ID for validation purposes
	 */
	public async getAppById(appId: string): Promise<TestFlightApp> {
		const response = await this.makeApiRequest<{ data: TestFlightApp }>(
			`/apps/${appId}`,
			{
				fields: {
					apps: "bundleId,name,sku,primaryLocale"
				}
			}
		);

		return response.data;
	}

	/**
	 * Gets crash submissions for a specific app
	 */
	public async getAppCrashSubmissions(
		appId: string,
		params?: TestFlightQueryParams,
	): Promise<TestFlightCrashReport[]> {
		const queryParams = {
			limit: DEFAULT_TESTFLIGHT_CONFIG.DEFAULT_LIMIT,
			sort: DEFAULT_TESTFLIGHT_CONFIG.DEFAULT_SORT,
			...params,
		};

		const response = await this.makeApiRequest<AppBetaFeedbackCrashSubmissionsResponse>(
			`/apps/${appId}/betaFeedbackCrashSubmissions`,
			queryParams,
		);

		return response.data;
	}

	/**
	 * Gets detailed information about a specific crash submission
	 */
	public async getDetailedCrashSubmission(
		crashId: string,
		params?: TestFlightQueryParams,
	): Promise<DetailedTestFlightCrashReport> {
		const response = await this.makeApiRequest<DetailedCrashSubmissionResponse>(
			`/betaFeedbackCrashSubmissions/${crashId}`,
			params,
		);

		return response.data;
	}

	/**
	 * Gets the actual crash log content for a crash submission
	 */
	public async getCrashLog(
		crashId: string,
		params?: TestFlightQueryParams,
	): Promise<TestFlightCrashLog> {
		const response = await this.makeApiRequest<CrashLogResponse>(
			`/betaFeedbackCrashSubmissions/${crashId}/crashLog`,
			params,
		);

		return response.data;
	}

	/**
	 * Gets crash log relationships for a crash submission
	 */
	public async getCrashLogRelationships(
		crashId: string,
	): Promise<CrashLogRelationshipsResponse> {
		return await this.makeApiRequest<CrashLogRelationshipsResponse>(
			`/betaFeedbackCrashSubmissions/${crashId}/relationships/crashLog`,
		);
	}

	/**
	 * Downloads the actual crash log content from the download URL
	 */
	public async downloadDetailedCrashLog(crashLog: TestFlightCrashLog): Promise<string | null> {
		try {
			// Check if URL hasn't expired
			const expiresAt = new Date(crashLog.attributes.expiresAt);
			if (expiresAt <= new Date()) {
				console.warn(`Crash log download URL expired: ${crashLog.attributes.downloadUrl}`);
				return null;
			}

			const response = await fetch(crashLog.attributes.downloadUrl, {
				headers: {
					"User-Agent": "TestFlight-PM/1.0",
				},
				signal: AbortSignal.timeout(this.defaultTimeout),
			});

			if (!response.ok) {
				console.warn(
					`Failed to download detailed crash log: ${response.status} ${response.statusText}`,
				);
				return null;
			}

			return await response.text();
		} catch (error) {
			console.warn(`Error downloading detailed crash log:`, error);
			return null;
		}
	}

	/**
	 * Resolves and validates app ID using App Store Connect API as single source of truth
	 * Ensures consistency between provided app_id and bundle_id when both are available
	 * Enhanced with better error handling and user guidance
	 */
	public async resolveAppId(bundleId?: string): Promise<string> {
		const providedAppId = this.appId;
		const providedBundleId = bundleId;

		// Case 1: Both app_id and bundle_id provided - validate consistency
		if (providedAppId && providedBundleId) {
			console.log(`🔍 Validating consistency between app_id: ${providedAppId} and bundle_id: ${providedBundleId}`);

			try {
				// Use API as single source of truth - fetch app by bundle ID
				const appFromBundleId = await this.findAppByBundleId(providedBundleId);

				if (!appFromBundleId) {
					throw new Error(
						`Bundle ID '${providedBundleId}' not found in App Store Connect. Please verify the bundle ID is correct and exists.`
					);
				}

				// Validate that the provided app_id matches the API response
				if (appFromBundleId.id !== providedAppId) {
					console.warn(`⚠️ Inconsistency detected! Provided app_id: ${providedAppId} does not match API app_id: ${appFromBundleId.id} for bundle_id: ${providedBundleId}`);
					console.warn(`📋 App Store Connect API shows: ${appFromBundleId.attributes.name} (${appFromBundleId.attributes.bundleId})`);
					console.warn(`🔧 Using App Store Connect API as authoritative source: ${appFromBundleId.id}`);

					// Use API response as authoritative (single source of truth)
					return appFromBundleId.id;
				}

				console.log(`✅ Validated consistency: app_id ${providedAppId} matches bundle_id ${providedBundleId}`);
				return providedAppId;

			} catch (error) {
				// Enhanced error handling with specific guidance
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.warn(`⚠️ Bundle ID validation failed: ${errorMessage}`);
				console.log(`🔍 Attempting to validate app_id: ${providedAppId} directly`);

				try {
					// Fetch app by app_id to validate it exists and get its bundle_id
					const appFromAppId = await this.getAppById(providedAppId);

					if (appFromAppId.attributes.bundleId !== providedBundleId) {
						throw new Error(
							`Inconsistent data: app_id '${providedAppId}' has bundle_id '${appFromAppId.attributes.bundleId}' but you provided bundle_id '${providedBundleId}'. Please check your configuration.`
						);
					}

					console.log(`✅ Validated app_id ${providedAppId} exists and matches expected bundle_id`);
					return providedAppId;

				} catch (appIdError) {
					const appIdErrorMessage = appIdError instanceof Error ? appIdError.message : String(appIdError);
					throw new Error(
						`App validation failed - neither app_id '${providedAppId}' nor bundle_id '${providedBundleId}' could be validated. Bundle ID Error: ${errorMessage}; App ID Error: ${appIdErrorMessage}`
					);
				}
			}
		}

		// Case 2: Only app_id provided - validate it exists
		if (providedAppId && !providedBundleId) {
			console.log(`🔍 Validating app_id: ${providedAppId}`);

			try {
				const app = await this.getAppById(providedAppId);
				console.log(`✅ Validated app_id ${providedAppId} - ${app.attributes.name} (${app.attributes.bundleId})`);
				return providedAppId;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				throw new Error(
					`App ID '${providedAppId}' not found in App Store Connect. Error: ${errorMessage}`
				);
			}
		}

		// Case 3: Only bundle_id provided - resolve app_id
		if (!providedAppId && providedBundleId) {
			console.log(`🔍 Resolving app_id from bundle_id: ${providedBundleId}`);

			try {
				const app = await this.findAppByBundleId(providedBundleId);
				if (!app) {
					throw new Error(
						`No app found with bundle ID '${providedBundleId}' in your App Store Connect account.`
					);
				}

				console.log(`✅ Resolved app_id ${app.id} from bundle_id ${providedBundleId} - ${app.attributes.name}`);
				return app.id;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				throw new Error(
					`Failed to resolve app_id from bundle_id '${providedBundleId}'. Error: ${errorMessage}`
				);
			}
		}

		// Case 4: Neither provided
		throw new Error(
			"Either app_id or testflight_bundle_id must be provided. Please set TESTFLIGHT_APP_ID or TESTFLIGHT_BUNDLE_ID environment variables, or provide app_id or testflight_bundle_id inputs."
		);
	}

	/**
	 * Enhanced method to get recent feedback with detailed crash logs
	 * This is the main method to use for fetching TestFlight feedback
	 */
	public async getEnhancedRecentFeedback(
		since: Date,
		bundleId?: string,
	): Promise<ProcessedFeedbackData[]> {
		// Resolve app ID
		const resolvedAppId = await this.resolveAppId(bundleId);

		const isoDate = since.toISOString();

		// Get crash submissions and screenshot feedback in parallel
		const [crashes, screenshots] = await Promise.all([
			this.getAppCrashSubmissions(resolvedAppId, {
				filter: {
					submittedAt: `>${isoDate}`,
				},
				limit: 100,
			}),
			this.getAppScreenshotSubmissions(resolvedAppId, {
				filter: {
					submittedAt: `>${isoDate}`,
				},
				limit: 100,
			}),
		]);

		const processedData: ProcessedFeedbackData[] = [];

		// Process crash reports with enhanced details
		await this.processCrashReportsWithDetails(crashes, processedData);

		// Process screenshot feedback  
		await this.processScreenshotFeedbackData(screenshots, processedData);

		// Sort by submission date (newest first)
		processedData.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

		return processedData;
	}

	/**
	 * Legacy method - use getEnhancedRecentFeedback instead
	 * @deprecated Use getEnhancedRecentFeedback for better performance and detailed crash logs
	 */
	public async getRecentFeedback(since: Date): Promise<ProcessedFeedbackData[]> {
		return this.getEnhancedRecentFeedback(since);
	}

	/**
	 * Makes an authenticated API request with enhanced retry logic and rate limiting
	 * Includes better error categorization and exponential backoff
	 */
	private async makeApiRequest<T>(
		endpoint: string,
		params?: TestFlightQueryParams,
		options?: ApiRequestOptions,
	): Promise<T> {
		const {
			retries = this.defaultRetries,
			retryDelay = this.defaultRetryDelay,
			timeout = this.defaultTimeout,
		} = options || {};

		let lastError: Error | null = null;
		let lastStatusCode: number | null = null;

		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				// Wait for rate limit reset if necessary
				await this.waitForRateLimit();

				// Get valid authentication token
				const authInstance = getAuthInstance();
				const token = await authInstance.getValidToken();

				// Build URL with query parameters
				const url = this.buildUrl(endpoint, params);

				console.log(`🔗 API Request (attempt ${attempt + 1}/${retries + 1}): ${url.toString()}`);

				// Make the request
				const response = await fetch(url, {
					method: "GET",
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: "application/json",
						"User-Agent": "TestFlight-PM/1.0",
					},
					signal: AbortSignal.timeout(timeout),
				});

				lastStatusCode = response.status;

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

					const errorMessage = errorData.errors
						.map((e) => `${e.title}: ${e.detail}`)
						.join("; ");

					// Enhanced error handling with retry logic
					const apiError = new Error(`API Error: ${errorMessage}`);

					// Determine if this is a retryable error
					const isRetryable = this.isRetryableError(response.status, errorMessage);

					if (!isRetryable) {
						console.log(`❌ Non-retryable error (${response.status}): ${errorMessage}`);
						throw apiError;
					}

					console.log(`⚠️ Retryable error (${response.status}): ${errorMessage}`);
					throw apiError;
				}

				// Parse and return response
				const data = await response.json();
				console.log(`✅ API Request successful (attempt ${attempt + 1})`);
				return data as T;
			} catch (error) {
				lastError = error as Error;

				// Don't retry on authentication errors (401, 403)
				if (
					lastError.message.includes("authentication") ||
					lastError.message.includes("unauthorized") ||
					lastStatusCode === 401 ||
					lastStatusCode === 403
				) {
					console.log(`❌ Authentication error - not retrying: ${lastError.message}`);
					throw lastError;
				}

				// Don't retry on client errors (400, 404) - these are configuration issues
				if (lastStatusCode && lastStatusCode >= 400 && lastStatusCode < 500 && lastStatusCode !== 429) {
					console.log(`❌ Client error (${lastStatusCode}) - not retrying: ${lastError.message}`);
					throw lastError;
				}

				// Don't retry on the last attempt
				if (attempt === retries) {
					console.log(`❌ Final attempt failed: ${lastError.message}`);
					break;
				}

				// Calculate delay with exponential backoff and jitter
				const baseDelay = retryDelay * Math.pow(2, attempt);
				const jitter = Math.random() * 0.1 * baseDelay; // Add up to 10% jitter
				const delay = Math.floor(baseDelay + jitter);

				console.log(`🔄 Retrying in ${delay}ms (attempt ${attempt + 1}/${retries + 1}): ${lastError.message}`);
				await this.sleep(delay);
			}
		}

		// Enhanced final error message
		const finalError = new Error(
			`Request failed after ${retries + 1} attempts: ${lastError?.message}${lastStatusCode ? ` (HTTP ${lastStatusCode})` : ''}`
		);

		// Add additional context for common issues
		if (lastStatusCode === 404 || lastError?.message.includes("The specified resource does not exist")) {
			console.error(`🔍 This appears to be a resource not found error. Check your app_id/bundle_id and API key permissions.`);
		}

		throw finalError;
	}

	/**
	 * Determines if an error is retryable based on status code and error message
	 */
	private isRetryableError(statusCode: number, errorMessage: string): boolean {
		// Rate limiting - always retry
		if (statusCode === 429) {
			return true;
		}

		// Server errors - retry
		if (statusCode >= 500) {
			return true;
		}

		// Timeout or network errors - retry
		if (errorMessage.includes("timeout") || errorMessage.includes("network")) {
			return true;
		}

		// Temporary Apple API issues (sometimes happens intermittently)
		if (errorMessage.includes("temporarily unavailable") ||
			errorMessage.includes("service unavailable")) {
			return true;
		}

		// Don't retry client errors (400-499, except 429)
		if (statusCode >= 400 && statusCode < 500) {
			return false;
		}

		// Default to not retrying unknown errors
		return false;
	}

	/**
	 * Builds a complete URL with query parameters
	 * Properly handles endpoints that start with "/" to avoid replacing the base path
	 */
	private buildUrl(endpoint: string, params?: TestFlightQueryParams): string {
		// Fix: If endpoint starts with "/", we need to properly append it to baseUrl
		// new URL("/apps", "https://api.appstoreconnect.apple.com/v1") would incorrectly become 
		// "https://api.appstoreconnect.apple.com/apps" (losing /v1)
		// Instead, we should get "https://api.appstoreconnect.apple.com/v1/apps"
		let fullUrl: string;
		if (endpoint.startsWith('/')) {
			// Append endpoint to baseUrl, ensuring no double slashes
			fullUrl = this.baseUrl.endsWith('/')
				? this.baseUrl + endpoint.slice(1)
				: this.baseUrl + endpoint;
		} else {
			// Use standard URL constructor for relative paths
			fullUrl = new URL(endpoint, this.baseUrl).toString();
		}

		const url = new URL(fullUrl);

		if (params) {
			if (params.limit) {
				url.searchParams.set("limit", params.limit.toString());
			}
			if (params.sort) {
				url.searchParams.set("sort", params.sort);
			}
			if (params.include) {
				url.searchParams.set("include", params.include);
			}

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
		const remaining = response.headers.get("X-RateLimit-Remaining");
		const reset = response.headers.get("X-RateLimit-Reset");
		const limit = response.headers.get("X-RateLimit-Limit");

		if (remaining && reset && limit) {
			this.rateLimitInfo = {
				remaining: Number.parseInt(remaining, 10),
				reset: new Date(Number.parseInt(reset, 10) * 1000),
				limit: Number.parseInt(limit, 10),
			};
		}
	}

	/**
	 * Waits if we're close to hitting rate limits
	 */
	private async waitForRateLimit(): Promise<void> {
		if (!this.rateLimitInfo) {
			return;
		}

		// If we have very few requests remaining, wait until reset
		if (this.rateLimitInfo.remaining <= 5) {
			const now = new Date();
			const waitTime = this.rateLimitInfo.reset.getTime() - now.getTime();

			if (waitTime > 0) {
				console.log(
					`Rate limit approaching. Waiting ${Math.ceil(waitTime / 1000)} seconds...`,
				);
				await this.sleep(waitTime);
			}
		}
	}

	/**
	 * Processes crash reports with enhanced details (including detailed crash logs)
	 */
	private async processCrashReportsWithDetails(
		crashes: TestFlightCrashReport[],
		processedData: ProcessedFeedbackData[],
	): Promise<void> {
		for (const crash of crashes) {
			const processedCrash = this.processCrashReport(crash);

			// Get detailed crash log content
			try {
				const crashLog = await this.getCrashLog(crash.id);
				const detailedLogContent = await this.downloadDetailedCrashLog(crashLog);

				if (detailedLogContent && processedCrash.crashData) {
					processedCrash.crashData.detailedLogs = [detailedLogContent];
				}
			} catch (error) {
				console.warn(`Failed to get detailed crash log for ${crash.id}:`, error);
			}

			processedData.push(processedCrash);
		}
	}

	/**
	 * Processes screenshot feedback data with enhanced details (including detailed screenshot info)
	 */
	private async processScreenshotFeedbackData(
		screenshots: TestFlightScreenshotFeedback[],
		processedData: ProcessedFeedbackData[],
	): Promise<void> {
		for (const screenshot of screenshots) {
			const processedScreenshot = this.processScreenshotFeedback(screenshot);

			// Get detailed screenshot submission data
			try {
				const detailedScreenshot = await this.getDetailedScreenshotSubmission(screenshot.id);

				if (processedScreenshot.screenshotData) {
					// Add enhanced screenshot information
					processedScreenshot.screenshotData.testerNotes = detailedScreenshot.attributes.testerNotes;
					processedScreenshot.screenshotData.submissionMethod = detailedScreenshot.attributes.submissionMethod;

					// Add system information if available
					processedScreenshot.screenshotData.systemInfo = {
						applicationState: detailedScreenshot.attributes.applicationState,
						memoryPressure: detailedScreenshot.attributes.memoryPressure,
						batteryLevel: detailedScreenshot.attributes.batteryLevel,
						batteryState: detailedScreenshot.attributes.batteryState,
						thermalState: detailedScreenshot.attributes.thermalState,
						diskSpaceRemaining: detailedScreenshot.attributes.diskSpaceRemaining,
					};

					// Process enhanced screenshot images if available
					if (detailedScreenshot.attributes.screenshots) {
						processedScreenshot.screenshotData.enhancedImages =
							await this.processEnhancedScreenshotImages(detailedScreenshot.attributes.screenshots);
					}
				}
			} catch (error) {
				console.warn(`Failed to get detailed screenshot submission for ${screenshot.id}:`, error);
			}

			processedData.push(processedScreenshot);
		}
	}

	/**
	 * Processes enhanced screenshot images with additional metadata
	 */
	private async processEnhancedScreenshotImages(
		screenshots: TestFlightScreenshotFeedback["attributes"]["screenshots"],
	): Promise<EnhancedScreenshotImage[]> {
		return screenshots.map((screenshot, index) => ({
			url: screenshot.url,
			fileName: screenshot.fileName,
			fileSize: screenshot.fileSize,
			expiresAt: new Date(screenshot.expiresAt),
			// Additional enhanced properties (would be available from Apple's detailed API)
			imageFormat: this.extractImageFormat(screenshot.fileName),
			imageScale: 1.0, // Default scale, could be enhanced with actual data
			imageDimensions: {
				width: 0, // Would be provided by detailed API
				height: 0, // Would be provided by detailed API
			},
			compressionQuality: 0.8, // Default quality
			metadata: {
				index,
				processingTime: new Date().toISOString(),
			},
		}));
	}

	/**
	 * Extracts image format from filename
	 */
	private extractImageFormat(fileName: string): "png" | "jpeg" | "heic" {
		const extension = fileName.toLowerCase().split('.').pop();
		switch (extension) {
			case 'png':
				return 'png';
			case 'jpg':
			case 'jpeg':
				return 'jpeg';
			case 'heic':
				return 'heic';
			default:
				return 'png'; // Default fallback
		}
	}

	/**
	 * Processes raw crash report data into standardized format
	 * Handles both real API fields and legacy field names for backward compatibility
	 */
	private processCrashReport(
		crash: TestFlightCrashReport,
	): ProcessedFeedbackData {
		const attrs = crash.attributes;

		// Use real API fields with fallbacks to legacy fields
		const submittedAt = attrs.createdDate || attrs.submittedAt || new Date().toISOString();
		const bundleId = attrs.buildBundleId || attrs.bundleId || '';
		const deviceFamily = attrs.deviceFamily || 'UNKNOWN';

		// Extract app version and build number from other available data if not directly provided
		// Note: Real API may not always include these fields in crash submissions
		const appVersion = attrs.appVersion || 'Unknown';
		const buildNumber = attrs.buildNumber || 'Unknown';

		return {
			id: crash.id,
			type: "crash",
			submittedAt: new Date(submittedAt),
			appVersion,
			buildNumber,
			deviceInfo: {
				family: deviceFamily,
				model: attrs.deviceModel,
				osVersion: attrs.osVersion,
				locale: attrs.locale,
			},
			bundleId,
			testerInfo: attrs.email ? {
				email: attrs.email,
			} : undefined,
			crashData: {
				// Real API may not have crash trace/type directly in submission
				// These might be in the related crashLog resource
				trace: attrs.crashTrace || '',
				type: attrs.crashType || 'Unknown',
				exceptionType: attrs.exceptionType,
				exceptionMessage: attrs.exceptionMessage,
				logs: attrs.crashLogs?.map((log) => ({
					url: log.url,
					expiresAt: new Date(log.expiresAt),
				})) || [],
			},
		};
	}

	/**
	 * Processes raw screenshot feedback data into standardized format
	 * Handles both real API fields and legacy field names for backward compatibility
	 */
	private processScreenshotFeedback(
		screenshot: TestFlightScreenshotFeedback,
	): ProcessedFeedbackData {
		const attrs = screenshot.attributes;

		// Use real API fields with fallbacks to legacy fields
		const submittedAt = attrs.createdDate || attrs.submittedAt || new Date().toISOString();
		const bundleId = attrs.buildBundleId || attrs.bundleId || '';
		const deviceFamily = attrs.deviceFamily || 'UNKNOWN';
		const feedbackText = attrs.comment || attrs.feedbackText || '';

		// Extract app version and build number from other available data if not directly provided
		const appVersion = attrs.appVersion || 'Unknown';
		const buildNumber = attrs.buildNumber || 'Unknown';

		return {
			id: screenshot.id,
			type: "screenshot",
			submittedAt: new Date(submittedAt),
			appVersion,
			buildNumber,
			deviceInfo: {
				family: deviceFamily,
				model: attrs.deviceModel,
				osVersion: attrs.osVersion,
				locale: attrs.locale,
			},
			bundleId,
			testerInfo: attrs.email ? {
				email: attrs.email,
			} : undefined,
			screenshotData: {
				text: feedbackText,
				images: attrs.screenshots.map((img) => ({
					url: img.url,
					fileName: img.fileName,
					fileSize: img.fileSize,
					expiresAt: new Date(img.expiresAt),
				})),
				annotations: attrs.annotations || [],
			},
		};
	}

	/**
	 * Utility function for sleeping/waiting
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
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
