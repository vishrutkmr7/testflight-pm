/**
 * LLM Configuration Tests
 * Tests for LLM configuration management, validation, and security
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	calculateEstimatedCost,
	checkCostLimits,
	clearLLMConfigCache,
	DEFAULT_LLM_CONFIG,
	getLLMConfig,
	LLM_MODEL_PRICING,
	type LLMEnhancementConfig,
	type LLMUsageStats,
	loadLLMConfig,
	sanitizeDataForLLM,
	validateLLMConfig,
} from "../src/config/llm-config.js";

describe("LLM Configuration", () => {
	beforeEach(() => {
		// Clear environment variables
		delete process.env.ENABLE_LLM_ENHANCEMENT;
		delete process.env.LLM_PROVIDER;
		delete process.env.OPENAI_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.GOOGLE_API_KEY;
		delete process.env.MAX_LLM_COST_PER_RUN;

		// Clear configuration cache
		clearLLMConfigCache();
	});

	afterEach(() => {
		clearLLMConfigCache();
	});

	describe("loadLLMConfig", () => {
		test("should return default config when LLM is disabled", () => {
			const config = loadLLMConfig();

			expect(config.enabled).toBe(false);
			expect(config.primaryProvider).toBe("openai");
			expect(config.fallbackProviders).toEqual(["anthropic", "google"]);
		});

		test("should enable LLM when environment variable is set", () => {
			process.env.ENABLE_LLM_ENHANCEMENT = "true";

			const config = loadLLMConfig();

			expect(config.enabled).toBe(true);
		});

		test("should configure primary provider from environment", () => {
			process.env.ENABLE_LLM_ENHANCEMENT = "true";
			process.env.LLM_PROVIDER = "anthropic";

			const config = loadLLMConfig();

			expect(config.primaryProvider).toBe("anthropic");
		});

		test("should load API keys from environment", () => {
			process.env.ENABLE_LLM_ENHANCEMENT = "true";
			process.env.OPENAI_API_KEY = "sk-test-openai-key";
			process.env.ANTHROPIC_API_KEY = "sk-test-anthropic-key";
			process.env.GOOGLE_API_KEY = "test-google-key";

			const config = loadLLMConfig();

			expect(config.providers.openai.apiKey).toBe("sk-test-openai-key");
			expect(config.providers.anthropic.apiKey).toBe("sk-test-anthropic-key");
			expect(config.providers.google.apiKey).toBe("test-google-key");
		});

		test("should configure cost limits from environment", () => {
			process.env.ENABLE_LLM_ENHANCEMENT = "true";
			process.env.MAX_LLM_COST_PER_RUN = "5.0";
			process.env.MAX_LLM_COST_PER_MONTH = "100.0";
			process.env.MAX_TOKENS_PER_ISSUE = "10000";

			const config = loadLLMConfig();

			expect(config.costControls.maxCostPerRun).toBe(5.0);
			expect(config.costControls.maxCostPerMonth).toBe(100.0);
			expect(config.costControls.maxTokensPerIssue).toBe(10000);
		});

		test("should handle GitHub Action inputs", () => {
			// Simulate GitHub Action environment
			process.env.INPUT_ENABLE_LLM_ENHANCEMENT = "true";
			process.env.INPUT_LLM_PROVIDER = "anthropic";
			process.env.INPUT_MAX_LLM_COST_PER_RUN = "3.0";

			// Mock isGitHubAction
			const originalEnv = process.env.GITHUB_ACTIONS;
			process.env.GITHUB_ACTIONS = "true";

			clearLLMConfigCache();
			const config = loadLLMConfig();

			expect(config.enabled).toBe(true);
			expect(config.primaryProvider).toBe("anthropic");
			expect(config.costControls.maxCostPerRun).toBe(3.0);

			// Restore environment
			if (originalEnv) {
				process.env.GITHUB_ACTIONS = originalEnv;
			} else {
				delete process.env.GITHUB_ACTIONS;
			}
		});

		test("should handle invalid numeric values gracefully", () => {
			process.env.ENABLE_LLM_ENHANCEMENT = "true";
			process.env.MAX_LLM_COST_PER_RUN = "invalid";
			process.env.MAX_TOKENS_PER_ISSUE = "not-a-number";

			const config = loadLLMConfig();

			// Should use default values when parsing fails
			expect(config.costControls.maxCostPerRun).toBe(
				DEFAULT_LLM_CONFIG.costControls.maxCostPerRun,
			);
			expect(config.costControls.maxTokensPerIssue).toBe(
				DEFAULT_LLM_CONFIG.costControls.maxTokensPerIssue,
			);
		});
	});

	describe("validateLLMConfig", () => {
		test("should validate disabled config as valid", () => {
			const config = { ...DEFAULT_LLM_CONFIG, enabled: false };

			const result = validateLLMConfig(config);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.warnings).toContain("LLM enhancement is disabled");
		});

		test("should require API key for primary provider", () => {
			const config: LLMEnhancementConfig = {
				...DEFAULT_LLM_CONFIG,
				enabled: true,
				providers: {
					...DEFAULT_LLM_CONFIG.providers,
					openai: {
						...DEFAULT_LLM_CONFIG.providers.openai,
						apiKey: "",
					},
				},
			};

			const result = validateLLMConfig(config);

			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"API key missing for primary provider: openai",
			);
		});

		test("should require model for primary provider", () => {
			const config: LLMEnhancementConfig = {
				...DEFAULT_LLM_CONFIG,
				enabled: true,
				providers: {
					...DEFAULT_LLM_CONFIG.providers,
					openai: {
						...DEFAULT_LLM_CONFIG.providers.openai,
						apiKey: "sk-test",
						model: "",
					},
				},
			};

			const result = validateLLMConfig(config);

			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Model not specified for primary provider: openai",
			);
		});

		test("should validate cost controls", () => {
			const config: LLMEnhancementConfig = {
				...DEFAULT_LLM_CONFIG,
				enabled: true,
				providers: {
					...DEFAULT_LLM_CONFIG.providers,
					openai: {
						...DEFAULT_LLM_CONFIG.providers.openai,
						apiKey: "sk-test",
					},
				},
				costControls: {
					...DEFAULT_LLM_CONFIG.costControls,
					maxCostPerRun: 0,
					maxCostPerMonth: -5,
				},
			};

			const result = validateLLMConfig(config);

			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Max cost per run must be greater than 0",
			);
			expect(result.errors).toContain(
				"Max cost per month must be greater than 0",
			);
		});

		test("should warn about missing fallback provider keys", () => {
			const config: LLMEnhancementConfig = {
				...DEFAULT_LLM_CONFIG,
				enabled: true,
				providers: {
					...DEFAULT_LLM_CONFIG.providers,
					openai: {
						...DEFAULT_LLM_CONFIG.providers.openai,
						apiKey: "sk-test",
					},
					anthropic: {
						...DEFAULT_LLM_CONFIG.providers.anthropic,
						apiKey: "", // Missing fallback key
					},
				},
			};

			const result = validateLLMConfig(config);

			expect(result.valid).toBe(true);
			expect(result.warnings).toContain(
				"API key missing for fallback provider: anthropic",
			);
		});

		test("should warn about unknown models", () => {
			const config: LLMEnhancementConfig = {
				...DEFAULT_LLM_CONFIG,
				enabled: true,
				providers: {
					...DEFAULT_LLM_CONFIG.providers,
					openai: {
						...DEFAULT_LLM_CONFIG.providers.openai,
						apiKey: "sk-test",
						model: "unknown-model",
					},
				},
			};

			const result = validateLLMConfig(config);

			expect(result.valid).toBe(true);
			expect(result.warnings).toContain(
				"Pricing information not available for model: unknown-model",
			);
		});
	});

	describe("calculateEstimatedCost", () => {
		test("should calculate cost for known models", () => {
			const cost = calculateEstimatedCost("openai", "gpt-4o-mini", 1000, 500);

			const pricing = LLM_MODEL_PRICING["gpt-4o-mini"];
			if (pricing) {
				const expectedCost =
					(1000 / 1000) * pricing.input + (500 / 1000) * pricing.output;
				expect(cost).toBe(expectedCost);
			} else {
				expect(cost).toBe(0);
			}
		});

		test("should handle unknown models", () => {
			const cost = calculateEstimatedCost("openai", "unknown-model", 1000, 500);

			expect(cost).toBe(0);
		});

		test("should handle missing output tokens", () => {
			const cost = calculateEstimatedCost("openai", "gpt-4o-mini", 1000);

			const pricing = LLM_MODEL_PRICING["gpt-4o-mini"];
			if (pricing) {
				const expectedCost = (1000 / 1000) * pricing.input;
				expect(cost).toBe(expectedCost);
			} else {
				expect(cost).toBe(0);
			}
		});

		test("should calculate costs for different providers", () => {
			const models = [
				{ provider: "openai" as const, model: "gpt-4o-mini" },
				{ provider: "anthropic" as const, model: "claude-3-5-haiku-20241022" },
				{ provider: "google" as const, model: "gemini-1.5-flash" },
			];

			for (const { provider, model } of models) {
				const cost = calculateEstimatedCost(provider, model, 1000, 500);
				expect(cost).toBeGreaterThan(0);
			}
		});
	});

	describe("checkCostLimits", () => {
		const mockConfig: LLMEnhancementConfig = {
			...DEFAULT_LLM_CONFIG,
			costControls: {
				...DEFAULT_LLM_CONFIG.costControls,
				maxCostPerRun: 2.0,
				maxCostPerMonth: 50.0,
			},
		};

		const mockUsage: LLMUsageStats = {
			totalTokensUsed: 10000,
			totalCostAccrued: 25.0,
			requestCount: 10,
			lastResetDate: new Date(),
			monthlyUsage: {
				tokens: 10000,
				cost: 25.0,
				requests: 10,
			},
			providerUsage: {
				openai: { tokens: 10000, cost: 25.0, requests: 10, successRate: 1.0 },
				anthropic: { tokens: 0, cost: 0, requests: 0, successRate: 1.0 },
				google: { tokens: 0, cost: 0, requests: 0, successRate: 1.0 },
				deepseek: { tokens: 0, cost: 0, requests: 0, successRate: 1.0 },
				xai: { tokens: 0, cost: 0, requests: 0, successRate: 1.0 },
			},
		};

		test("should allow requests within limits", () => {
			const result = checkCostLimits(mockConfig, mockUsage, 1.0);

			expect(result.withinLimits).toBe(true);
			expect(result.exceededLimits).toHaveLength(0);
			expect(result.remainingBudget.run).toBe(1.0);
			expect(result.remainingBudget.month).toBe(24.0);
		});

		test("should detect per-run limit exceeded", () => {
			const result = checkCostLimits(mockConfig, mockUsage, 3.0);

			expect(result.withinLimits).toBe(false);
			expect(result.exceededLimits).toContain("Per-run cost limit: $2");
			expect(result.remainingBudget.run).toBe(0);
		});

		test("should detect monthly limit exceeded", () => {
			const result = checkCostLimits(mockConfig, mockUsage, 30.0);

			expect(result.withinLimits).toBe(false);
			expect(result.exceededLimits).toContain("Monthly cost limit: $50");
			expect(result.remainingBudget.month).toBe(0);
		});

		test("should handle exact limit values", () => {
			const result = checkCostLimits(mockConfig, mockUsage, 2.0);

			expect(result.withinLimits).toBe(true);
			expect(result.remainingBudget.run).toBe(0);
		});
	});

	describe("sanitizeDataForLLM", () => {
		const testConfig: LLMEnhancementConfig = {
			...DEFAULT_LLM_CONFIG,
			security: {
				...DEFAULT_LLM_CONFIG.security,
				excludeSensitiveInfo: true,
				anonymizeData: false,
			},
		};

		test("should not sanitize when disabled", () => {
			const configNoSanitize = {
				...testConfig,
				security: {
					...testConfig.security,
					excludeSensitiveInfo: false,
				},
			};

			const input = "API key: sk-1234567890abcdef";
			const result = sanitizeDataForLLM(input, configNoSanitize);

			expect(result).toBe(input);
		});

		test("should redact API keys and tokens", () => {
			const input =
				"My API key is sk-1234567890abcdef and token is abc123def456";
			const result = sanitizeDataForLLM(input, testConfig);

			expect(result).toContain("[REDACTED]");
			expect(result).not.toContain("sk-1234567890abcdef");
		});

		test("should redact credit card numbers", () => {
			const input = "Credit card: 1234-5678-9012-3456";
			const result = sanitizeDataForLLM(input, testConfig);

			expect(result).toContain("[REDACTED]");
			expect(result).not.toContain("1234-5678-9012-3456");
		});

		test("should redact SSNs", () => {
			const input = "SSN: 123-45-6789";
			const result = sanitizeDataForLLM(input, testConfig);

			expect(result).toContain("[REDACTED]");
			expect(result).not.toContain("123-45-6789");
		});

		test("should conditionally redact emails when anonymization is enabled", () => {
			const configWithAnonymization = {
				...testConfig,
				security: {
					...testConfig.security,
					anonymizeData: true,
				},
			};

			const input = "Contact: user@example.com";
			const result = sanitizeDataForLLM(input, configWithAnonymization);

			expect(result).toContain("[REDACTED]");
			expect(result).not.toContain("user@example.com");
		});

		test("should not redact emails when anonymization is disabled", () => {
			const input = "Contact: user@example.com";
			const result = sanitizeDataForLLM(input, testConfig);

			expect(result).toBe(input);
		});

		test("should handle multiple sensitive patterns", () => {
			const input =
				"API: sk-test123, Card: 4111-1111-1111-1111, SSN: 555-55-5555";
			const result = sanitizeDataForLLM(input, testConfig);

			expect(result).toContain("[REDACTED]");
			expect(result).not.toContain("sk-test123");
			expect(result).not.toContain("4111-1111-1111-1111");
			expect(result).not.toContain("555-55-5555");
		});
	});

	describe("getLLMConfig caching", () => {
		test("should cache configuration", () => {
			process.env.ENABLE_LLM_ENHANCEMENT = "true";

			const config1 = getLLMConfig();
			const config2 = getLLMConfig();

			expect(config1).toBe(config2); // Same object reference
		});

		test("should reload after cache clear", () => {
			process.env.ENABLE_LLM_ENHANCEMENT = "true";

			const config1 = getLLMConfig();
			clearLLMConfigCache();

			process.env.ENABLE_LLM_ENHANCEMENT = "false";
			const config2 = getLLMConfig();

			expect(config1.enabled).toBe(true);
			expect(config2.enabled).toBe(false);
		});
	});

	describe("DEFAULT_LLM_CONFIG", () => {
		test("should have sensible defaults", () => {
			expect(DEFAULT_LLM_CONFIG.enabled).toBe(false);
			expect(DEFAULT_LLM_CONFIG.primaryProvider).toBe("openai");
			expect(DEFAULT_LLM_CONFIG.fallbackProviders).toContain("anthropic");
			expect(DEFAULT_LLM_CONFIG.fallbackProviders).toContain("google");
			expect(DEFAULT_LLM_CONFIG.costControls.maxCostPerRun).toBeGreaterThan(0);
			expect(DEFAULT_LLM_CONFIG.costControls.maxCostPerMonth).toBeGreaterThan(
				0,
			);
			expect(DEFAULT_LLM_CONFIG.features.codebaseAnalysis).toBe(true);
			expect(DEFAULT_LLM_CONFIG.security.excludeSensitiveInfo).toBe(true);
		});

		test("should have valid provider configurations", () => {
			for (const [_provider, config] of Object.entries(
				DEFAULT_LLM_CONFIG.providers,
			)) {
				expect(config.model).toBeTruthy();
				expect(config.maxTokens).toBeGreaterThan(0);
				expect(config.temperature).toBeGreaterThanOrEqual(0);
				expect(config.temperature).toBeLessThanOrEqual(2);
				expect(config.timeout).toBeGreaterThan(0);
				expect(config.maxRetries).toBeGreaterThanOrEqual(0);
			}
		});
	});

	describe("LLM_MODEL_PRICING", () => {
		test("should have pricing for all models in config", () => {
			const configModels = [
				DEFAULT_LLM_CONFIG.providers.openai.model,
				DEFAULT_LLM_CONFIG.providers.anthropic.model,
				DEFAULT_LLM_CONFIG.providers.google.model,
			];

			for (const model of configModels) {
				const pricing = LLM_MODEL_PRICING[model];
				expect(pricing).toBeTruthy();
				if (pricing) {
					expect(pricing.input).toBeGreaterThan(0);
					expect(pricing.output).toBeGreaterThan(0);
				}
			}
		});

		test("should have reasonable pricing ranges", () => {
			for (const [_model, pricing] of Object.entries(LLM_MODEL_PRICING)) {
				// Input pricing should be less than $0.1 per 1K tokens for most models
				expect(pricing.input).toBeLessThan(0.1);
				// Output pricing should be less than $0.5 per 1K tokens for most models
				expect(pricing.output).toBeLessThan(0.5);
				// Output should typically cost more than input
				expect(pricing.output).toBeGreaterThanOrEqual(pricing.input);
			}
		});
	});
});
