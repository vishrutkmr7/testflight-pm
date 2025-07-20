/**
 * Universal LLM Client
 * Secure LLM interface using LLM Bridge for universal provider support
 */

import { encoding_for_model } from "tiktoken";
import type {
	LLMEnhancementConfig,
	LLMProvider,
	LLMUsageStats,
} from "../config/llm-config.js";
import {
	calculateEstimatedCost,
	checkCostLimits,
	getLLMConfig,
	sanitizeDataForLLM,
	validateLLMConfig,
} from "../config/llm-config.js";

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
	provider: LLMProvider;
	cost: number;
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

export interface LLMRequestOptions {
	provider?: LLMProvider;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	timeout?: number;
	retries?: number;
	enableFallback?: boolean;
	skipCostCheck?: boolean;
}

export interface LLMEnhancementRequest {
	feedback: {
		id: string;
		type: "crash" | "screenshot";
		appVersion: string;
		buildNumber: string;
		deviceInfo: {
			model: string;
			osVersion: string;
			family: string;
			locale: string;
		};
		submittedAt: string;
		crashData?: {
			type: string;
			exceptionType?: string;
			exceptionMessage?: string;
			trace: string;
		};
		screenshotData?: {
			text?: string;
			images: Array<{
				fileName: string;
				url: string;
			}>;
		};
	};
	codebaseContext?: {
		relevantFiles: Array<{
			path: string;
			content: string;
			lines?: string;
			confidence: number;
		}>;
		recentChanges?: Array<{
			file: string;
			diff: string;
			author: string;
			timestamp: string;
		}>;
		relatedIssues?: Array<{
			title: string;
			number: number;
			labels: string[];
		}>;
	};
	options?: LLMRequestOptions;
}

export interface LLMEnhancementResponse {
	title: string;
	description: string;
	labels: string[];
	priority: "urgent" | "high" | "normal" | "low";
	relevantCodeAreas: Array<{
		file: string;
		lines: string;
		confidence: number;
		reason: string;
	}>;
	suggestedAssignees?: string[];
	estimatedEffort?: string;
	reproductionSteps?: string[];
	affectedComponents?: string[];
	rootCauseAnalysis?: string;
	suggestedFix?: string;
	metadata: {
		enhancementVersion: string;
		processingTime: number;
		provider: LLMProvider;
		model: string;
		cost: number;
		confidence: number;
	};
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
 * Universal LLM Client with provider fallback and cost management
 */
export class LLMClient {
	private readonly config: LLMEnhancementConfig;
	private usage: LLMUsageStats;
	private readonly defaultTimeout = 30000;

	constructor() {
		this.config = getLLMConfig();
		this.usage = this.initializeUsageStats();
	}

	/**
	 * Enhances TestFlight feedback with LLM analysis
	 */
	public async enhanceIssue(
		request: LLMEnhancementRequest,
	): Promise<LLMEnhancementResponse> {
		const startTime = Date.now();

		try {
			// Validate configuration
			const validation = validateLLMConfig(this.config);
			if (!validation.valid) {
				throw new Error(
					`LLM configuration invalid: ${validation.errors.join(", ")}`,
				);
			}

			// Build enhancement prompt
			const llmRequest = this.buildEnhancementPrompt(request);

			// Make LLM request with fallback
			const response = await this.makeRequest(llmRequest, request.options);

			// Parse structured response
			const enhancement = this.parseEnhancementResponse(response, startTime);

			// Update usage statistics
			this.updateUsageStats(response);

			return enhancement;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.error(`LLM enhancement failed: ${errorMessage}`);

			// Return basic enhancement as fallback
			return this.createFallbackEnhancement(request, startTime);
		}
	}

	/**
	 * Makes a raw LLM request with provider fallback
	 */
	public async makeRequest(
		request: LLMRequest,
		options: LLMRequestOptions = {},
	): Promise<LLMResponse> {
		if (!this.config.enabled) {
			throw new Error("LLM enhancement is disabled");
		}

		const providers = [
			options.provider || this.config.primaryProvider,
			...(options.enableFallback !== false
				? this.config.fallbackProviders
				: []),
		];

		let lastError: Error | null = null;

		for (const provider of providers) {
			try {
				return await this.makeProviderRequest(provider, request, options);
			} catch (error) {
				lastError = error as Error;
				console.warn(
					`LLM request failed for provider ${provider}: ${lastError.message}`,
				);
			}
		}

		throw new Error(
			`All LLM providers failed. Last error: ${lastError?.message}`,
		);
	}

