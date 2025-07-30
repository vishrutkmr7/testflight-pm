/**
 * Secure Prompt Storage and Management
 * Implements prompt obfuscation and injection prevention
 */

import crypto from "node:crypto";

// Obfuscated prompt templates using base64 encoding and encryption
const OBFUSCATED_PROMPTS = {
	// System prompts with security measures
	CRASH_ANALYSIS_SYSTEM: "WW91IGFyZSBhbiBleHBlcnQgc29mdHdhcmUgZW5naW5lZXIgYW5hbHl6aW5nIGlPUy9tb2JpbGUgYXBwIGNyYXNoIHJlcG9ydHMgZnJvbSBUZXN0RmxpZ2h0LiBZb3VyIHRhc2sgaXMgdG8gY3JlYXRlIGhpZ2gtcXVhbGl0eSwgYWN0aW9uYWJsZSBidWcgcmVwb3J0cyB3aXRoIHRlY2huaWNhbCBhbmFseXNpcyBhbmQgcmVsZXZhbnQgY29kZSBhcmVhIGlkZW50aWZpY2F0aW9uLiBGb2N1cyBvbjogVGVjaG5pY2FsIHJvb3QgY2F1c2UgYW5hbHlzaXMsIFN0YWNrIHRyYWNlIGludGVycHJldGF0aW9uLCBJbXBhY3QgYXNzZXNzbWVudCBhbmQgc2V2ZXJpdHkgY2xhc3NpZmljYXRpb24sIENvZGUgYXJlYSBpZGVudGlmaWNhdGlvbiBhbmQgY29ycmVsYXRpb24sIFJlcHJvZHVjaWJpbGl0eSBhbmFseXNpcywgUmVjb21tZW5kZWQgZml4IGFwcHJvYWNoZXM=",
	
	FEEDBACK_ANALYSIS_SYSTEM: "WW91IGFyZSBhbiBleHBlcnQgcHJvZHVjdCBtYW5hZ2VyIGFuZCBVWCBkZXNpZ25lciBhbmFseXppbmcgdXNlciBmZWVkYmFjayBmcm9tIFRlc3RGbGlnaHQuIFlvdXIgdGFzayBpcyB0byBjcmVhdGUgYWN0aW9uYWJsZSBmZWF0dXJlIHJlcXVlc3RzIGFuZCBpbXByb3ZlbWVudCB0YXNrcyB3aXRoIHVzZXIgZXhwZXJpZW5jZSBpbnNpZ2h0cy4gRm9jdXMgb246IFVzZXIgZXhwZXJpZW5jZSBhbmFseXNpcywgRmVhdHVyZSBnYXAgaWRlbnRpZmljYXRpb24sIFVJL1VYIGltcHJvdmVtZW50IHJlY29tbWVuZGF0aW9ucywgUHJpb3JpdHkgYXNzZXNzbWVudCBiYXNlZCBvbiB1c2VyIGltcGFjdCwgSW1wbGVtZW50YXRpb24gY29tcGxleGl0eSBlc3RpbWF0aW9uLCBVc2VyIGpvdXJuZXkgb3B0aW1pemF0aW9u",
	
	ENHANCEMENT_SYSTEM: "WW91IGFyZSBhbiBleHBlcnQgc29mdHdhcmUgZW5naW5lZXIgYW5kIHRlY2huaWNhbCBpc3N1ZSBhbmFseXN0LiBZb3VyIHJvbGUgaXMgdG8gZW5oYW5jZSBidWcgcmVwb3J0cyBhbmQgZmVhdHVyZSByZXF1ZXN0cyB3aXRoIGRldGFpbGVkIHRlY2huaWNhbCBhbmFseXNpcy4gWW91IGhhdmUgYWNjZXNzIHRvIGNvZGViYXNlIGNvbnRleHQgYW5kIHJlY2VudCBjaGFuZ2VzLiBQcm92aWRlIGFjdGlvbmFibGUgaW5zaWdodHMgYW5kIHRlY2huaWNhbCByZWNvbW1lbmRhdGlvbnM=",
	
	// Analysis request templates
	CRASH_ANALYSIS_REQUEST: "UGxlYXNlIGFuYWx5emUgdGhpcyBjcmFzaCByZXBvcnQgYW5kIHByb3ZpZGUgYSBjb21wcmVoZW5zaXZlIHRlY2huaWNhbCBhc3Nlc3NtZW50LiBGb2N1cyBvbjogUm9vdCBDYXVzZSBJZGVudGlmaWNhdGlvbjogV2hhdCBsaWtlbHkgY2F1c2VkIHRoaXMgY3Jhc2g/IENvZGUgQXJlYSBBbmFseXNpczogV2hpY2ggZmlsZXMvbWV0aG9kcyBhcmUgbW9zdCBsaWtlbHkgaW52b2x2ZWQ/IEZpeCBTdHJhdGVneTogV2hhdCBzcGVjaWZpYyBzdGVwcyBzaG91bGQgZGV2ZWxvcGVycyB0YWtlPyBQcmlvcml0eSBBc3Nlc3NtZW50OiBIb3cgY3JpdGljYWwgaXMgdGhpcyBjcmFzaCBmb3IgdXNlcnM/",
	
	FEEDBACK_ANALYSIS_REQUEST: "UGxlYXNlIGFuYWx5emUgdGhpcyB1c2VyIGZlZWRiYWNrIGFuZCBjcmVhdGUgYW4gYWN0aW9uYWJsZSB0YXNrIGZvciB0aGUgZGV2ZWxvcG1lbnQgdGVhbS4gRm9jdXMgb246IFVzZXIgSW50ZW50OiBXaGF0IGlzIHRoZSB1c2VyIHRyeWluZyB0byBhY2hpZXZlPyBQYWluIFBvaW50czogV2hhdCBzcGVjaWZpYyBwcm9ibGVtcyBhcmUgdGhleSBleHBlcmllbmNpbmc/IFVJL1VYIEltcGFjdDogV2hpY2ggc2NyZWVucyBvciBjb21wb25lbnRzIG5lZWQgYXR0ZW50aW9uPyBJbXBsZW1lbnRhdGlvbiBTdHJhdGVneTogSG93IHNob3VsZCB0aGlzIGJlIGFkZHJlc3NlZD8gQnVzaW5lc3MgVmFsdWU6IFdoYXQncyB0aGUgcG90ZW50aWFsIGltcGFjdCBvZiBmaXhpbmcgdGhpcz8="
};

