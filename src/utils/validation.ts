/**
 * Runtime Validation Utilities
 * Production-ready validation for runtime inputs, security, and operational concerns
 * 
 * SCOPE: This module handles runtime validation, input sanitization, and security checks
 * DIFFERS FROM: src/config/validation.ts which handles compile-time configuration validation
 * 
 * Use this module for:
 * - Environment variable validation at runtime
 * - User input sanitization
 * - Security validation
 * - Rate limiting
 * - API request validation
 * 
 * Use src/config/validation.ts for:
 * - TypeScript configuration object validation
 * - Compile-time configuration checks
 * - Structured configuration validation
 */

// VALIDATION_PATTERNS import removed as environment validation is deprecated

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

export interface SecurityValidationResult extends ValidationResult {
	securityRisk: "low" | "medium" | "high";
	recommendations: string[];
}

/**
 * Note: Environment validation has been moved to src/utils/monitoring/environment-validator.ts
 * This function is deprecated and should not be used.
 * @deprecated Use EnvironmentValidator from src/utils/monitoring/environment-validator.ts instead
 */
export function validateEnvironmentConfiguration(
	_config: Record<string, unknown>,
): ValidationResult {
	console.warn("validateEnvironmentConfiguration is deprecated. Use EnvironmentValidator from src/utils/monitoring/environment-validator.ts instead");
	return {
		valid: true,
		errors: [],
		warnings: ["This validation function is deprecated"]
	};
}

/**
 * Validates API keys and tokens for security compliance
 */
export function validateApiSecrets(
	secrets: Record<string, string>,
): SecurityValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const recommendations: string[] = [];
	let securityRisk: "low" | "medium" | "high" = "low";

	for (const [key, value] of Object.entries(secrets)) {
		// Check for empty or placeholder values
		if (!value || value.trim() === "") {
			errors.push(`Empty secret value for ${key}`);
			securityRisk = "high";
			continue;
		}

		// Check for obviously fake/placeholder values
		const placeholderPatterns = [
			/^(test|demo|example|placeholder|fake|dummy)/i,
			/^(xxx|000|123)/,
			/^(your_|my_|insert_)/i,
		];

		if (placeholderPatterns.some((pattern) => pattern.test(value))) {
			errors.push(`Placeholder value detected for ${key}`);
			securityRisk = "high";
		}

		// Validate specific token formats
		if (key.includes("GITHUB") && value.length < 20) {
			warnings.push(`GitHub token appears too short: ${key}`);
			securityRisk = securityRisk === "low" ? "medium" : securityRisk;
		}

		if (key.includes("LINEAR") && value.length < 30) {
			warnings.push(`Linear token appears too short: ${key}`);
			securityRisk = securityRisk === "low" ? "medium" : securityRisk;
		}

		// Check for token exposure risks
		if (value.includes(" ") || value.includes("\n")) {
			warnings.push(`Secret contains whitespace characters: ${key}`);
			securityRisk = securityRisk === "low" ? "medium" : securityRisk;
		}
	}

	// Security recommendations
	if (securityRisk === "high") {
		recommendations.push("Review and update all API keys with valid values");
		recommendations.push(
			"Ensure secrets are stored securely in GitHub repository settings",
		);
	}

	if (securityRisk === "medium" || warnings.length > 0) {
		recommendations.push("Verify all API tokens have appropriate permissions");
		recommendations.push("Consider implementing secret rotation policies");
	}

	recommendations.push("Enable audit logging for secret access");
	recommendations.push("Regularly review and update API token permissions");

	return {
		valid: errors.length === 0,
		errors,
		warnings,
		securityRisk,
		recommendations,
	};
}

/**
 * Validates TestFlight feedback data for security and completeness
 */