	/**
	 * Makes a request to a specific provider
	 */
	private async makeProviderRequest(
		provider: LLMProvider,
		request: LLMRequest,
		options: LLMRequestOptions,
	): Promise<LLMResponse> {
		const providerConfig = this.config.providers[provider];
		if (!providerConfig.apiKey) {
			throw new Error(`API key not configured for provider: ${provider}`);
		}

		// Estimate cost before making request
		const inputTokens = this.estimateTokens(JSON.stringify(request.messages));
		const estimatedCost = calculateEstimatedCost(
			provider,
			options.model || providerConfig.model,
			inputTokens,
			options.maxTokens || providerConfig.maxTokens,
		);

		// Check cost limits
		if (!options.skipCostCheck) {
			const costCheck = checkCostLimits(this.config, this.usage, estimatedCost);
			if (!costCheck.withinLimits && this.config.costControls.preventOverage) {
				throw new Error(
					`Cost limits exceeded: ${costCheck.exceededLimits.join(", ")}`,
				);
			}
		}

		// Sanitize request data
		const sanitizedRequest = this.sanitizeRequest(request);

		// Build provider-specific request
		const providerRequest = this.buildProviderRequest(
			provider,
			sanitizedRequest,
			options,
		);

		// Make HTTP request to provider
		const response = await this.callProvider(
			provider,
			providerRequest,
			options,
		);

		// Process and return response
		return this.processProviderResponse(provider, response, estimatedCost);
	}

	/**
	 * Builds a provider-specific request from universal LLM request
	 */
	private buildProviderRequest(
		provider: LLMProvider,
		request: LLMRequest,
		options: LLMRequestOptions,
	): Record<string, unknown> {
		const providerConfig = this.config.providers[provider];

		const baseRequest = {
			model: options.model || providerConfig.model,
			temperature: options.temperature ?? providerConfig.temperature,
			max_tokens: options.maxTokens || providerConfig.maxTokens,
		};

		// Provider-specific formatting
		switch (provider) {
			case "openai":
				return {
					...baseRequest,
					messages: request.messages,
					tools: request.tools,
				};

			case "anthropic":
				return {
					...baseRequest,
					messages: request.messages,
					system:
						request.messages.find((m) => m.role === "system")?.content || "",
				};

			case "google":
				return {
					...baseRequest,
					contents: request.messages.map((m) => ({
						role: m.role === "assistant" ? "model" : "user",
						parts: [
							{
								text:
									typeof m.content === "string"
										? m.content
										: JSON.stringify(m.content),
							},
						],
					})),
				};

			case "deepseek":
			case "xai":
				// Use OpenAI-compatible format
				return {
					...baseRequest,
					messages: request.messages,
				};

			default:
				throw new Error(`Unsupported provider: ${provider}`);
		}
	}

	/**
	 * Makes API call to specific provider
	 */
	private async callProvider(
		provider: LLMProvider,
		request: Record<string, unknown>,
		options: LLMRequestOptions,
	): Promise<Record<string, unknown>> {
		const providerConfig = this.config.providers[provider];
		const timeout =
			options.timeout || providerConfig.timeout || this.defaultTimeout;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		// Provider-specific authentication
		switch (provider) {
			case "openai":
				headers.Authorization = `Bearer ${providerConfig.apiKey}`;
				break;
			case "anthropic":
				headers["x-api-key"] = providerConfig.apiKey;
				headers["anthropic-version"] = "2023-06-01";
				break;
			case "google":
				headers.Authorization = `Bearer ${providerConfig.apiKey}`;
				break;
			case "deepseek":
				headers.Authorization = `Bearer ${providerConfig.apiKey}`;
				break;
			case "xai":
				headers.Authorization = `Bearer ${providerConfig.apiKey}`;
				break;
		}

		const endpoints: Record<LLMProvider, string> = {
			openai: "https://api.openai.com/v1/chat/completions",
			anthropic: "https://api.anthropic.com/v1/messages",
			google:
				"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
			deepseek: "https://api.deepseek.com/v1/chat/completions",
			xai: "https://api.x.ai/v1/chat/completions",
		};

		const response = await fetch(endpoints[provider], {
			method: "POST",
			headers,
			body: JSON.stringify(request),
			signal: AbortSignal.timeout(timeout),
		});

		if (!response.ok) {
			throw new Error(
				`Provider ${provider} API error: ${response.status} ${response.statusText}`,
			);
		}

		return (await response.json()) as Record<string, unknown>;
	}

