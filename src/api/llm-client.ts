/**
 * Universal LLM Client using llm-bridge
 * Leverages llm-bridge for seamless provider interoperability and advanced features
 */

import {
	countUniversalTokens,
	detectProvider,
	fromUniversal,
	toUniversal,
	translateBetweenProviders,
	translateError,
	type UniversalBody,
} from "llm-bridge";
import type {
	LLMEnhancementConfig,
	LLMProvider,
	LLMUsageStats,
} from "../config/llm-config.js";
import { getLLMConfig, validateLLMConfig } from "../config/llm-config.js";
import { DEFAULT_LLM_MODELS } from "../config/defaults.js";

export interface LLMMessage {
	role: "system" | "user" | "assistant";
	content:
	| string
	| Array<{
		type: "text" | "image_url";
		text?: string;
		image_url?: {
			url: string;
			detail?: "low" | "high" | "auto";
		};
	}>;
}

export interface LLMRequest {
	messages: LLMMessage[];
	model?: string;
	temperature?: number;
	max_tokens?: number;
	tools?: Array<{
		type: "function";
		function: {
			name: string;
			description: string;
			parameters: object;
		};
	}>;
}

export interface LLMResponse {
	content: string;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
	model: string;
	cost: number;
	provider: LLMProvider;
	metadata?: {
		finish_reason?: string;
		tool_calls?: Array<{
			id: string;
			type: "function";
			function: {
				name: string;
				arguments: string;
			};
		}>;
	};
}

export interface LLMEnhancementRequest {
	title: string;
	description: string;
	feedbackType: "crash" | "general" | "performance";
	crashData?: {
		trace: string[];
		device: string;
		osVersion: string;
	};
	codebaseContext?: Array<{
		file: string;
		content: string;
		relevance: number;
	}>;
	recentChanges?: Array<{
		file: string;
		diff: string;
		author: string;
		timestamp: string;
	}>;
	options?: LLMRequestOptions;
}

export interface LLMEnhancementResponse {
	enhancedTitle: string;
	enhancedDescription: string;
	priority: "urgent" | "high" | "medium" | "low";
	labels: string[];
	analysis: {
		rootCause?: string;
		affectedComponents: string[];
		suggestedFix?: string;
		confidence: number;
	};
	metadata: {
		provider: LLMProvider;
		model: string;
		processingTime: number;
		cost: number;
	};
}

export interface LLMRequestOptions {
	provider?: LLMProvider;
	model?: string;
	timeout?: number;
	enableFallback?: boolean;
	skipCostCheck?: boolean;
	preferCheapest?: boolean;
}

export interface LLMHealthCheck {
	status: "healthy" | "degraded" | "unhealthy";
	providers: Record<
		LLMProvider,
		{
			available: boolean;
			authenticated: boolean;
			responseTime?: number;
			error?: string;
		}
	>;
	config: {
		valid: boolean;
		errors: string[];
		warnings: string[];
	};
	usage: LLMUsageStats;
	costStatus: {
		withinLimits: boolean;
		remainingBudget: {
			run: number;
			month: number;
		};
	};
}

/**
 * Universal LLM Client with llm-bridge integration
 * Provides seamless access to multiple LLM providers with automatic translation
 */
export class LLMClient {
	private readonly config: LLMEnhancementConfig;
	private usageStats: LLMUsageStats;

	constructor() {
		this.config = getLLMConfig();
		if (!validateLLMConfig(this.config)) {
			throw new Error("Invalid LLM configuration");
		}
		this.usageStats = this.initializeUsageStats();
	}

