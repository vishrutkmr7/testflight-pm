/**
 * Universal LLM Client
 * Secure LLM interface using Universal Bridge pattern for provider interoperability
 * Implements clean "normalize → process → emit" pipeline following llm-bridge principles
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
import {
    type UniversalRequest,
    type UniversalResponse,
    type UniversalError,
    fromUniversal,
    normalizeError,
    getProviderAdapter,
} from "./universal-llm-types.js";

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
 * Universal LLM Client implementing the bridge pattern
 * Clean "normalize → process → emit" pipeline
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
     * Implements clean normalize → process → emit pipeline
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
                // NORMALIZE: Convert to universal format
                const universalRequest = this.normalizeRequest(request, provider, options);

                // PROCESS: Make the request
                const universalResponse = await this.processRequest(universalRequest, options);

                // EMIT: Convert back to legacy format
                return this.emitResponse(universalResponse);
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
     * NORMALIZE: Convert legacy request to universal format
     */
    private normalizeRequest(
        request: LLMRequest,
        provider: LLMProvider,
        options: LLMRequestOptions
    ): UniversalRequest {
        const providerConfig = this.config.providers[provider];

        return {
            messages: request.messages.map((msg, index) => ({
                id: `msg_${index}`,
                role: msg.role,
                content: typeof msg.content === "string"
                    ? [{ type: "text", text: msg.content }]
                    : msg.content.map(c => ({
                        type: c.type,
                        text: c.text,
                        image_url: c.image_url
                    })),
                metadata: { provider }
            })),
            model: options.model || providerConfig.model,
            temperature: options.temperature ?? providerConfig.temperature,
            max_tokens: options.maxTokens || providerConfig.maxTokens,
            tools: request.tools,
            provider,
            _original: request as unknown as Record<string, unknown>
        };
    }

    /**
     * PROCESS: Execute request using universal format
     */
    private async processRequest(
        universalRequest: UniversalRequest,
        options: LLMRequestOptions
    ): Promise<UniversalResponse> {
        const provider = universalRequest.provider!;
        const providerConfig = this.config.providers[provider];

        if (!providerConfig.apiKey) {
            throw new Error(`API key not configured for provider: ${provider}`);
        }

        // Pre-flight cost check
        await this.validateCostLimits(universalRequest, options);

        // Sanitize data
        const sanitizedRequest = this.sanitizeUniversalRequest(universalRequest);

        // Get provider adapter
        const adapter = getProviderAdapter(provider);

        // Convert to provider format
        const providerRequest = fromUniversal(provider, sanitizedRequest);

        // Make HTTP request
        const providerResponse = await this.callProviderHTTP(
            adapter,
            providerRequest,
            providerConfig.apiKey,
            options,
            provider
        );

        // Convert response to universal format
        const universalResponse = adapter.toUniversal(providerResponse, sanitizedRequest);

        // Calculate and attach cost
        const cost = calculateEstimatedCost(
            provider,
            universalResponse.model,
            universalResponse.usage.prompt_tokens,
            universalResponse.usage.completion_tokens
        );

        return {
            content: universalResponse.content,
            usage: universalResponse.usage,
            model: universalResponse.model,
            provider: universalResponse.provider,
            cost,
            metadata: universalResponse.metadata,
            _original: universalResponse._original
        };
    }

    /**
     * EMIT: Convert universal response back to legacy format
     */
    private emitResponse(universalResponse: UniversalResponse): LLMResponse {
        return {
            content: universalResponse.content,
            usage: universalResponse.usage,
            model: universalResponse.model,
            provider: universalResponse.provider,
            cost: universalResponse.cost,
            metadata: universalResponse.metadata
        };
    }

    /**
     * Validate cost limits before making request
     */
    private async validateCostLimits(
        universalRequest: UniversalRequest,
        options: LLMRequestOptions
    ): Promise<void> {
        if (options.skipCostCheck) return;

        const provider = universalRequest.provider!;
        const inputTokens = this.estimateTokens(JSON.stringify(universalRequest.messages));
        const estimatedCost = calculateEstimatedCost(
            provider,
            universalRequest.model || "",
            inputTokens,
            universalRequest.max_tokens || 1000
        );

        const costCheck = checkCostLimits(this.config, this.usage, estimatedCost);
        if (!costCheck.withinLimits && this.config.costControls.preventOverage) {
            throw new Error(
                `Cost limits exceeded: ${costCheck.exceededLimits.join(", ")}`
            );
        }
    }

    /**
     * Sanitize universal request data
     */
    private sanitizeUniversalRequest(request: UniversalRequest): UniversalRequest {
        return {
            ...request,
            messages: request.messages.map(msg => ({
                ...msg,
                content: msg.content.map(content => ({
                    ...content,
                    text: content.text ? sanitizeDataForLLM(content.text, this.config) : content.text
                }))
            }))
        };
    }

    /**
     * Make HTTP request to provider using adapter
     */
    private async callProviderHTTP(
        adapter: any,
        request: Record<string, unknown>,
        apiKey: string,
        options: LLMRequestOptions,
        provider: LLMProvider
    ): Promise<Record<string, unknown>> {
        const timeout = options.timeout || this.defaultTimeout;
        const headers = adapter.getAuthHeaders(apiKey);
        const endpoint = adapter.getEndpoint();

        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify(request),
                signal: AbortSignal.timeout(timeout),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorInfo = {
                    status: response.status,
                    message: response.statusText,
                    ...(errorData as Record<string, unknown>)
                };
                const error = normalizeError(provider, errorInfo);
                throw new Error(`${error.type}: ${error.message}`);
            }

            return await response.json() as Record<string, unknown>;
        } catch (error) {
            const normalizedError = normalizeError(provider, error);
            throw new Error(`${normalizedError.type}: ${normalizedError.message}`);
        }
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

        userPrompt += "Please analyze this TestFlight feedback and provide an enhanced issue following the JSON format specified above.";

        return {
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ]
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
     * Parses unstructured LLM response
     */
    private parseUnstructuredResponse(
        response: LLMResponse,
        startTime: number,
    ): LLMEnhancementResponse {
        const content = response.content;

        // Extract title from first line or heading
        const titleMatch = content.match(/^#\s*(.+)$/m) || content.match(/^(.+)$/m);
        const title = titleMatch?.[1]?.trim() || "TestFlight Issue";

        // Extract priority
        const priorityMatch = content.match(/priority[:\s]+(\w+)/i);
        const priority = priorityMatch?.[1]?.toLowerCase() as "urgent" | "high" | "normal" | "low" || "normal";

        // Extract labels from content
        const labels = ["testflight", "llm-enhanced"];
        if (content.toLowerCase().includes("crash")) labels.push("crash", "bug");
        if (content.toLowerCase().includes("feedback")) labels.push("feedback", "enhancement");

        return {
            title,
            description: content,
            labels,
            priority,
            relevantCodeAreas: [],
            affectedComponents: [],
            metadata: {
                enhancementVersion: "1.0.0-unstructured",
                processingTime: Date.now() - startTime,
                provider: response.provider,
                model: response.model,
                cost: response.cost,
                confidence: 0.5,
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

${isCrash && feedback.crashData
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

${feedback.screenshotData?.text
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
        let confidence = 0.8; // Base confidence

        // Boost for well-structured response
        if (parsed.title && parsed.description) confidence += 0.1;
        if (Array.isArray(parsed.labels) && parsed.labels.length > 0) confidence += 0.05;
        if (parsed.priority) confidence += 0.05;

        return Math.min(1.0, confidence);
    }

    /**
     * Estimates tokens in text
     */
    private estimateTokens(text: string): number {
        try {
            const encoding = encoding_for_model("gpt-4");
            return encoding.encode(text).length;
        } catch {
            // Fallback estimation: ~4 characters per token
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

        const providerUsage = this.usage.providerUsage[response.provider];
        providerUsage.tokens += response.usage.total_tokens;
        providerUsage.cost += response.cost;
        providerUsage.requests += 1;
    }

    /**
     * Gets usage statistics
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
                const _testResponse = await this.makeRequest(
                    {
                        messages: [{ role: "user", content: "Hello" }],
                    },
                    {
                        provider,
                        skipCostCheck: true,
                        enableFallback: false,
                        maxTokens: 10
                    },
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