	/**
	 * Processes provider response into universal format
	 */
	private processProviderResponse(
		provider: LLMProvider,
		response: Record<string, unknown>,
		estimatedCost: number,
	): LLMResponse {
		// Convert response to universal format using LLM Bridge
		let universalResponse: Record<string, unknown>;

		if (provider === "openai") {
			universalResponse = response;
		} else if (provider === "anthropic") {
			// Convert Anthropic format to OpenAI-compatible
			universalResponse = {
				choices: [
					{
						message: {
							content:
								(response.content as Array<{ text: string }>)?.[0]?.text || "",
							role: "assistant",
						},
						finish_reason: response.stop_reason || "stop",
					},
				],
				usage: response.usage,
			};
		} else if (provider === "google") {
			// Convert Google format to OpenAI-compatible
			const candidates = response.candidates as Array<{
				content: { parts: Array<{ text: string }> };
			}>;
			universalResponse = {
				choices: [
					{
						message: {
							content: candidates?.[0]?.content?.parts?.[0]?.text || "",
							role: "assistant",
						},
						finish_reason: "stop",
					},
				],
				usage: response.usageMetadata,
			};
		} else {
			// Assume OpenAI-compatible format for other providers
			universalResponse = response;
		}

		return {
			content: this.extractContentFromResponse(universalResponse, provider),
			usage: this.extractUsageFromResponse(universalResponse, provider),
			model:
				(response.model as string) || this.config.providers[provider].model,
			provider,
			cost: estimatedCost,
			metadata: this.extractMetadataFromResponse(universalResponse, provider),
		};
	}

	/**
	 * Extracts content from response
	 */
	private extractContentFromResponse(
		response: Record<string, unknown>,
		provider: LLMProvider,
	): string {
		// Handle different response formats
		if (provider === "anthropic") {
			const content = response.content as Array<{ text: string }>;
			return content?.[0]?.text || "";
		}

		// OpenAI-compatible format (default)
		const choices = response.choices as Array<{ message: { content: string } }>;
		return choices?.[0]?.message?.content || "";
	}

	/**
	 * Extracts usage information from response
	 */
	private extractUsageFromResponse(
		response: Record<string, unknown>,
		provider: LLMProvider,
	): {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	} {
		const usage = response.usage as {
			prompt_tokens?: number;
			completion_tokens?: number;
			total_tokens?: number;
			input_tokens?: number;
			output_tokens?: number;
		};

		if (!usage) {
			return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
		}

		// Handle different provider formats
		if (provider === "anthropic") {
			return {
				prompt_tokens: usage.input_tokens || 0,
				completion_tokens: usage.output_tokens || 0,
				total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
			};
		}

		// OpenAI-compatible format (default)
		return {
			prompt_tokens: usage.prompt_tokens || 0,
			completion_tokens: usage.completion_tokens || 0,
			total_tokens: usage.total_tokens || 0,
		};
	}

	/**
	 * Extracts metadata from response
	 */
	private extractMetadataFromResponse(
		response: Record<string, unknown>,
		_provider: LLMProvider,
	): Record<string, unknown> {
		const metadata: Record<string, unknown> = {};

		const choices = response.choices as
			| Array<{
					finish_reason?: string;
					message?: { tool_calls?: unknown[] };
			  }>
			| undefined;

		if (choices && choices.length > 0) {
			const choice = choices[0];
			if (choice?.finish_reason) {
				metadata.finish_reason = choice.finish_reason;
			}
			if (choice?.message?.tool_calls) {
				metadata.tool_calls = choice.message.tool_calls;
			}
		}

		return metadata;
	}

