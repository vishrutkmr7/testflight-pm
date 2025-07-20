/**
 * Universal LLM Types
 * Following llm-bridge pattern for provider interoperability
 */

import type { LLMProvider } from "../config/llm-config.js";

export interface UniversalMessage {
    id?: string;
    role: "system" | "user" | "assistant";
    content: UniversalContent[];
    metadata?: {
        provider?: LLMProvider;
        timestamp?: string;
        [key: string]: unknown;
    };
}

export interface UniversalContent {
    type: "text" | "image_url";
    text?: string;
    image_url?: {
        url: string;
        detail?: "low" | "high" | "auto";
    };
}

export interface UniversalRequest {
    messages: UniversalMessage[];
    model?: string;
    temperature?: number;
    max_tokens?: number;
    tools?: UniversalTool[];
    provider?: LLMProvider;
    _original?: Record<string, unknown>; // Preserve original request for lossless transforms
}

export interface UniversalTool {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: object;
    };
}

export interface UniversalResponse {
    content: string;
    usage: UniversalUsage;
    model: string;
    provider: LLMProvider;
    cost: number;
    metadata?: {
        finish_reason?: string;
        tool_calls?: UniversalToolCall[];
        [key: string]: unknown;
    };
    _original?: Record<string, unknown>; // Preserve original response
}

export interface UniversalUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

export interface UniversalToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

export interface UniversalError {
    type: "authentication_error" | "rate_limit_error" | "invalid_request_error" | "api_error" | "timeout_error";
    message: string;
    provider: LLMProvider;
    status?: number;
    code?: string;
    details?: Record<string, unknown>;
    retryAfter?: number;
    _original?: Record<string, unknown>;
}

export interface LLMProviderAdapter {
    /**
     * Convert universal request to provider-specific format
     */
    fromUniversal(request: UniversalRequest): Record<string, unknown>;

    /**
     * Convert provider-specific response to universal format
     */
    toUniversal(response: Record<string, unknown>, request: UniversalRequest): UniversalResponse;

    /**
     * Convert provider-specific error to universal format
     */
    normalizeError(error: unknown): UniversalError;

    /**
     * Get provider-specific authentication headers
     */
    getAuthHeaders(apiKey: string): Record<string, string>;

    /**
     * Get provider API endpoint
     */
    getEndpoint(model?: string): string;

    /**
     * Validate provider-specific configuration
     */
    validateConfig(config: Record<string, unknown>): { valid: boolean; errors: string[] };
}

/**
 * Convert any LLM request to universal format
 */
export function toUniversal(provider: LLMProvider, request: Record<string, unknown>): UniversalRequest {
    // For now, assume OpenAI-compatible input format
    // In full llm-bridge implementation, this would handle provider-specific formats
    return {
        messages: (request.messages as any[])?.map((msg, index) => ({
            id: `msg_${index}`,
            role: msg.role,
            content: typeof msg.content === "string"
                ? [{ type: "text", text: msg.content }]
                : msg.content,
            metadata: { provider }
        })) || [],
        model: request.model as string,
        temperature: request.temperature as number,
        max_tokens: request.max_tokens as number,
        tools: request.tools as UniversalTool[],
        provider,
        _original: request
    };
}

/**
 * Convert universal request to provider-specific format
 */
export function fromUniversal(provider: LLMProvider, request: UniversalRequest): Record<string, unknown> {
    const adapter = getProviderAdapter(provider);
    return adapter.fromUniversal(request);
}

/**
 * Normalize provider error to universal format
 */
export function normalizeError(provider: LLMProvider, error: unknown): UniversalError {
    const adapter = getProviderAdapter(provider);
    return adapter.normalizeError(error);
}

/**
 * Get provider adapter instance
 */
export function getProviderAdapter(provider: LLMProvider): LLMProviderAdapter {
    switch (provider) {
        case "openai":
            return new OpenAIAdapter();
        case "anthropic":
            return new AnthropicAdapter();
        case "google":
            return new GoogleAdapter();
        case "deepseek":
            return new DeepSeekAdapter();
        case "xai":
            return new XAIAdapter();
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}

// Provider-specific adapters implementing the universal interface
class OpenAIAdapter implements LLMProviderAdapter {
    fromUniversal(request: UniversalRequest): Record<string, unknown> {
        return {
            model: request.model,
            messages: request.messages.map(msg => ({
                role: msg.role,
                content: msg.content.length === 1 && msg.content[0]?.type === "text"
                    ? msg.content[0]?.text
                    : msg.content
            })),
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            tools: request.tools
        };
    }

    toUniversal(response: Record<string, unknown>, request: UniversalRequest): UniversalResponse {
        const choices = response.choices as Array<{ message: { content: string }; finish_reason?: string }> | undefined;
        const usage = response.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

        return {
            content: choices?.[0]?.message?.content || "",
            usage: {
                prompt_tokens: usage?.prompt_tokens ?? 0,
                completion_tokens: usage?.completion_tokens ?? 0,
                total_tokens: usage?.total_tokens ?? 0
            },
            model: (response.model as string) || request.model || "",
            provider: "openai",
            cost: 0, // Calculate separately
            metadata: {
                finish_reason: choices?.[0]?.finish_reason
            },
            _original: response
        };
    }

    normalizeError(error: unknown): UniversalError {
        const err = error as any;
        return {
            type: err.type || "api_error",
            message: err.message || "Unknown OpenAI error",
            provider: "openai",
            status: err.status,
            code: err.code,
            _original: err
        };
    }

    getAuthHeaders(apiKey: string): Record<string, string> {
        return {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        };
    }

    getEndpoint(): string {
        return "https://api.openai.com/v1/chat/completions";
    }

    validateConfig(config: Record<string, unknown>): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        if (!config.apiKey) {
            errors.push("OpenAI API key is required");
        }
        return { valid: errors.length === 0, errors };
    }
}