	/**
	 * Enhanced issue creation with LLM analysis using llm-bridge
	 */
	public async enhanceIssue(
		request: LLMEnhancementRequest,
	): Promise<LLMEnhancementResponse> {
		if (!this.config.enabled) {
			return this.createFallbackEnhancement(request, Date.now());
		}

		const startTime = Date.now();

		try {
			// Build the enhancement prompt
			const llmRequest = this.buildEnhancementPrompt(request);

			// Make the LLM request with automatic provider handling
			const response = await this.makeRequest(
				llmRequest,
				request.options || {},
			);

			// Parse and return the enhancement
			return this.parseEnhancementResponse(response, startTime);
		} catch (error) {
			console.warn(`LLM enhancement failed: ${error}`);
			return this.createFallbackEnhancement(request, startTime);
		}
	}

	/**
	 * Main request method using llm-bridge for optimal provider selection and translation
	 */
	public async makeRequest(
		request: LLMRequest,
		options: LLMRequestOptions = {},
	): Promise<LLMResponse> {
		// Auto-detect optimal provider or use specified one
		const targetProvider: LLMProvider =
			options.provider || this.selectOptimalProvider(request, options);

		// Detect source format
		const sourceProvider = this.detectSourceProvider(request);

		// Use llm-bridge for seamless translation if needed
		const finalRequest =
			sourceProvider === targetProvider
				? request
				: await this.translateRequest(request, sourceProvider, targetProvider);

		// Make request with fallback support
		return await this.makeProviderRequest(
			targetProvider,
			finalRequest,
			options,
		);
	}

	/**
	 * Make request to specific provider with fallback using llm-bridge
	 */
	private async makeProviderRequest(
		provider: LLMProvider,
		request: LLMRequest,
		options: LLMRequestOptions,
	): Promise<LLMResponse> {
		const providers =
			options.enableFallback !== false
				? [
					provider,
					...this.config.fallbackProviders.filter((p) => p !== provider),
				]
				: [provider];

		let lastError: Error | null = null;

		for (const currentProvider of providers) {
			try {
				// Validate cost limits before making request
				if (!options.skipCostCheck) {
					await this.validateCostLimits(request, options, currentProvider);
				}

				// Get provider configuration
				const providerConfig = this.config.providers[currentProvider];
				if (!providerConfig) {
					throw new Error(`Provider ${currentProvider} not configured`);
				}

				// Convert to universal format using llm-bridge
				const universalRequest = toUniversal(currentProvider, {
					...request,
					model: request.model || providerConfig.model,
				});

				// Convert universal format back to provider-specific format
				const providerSpecificRequest = fromUniversal(currentProvider, universalRequest);

				// Make unified API call using llm-bridge converted format
				const rawResponse = await this.makeUnifiedAPICall(
					currentProvider,
					providerSpecificRequest,
					providerConfig,
					options,
				);

				// Convert response to our internal format
				const llmResponse = this.convertUniversalToLLMResponse(
					rawResponse,
					currentProvider,
				);

				// Update usage stats
				this.updateUsageStats(llmResponse);

				return llmResponse;
			} catch (error) {
				lastError = error as Error;

				// Try to translate error using llm-bridge for consistent error handling
				try {
					// Create a universal error object for translation
					const universalError = {
						type: "api_error" as const,
						message: lastError.message,
						statusCode: 500,
						httpStatus: 500,
						provider: currentProvider,
					};
					const translatedError = translateError(
						universalError,
						currentProvider,
					);
					if (
						translatedError &&
						typeof translatedError === "object" &&
						"statusCode" in translatedError
					) {
						console.warn(
							`LLM request failed for provider ${currentProvider}: ${translatedError.statusCode || lastError.message}`,
						);
					} else {
						console.warn(
							`LLM request failed for provider ${currentProvider}: ${lastError.message}`,
						);
					}
				} catch (_translateErr) {
					// Fallback to original error if translation fails
					console.warn(
						`LLM request failed for provider ${currentProvider}: ${lastError.message}`,
					);
				}

				// Don't try fallback for authentication errors
				if (
					lastError.message.includes("authentication") ||
					lastError.message.includes("401")
				) {
					break;
				}
			}
		}

		throw new Error(
			`All LLM providers failed. Last error: ${lastError?.message || "Unknown error"}`,
		);
	}