	/**
	 * Builds enhancement prompt for TestFlight feedback
	 */
	private buildEnhancementPrompt(request: LLMEnhancementRequest): LLMRequest {
		const { feedback, codebaseContext } = request;
		const isCrash = feedback.type === "crash";

		// System prompt for issue enhancement
		const systemPrompt = `You are an expert software engineer analyzing TestFlight feedback to create high-quality GitHub/Linear issues. Your task is to enhance the provided TestFlight data with additional context and structure.

IMPORTANT: Respond with a JSON object matching this exact structure:
{
  "title": "string - concise issue title with emoji",
  "description": "string - detailed markdown description",
  "labels": ["string array - relevant labels"],
  "priority": "urgent|high|normal|low",
  "relevantCodeAreas": [{"file": "string", "lines": "string", "confidence": 0.0-1.0, "reason": "string"}],
  "suggestedAssignees": ["string array - optional"],
  "estimatedEffort": "string - optional time estimate",
  "reproductionSteps": ["string array - optional steps"],
  "affectedComponents": ["string array - components/features"],
  "rootCauseAnalysis": "string - optional analysis",
  "suggestedFix": "string - optional fix suggestion"
}

Focus on:
1. Clear, actionable issue titles with appropriate emojis
2. Structured descriptions with technical context
3. Accurate identification of relevant code areas
4. Appropriate priority classification
5. Helpful labels for categorization`;

		// Build user prompt with feedback data
		let userPrompt = `## TestFlight Feedback Analysis

**Type**: ${isCrash ? "Crash Report" : "User Feedback"}
**App Version**: ${feedback.appVersion} (Build ${feedback.buildNumber})
**Device**: ${feedback.deviceInfo.model} (${feedback.deviceInfo.osVersion})
**Locale**: ${feedback.deviceInfo.locale}
**Submitted**: ${feedback.submittedAt}

`;

		if (isCrash && feedback.crashData) {
			userPrompt += `### Crash Details
**Type**: ${feedback.crashData.type}
${feedback.crashData.exceptionType ? `**Exception**: ${feedback.crashData.exceptionType}` : ""}
${feedback.crashData.exceptionMessage ? `**Message**: ${feedback.crashData.exceptionMessage}` : ""}

**Stack Trace**:
\`\`\`
${feedback.crashData.trace}
\`\`\`

`;
		}

		if (feedback.screenshotData) {
			if (feedback.screenshotData.text) {
				userPrompt += `### User Feedback
**Text**: ${feedback.screenshotData.text}

`;
			}
			if (feedback.screenshotData.images.length > 0) {
				userPrompt += `**Screenshots**: ${feedback.screenshotData.images.length} image(s) attached\n\n`;
			}
		}

		// Add codebase context if available
		if (
			codebaseContext?.relevantFiles &&
			codebaseContext.relevantFiles.length > 0
		) {
			userPrompt += `### Relevant Codebase Context

`;
			for (const file of codebaseContext.relevantFiles.slice(0, 3)) {
				// Limit to top 3 files
				userPrompt += `**${file.path}** (confidence: ${(file.confidence * 100).toFixed(0)}%)
${file.lines ? `Lines ${file.lines}:` : ""}
\`\`\`
${file.content.substring(0, 500)}${file.content.length > 500 ? "..." : ""}
\`\`\`

`;
			}
		}

		if (
			codebaseContext?.recentChanges &&
			codebaseContext.recentChanges.length > 0
		) {
			userPrompt += `### Recent Changes
`;
			for (const change of codebaseContext.recentChanges.slice(0, 2)) {
				userPrompt += `**${change.file}** by ${change.author} (${change.timestamp})
\`\`\`diff
${change.diff.substring(0, 300)}${change.diff.length > 300 ? "..." : ""}
\`\`\`

`;
			}
		}

		if (
			codebaseContext?.relatedIssues &&
			codebaseContext.relatedIssues.length > 0
		) {
			userPrompt += `### Related Issues
`;
			for (const issue of codebaseContext.relatedIssues.slice(0, 3)) {
				userPrompt += `- #${issue.number}: ${issue.title} [${issue.labels.join(", ")}]\n`;
			}
			userPrompt += "\n";
		}

		userPrompt += `Please analyze this TestFlight feedback and provide an enhanced issue structure. Focus on identifying the most relevant code areas and providing actionable insights for developers.`;

		return {
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
		};
	}