export function validateTestFlightFeedback(
	feedback: unknown,
): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!feedback || typeof feedback !== "object") {
		errors.push("Invalid feedback data structure");
		return { valid: false, errors, warnings };
	}

	const feedbackObj = feedback as Record<string, unknown>;

	// Required fields
	const requiredFields = [
		"id",
		"type",
		"appVersion",
		"buildNumber",
		"deviceInfo",
		"submittedAt",
	];
	for (const field of requiredFields) {
		if (!feedbackObj[field]) {
			errors.push(`Missing required field: ${field}`);
		}
	}

	// Validate feedback type
	if (
		feedbackObj.type &&
		!["crash", "screenshot"].includes(feedbackObj.type as string)
	) {
		errors.push("Invalid feedback type (must be 'crash' or 'screenshot')");
	}

	// Validate device info structure
	if (feedbackObj.deviceInfo && typeof feedbackObj.deviceInfo === "object") {
		const deviceInfo = feedbackObj.deviceInfo as Record<string, unknown>;
		const requiredDeviceFields = ["model", "osVersion", "family", "locale"];

		for (const field of requiredDeviceFields) {
			if (!deviceInfo[field]) {
				warnings.push(`Missing device info field: ${field}`);
			}
		}
	}

	// Validate crash data if present
	if (feedbackObj.type === "crash" && feedbackObj.crashData) {
		const crashData = feedbackObj.crashData as Record<string, unknown>;
		if (!crashData.trace) {
			errors.push("Crash data missing stack trace");
		}

		if (!crashData.type) {
			warnings.push("Crash data missing crash type");
		}
	}

	// Security validation - check for sensitive data in feedback text
	if (
		feedbackObj.screenshotData &&
		typeof feedbackObj.screenshotData === "object"
	) {
		const screenshotData = feedbackObj.screenshotData as Record<
			string,
			unknown
		>;
		if (screenshotData.text && typeof screenshotData.text === "string") {
			const sensitivePatterns = [
				/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/, // Credit card patterns
				/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email patterns
				/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // Phone number patterns
				/\b(?:password|passwd|pwd|token|secret|key)\s*[:=]\s*\S+/i, // Password patterns
			];

			for (const pattern of sensitivePatterns) {
				if (pattern.test(screenshotData.text)) {
					warnings.push("Potential sensitive data detected in feedback text");
					break;
				}
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Validates issue creation requests for completeness and security
 */
export function validateIssueCreationRequest(
	request: Record<string, unknown>,
): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Required fields
	if (
		!request.title ||
		typeof request.title !== "string" ||
		request.title.trim().length === 0
	) {
		errors.push("Issue title is required and must be non-empty");
	}

	if (
		!request.description ||
		typeof request.description !== "string" ||
		request.description.trim().length === 0
	) {
		errors.push("Issue description is required and must be non-empty");
	}

	// Validate title length and content
	if (request.title && typeof request.title === "string") {
		if (request.title.length > 200) {
			warnings.push("Issue title is very long (>200 characters)");
		}

		if (request.title.length < 10) {
			warnings.push("Issue title is very short (<10 characters)");
		}

		// Check for suspicious content
		const suspiciousPatterns = [
			/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, // Script tags
			/javascript:/i, // JavaScript protocol
			/on\w+\s*=/i, // Event handlers
		];

		if (
			suspiciousPatterns.some((pattern) =>
				pattern.test(request.title as string),
			)
		) {
			errors.push("Potentially malicious content detected in issue title");
		}
	}

	// Validate description content
	if (request.description && typeof request.description === "string") {
		if (request.description.length > 50000) {
			warnings.push("Issue description is very long (>50k characters)");
		}

		// Check for suspicious content in description
		const suspiciousPatterns = [
			/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
			/javascript:/i,
			/on\w+\s*=/i,
		];

		if (
			suspiciousPatterns.some((pattern) =>
				pattern.test(request.description as string),
			)
		) {
			errors.push(
				"Potentially malicious content detected in issue description",
			);
		}
	}

	// Validate labels
	if (request.labels && Array.isArray(request.labels)) {
		if (request.labels.length > 20) {
			warnings.push(
				"Too many labels (>20) - may cause issues with some platforms",
			);
		}

		for (const label of request.labels) {
			if (typeof label !== "string" || label.length === 0) {
				errors.push("All labels must be non-empty strings");
				break;
			}

			if (label.length > 50) {
				warnings.push(`Label too long: ${label}`);
			}
		}
	}

	// Validate priority
	if (
		request.priority &&
		!["urgent", "high", "normal", "low"].includes(request.priority as string)
	) {
		errors.push(
			"Invalid priority value (must be urgent, high, normal, or low)",
		);
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Validates file paths for security (prevents path traversal attacks)
 */
export function validateFilePath(filePath: string): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Check for path traversal attempts
	const dangerousPatterns = [
		/\.\./, // Parent directory references
		/\/\.\./, // Unix path traversal
		/\\\.\./, // Windows path traversal
		/~\//, // Home directory references
		/\/etc\//, // System directories
		/\/root\//, // Root directory
		/\/home\//, // User directories (be cautious)
		/\/var\//, // Variable data directories
		/\/tmp\/.*\.\./, // Temp directory traversal
	];

	for (const pattern of dangerousPatterns) {
		if (pattern.test(filePath)) {
			errors.push(
				"Potentially dangerous file path detected (path traversal risk)",
			);
			break;
		}
	}

	// Check for absolute paths that might be risky
	if (filePath.startsWith("/") || /^[A-Za-z]:\\/.test(filePath)) {
		warnings.push("Absolute file path detected - ensure this is intentional");
	}

	// Check for very long paths
	if (filePath.length > 1000) {
		warnings.push("File path is extremely long (>1000 characters)");
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Validates network URLs for security
 */
export function validateUrl(url: string): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	try {
		const urlObj = new URL(url);

		// Only allow HTTPS in production
		if (process.env.NODE_ENV === "production" && urlObj.protocol !== "https:") {
			errors.push("Only HTTPS URLs are allowed in production");
		}

		// Check for dangerous protocols
		const dangerousProtocols = ["javascript:", "data:", "file:", "ftp:"];
		if (dangerousProtocols.includes(urlObj.protocol)) {
			errors.push(`Dangerous protocol detected: ${urlObj.protocol}`);
		}

		// Check for suspicious domains
		const suspiciousDomains = [
			"localhost",
			"127.0.0.1",
			"0.0.0.0",
			"192.168.",
			"10.",
			"172.16.",
		];

		if (process.env.NODE_ENV === "production") {
			for (const suspiciousDomain of suspiciousDomains) {
				if (urlObj.hostname.includes(suspiciousDomain)) {
					warnings.push(
						`Potentially risky hostname in production: ${urlObj.hostname}`,
					);
					break;
				}
			}
		}

		// Check URL length
		if (url.length > 2000) {
			warnings.push("URL is extremely long (>2000 characters)");
		}
	} catch (error) {
		errors.push(`Invalid URL format: ${error}`);
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Sanitizes user input to prevent injection attacks
 */
export function sanitizeUserInput(input: string): string {
	if (typeof input !== "string") {
		return "";
	}

	// Remove all script tags by repeatedly applying the regex until no matches remain
	let sanitized = input;
	let prev;
	do {
		prev = sanitized;
		sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
	} while (sanitized !== prev);

	return sanitized
		.replace(/javascript:/gi, "") // Remove javascript: protocol
		.replace(/on\w+\s*=/gi, "") // Remove event handlers
		.replace(/[<>]/g, (match) => (match === "<" ? "&lt;" : "&gt;")) // Escape HTML
		.trim();
}

/**
 * Rate limiting validation
 */
export interface RateLimitConfig {
	windowMs: number;
	maxRequests: number;
	skipSuccessfulRequests?: boolean;
}

export class RateLimiter {
	private requests: Map<string, number[]> = new Map();
	private config: RateLimitConfig;

	constructor(config: RateLimitConfig) {
		this.config = config;
	}

	/**
	 * Check if request is within rate limits
	 */
	public checkRateLimit(identifier: string): ValidationResult {
		const now = Date.now();
		const windowStart = now - this.config.windowMs;

		// Get existing requests for this identifier
		const userRequests = this.requests.get(identifier) || [];

		// Filter out requests outside the window
		const validRequests = userRequests.filter(
			(timestamp) => timestamp > windowStart,
		);

		// Check if limit exceeded
		if (validRequests.length >= this.config.maxRequests) {
			return {
				valid: false,
				errors: [
					`Rate limit exceeded. Max ${this.config.maxRequests} requests per ${this.config.windowMs}ms`,
				],
				warnings: [],
			};
		}

		// Add current request
		validRequests.push(now);
		this.requests.set(identifier, validRequests);

		return {
			valid: true,
			errors: [],
			warnings:
				validRequests.length > this.config.maxRequests * 0.8
					? ["Approaching rate limit"]
					: [],
		};
	}

	/**
	 * Reset rate limit for identifier
	 */
	public resetRateLimit(identifier: string): void {
		this.requests.delete(identifier);
	}

	/**
	 * Clean up old requests
	 */
	public cleanup(): void {
		const now = Date.now();
		const windowStart = now - this.config.windowMs;

		for (const [identifier, requests] of this.requests.entries()) {
			const validRequests = requests.filter(
				(timestamp) => timestamp > windowStart,
			);
			if (validRequests.length === 0) {
				this.requests.delete(identifier);
			} else {
				this.requests.set(identifier, validRequests);
			}
		}
	}
}

/**
 * Global validation functions
 * Note: Environment validation has been moved to src/utils/monitoring/environment-validator.ts
 */
export const Validation = {
	// environment: validateEnvironmentConfiguration, // DEPRECATED: Use EnvironmentValidator instead
	apiSecrets: validateApiSecrets,
	testFlightFeedback: validateTestFlightFeedback,
	issueCreationRequest: validateIssueCreationRequest,
	filePath: validateFilePath,
	url: validateUrl,
	sanitizeInput: sanitizeUserInput,
	RateLimiter,
};

export default Validation;