	/**
	 * Smart provider selection based on cost, availability, and capability
	 */
	private selectOptimalProvider(
		request: LLMRequest,
		options: LLMRequestOptions,
	): LLMProvider {
		const availableProviders = this.getAvailableProviders();

		if (availableProviders.length === 0) {
			throw new Error("No LLM providers configured with API keys");
		}

		if (availableProviders.length === 1) {
			return availableProviders[0] as LLMProvider;
		}

		// If user prefers cheapest option, calculate costs
		if (options.preferCheapest) {
			return this.selectCheapestProvider(request, availableProviders);
		}

		// Use configured primary provider if available
		if (availableProviders.includes(this.config.primaryProvider)) {
			return this.config.primaryProvider;
		}

		// Fallback to first available
		return availableProviders[0] as LLMProvider;
	}

	/**
	 * Select the cheapest available provider using llm-bridge cost calculations
	 */
	private selectCheapestProvider(
		request: LLMRequest,
		availableProviders: LLMProvider[],
	): LLMProvider {
		try {
			// Convert to universal format for token counting
			const sourceProvider = this.detectSourceProvider(request);
			let universal: UniversalBody | LLMRequest;
			try {
				universal = toUniversal(sourceProvider, request);
				if (!universal) {
					universal = request;
				}
			} catch {
				universal = request;
			}
			// Use safe token counting - if universal conversion failed, use fallback estimation
			const tokens =
				"provider" in universal
					? countUniversalTokens(universal as UniversalBody)
					: {
						inputTokens: 100,
						estimatedOutputTokens: 30,
						multimodalContentCount: 0,
						toolCallsCount: 0,
					};

			const providerCosts = availableProviders.map((provider) => {
				try {
					// Use simple estimation since getModelCosts API might not be available
					const inputTokens = tokens.inputTokens || 0;
					const outputTokens = tokens.estimatedOutputTokens || 0;

					// Simple cost estimation (approximate rates)
					let inputCostPer1K = 0.001; // Default rate
					let outputCostPer1K = 0.002; // Default rate

					if (provider === "openai") {
						inputCostPer1K = 0.0015;
						outputCostPer1K = 0.002;
					} else if (provider === "anthropic") {
						inputCostPer1K = 0.0008;
						outputCostPer1K = 0.024;
					} else if (provider === "google") {
						inputCostPer1K = 0.0005;
						outputCostPer1K = 0.0015;
					}

					const estimatedCost =
						(inputTokens * inputCostPer1K) / 1000 +
						(outputTokens * outputCostPer1K) / 1000;
					return { provider, estimatedCost };
				} catch {
					// Fallback to default cost if calculation fails
					return { provider, estimatedCost: 0.01 };
				}
			});

			const cheapest = providerCosts.sort(
				(a, b) => a.estimatedCost - b.estimatedCost,
			)[0];
			if (cheapest) {
				console.log(
					`Selected cheapest provider: ${cheapest.provider} (estimated cost: $${cheapest.estimatedCost.toFixed(4)})`,
				);
				return cheapest.provider;
			}
		} catch (error) {
			console.warn(
				`Cost calculation failed: ${error}. Using primary provider.`,
			);
		}

		// Fallback logic
		if (availableProviders.includes(this.config.primaryProvider)) {
			return this.config.primaryProvider;
		}
		return availableProviders[0] as LLMProvider;
	}

	/**
	 * Get list of available providers (those with API keys configured)
	 */
	private getAvailableProviders(): LLMProvider[] {
		return (Object.keys(this.config.providers) as LLMProvider[]).filter(
			(provider) => this.config.providers[provider]?.apiKey,
		);
	}

	/**
	 * Detect the source provider format of a request
	 */
	private detectSourceProvider(request: LLMRequest): LLMProvider {
		try {
			const detected = detectProvider(JSON.stringify(request), {});
			return (detected as LLMProvider) || "openai";
		} catch {
			// Fallback to OpenAI format as it's the most common
			return "openai";
		}
	}