	/**
	 * Parses LLM enhancement response
	 */
	private parseEnhancementResponse(
		response: LLMResponse,
		startTime: number,
	): LLMEnhancementResponse {
		try {
			// Try to parse JSON response
			const parsed = JSON.parse(response.content);

			// Validate required fields
			const enhancement: LLMEnhancementResponse = {
				title: parsed.title || "Enhanced TestFlight Issue",
				description: parsed.description || "LLM-enhanced issue description",
				labels: Array.isArray(parsed.labels)
					? parsed.labels
					: ["testflight", "llm-enhanced"],
				priority: ["urgent", "high", "normal", "low"].includes(parsed.priority)
					? parsed.priority
					: "normal",
				relevantCodeAreas: Array.isArray(parsed.relevantCodeAreas)
					? parsed.relevantCodeAreas.filter(
							(area: any) =>
								area.file && area.confidence >= 0 && area.confidence <= 1,
						)
					: [],
				suggestedAssignees: parsed.suggestedAssignees || [],
				estimatedEffort: parsed.estimatedEffort,
				reproductionSteps: parsed.reproductionSteps,
				affectedComponents: parsed.affectedComponents || [],
				rootCauseAnalysis: parsed.rootCauseAnalysis,
				suggestedFix: parsed.suggestedFix,
				metadata: {
					enhancementVersion: "1.0.0",
					processingTime: Date.now() - startTime,
					provider: response.provider,
					model: response.model,
					cost: response.cost,
					confidence: this.calculateConfidence(parsed),
				},
			};

			return enhancement;
		} catch (_error) {
			console.warn(
				"Failed to parse LLM response as JSON, using fallback parsing",
			);
			return this.parseUnstructuredResponse(response, startTime);
		}
	}

	/**
	 * Parses unstructured LLM response as fallback
	 */
	private parseUnstructuredResponse(
		response: LLMResponse,
		startTime: number,
	): LLMEnhancementResponse {
		const content = response.content;

		// Extract title (first line or until first newline)
		const titleMatch = content.match(/^([^\n]+)/);
		const title =
			titleMatch && titleMatch[1]
				? titleMatch[1].trim()
				: "LLM-Enhanced TestFlight Issue";

		// Use content as description
		const description = content;

		// Basic label extraction
		const labels = ["testflight", "llm-enhanced"];
		if (content.toLowerCase().includes("crash")) {
			labels.push("crash", "bug");
		}
		if (content.toLowerCase().includes("ui")) {
			labels.push("ui", "frontend");
		}

		return {
			title,
			description,
			labels,
			priority: "normal",
			relevantCodeAreas: [],
			affectedComponents: [],
			metadata: {
				enhancementVersion: "1.0.0",
				processingTime: Date.now() - startTime,
				provider: response.provider,
				model: response.model,
				cost: response.cost,
				confidence: 0.5, // Lower confidence for unstructured parsing
			},
		};
	}