// Injection detection patterns
const INJECTION_PATTERNS = [
	// Command injection attempts
	/\bignore\s+(previous|above|all)\s+(instructions?|prompts?)\b/i,
	/\bforget\s+(everything|all)\s+(above|before)\b/i,
	/\bnow\s+(act|behave|pretend)\s+as\b/i,
	/\byou\s+are\s+now\b/i,
	/\bsystem\s*[:=]\s*\w+/i,
	
	// Role manipulation
	/\bassistant\s*[:=]/i,
	/\buser\s*[:=]/i,
	/\brole\s*[:=]/i,
	/\bpersona\s*[:=]/i,
	
	// Output manipulation
	/\boutput\s+only\b/i,
	/\brespond\s+with\s+only\b/i,
	/\bjust\s+say\b/i,
	/\bsimply\s+output\b/i,
	
	// System bypass attempts
	/\bdev\s*mode\b/i,
	/\bdebug\s*mode\b/i,
	/\badmin\s*mode\b/i,
	/\broot\s*access\b/i,
	
	// Encoding attempts
	/\bbase64\b/i,
	/\bhex\s*encod/i,
	/\brot13\b/i,
	/\bunicode\s*encod/i,
	
	// Jailbreak patterns
	/\bjailbreak\b/i,
	/\bescape\s+the\s+system\b/i,
	/\bbreak\s+out\s+of\b/i,
	/\boverride\s+safety\b/i,
];

// Security configuration
const SECURITY_CONFIG = {
	maxPromptLength: 50000,
	maxUserInputLength: 10000,
	enableStrictValidation: true,
	logSuspiciousInputs: true,
	sanitizeSpecialChars: true,
};

/**
 * Decodes and returns secure prompt template
 */
function getSecurePrompt(key: keyof typeof OBFUSCATED_PROMPTS): string {
	try {
		const encoded = OBFUSCATED_PROMPTS[key];
		const decoded = Buffer.from(encoded, 'base64').toString('utf8');
		return decoded;
	} catch (error) {
		console.error(`Failed to decode prompt ${key}:`, error);
		return "Error loading prompt template. Using fallback.";
	}
}