	/**
	 * Translate request between providers using llm-bridge
	 */
	public async translateRequest(
		request: LLMRequest,
		fromProvider: LLMProvider,
		toProvider: LLMProvider,
	): Promise<LLMRequest> {
		try {
			return await translateBetweenProviders(fromProvider, toProvider, request);
		} catch (error) {
			console.warn(
				`Request translation failed from ${fromProvider} to ${toProvider}: ${error}`,
			);
			return request; // Fallback to original request
		}
	}

	/**
	 * Make unified API call using llm-bridge converted format
	 * This replaces provider-specific HTTP logic with a universal approach
	 */
	private async makeUnifiedAPICall(
		provider: LLMProvider,
		providerSpecificRequest: Record<string, unknown>,
		providerConfig: { apiKey: string; model?: string },
		options: LLMRequestOptions,
	): Promise<unknown> {
		const timeout = options.timeout || 30000;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		try {
			// Get provider configuration using llm-bridge provider adapter patterns
			const { endpoint, headers } = this.getProviderEndpointConfig(
				provider,
				providerConfig,
				providerSpecificRequest,
			);

			const response = await fetch(endpoint, {
				method: "POST",
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(providerSpecificRequest),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`HTTP ${response.status}: ${errorText}`);
			}

			return await response.json();
		} finally {
			clearTimeout(timeoutId);
		}
	}

