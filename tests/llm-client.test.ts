import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { LLMEnhancementRequest } from "../src/api/llm-client";
import { LLMClient } from "../src/api/llm-client";
import type {
    LLMEnhancementConfig,
    LLMProvider,
} from "../src/config/llm-config";

// Mock llm-bridge
const mockLLMBridge = {
    toUniversal: mock(() => ({})),
    fromUniversal: mock(() => ({})),
    translateBetweenProviders: mock(() => ({})),
    detectProvider: mock(() => "openai"),
};

// Mock tiktoken
const mockTiktoken = {
    encoding_for_model: mock(() => ({ encode: mock(() => [1, 2, 3, 4, 5]) })),
};

// Mock config
const mockGetLLMConfig = mock(() => ({
    enabled: true,
    primaryProvider: "openai" as LLMProvider,
    fallbackProviders: ["anthropic"] as LLMProvider[],
    providers: {
        openai: {
            apiKey: "test-openai-key",
            model: "gpt-4",
            maxTokens: 4000,
            temperature: 0.1,
            timeout: 30000,
            maxRetries: 3,
        },
        anthropic: {
            apiKey: "test-anthropic-key",
            model: "claude-3-sonnet-20240229",
            maxTokens: 4000,
            temperature: 0.1,
            timeout: 30000,
            maxRetries: 3,
        },
    },
    costControls: {
        maxTokensPerIssue: 8000,
        maxCostPerRun: 1.0,
        maxCostPerMonth: 100.0,
        enableCostAlerts: true,
        preventOverage: true,
    },
    features: {
        codebaseAnalysis: true,
        screenshotAnalysis: true,
        priorityClassification: true,
        labelGeneration: true,
        assigneeRecommendation: true,
    },
    security: {
        anonymizeData: true,
        excludeSensitiveInfo: true,
        logRequestsResponses: false,
        enableDataRetentionPolicy: true,
    },
}));

const mockValidateLLMConfig = mock(() => ({
    valid: true,
    errors: [] as string[],
    warnings: [] as string[],
}));
const mockCalculateEstimatedCost = mock(() => 0.05);
const mockCheckCostLimits = mock(() => ({
    withinLimits: true,
    estimatedCost: 0.05,
}));
const mockSanitizeDataForLLM = mock(
    (data: string, config: LLMEnhancementConfig) => data,
);

// Set up mocks using Bun's mock system
import * as llmBridge from "llm-bridge";
import * as tiktoken from "tiktoken";
import * as llmConfig from "../src/config/llm-config";

Object.assign(llmBridge, mockLLMBridge);
Object.assign(tiktoken, mockTiktoken);
Object.assign(llmConfig, {
    getLLMConfig: mockGetLLMConfig,
    validateLLMConfig: mockValidateLLMConfig,
    calculateEstimatedCost: mockCalculateEstimatedCost,
    checkCostLimits: mockCheckCostLimits,
    sanitizeDataForLLM: mockSanitizeDataForLLM,
});