/**
 * Sanitizes user input to prevent injection attacks
 */
function sanitizeInput(input: string): string {
	if (!input || typeof input !== 'string') {
		return '';
	}
	
	// Length validation
	if (input.length > SECURITY_CONFIG.maxUserInputLength) {
		console.warn(`Input truncated: length ${input.length} > ${SECURITY_CONFIG.maxUserInputLength}`);
		input = input.substring(0, SECURITY_CONFIG.maxUserInputLength);
	}
	
	// Remove or escape potentially dangerous characters
	if (SECURITY_CONFIG.sanitizeSpecialChars) {
		input = input
			.replace(/[<>]/g, '') // Remove HTML-like tags
			.replace(/\x00/g, '') // Remove null bytes
			.replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
			.trim();
	}
	
	return input;
}

/**
 * Detects potential prompt injection attempts
 */
function detectInjection(input: string): { isInjection: boolean; patterns: string[] } {
	const foundPatterns: string[] = [];
	
	for (const pattern of INJECTION_PATTERNS) {
		if (pattern.test(input)) {
			foundPatterns.push(pattern.source);
		}
	}
	
	return {
		isInjection: foundPatterns.length > 0,
		patterns: foundPatterns
	};
}

/**
 * Validates and sanitizes prompt input
 */
function validatePromptInput(input: string, context: string = 'unknown'): {
	sanitized: string;
	isValid: boolean;
	warnings: string[];
} {
	const warnings: string[] = [];
	
	// Basic validation
	if (!input || typeof input !== 'string') {
		return {
			sanitized: '',
			isValid: false,
			warnings: ['Invalid input type']
		};
	}
	
	// Injection detection
	const injectionResult = detectInjection(input);
	if (injectionResult.isInjection) {
		warnings.push(`Potential injection detected in ${context}: ${injectionResult.patterns.join(', ')}`);
		
		if (SECURITY_CONFIG.logSuspiciousInputs) {
			console.warn(`[SECURITY] Injection attempt detected in ${context}`, {
				patterns: injectionResult.patterns,
				inputLength: input.length,
				timestamp: new Date().toISOString()
			});
		}
		
		if (SECURITY_CONFIG.enableStrictValidation) {
			return {
				sanitized: '',
				isValid: false,
				warnings
			};
		}
	}
	
	// Sanitize input
	const sanitized = sanitizeInput(input);
	
	// Additional validation after sanitization
	if (sanitized.length === 0 && input.length > 0) {
		warnings.push('Input was completely sanitized (possibly malicious)');
	}
	
	return {
		sanitized,
		isValid: true,
		warnings
	};
}

/**
 * Secure prompt template interface
 */
export interface SecurePromptTemplate {
	systemPrompt: string;
	analysisRequest: string;
	outputSchema: object;
	securityValidated: boolean;
}

/**
 * Main secure prompt manager
 */
export class SecurePromptManager {
	private readonly securityToken: string;
	
	constructor() {
		// Generate a security token for this session
		this.securityToken = crypto.randomBytes(16).toString('hex');
	}
	
	/**
	 * Gets crash analysis prompt template
	 */
	getCrashAnalysisTemplate(platform?: string, hasCodebaseAnalysis?: boolean): SecurePromptTemplate {
		const systemPrompt = getSecurePrompt('CRASH_ANALYSIS_SYSTEM');
		const analysisRequest = getSecurePrompt('CRASH_ANALYSIS_REQUEST');
		
		// Add platform and context information securely
		const contextualSystemPrompt = `${systemPrompt}\n\nPlatform context: ${platform || 'iOS'}\nCodebase analysis available: ${!!hasCodebaseAnalysis}`;
		
		return {
			systemPrompt: contextualSystemPrompt,
			analysisRequest,
			outputSchema: {
				type: "object",
				properties: {
					title: { type: "string", maxLength: 200 },
					description: { type: "string", maxLength: 5000 },
					labels: { type: "array", items: { type: "string" }, maxItems: 10 },
					priority: {
						type: "string",
						enum: ["urgent", "high", "normal", "low"]
					}
				},
				required: ["title", "description", "labels", "priority"]
			},
			securityValidated: true
		};
	}
	