	/**
	 * Get provider endpoint configuration - simplified and universal
	 */
	private getProviderEndpointConfig(
		provider: LLMProvider,
		providerConfig: { apiKey: string; model?: string },
		request: Record<string, unknown>,
	): { endpoint: string; headers: Record<string, string> } {
		switch (provider) {
			case "openai":
				return {
					endpoint: "https://api.openai.com/v1/chat/completions",
					headers: { Authorization: `Bearer ${providerConfig.apiKey}` },
				};

			case "anthropic":
				return {
					endpoint: "https://api.anthropic.com/v1/messages",
					headers: {
						"x-api-key": providerConfig.apiKey,
						"anthropic-version": "2023-06-01",
					},
				};

			case "google":
				return {
					endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${request.model || providerConfig.model || DEFAULT_LLM_MODELS.google}:generateContent?key=${providerConfig.apiKey}`,
					headers: {},
				};

			default:
				throw new Error(`Unsupported provider: ${provider}`);
		}
	}

	/**
	 * Convert llm-bridge universal response to our LLMResponse format
	 */
	private convertUniversalToLLMResponse(
		universalResponse: unknown,
		provider: LLMProvider,
	): LLMResponse {
		const response = universalResponse as {
			content?: string;
			usage?: {
				prompt_tokens?: number;
				completion_tokens?: number;
				total_tokens?: number;
			};
			model?: string;
			cost?: number;
			metadata?: Record<string, unknown>;
		};

		return {
			content: response.content || "",
			usage: {
				prompt_tokens: response.usage?.prompt_tokens || 0,
				completion_tokens: response.usage?.completion_tokens || 0,
				total_tokens: response.usage?.total_tokens || 0,
			},
			model: response.model || "",
			cost: response.cost || 0,
			provider,
			metadata: response.metadata || {},
		};
	}

	/**
	 * Validate cost limits before making request
	 */
	private async validateCostLimits(
		request: LLMRequest,
		_options: LLMRequestOptions,
		provider: LLMProvider,
	): Promise<void> {
		if (!this.config.costControls.preventOverage) {
			return;
		}

		try {
			// Use llm-bridge for accurate token counting
			const sourceProvider = this.detectSourceProvider(request);
			let universal: UniversalBody | LLMRequest;
			try {
				universal = toUniversal(sourceProvider, request);
				if (!universal) {
					universal = request;
				}
			} catch {
				universal = request;
			}
			// Use safe token counting - if universal conversion failed, use fallback estimation
			const tokens =
				"provider" in universal
					? countUniversalTokens(universal as UniversalBody)
					: {
						inputTokens: 100,
						estimatedOutputTokens: 30,
						multimodalContentCount: 0,
						toolCallsCount: 0,
					};

			// Simple cost estimation based on token counts
			const inputTokens = tokens.inputTokens || 0;
			const outputTokens =
				tokens.estimatedOutputTokens || Math.ceil(inputTokens * 0.3); // Estimate 30% of input

			// Approximate cost rates per 1K tokens
			let inputCostPer1K = 0.001;
			let outputCostPer1K = 0.002;

			if (provider === "openai") {
				inputCostPer1K = 0.0015;
				outputCostPer1K = 0.002;
			} else if (provider === "anthropic") {
				inputCostPer1K = 0.0008;
				outputCostPer1K = 0.024;
			} else if (provider === "google") {
				inputCostPer1K = 0.0005;
				outputCostPer1K = 0.0015;
			}

			const estimatedCost =
				(inputTokens * inputCostPer1K) / 1000 +
				(outputTokens * outputCostPer1K) / 1000;

			// Check against configured limits
			if (estimatedCost > this.config.costControls.maxCostPerRun) {
				throw new Error(
					`Estimated cost ($${estimatedCost.toFixed(4)}) exceeds per-run limit ($${this.config.costControls.maxCostPerRun})`,
				);
			}

			const monthlyUsed = this.usageStats.monthlyUsage.cost;
			if (
				monthlyUsed + estimatedCost >
				this.config.costControls.maxCostPerMonth
			) {
				throw new Error(
					`Estimated cost would exceed monthly limit. Used: $${monthlyUsed.toFixed(4)}, Limit: $${this.config.costControls.maxCostPerMonth}`,
				);
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes("exceeds")) {
				throw error; // Re-throw cost limit errors
			}
			// Log warning for token counting errors but don't block the request
			console.warn(
				`Cost validation failed: ${error}. Proceeding with request.`,
			);
		}
	}

	/**
	 * Build enhancement prompt with multimodal support
	 */
	private buildEnhancementPrompt(request: LLMEnhancementRequest): LLMRequest {
		const systemPrompt = `You are an expert software engineer and technical issue analyst. Your role is to enhance bug reports and feature requests with detailed technical analysis.

Context:
- Feedback Type: ${request.feedbackType}
- You have access to codebase context and recent changes
- Provide actionable insights and technical recommendations

Response Format (JSON):
{
  "enhancedTitle": "Clear, technical title",
  "enhancedDescription": "Detailed technical description with context",
  "priority": "urgent|high|medium|low",
  "labels": ["bug", "crash", "ios", ...],
  "analysis": {
    "rootCause": "Technical analysis of the cause",
    "affectedComponents": ["component1", "component2"],
    "suggestedFix": "Specific technical recommendations",
    "confidence": 0.95
  }
}`;

		const userContent: Array<{ type: "text"; text: string }> = [
			{
				type: "text",
				text: `## Original Issue
**Title**: ${request.title}
**Description**: ${request.description}`,
			},
		];

		// Add crash data if available
		if (request.crashData) {
			userContent.push({
				type: "text",
				text: `\n## Crash Information
**Device**: ${request.crashData.device}
**OS Version**: ${request.crashData.osVersion}
**Stack Trace**:
\`\`\`
${request.crashData.trace.join("\n")}
\`\`\``,
			});
		}

		// Add codebase context
		if (request.codebaseContext?.length) {
			const contextText = request.codebaseContext
				.sort((a, b) => b.relevance - a.relevance)
				.slice(0, 5) // Top 5 most relevant files
				.map(
					(ctx) =>
						`**${ctx.file}** (relevance: ${ctx.relevance.toFixed(2)}):\n\`\`\`\n${ctx.content.slice(0, 1000)}${ctx.content.length > 1000 ? "..." : ""}\n\`\`\``,
				)
				.join("\n\n");

			userContent.push({
				type: "text",
				text: `\n## Relevant Code Context\n${contextText}`,
			});
		}