describe("LLMClient", () => {
    let client: LLMClient;

    const mockRequest: LLMEnhancementRequest = {
        feedback: {
            id: "test-feedback-id",
            type: "crash",
            appVersion: "1.0.0",
            buildNumber: "123",
            deviceInfo: {
                model: "iPhone 15",
                osVersion: "17.0",
                family: "iPhone",
                locale: "en_US",
            },
            submittedAt: "2024-01-01T00:00:00Z",
            crashData: {
                type: "SIGABRT",
                exceptionType: "NSException",
                exceptionMessage: "Array index out of bounds",
                trace: "Stack trace here...",
            },
        },
        codebaseContext: {
            relevantFiles: [
                {
                    path: "src/components/ListView.swift",
                    content:
                        "class ListView { func itemAt(index: Int) -> Item? { return items[index] } }",
                    confidence: 0.9,
                },
            ],
        },
    };

    beforeEach(() => {
        // Reset all mocks
        mockGetLLMConfig.mockClear();
        mockValidateLLMConfig.mockClear();
        mockCalculateEstimatedCost.mockClear();
        mockCheckCostLimits.mockClear();
        mockSanitizeDataForLLM.mockClear();

        Object.values(mockLLMBridge).forEach((mockFn) => {
            if (typeof mockFn === "function" && "mockClear" in mockFn) {
                mockFn.mockClear();
            }
        });

        client = new LLMClient();
    });

    describe("initialization", () => {
        it("should initialize with default configuration", () => {
            expect(mockGetLLMConfig).toHaveBeenCalled();
            expect(client).toBeInstanceOf(LLMClient);
        });

        it("should handle disabled configuration", async () => {
            const disabledConfig = {
                ...mockGetLLMConfig(),
                enabled: false,
            };
            mockGetLLMConfig.mockReturnValueOnce(disabledConfig);

            const disabledClient = new LLMClient();

            await expect(disabledClient.enhanceIssue(mockRequest)).rejects.toThrow(
                "LLM enhancement is disabled",
            );
        });
    });

    describe("enhanceIssue", () => {
        it("should successfully enhance a crash report", async () => {
            // Mock successful LLM response
            const mockLLMResponse = {
                content: JSON.stringify({
                    title: "Fix array bounds crash in ListView",
                    description:
                        "The app crashes when accessing array elements beyond bounds",
                    labels: ["bug", "crash", "ui"],
                    priority: "high",
                    relevantCodeAreas: [
                        {
                            file: "src/components/ListView.swift",
                            lines: "1-10",
                            confidence: 0.9,
                            reason: "Contains array access that could cause bounds exception",
                        },
                    ],
                    reproductionSteps: [
                        "Navigate to list view",
                        "Scroll to bottom rapidly",
                        "App crashes with SIGABRT",
                    ],
                    suggestedFix: "Add bounds checking before array access",
                }),
                usage: {
                    prompt_tokens: 500,
                    completion_tokens: 200,
                    total_tokens: 700,
                },
                model: "gpt-4",
                provider: "openai" as LLMProvider,
                cost: 0.05,
            };

            // Mock the internal makeRequest method
            const makeRequestSpy = mock(async () => mockLLMResponse);
            (client as any).makeRequest = makeRequestSpy;

            const response = await client.enhanceIssue(mockRequest);

            expect(response.title).toBe("Fix array bounds crash in ListView");
            expect(response.priority).toBe("high");
            expect(response.labels).toContain("crash");
            expect(response.relevantCodeAreas).toHaveLength(1);
            expect(response.metadata.provider).toBe("openai");
            expect(response.metadata.cost).toBe(0.05);
        });

        it("should handle validation errors", async () => {
            mockValidateLLMConfig.mockReturnValueOnce({
                valid: false,
                errors: ["Invalid API key"],
                warnings: [],
            });

            const response = await client.enhanceIssue(mockRequest);

            // Should return fallback enhancement
            expect(response.title).toContain("TestFlight");
            expect(response.metadata.confidence).toBeLessThan(1.0);
        });

        it("should create fallback enhancement on LLM failure", async () => {
            // Mock makeRequest to throw error
            const makeRequestSpy = mock(async () => {
                throw new Error("LLM request failed");
            });
            (client as any).makeRequest = makeRequestSpy;

            const response = await client.enhanceIssue(mockRequest);

            // Should return fallback enhancement
            expect(response.title).toBeDefined();
            expect(response.description).toBeDefined();
            expect(response.priority).toBeDefined();
            expect(response.metadata.confidence).toBeLessThan(1.0);
        });

        it("should handle screenshot feedback", async () => {
            const screenshotRequest: LLMEnhancementRequest = {
                feedback: {
                    id: "test-screenshot-id",
                    type: "screenshot",
                    appVersion: "1.0.0",
                    buildNumber: "123",
                    deviceInfo: {
                        model: "iPhone 15",
                        osVersion: "17.0",
                        family: "iPhone",
                        locale: "en_US",
                    },
                    submittedAt: "2024-01-01T00:00:00Z",
                    screenshotData: {
                        text: "The button is not working properly",
                        images: [
                            {
                                fileName: "screenshot.png",
                                url: "https://example.com/screenshot.png",
                            },
                        ],
                    },
                },
            };

            const mockLLMResponse = {
                content: JSON.stringify({
                    title: "Button functionality issue",
                    description: "User reports button not working properly",
                    labels: ["bug", "ui"],
                    priority: "normal",
                }),
                usage: {
                    prompt_tokens: 300,
                    completion_tokens: 100,
                    total_tokens: 400,
                },
                model: "gpt-4",
                provider: "openai" as LLMProvider,
                cost: 0.03,
            };

            const makeRequestSpy = mock(async () => mockLLMResponse);
            (client as any).makeRequest = makeRequestSpy;

            const response = await client.enhanceIssue(screenshotRequest);

            expect(response.title).toBe("Button functionality issue");
            expect(response.labels).toContain("ui");
        });
    });

    describe("makeRequest", () => {
        it("should make successful request with primary provider", async () => {
            const mockResponse = {
                content: "Test response",
                usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
                model: "gpt-4",
                provider: "openai" as LLMProvider,
                cost: 0.01,
            };

            // Mock the internal makeProviderRequest method
            const makeProviderRequestSpy = mock(async () => mockResponse);
            (client as any).makeProviderRequest = makeProviderRequestSpy;

            const llmRequest = {
                messages: [
                    { role: "system" as const, content: "Test system message" },
                    { role: "user" as const, content: "Test user message" },
                ],
            };

            const response = await client.makeRequest(llmRequest);

            expect(response.content).toBe("Test response");
            expect(response.provider).toBe("openai");
            expect(makeProviderRequestSpy).toHaveBeenCalledWith(
                "openai",
                llmRequest,
                {},
            );
        });

        it("should fallback to secondary provider on failure", async () => {
            const mockSuccessResponse = {
                content: "Fallback response",
                usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
                model: "claude-3-sonnet-20240229",
                provider: "anthropic" as LLMProvider,
                cost: 0.01,
            };

            // Mock first call to fail, second to succeed
            const makeProviderRequestSpy = mock()
                .mockRejectedValueOnce(new Error("Primary provider failed"))
                .mockResolvedValueOnce(mockSuccessResponse);

            (client as any).makeProviderRequest = makeProviderRequestSpy;

            const llmRequest = {
                messages: [{ role: "user" as const, content: "Test message" }],
            };

            const response = await client.makeRequest(llmRequest);

            expect(response.content).toBe("Fallback response");
            expect(response.provider).toBe("anthropic");
            expect(makeProviderRequestSpy).toHaveBeenCalledTimes(2);
        });

        it("should respect enableFallback option", async () => {
            const makeProviderRequestSpy = mock(async () => {
                throw new Error("Provider failed");
            });
            (client as any).makeProviderRequest = makeProviderRequestSpy;

            const llmRequest = {
                messages: [{ role: "user" as const, content: "Test message" }],
            };

            await expect(
                client.makeRequest(llmRequest, { enableFallback: false }),
            ).rejects.toThrow("Provider failed");

            expect(makeProviderRequestSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe("cost controls", () => {
        it("should respect cost limits", async () => {
            mockCheckCostLimits.mockReturnValueOnce({
                withinLimits: false,
                estimatedCost: 2.0,
            });

            await expect(client.enhanceIssue(mockRequest)).rejects.toThrow();
        });

        it("should calculate costs correctly", async () => {
            mockCalculateEstimatedCost.mockReturnValue(0.15);

            const mockLLMResponse = {
                content: JSON.stringify({ title: "Test" }),
                usage: {
                    prompt_tokens: 1000,
                    completion_tokens: 500,
                    total_tokens: 1500,
                },
                model: "gpt-4",
                provider: "openai" as LLMProvider,
                cost: 0.15,
            };

            const makeRequestSpy = mock(async () => mockLLMResponse);
            (client as any).makeRequest = makeRequestSpy;

            const response = await client.enhanceIssue(mockRequest);

            expect(response.metadata.cost).toBe(0.15);
            expect(mockCalculateEstimatedCost).toHaveBeenCalled();
        });
    });

    describe("security and sanitization", () => {
        it("should sanitize sensitive data", async () => {
            const requestWithSecrets = {
                ...mockRequest,
                feedback: {
                    ...mockRequest.feedback,
                    crashData: {
                        ...(mockRequest.feedback.crashData || {
                            trace: "",
                            type: "crash",
                            logs: [],
                        }),
                        trace:
                            "Stack trace with API_KEY=sk-1234567890 and password=secret123",
                    },
                },
            };

            mockSanitizeDataForLLM.mockImplementation((data) => {
                if (typeof data === "string") {
                    return data
                        .replace(/API_KEY=\S+/g, "API_KEY=[REDACTED]")
                        .replace(/password=\S+/g, "password=[REDACTED]");
                }
                return data;
            });

            const mockLLMResponse = {
                content: JSON.stringify({ title: "Sanitized issue" }),
                usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
                model: "gpt-4",
                provider: "openai" as LLMProvider,
                cost: 0.01,
            };

            const makeRequestSpy = mock(async () => mockLLMResponse);
            (client as any).makeRequest = makeRequestSpy;

            await client.enhanceIssue(requestWithSecrets);

            expect(mockSanitizeDataForLLM).toHaveBeenCalled();
        });
    });

    describe("error recovery", () => {
        it("should handle JSON parsing errors gracefully", async () => {
            const mockLLMResponse = {
                content: 'Invalid JSON response: { title: "Test" missing bracket',
                usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
                model: "gpt-4",
                provider: "openai" as LLMProvider,
                cost: 0.01,
            };

            const makeRequestSpy = mock(async () => mockLLMResponse);
            (client as any).makeRequest = makeRequestSpy;

            const response = await client.enhanceIssue(mockRequest);

            // Should fallback to default enhancement structure
            expect(response.title).toBeDefined();
            expect(response.description).toBeDefined();
            expect(response.metadata.confidence).toBeLessThan(1.0);
        });

        it("should handle network timeouts", async () => {
            const timeoutError = new Error("Request timeout");
            timeoutError.name = "TimeoutError";

            const makeRequestSpy = mock(async () => {
                throw timeoutError;
            });
            (client as any).makeRequest = makeRequestSpy;

            const response = await client.enhanceIssue(mockRequest);

            // Should return fallback enhancement
            expect(response.title).toBeDefined();
            expect(response.metadata.confidence).toBeLessThan(1.0);
        });
    });
});
