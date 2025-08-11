/**
 * Base API Client
 * Abstract base class providing common HTTP client functionality with rate limiting, retry logic, and error handling
 * Implements DRY and SOLID principles for API client architecture
 */

import { DEFAULT_HTTP_CONFIG } from "../config/index.js";

export interface ApiRequestConfig {
	method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
	headers?: Record<string, string>;
	body?: unknown;
	timeout?: number;
	retries?: number;
	retryDelay?: number;
	skipRateLimit?: boolean;
}

export interface ApiResponse<T = unknown> {
	data: T;
	status: number;
	headers: Record<string, string>;
	rateLimit?: RateLimitInfo;
}

export interface RateLimitInfo {
	limit: number;
	remaining: number;
	reset: Date;
	used?: number;
	resource?: string;
}

export interface ApiErrorInfo {
	status?: number;
	code?: string;
	message: string;
	details?: unknown;
}

export interface ApiError extends Error {
	status?: number;
	code?: string;
	details?: unknown;
}

/**
 * Base API client with common functionality
 */
export abstract class BaseApiClient {
	protected readonly baseUrl: string;
	protected readonly defaultTimeout: number;
	protected readonly defaultRetries: number;
	protected readonly defaultRetryDelay: number;
	protected rateLimitInfo: RateLimitInfo | null = null;

	protected constructor(
		baseUrl: string,
		timeout: number = DEFAULT_HTTP_CONFIG.timeout,
		retries: number = DEFAULT_HTTP_CONFIG.retries,
		retryDelay: number = DEFAULT_HTTP_CONFIG.retryDelay,
	) {
		this.baseUrl = baseUrl;
		this.defaultTimeout = timeout;
		this.defaultRetries = retries;
		this.defaultRetryDelay = retryDelay;
	}

	/**
	 * Build request headers with authentication and defaults
	 */
	protected abstract buildHeaders(
		additionalHeaders?: Record<string, string>,
	): Promise<Record<string, string>>;

	/**
	 * Make HTTP request with retry logic and rate limiting
	 */
	protected async makeRequest<T>(
		endpoint: string,
		config: ApiRequestConfig = {},
	): Promise<ApiResponse<T>> {
		const {
			method = "GET",
			headers = {},
			body,
			timeout = this.defaultTimeout,
			retries = this.defaultRetries,
			retryDelay = this.defaultRetryDelay,
			skipRateLimit = false,
		} = config;

		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				// Check rate limits if applicable
				if (!skipRateLimit) {
					await this.waitForRateLimit();
				}

				const url = endpoint.startsWith("http")
					? endpoint
					: `${this.baseUrl}${endpoint}`;
				const requestHeaders = await this.buildHeaders(headers);

				const response = await fetch(url, {
					method,
					headers: requestHeaders,
					body: body ? JSON.stringify(body) : undefined,
					signal: AbortSignal.timeout(timeout),
				});

				// Update rate limit info from response
				this.updateRateLimitInfo(response);

				// Handle error responses
				if (!response.ok) {
					const errorInfo = await this.parseErrorResponse(response);

					// Don't retry on client errors (4xx) except rate limiting
					if (
						response.status >= 400 &&
						response.status < 500 &&
						response.status !== 429
					) {
						throw this.createApiError(errorInfo);
					}

					throw this.createApiError(errorInfo);
				}

				// Parse successful response
				const data = await response.json();

				return {
					data: data as T,
					status: response.status,
					headers: Object.fromEntries(response.headers.entries()),
					rateLimit: this.rateLimitInfo || undefined,
				};
			} catch (error) {
				lastError = error as Error;

				// Don't retry on authentication or client errors
				if (this.shouldNotRetry(lastError)) {
					throw lastError;
				}

				// Don't retry on the last attempt
				if (attempt === retries) {
					break;
				}

				// Wait before retrying (exponential backoff)
				const delay = retryDelay * 2 ** attempt;
				await this.sleep(delay);
			}
		}

		throw new Error(
			`Request failed after ${retries + 1} attempts: ${lastError?.message || "Unknown error"}`,
		);
	}

	/**
	 * Wait for rate limits if needed
	 */
	protected async waitForRateLimit(): Promise<void> {
		if (!this.rateLimitInfo) {
			return;
		}

		const { remaining, reset } = this.rateLimitInfo;
		const now = new Date();

		// If we have requests remaining, proceed
		if (remaining > 0) {
			return;
		}

		// If reset time has passed, proceed
		if (now >= reset) {
			this.rateLimitInfo = null;
			return;
		}

		// Wait until reset time
		const waitTime = reset.getTime() - now.getTime();
		console.log(
			`Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s until reset...`,
		);
		await this.sleep(waitTime);
	}

	/**
	 * Update rate limit information from response headers
	 */
	protected updateRateLimitInfo(response: Response): void {
		const limit = response.headers.get("x-ratelimit-limit");
		const remaining = response.headers.get("x-ratelimit-remaining");
		const reset = response.headers.get("x-ratelimit-reset");

		if (limit && remaining && reset) {
			this.rateLimitInfo = {
				limit: parseInt(limit, 10),
				remaining: parseInt(remaining, 10),
				reset: new Date(parseInt(reset, 10) * 1000),
				resource: response.headers.get("x-ratelimit-resource") || undefined,
			};
		}
	}

	/**
	 * Parse error response from API
	 */
	protected async parseErrorResponse(
		response: Response,
	): Promise<ApiErrorInfo> {
		try {
			const errorData = (await response.json()) as {
				code?: string;
				message?: string;
				[key: string]: unknown;
			};
			return {
				status: response.status,
				code: errorData.code || response.statusText,
				message:
					errorData.message ||
					`HTTP ${response.status}: ${response.statusText}`,
				details: errorData,
			};
		} catch {
			return {
				status: response.status,
				message: `HTTP ${response.status}: ${response.statusText}`,
			};
		}
	}

	/**
	 * Create API error from error info
	 */
	protected createApiError(errorInfo: ApiErrorInfo): ApiError {
		const error = new Error(errorInfo.message) as ApiError;
		error.status = errorInfo.status;
		error.code = errorInfo.code;
		error.details = errorInfo.details;
		return error;
	}

	/**
	 * Check if error should not be retried
	 */
	protected shouldNotRetry(error: Error): boolean {
		const message = error.message.toLowerCase();
		return (
			message.includes("authentication") ||
			message.includes("401") ||
			message.includes("403") ||
			message.includes("404") ||
			message.includes("timeout")
		);
	}

	/**
	 * Sleep for specified milliseconds
	 */
	protected async sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Health check method to be implemented by subclasses
	 */
	public abstract healthCheck(): Promise<{
		status: "healthy" | "unhealthy";
		details: Record<string, unknown>;
	}>;
}