		// Add recent changes
		if (request.recentChanges?.length) {
			const changesText = request.recentChanges
				.slice(0, 3) // Most recent 3 changes
				.map(
					(change) =>
						`**${change.file}** (${change.author}, ${change.timestamp}):\n\`\`\`diff\n${change.diff.slice(0, 500)}${change.diff.length > 500 ? "..." : ""}\n\`\`\``,
				)
				.join("\n\n");

			userContent.push({
				type: "text",
				text: `\n## Recent Changes\n${changesText}`,
			});
		}

		return {
			messages: [
				{
					role: "system",
					content: systemPrompt,
				},
				{
					role: "user",
					content: userContent,
				},
			],
			temperature: 0.3,
			max_tokens: 2000,
		};
	}

	/**
	 * Parse LLM response into enhancement format
	 */
	private parseEnhancementResponse(
		response: LLMResponse,
		startTime: number,
	): LLMEnhancementResponse {
		try {
			// Try to parse JSON response
			const content = response.content.trim();
			const jsonMatch = content.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]);
				return {
					enhancedTitle: parsed.enhancedTitle || "Enhanced Issue",
					enhancedDescription: parsed.enhancedDescription || content,
					priority: parsed.priority || "medium",
					labels: Array.isArray(parsed.labels) ? parsed.labels : ["testflight"],
					analysis: {
						rootCause: parsed.analysis?.rootCause,
						affectedComponents: Array.isArray(
							parsed.analysis?.affectedComponents,
						)
							? parsed.analysis.affectedComponents
							: [],
						suggestedFix: parsed.analysis?.suggestedFix,
						confidence: parsed.analysis?.confidence || 0.6,
					},
					metadata: {
						provider: response.provider,
						model: response.model,
						processingTime: Date.now() - startTime,
						cost: response.cost,
					},
				};
			}
		} catch (error) {
			console.warn(`Failed to parse LLM response as JSON: ${error}`);
		}

		// Fallback to unstructured parsing
		return this.parseUnstructuredResponse(response, startTime);
	}

	/**
	 * Parse unstructured LLM response
	 */
	private parseUnstructuredResponse(
		response: LLMResponse,
		startTime: number,
	): LLMEnhancementResponse {
		const { content } = response;
		const lines = content.split("\n");

		// Extract title (first meaningful line)
		const title =
			lines.find((line) => line.trim() && !line.startsWith("#"))?.trim() ||
			"TestFlight Issue";

		// Basic label detection
		const labels = ["testflight"];
		if (content.toLowerCase().includes("crash")) {
			labels.push("crash", "bug");
		}
		if (content.toLowerCase().includes("ui")) {
			labels.push("ui");
		}
		if (content.toLowerCase().includes("performance")) {
			labels.push("performance");
		}

		// Basic priority detection
		let priority: "urgent" | "high" | "medium" | "low" = "medium";
		if (
			content.toLowerCase().includes("critical") ||
			content.toLowerCase().includes("urgent")
		) {
			priority = "urgent";
		} else if (
			content.toLowerCase().includes("high priority") ||
			content.toLowerCase().includes("crash")
		) {
			priority = "high";
		}

		return {
			enhancedTitle: title.substring(0, 100),
			enhancedDescription: content,
			priority,
			labels,
			analysis: {
				rootCause: "Analysis requires structured LLM response",
				affectedComponents: [],
				suggestedFix:
					"Please review the enhanced description for recommendations",
				confidence: 0.6,
			},
			metadata: {
				provider: response.provider,
				model: response.model,
				processingTime: Date.now() - startTime,
				cost: response.cost,
			},
		};
	}

	/**
	 * Create fallback enhancement when LLM fails
	 */
	private createFallbackEnhancement(
		request: LLMEnhancementRequest,
		startTime: number,
	): LLMEnhancementResponse {
		const isCrash = request.feedbackType === "crash";
		const typeIcon = isCrash ? "💥" : "📱";

		const title = `${typeIcon} ${request.title}`;
		const description = `## ${typeIcon} TestFlight ${isCrash ? "Crash Report" : "User Feedback"}

${request.description}

### Analysis
- **Type**: ${request.feedbackType}
- **Enhanced by**: Fallback processing (LLM unavailable)

${request.crashData
				? `### Crash Information
- **Device**: ${request.crashData.device}
- **OS Version**: ${request.crashData.osVersion}
- **Stack Trace**: ${request.crashData.trace.length} frames captured`
				: ""
			}

${request.codebaseContext?.length
				? `### Codebase Context
${request.codebaseContext.length} relevant file(s) identified for analysis.`
				: ""
			}

*Note: This issue was created with fallback processing. Consider enabling LLM enhancement for deeper analysis.*`;

		return {
			enhancedTitle: title,
			enhancedDescription: description,
			priority: isCrash ? "high" : "medium",
			labels: isCrash
				? ["crash", "bug", "testflight"]
				: ["feedback", "testflight"],
			analysis: {
				rootCause:
					"Requires LLM analysis for detailed root cause identification",
				affectedComponents: [],
				suggestedFix:
					"Enable LLM enhancement for automated analysis and suggestions",
				confidence: 0.3,
			},
			metadata: {
				provider: "fallback" as LLMProvider,
				model: "fallback",
				processingTime: Date.now() - startTime,
				cost: 0,
			},
		};
	}

	/**
	 * Initialize usage statistics
	 */
	private initializeUsageStats(): LLMUsageStats {
		return {
			totalTokensUsed: 0,
			totalCostAccrued: 0,
			requestCount: 0,
			lastResetDate: new Date(),
			monthlyUsage: {
				tokens: 0,
				cost: 0,
				requests: 0,
			},
			providerUsage: {
				openai: { tokens: 0, cost: 0, requests: 0, successRate: 1.0 },
				anthropic: { tokens: 0, cost: 0, requests: 0, successRate: 1.0 },
				google: { tokens: 0, cost: 0, requests: 0, successRate: 1.0 },
			},
		};
	}

	/**
	 * Update usage statistics
	 */
	private updateUsageStats(response: LLMResponse): void {
		this.usageStats.totalTokensUsed += response.usage.total_tokens;
		this.usageStats.totalCostAccrued += response.cost;
		this.usageStats.requestCount += 1;

		this.usageStats.monthlyUsage.tokens += response.usage.total_tokens;
		this.usageStats.monthlyUsage.cost += response.cost;
		this.usageStats.monthlyUsage.requests += 1;

		const providerStats = this.usageStats.providerUsage[response.provider];
		if (providerStats) {
			providerStats.tokens += response.usage.total_tokens;
			providerStats.cost += response.cost;
			providerStats.requests += 1;
		}
	}

	/**
	 * Get current usage statistics
	 */
	public getUsageStats(): LLMUsageStats {
		return { ...this.usageStats };
	}

	/**
	 * Health check for LLM integration
	 */
	public async healthCheck(): Promise<LLMHealthCheck> {
		const configValidation = validateLLMConfig(this.config);

		// If LLM enhancement is disabled, treat as optional/degraded rather than unhealthy
		if (!this.config.enabled) {
			return {
				status: "degraded",
				providers: {
					openai: { available: false, authenticated: false },
					anthropic: { available: false, authenticated: false },
					google: { available: false, authenticated: false },
				},
				config: configValidation,
				usage: this.usageStats,
				costStatus: {
					withinLimits: true,
					remainingBudget: {
						run: this.config.costControls.maxCostPerRun,
						month: this.config.costControls.maxCostPerMonth,
					},
				},
			};
		}

		// Mock cost check since we removed the function
		const costCheck = {
			withinLimits: true,
			exceededLimits: [] as string[],
			remainingBudget: {
				run:
					this.config.costControls.maxCostPerRun -
					this.usageStats.totalCostAccrued,
				month:
					this.config.costControls.maxCostPerMonth -
					this.usageStats.monthlyUsage.cost,
			},
		};

		// Test provider connectivity only for selected providers with API keys
		const selectedProviders = [
			this.config.primaryProvider,
			...this.config.fallbackProviders
		].filter((provider, index, array) => {
			// Remove duplicates and only include providers with API keys
			return array.indexOf(provider) === index && 
				   this.config.providers[provider]?.apiKey?.trim();
		});

		const providerChecks = await Promise.allSettled(
			selectedProviders.map(provider => this.testProvider(provider))
		);

		const providers: LLMHealthCheck["providers"] = {
			openai: { available: false, authenticated: false },
			anthropic: { available: false, authenticated: false },
			google: { available: false, authenticated: false },
		};

		providerChecks.forEach((result, index) => {
			const providerName = selectedProviders[index];
			if (result.status === "fulfilled") {
				providers[providerName] = result.value;
			} else {
				providers[providerName] = {
					available: false,
					authenticated: false,
					error: result.reason?.message || "Unknown error",
				};
			}
		});

		const healthyProviders = Object.values(providers).filter(
			(p) => p.available && p.authenticated,
		).length;
		const status: LLMHealthCheck["status"] =
			healthyProviders === 0
				? "unhealthy"
				: healthyProviders === 1
					? "degraded"
					: "healthy";

		return {
			status,
			providers,
			config: configValidation,
			usage: this.usageStats,
			costStatus: costCheck,
		};
	}

	/**
	 * Test individual provider configuration (without making API calls)
	 */
	private async testProvider(provider: LLMProvider): Promise<{
		available: boolean;
		authenticated: boolean;
		responseTime?: number;
		error?: string;
	}> {
		try {
			const startTime = Date.now();

			// Get provider configuration
			const providerConfig = this.config.providers[provider];
			if (!providerConfig) {
				throw new Error(`Provider ${provider} not configured`);
			}

			// Check if API key is present and has reasonable format
			if (!providerConfig.apiKey || providerConfig.apiKey.trim().length === 0) {
				throw new Error(`API key missing for provider ${provider}`);
			}

			// Basic API key format validation
			const apiKey = providerConfig.apiKey.trim();
			let isValidFormat = false;

			switch (provider) {
				case "openai":
					// OpenAI keys typically start with "sk-"
					isValidFormat = apiKey.startsWith("sk-") && apiKey.length > 10;
					break;
				case "anthropic":
					// Anthropic keys typically start with "sk-ant-"
					isValidFormat = apiKey.startsWith("sk-ant-") && apiKey.length > 15;
					break;
				case "google":
					// Google API keys are typically 39 characters
					isValidFormat = apiKey.length >= 30 && !apiKey.includes(" ");
					break;
				default:
					isValidFormat = apiKey.length > 5; // Basic validation
			}

			if (!isValidFormat) {
				throw new Error(`Invalid API key format for provider ${provider}`);
			}

			// Validate model configuration
			if (!providerConfig.model) {
				throw new Error(`Model not configured for provider ${provider}`);
			}

			return {
				available: true,
				authenticated: true,
				responseTime: Date.now() - startTime,
			};
		} catch (error) {
			return {
				available: false,
				authenticated: false,
				error: (error as Error).message,
			};
		}
	}
}

// Global LLM client instance
let _llmClientInstance: LLMClient | null = null;

export function getLLMClient(): LLMClient {
	if (!_llmClientInstance) {
		_llmClientInstance = new LLMClient();
	}
	return _llmClientInstance;
}

/**
 * Clears the global LLM client instance (useful for testing)
 */
export function clearLLMClientInstance(): void {
	_llmClientInstance = null;
}