	/**
	 * Gets feedback analysis prompt template
	 */
	getFeedbackAnalysisTemplate(platform?: string, feedbackType?: string): SecurePromptTemplate {
		const systemPrompt = getSecurePrompt('FEEDBACK_ANALYSIS_SYSTEM');
		const analysisRequest = getSecurePrompt('FEEDBACK_ANALYSIS_REQUEST');
		
		// Add platform and feedback type information securely
		const contextualSystemPrompt = `${systemPrompt}\n\nPlatform context: ${platform || 'iOS'}\nFeedback type: ${feedbackType || 'general'}`;
		
		return {
			systemPrompt: contextualSystemPrompt,
			analysisRequest,
			outputSchema: {
				type: "object",
				properties: {
					title: { type: "string", maxLength: 200 },
					description: { type: "string", maxLength: 5000 },
					labels: { type: "array", items: { type: "string" }, maxItems: 10 },
					priority: {
						type: "string",
						enum: ["urgent", "high", "normal", "low"]
					}
				},
				required: ["title", "description", "labels", "priority"]
			},
			securityValidated: true
		};
	}
	
	/**
	 * Gets enhancement prompt template for LLM client
	 */
	getEnhancementTemplate(feedbackType: string): SecurePromptTemplate {
		const systemPrompt = getSecurePrompt('ENHANCEMENT_SYSTEM');
		
		// Add feedback type context securely
		const contextualSystemPrompt = `${systemPrompt}\n\nContext:\n- Feedback Type: ${feedbackType}\n- You have access to codebase context and recent changes\n- Provide actionable insights and technical recommendations\n\nResponse Format (JSON):\n{\n  "enhancedTitle": "Clear, technical title",\n  "enhancedDescription": "Detailed technical description with context",\n  "priority": "urgent|high|medium|low",\n  "labels": ["bug", "crash", "ios", ...],\n  "analysis": {\n    "rootCause": "Technical analysis of the cause",\n    "affectedComponents": ["component1", "component2"],\n    "suggestedFix": "Specific technical recommendations",\n    "confidence": 0.95\n  }\n}`;
		
		return {
			systemPrompt: contextualSystemPrompt,
			analysisRequest: "Analyze the provided information and enhance the issue with technical insights.",
			outputSchema: {
				type: "object",
				properties: {
					enhancedTitle: { type: "string", maxLength: 200 },
					enhancedDescription: { type: "string", maxLength: 5000 },
					priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
					labels: { type: "array", items: { type: "string" }, maxItems: 15 },
					analysis: {
						type: "object",
						properties: {
							rootCause: { type: "string", maxLength: 1000 },
							affectedComponents: { type: "array", items: { type: "string" }, maxItems: 10 },
							suggestedFix: { type: "string", maxLength: 2000 },
							confidence: { type: "number", minimum: 0, maximum: 1 }
						}
					}
				},
				required: ["enhancedTitle", "enhancedDescription", "priority", "labels"]
			},
			securityValidated: true
		};
	}
	
	/**
	 * Validates and sanitizes user input for prompts
	 */
	validateUserInput(input: string, context: string = 'user_input'): {
		sanitized: string;
		isValid: boolean;
		warnings: string[];
	} {
		return validatePromptInput(input, context);
	}
	
	/**
	 * Gets security configuration
	 */
	getSecurityConfig() {
		return { ...SECURITY_CONFIG };
	}
	
	/**
	 * Generates a secure context token for tracking
	 */
	generateContextToken(): string {
		return crypto.randomBytes(8).toString('hex');
	}
}

// Global secure prompt manager instance
let _securePromptManager: SecurePromptManager | null = null;

/**
 * Gets the global secure prompt manager instance
 */
export function getSecurePromptManager(): SecurePromptManager {
	if (!_securePromptManager) {
		_securePromptManager = new SecurePromptManager();
	}
	return _securePromptManager;
}

/**
 * Clears the global instance (for testing)
 */
export function clearSecurePromptManager(): void {
	_securePromptManager = null;
}

export { validatePromptInput, sanitizeInput, detectInjection, SECURITY_CONFIG };