class AnthropicAdapter implements LLMProviderAdapter {
    fromUniversal(request: UniversalRequest): Record<string, unknown> {
        const systemMessage = request.messages.find(m => m.role === "system");
        const userMessages = request.messages.filter(m => m.role !== "system");

        return {
            model: request.model,
            messages: userMessages.map(msg => ({
                role: msg.role,
                content: msg.content.map(c => c.type === "text" ? c.text : c).join("")
            })),
            system: systemMessage?.content.map(c => c.type === "text" ? c.text : c).join("") || "",
            temperature: request.temperature,
            max_tokens: request.max_tokens
        };
    }

    toUniversal(response: Record<string, unknown>, request: UniversalRequest): UniversalResponse {
        const content = response.content as Array<{ text: string }>;
        const usage = response.usage as { input_tokens: number; output_tokens: number };

        return {
            content: content?.[0]?.text || "",
            usage: {
                prompt_tokens: usage?.input_tokens || 0,
                completion_tokens: usage?.output_tokens || 0,
                total_tokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0)
            },
            model: response.model as string || request.model || "",
            provider: "anthropic",
            cost: 0,
            metadata: {
                finish_reason: response.stop_reason as string
            },
            _original: response
        };
    }

    normalizeError(error: unknown): UniversalError {
        const err = error as any;
        return {
            type: err.type || "api_error",
            message: err.message || "Unknown Anthropic error",
            provider: "anthropic",
            status: err.status_code,
            _original: err
        };
    }

    getAuthHeaders(apiKey: string): Record<string, string> {
        return {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        };
    }

    getEndpoint(): string {
        return "https://api.anthropic.com/v1/messages";
    }

    validateConfig(config: Record<string, unknown>): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        if (!config.apiKey) errors.push("Anthropic API key is required");
        return { valid: errors.length === 0, errors };
    }
}

class GoogleAdapter implements LLMProviderAdapter {
    fromUniversal(request: UniversalRequest): Record<string, unknown> {
        return {
            model: request.model,
            contents: request.messages.map(msg => ({
                role: msg.role === "assistant" ? "model" : "user",
                parts: msg.content.map(c => ({ text: c.type === "text" ? c.text : JSON.stringify(c) }))
            })),
            generation_config: {
                temperature: request.temperature,
                max_output_tokens: request.max_tokens
            }
        };
    }

    toUniversal(response: Record<string, unknown>, request: UniversalRequest): UniversalResponse {
        const candidates = response.candidates as Array<{ content: { parts: Array<{ text: string }> } }>;
        const usage = response.usageMetadata as { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };

        return {
            content: candidates?.[0]?.content?.parts?.[0]?.text || "",
            usage: {
                prompt_tokens: usage?.promptTokenCount || 0,
                completion_tokens: usage?.candidatesTokenCount || 0,
                total_tokens: usage?.totalTokenCount || 0
            },
            model: request.model || "",
            provider: "google",
            cost: 0,
            metadata: {},
            _original: response
        };
    }

    normalizeError(error: unknown): UniversalError {
        const err = error as any;
        return {
            type: "api_error",
            message: err.message || "Unknown Google error",
            provider: "google",
            status: err.status,
            _original: err
        };
    }

    getAuthHeaders(apiKey: string): Record<string, string> {
        return {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        };
    }

    getEndpoint(): string {
        return "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";
    }

    validateConfig(config: Record<string, unknown>): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        if (!config.apiKey) errors.push("Google API key is required");
        return { valid: errors.length === 0, errors };
    }
}

class DeepSeekAdapter implements LLMProviderAdapter {
    fromUniversal(request: UniversalRequest): Record<string, unknown> {
        // DeepSeek uses OpenAI-compatible format
        return new OpenAIAdapter().fromUniversal(request);
    }

    toUniversal(response: Record<string, unknown>, request: UniversalRequest): UniversalResponse {
        const universal = new OpenAIAdapter().toUniversal(response, request);
        return { ...universal, provider: "deepseek" };
    }

    normalizeError(error: unknown): UniversalError {
        const universal = new OpenAIAdapter().normalizeError(error);
        return { ...universal, provider: "deepseek" };
    }

    getAuthHeaders(apiKey: string): Record<string, string> {
        return {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        };
    }

    getEndpoint(): string {
        return "https://api.deepseek.com/v1/chat/completions";
    }

    validateConfig(config: Record<string, unknown>): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        if (!config.apiKey) errors.push("DeepSeek API key is required");
        return { valid: errors.length === 0, errors };
    }
}

class XAIAdapter implements LLMProviderAdapter {
    fromUniversal(request: UniversalRequest): Record<string, unknown> {
        // xAI uses OpenAI-compatible format
        return new OpenAIAdapter().fromUniversal(request);
    }

    toUniversal(response: Record<string, unknown>, request: UniversalRequest): UniversalResponse {
        const universal = new OpenAIAdapter().toUniversal(response, request);
        return { ...universal, provider: "xai" };
    }

    normalizeError(error: unknown): UniversalError {
        const universal = new OpenAIAdapter().normalizeError(error);
        return { ...universal, provider: "xai" };
    }

    getAuthHeaders(apiKey: string): Record<string, string> {
        return {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        };
    }

    getEndpoint(): string {
        return "https://api.x.ai/v1/chat/completions";
    }

    validateConfig(config: Record<string, unknown>): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        if (!config.apiKey) errors.push("xAI API key is required");
        return { valid: errors.length === 0, errors };
    }
} 