	/**
	 * Creates fallback enhancement when LLM fails
	 */
	private createFallbackEnhancement(
		request: LLMEnhancementRequest,
		startTime: number,
	): LLMEnhancementResponse {
		const { feedback } = request;
		const isCrash = feedback.type === "crash";

		const title = isCrash
			? `💥 Crash: ${feedback.crashData?.exceptionType || "Unknown"} in ${feedback.appVersion}`
			: `📱 Feedback: ${feedback.screenshotData?.text?.substring(0, 50) || "User feedback"} (${feedback.appVersion})`;

		const description = `## TestFlight ${isCrash ? "Crash Report" : "User Feedback"}

**App Version**: ${feedback.appVersion} (${feedback.buildNumber})
**Device**: ${feedback.deviceInfo.model} (${feedback.deviceInfo.osVersion})
**Submitted**: ${feedback.submittedAt}

${
	isCrash && feedback.crashData
		? `
### Crash Details
**Type**: ${feedback.crashData.type}
${feedback.crashData.exceptionType ? `**Exception**: ${feedback.crashData.exceptionType}` : ""}

\`\`\`
${feedback.crashData.trace}
\`\`\`
`
		: ""
}

${
	feedback.screenshotData?.text
		? `
### User Feedback
${feedback.screenshotData.text}
`
		: ""
}

*Note: This issue was created with fallback formatting due to LLM enhancement failure.*`;

		const labels = isCrash
			? ["testflight", "crash", "bug", "urgent"]
			: ["testflight", "feedback", "enhancement"];

		return {
			title,
			description,
			labels,
			priority: isCrash ? "high" : "normal",
			relevantCodeAreas: [],
			affectedComponents: [isCrash ? "crash-handling" : "user-experience"],
			metadata: {
				enhancementVersion: "1.0.0-fallback",
				processingTime: Date.now() - startTime,
				provider: "fallback" as LLMProvider,
				model: "none",
				cost: 0,
				confidence: 0.3,
			},
		};
	}

	/**
	 * Calculates confidence score for enhancement
	 */
	private calculateConfidence(parsed: Record<string, unknown>): number {
		let score = 0.5; // Base confidence

		// Boost confidence based on content quality
		if (
			parsed.title &&
			typeof parsed.title === "string" &&
			parsed.title.length > 10
		) {
			score += 0.1;
		}

		if (
			parsed.description &&
			typeof parsed.description === "string" &&
			parsed.description.length > 50
		) {
			score += 0.1;
		}

		if (
			parsed.labels &&
			Array.isArray(parsed.labels) &&
			parsed.labels.length > 0
		) {
			score += 0.1;
		}

		if (
			parsed.priority &&
			["urgent", "high", "normal", "low"].includes(parsed.priority as string)
		) {
			score += 0.1;
		}

		return Math.min(score, 1.0);
	}

	/**
	 * Sanitizes request data for LLM
	 */
	private sanitizeRequest(request: LLMRequest): LLMRequest {
		const sanitizedMessages = request.messages.map((message) => ({
			...message,
			content:
				typeof message.content === "string"
					? sanitizeDataForLLM(message.content, this.config)
					: message.content,
		}));

		return {
			...request,
			messages: sanitizedMessages,
		};
	}

	/**
	 * Estimates token count for text
	 */
	private estimateTokens(text: string): number {
		try {
			// Use tiktoken for more accurate token counting (OpenAI models)
			const encoder = encoding_for_model("gpt-4");
			const tokens = encoder.encode(text);
			encoder.free();
			return tokens.length;
		} catch (_error) {
			// Fallback: rough estimation (4 characters per token)
			return Math.ceil(text.length / 4);
		}
	}

	/**
	 * Initializes usage statistics
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
				deepseek: { tokens: 0, cost: 0, requests: 0, successRate: 1.0 },
				xai: { tokens: 0, cost: 0, requests: 0, successRate: 1.0 },
			},
		};
	}

	/**
	 * Updates usage statistics
	 */
	private updateUsageStats(response: LLMResponse): void {
		this.usage.totalTokensUsed += response.usage.total_tokens;
		this.usage.totalCostAccrued += response.cost;
		this.usage.requestCount += 1;

		this.usage.monthlyUsage.tokens += response.usage.total_tokens;
		this.usage.monthlyUsage.cost += response.cost;
		this.usage.monthlyUsage.requests += 1;

		const providerStats = this.usage.providerUsage[response.provider];
		providerStats.tokens += response.usage.total_tokens;
		providerStats.cost += response.cost;
		providerStats.requests += 1;
	}

	/**
	 * Gets current usage statistics
	 */
	public getUsageStats(): LLMUsageStats {
		return { ...this.usage };
	}

	/**
	 * Performs health check for LLM providers
	 */
	public async healthCheck(): Promise<LLMHealthCheck> {
		const validation = validateLLMConfig(this.config);
		const providers: Record<
			LLMProvider,
			{
				available: boolean;
				authenticated: boolean;
				responseTime?: number;
				error?: string;
			}
		> = {
			openai: { available: false, authenticated: false },
			anthropic: { available: false, authenticated: false },
			google: { available: false, authenticated: false },
			deepseek: { available: false, authenticated: false },
			xai: { available: false, authenticated: false },
		};

		// Test each configured provider
		for (const provider of Object.keys(providers) as LLMProvider[]) {
			try {
				const startTime = Date.now();

				// Simple test request
				const _testResponse = await this.makeProviderRequest(
					provider,
					{
						messages: [{ role: "user", content: "Hello" }],
					},
					{ skipCostCheck: true, enableFallback: false, maxTokens: 10 },
				);

				providers[provider] = {
					available: true,
					authenticated: true,
					responseTime: Date.now() - startTime,
				};
			} catch (error) {
				providers[provider] = {
					available: false,
					authenticated: false,
					error: (error as Error).message,
				};
			}
		}

		// Calculate overall status
		const availableCount = Object.values(providers).filter(
			(p) => p.available,
		).length;
		const status =
			availableCount === 0
				? "unhealthy"
				: availableCount < 2
					? "degraded"
					: "healthy";

		// Check cost status
		const costCheck = checkCostLimits(this.config, this.usage, 0);

		return {
			status,
			providers,
			config: validation,
			usage: this.usage,
			costStatus: {
				withinLimits: costCheck.withinLimits,
				remainingBudget: costCheck.remainingBudget,
			},
		};
	}
}

/**
 * Global LLM client instance
 */
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
