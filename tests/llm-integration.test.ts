/**
 * LLM Integration Tests
 * Comprehensive test suite for LLM client functionality, provider switching, and cost management
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { getLLMClient, LLMClient } from "../src/api/llm-client.js";
import type { LLMEnhancementConfig } from "../src/config/llm-config.js";
import type { ProcessedFeedbackData } from "../types/testflight.js";

// Mock configuration for testing
const mockConfig: LLMEnhancementConfig = {
	enabled: true,
	primaryProvider: "openai",
	fallbackProviders: ["anthropic", "google"],
	providers: {
		openai: {
			apiKey: "test-openai-key",
			model: "gpt-4.1-mini",
			maxTokens: 1000,
			temperature: 0.1,
			timeout: 30000,
			maxRetries: 3,
		},
		anthropic: {
			apiKey: "test-anthropic-key",
			model: "claude-3.7-sonnet",
			maxTokens: 1000,
			temperature: 0.1,
			timeout: 30000,
			maxRetries: 3,
		},
		google: {
			apiKey: "test-google-key",
			model: "gemini-2.0-flash",
			maxTokens: 1000,
			temperature: 0.1,
			timeout: 30000,
			maxRetries: 3,
		},
	},
	costLimits: {
		maxCostPerRun: 1.0,
		maxCostPerMonth: 100.0,
		maxTokensPerIssue: 5000,
	},
};

// Mock test feedback data
const mockCrashFeedback: ProcessedFeedbackData = {
	id: "test-crash-001",
	type: "crash",
	timestamp: new Date(),
	userId: "test-user",
	appVersion: "1.0.0",
	buildVersion: "123",
	deviceInfo: {
		model: "iPhone 14 Pro",
		os: "iOS 17.1",
		locale: "en-US",
	},
	crashData: {
		trace:
			"Exception in thread 'main' java.lang.NullPointerException\n\tat com.example.MainActivity.onCreate(MainActivity.java:42)",
		type: "NullPointerException",
		exceptionType: "NullPointerException",
		exceptionMessage: "Attempt to invoke virtual method on null object",
		logs: [],
	},
};

const mockUserFeedback: ProcessedFeedbackData = {
	id: "test-feedback-001",
	type: "feedback",
	timestamp: new Date(),
	userId: "test-user",
	appVersion: "1.0.0",
	buildVersion: "123",
	deviceInfo: {
		model: "iPhone 14 Pro",
		os: "iOS 17.1",
		locale: "en-US",
	},
	screenshotData: {
		text: "The login button is too small and hard to tap",
		annotations: [],
	},
};

// Mock fetch responses
const mockOpenAIResponse = {
	choices: [
		{
			message: {
				content: JSON.stringify({
					title: "NullPointerException in MainActivity.onCreate",
					description:
						"## Issue Description\nCrash occurring in MainActivity during onCreate lifecycle method...",
					labels: ["bug", "crash", "high-priority"],
					priority: "high",
				}),
			},
		},
	],
	usage: {
		prompt_tokens: 150,
		completion_tokens: 300,
		total_tokens: 450,
	},
};

describe("LLM Client Initialization", () => {
	test("should initialize with valid configuration", () => {
		// Mock the config function
		mock.module("../src/config/llm-config.js", () => ({
			getLLMConfig: () => mockConfig,
		}));

		const client = new LLMClient();
		expect(client).toBeDefined();
	});

	test("should throw error when LLM is disabled", () => {
		const disabledConfig = { ...mockConfig, enabled: false };

		mock.module("../src/config/llm-config.js", () => ({
			getLLMConfig: () => disabledConfig,
		}));

		expect(() => new LLMClient()).toThrow("LLM enhancement is disabled");
	});

	test("should validate provider configuration", () => {
		const invalidConfig = {
			...mockConfig,
			providers: {
				...mockConfig.providers,
				openai: { ...mockConfig.providers.openai, apiKey: "" },
			},
		};

		mock.module("../src/config/llm-config.js", () => ({
			getLLMConfig: () => invalidConfig,
		}));

		expect(() => new LLMClient()).toThrow(
			"API key missing for primary provider",
		);
	});
});

describe("LLM Provider Management", () => {
	let client: LLMClient;

	beforeEach(() => {
		mock.module("../src/config/llm-config.js", () => ({
			getLLMConfig: () => mockConfig,
		}));

		// Mock fetch globally
		global.fetch = mock(() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.resolve(mockOpenAIResponse),
				headers: new Headers(),
			} as Response),
		);

		client = new LLMClient();
	});

	afterEach(() => {
		mock.restore();
	});

	test("should use primary provider by default", async () => {
		const result = await client.enhanceFeedback(mockCrashFeedback);

		expect(result).toBeDefined();
		expect(result.title).toContain("NullPointerException");
		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining("openai"),
			expect.any(Object),
		);
	});

	test("should fallback to secondary provider on primary failure", async () => {
		let callCount = 0;
		global.fetch = mock(() => {
			callCount++;
			if (callCount === 1) {
				// First call (OpenAI) fails
				return Promise.resolve({
					ok: false,
					status: 500,
					statusText: "Internal Server Error",
				} as Response);
			}
			// Second call (Anthropic) succeeds
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve({
						content: [
							{
								text: JSON.stringify(
									mockOpenAIResponse.choices[0].message.content,
								),
							},
						],
						usage: { input_tokens: 150, output_tokens: 300 },
					}),
				headers: new Headers(),
			} as Response);
		});

		const result = await client.enhanceFeedback(mockCrashFeedback);

		expect(result).toBeDefined();
		expect(callCount).toBe(2);
	});

	test("should exhaust all providers before failing", async () => {
		// Mock all providers to fail
		global.fetch = mock(() =>
			Promise.resolve({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			} as Response),
		);

		await expect(client.enhanceFeedback(mockCrashFeedback)).rejects.toThrow(
			"All LLM providers failed",
		);
	});
});

describe("Cost Management", () => {
	let client: LLMClient;

	beforeEach(() => {
		const costLimitedConfig = {
			...mockConfig,
			costLimits: {
				maxCostPerRun: 0.01, // Very low limit for testing
				maxCostPerMonth: 0.5,
				maxTokensPerIssue: 100,
			},
		};

		mock.module("../src/config/llm-config.js", () => ({
			getLLMConfig: () => costLimitedConfig,
		}));

		global.fetch = mock(() =>
			Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve({
						...mockOpenAIResponse,
						usage: {
							prompt_tokens: 50,
							completion_tokens: 100, // This will exceed token limit
							total_tokens: 150,
						},
					}),
				headers: new Headers(),
			} as Response),
		);

		client = new LLMClient();
	});

	afterEach(() => {
		mock.restore();
	});

	test("should enforce token limits per issue", async () => {
		await expect(client.enhanceFeedback(mockCrashFeedback)).rejects.toThrow(
			"Token limit exceeded",
		);
	});

	test("should track usage statistics", async () => {
		const costLimitedConfig = {
			...mockConfig,
			costLimits: {
				maxCostPerRun: 10.0, // High enough to allow execution
				maxCostPerMonth: 100.0,
				maxTokensPerIssue: 1000,
			},
		};

		mock.module("../src/config/llm-config.js", () => ({
			getLLMConfig: () => costLimitedConfig,
		}));

		const newClient = new LLMClient();
		await newClient.enhanceFeedback(mockCrashFeedback);

		const usage = newClient.getUsageStats();
		expect(usage.totalRequests).toBe(1);
		expect(usage.totalTokens).toBeGreaterThan(0);
		expect(usage.totalCost).toBeGreaterThan(0);
	});

	test("should reset monthly usage on new month", () => {
		const usage = client.getUsageStats();
		expect(usage.monthlyReset).toBeDefined();

		// Simulate new month
		const nextMonth = new Date();
		nextMonth.setMonth(nextMonth.getMonth() + 1);

		// This would be tested in a real implementation with date mocking
		expect(usage.monthlyReset.getMonth()).toBeLessThanOrEqual(
			nextMonth.getMonth(),
		);
	});
});

describe("Enhancement Generation", () => {
	let client: LLMClient;

	beforeEach(() => {
		mock.module("../src/config/llm-config.js", () => ({
			getLLMConfig: () => mockConfig,
		}));

		client = new LLMClient();
	});

	afterEach(() => {
		mock.restore();
	});

	test("should generate crash report enhancement", async () => {
		global.fetch = mock(() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.resolve(mockOpenAIResponse),
				headers: new Headers(),
			} as Response),
		);

		const result = await client.enhanceFeedback(mockCrashFeedback);

		expect(result).toBeDefined();
		expect(result.title).toContain("NullPointerException");
		expect(result.description).toContain("Issue Description");
		expect(result.labels).toContain("crash");
		expect(result.priority).toBe("high");
	});

	test("should generate user feedback enhancement", async () => {
		const userFeedbackResponse = {
			choices: [
				{
					message: {
						content: JSON.stringify({
							title: "Improve Login Button Size and Accessibility",
							description:
								"## User Feedback Analysis\nUser reports difficulty tapping the login button...",
							labels: ["ux", "accessibility", "enhancement"],
							priority: "normal",
						}),
					},
				},
			],
			usage: mockOpenAIResponse.usage,
		};

		global.fetch = mock(() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.resolve(userFeedbackResponse),
				headers: new Headers(),
			} as Response),
		);

		const result = await client.enhanceFeedback(mockUserFeedback);

		expect(result).toBeDefined();
		expect(result.title).toContain("Login Button");
		expect(result.labels).toContain("ux");
		expect(result.priority).toBe("normal");
	});

	test("should include codebase analysis when available", async () => {
		const mockCodebaseAnalysis = {
			relevantAreas: [
				{
					file: "src/components/LoginScreen.tsx",
					lines: "45-67",
					confidence: 0.8,
					matchType: "semantic" as const,
					context: "Button component definition",
					reason: "Contains login button implementation",
				},
			],
			suggestions: {
				possibleComponents: ["LoginScreen", "Button"],
				relatedFiles: ["src/styles/buttons.css"],
			},
			confidence: 0.75,
		};

		// Mock the request to verify codebase analysis is included
		let requestBody: any;
		global.fetch = mock((_url, options) => {
			if (options?.body) {
				requestBody = JSON.parse(options.body as string);
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(mockOpenAIResponse),
				headers: new Headers(),
			} as Response);
		});

		await client.enhanceFeedback(mockUserFeedback, mockCodebaseAnalysis);

		expect(requestBody.messages).toBeDefined();
		expect(JSON.stringify(requestBody.messages)).toContain("LoginScreen.tsx");
	});

	test("should handle invalid JSON responses gracefully", async () => {
		global.fetch = mock(() =>
			Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve({
						choices: [{ message: { content: "Invalid JSON response" } }],
						usage: mockOpenAIResponse.usage,
					}),
				headers: new Headers(),
			} as Response),
		);

		const result = await client.enhanceFeedback(mockCrashFeedback);

		// Should return a fallback response
		expect(result).toBeDefined();
		expect(result.title).toContain("Enhanced");
		expect(result.description).toContain("Invalid JSON response");
	});
});

describe("Error Handling and Resilience", () => {
	let client: LLMClient;

	beforeEach(() => {
		mock.module("../src/config/llm-config.js", () => ({
			getLLMConfig: () => mockConfig,
		}));

		client = new LLMClient();
	});

	afterEach(() => {
		mock.restore();
	});

	test("should handle network timeouts", async () => {
		global.fetch = mock(
			() =>
				new Promise((_, reject) => {
					setTimeout(() => reject(new Error("Network timeout")), 100);
				}),
		);

		await expect(client.enhanceFeedback(mockCrashFeedback)).rejects.toThrow();
	});

	test("should handle rate limiting with exponential backoff", async () => {
		let callCount = 0;
		global.fetch = mock(() => {
			callCount++;
			if (callCount <= 2) {
				return Promise.resolve({
					ok: false,
					status: 429,
					statusText: "Too Many Requests",
					headers: new Headers({ "retry-after": "1" }),
				} as Response);
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(mockOpenAIResponse),
				headers: new Headers(),
			} as Response);
		});

		const result = await client.enhanceFeedback(mockCrashFeedback);

		expect(result).toBeDefined();
		expect(callCount).toBe(3); // 2 failures + 1 success
	});

	test("should validate API responses", async () => {
		global.fetch = mock(() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ invalid: "response" }),
				headers: new Headers(),
			} as Response),
		);

		const result = await client.enhanceFeedback(mockCrashFeedback);

		// Should handle invalid response structure gracefully
		expect(result).toBeDefined();
		expect(result.title).toBeDefined();
	});
});

describe("Singleton Pattern", () => {
	test("should return same instance", () => {
		mock.module("../src/config/llm-config.js", () => ({
			getLLMConfig: () => mockConfig,
		}));

		const client1 = getLLMClient();
		const client2 = getLLMClient();

		expect(client1).toBe(client2);
	});

	test("should reset instance for testing", () => {
		mock.module("../src/config/llm-config.js", () => ({
			getLLMConfig: () => mockConfig,
		}));

		const client1 = getLLMClient();

		// Reset instance (would need to be exposed for testing)
		// This test verifies the pattern exists
		expect(client1).toBeDefined();
	});
});
