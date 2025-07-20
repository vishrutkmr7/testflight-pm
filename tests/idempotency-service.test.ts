/**
 * Idempotency Service Tests
 * Tests for coordinated duplicate detection across GitHub and Linear platforms
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	clearIdempotencyServiceInstance,
	IdempotencyService,
} from "../src/utils/idempotency-service.js";
import { clearStateManagerInstance } from "../src/utils/state-manager.js";
import type { ProcessedFeedbackData } from "../types/testflight.js";

// Mock implementations for external dependencies
// Note: Using 'any' types for test mocks to avoid complex interface matching
const mockGitHubClient = {
	findDuplicateIssue: async (): Promise<any> => ({
		isDuplicate: false,
		confidence: 0,
		reasons: ["No duplicates found"],
		existingIssue: null,
	}),
	createIssueFromTestFlight: async (): Promise<any> => ({
		issue: {
			id: 12345,
			number: 42,
			title: "Test Issue",
			html_url: "https://github.com/test/repo/issues/42",
			body: "Test issue body",
		},
		wasExisting: false,
		action: "created",
		message: "Created new issue #42",
	}),
	addCommentToIssue: async (): Promise<any> => ({
		id: 67890,
		body: "Test comment",
		html_url: "https://github.com/test/repo/issues/42#issuecomment-67890",
	}),
};

const mockLinearClient = {
	findDuplicateIssue: async (): Promise<any> => null,
	createIssueFromTestFlight: async (): Promise<any> => ({
		id: "linear-123",
		identifier: "TEST-42",
		title: "Test Linear Issue",
		url: "https://linear.app/test/issue/TEST-42",
	}),
	addCommentToIssue: async (): Promise<any> => ({
		id: "comment-123",
		body: "Test comment",
	}),
};

// Mock the external modules
const originalGetGitHubClient =
	require("../src/api/github-client.js").getGitHubClient;
const originalGetLinearClient =
	require("../src/api/linear-client.js").getLinearClient;

// Mock feedback data
const createMockFeedback = (
	id: string,
	type: "crash" | "screenshot" = "crash",
): ProcessedFeedbackData => ({
	id,
	type,
	submittedAt: new Date(),
	appVersion: "1.0.0",
	buildNumber: "100",
	deviceInfo: {
		family: "iPhone",
		model: "iPhone 14 Pro",
		osVersion: "17.0",
		locale: "en_US",
	},
	bundleId: "com.test.app",
	crashData:
		type === "crash"
			? {
					trace: "test stack trace",
					type: "crash",
					exceptionType: "NSException",
					exceptionMessage: "Test crash",
					logs: [],
				}
			: undefined,
	screenshotData:
		type === "screenshot"
			? {
					text: "Test feedback",
					images: [],
					annotations: [],
				}
			: undefined,
});

describe("IdempotencyService", () => {
	let idempotencyService: IdempotencyService;

	beforeEach(() => {
		// Mock external clients
		require("../src/api/github-client.js").getGitHubClient = () =>
			mockGitHubClient;
		require("../src/api/linear-client.js").getLinearClient = () =>
			mockLinearClient;

		idempotencyService = new IdempotencyService({
			enableStateTracking: true,
			enableGitHubDuplicateDetection: true,
			enableLinearDuplicateDetection: true,
			retryAttempts: 2,
			retryDelayMs: 10, // Fast retries for testing
			searchTimeoutMs: 5000,
			confidenceThreshold: 0.7,
		});
	});

	afterEach(() => {
		// Restore original implementations
		require("../src/api/github-client.js").getGitHubClient =
			originalGetGitHubClient;
		require("../src/api/linear-client.js").getLinearClient =
			originalGetLinearClient;

		clearIdempotencyServiceInstance();
		clearStateManagerInstance();
	});

	describe("Basic Issue Creation", () => {
		test("should create issues on both platforms when no duplicates found", async () => {
			const feedback = createMockFeedback("unique-feedback-1");

			const result =
				await idempotencyService.createIssueWithDuplicateProtection(feedback, {
					preferredPlatform: "both",
				});

			expect(result.duplicateDetection.isDuplicate).toBe(false);
			expect(result.processedBy).toContain("github");
			expect(result.processedBy).toContain("linear");
			expect(result.github).toBeDefined();
			expect(result.linear).toBeDefined();
			expect(result.errors).toHaveLength(0);
		});

		test("should create issue on single platform when specified", async () => {
			const feedback = createMockFeedback("github-only-1");

			const result =
				await idempotencyService.createIssueWithDuplicateProtection(feedback, {
					preferredPlatform: "github",
				});

			expect(result.processedBy).toEqual(["github"]);
			expect(result.github).toBeDefined();
			expect(result.linear).toBeUndefined();
		});

		test("should track processing duration", async () => {
			const feedback = createMockFeedback("duration-test-1");

			const result =
				await idempotencyService.createIssueWithDuplicateProtection(feedback);

			expect(result.totalDuration).toBeGreaterThan(0);
			expect(result.totalDuration).toBeLessThan(5000); // Should complete within 5 seconds
		});
	});

	describe("State-Based Duplicate Detection", () => {
		test("should detect already processed feedback via state tracking", async () => {
			const feedback = createMockFeedback("state-duplicate-1");

			// First processing - should create issues
			const firstResult =
				await idempotencyService.createIssueWithDuplicateProtection(feedback);
			expect(firstResult.duplicateDetection.isDuplicate).toBe(false);

			// Second processing - should detect as duplicate
			const secondResult =
				await idempotencyService.createIssueWithDuplicateProtection(feedback);
			expect(secondResult.duplicateDetection.isDuplicate).toBe(true);
			expect(secondResult.duplicateDetection.platform).toBe("state");
			expect(secondResult.duplicateDetection.confidence).toBe(1.0);
			expect(secondResult.processedBy).toHaveLength(0);
		});

		test("should bypass state tracking when disabled", async () => {
			const disabledService = new IdempotencyService({
				enableStateTracking: false,
			});

			const feedback = createMockFeedback("no-state-tracking-1");

			// Process twice - should not detect duplicates via state
			await disabledService.createIssueWithDuplicateProtection(feedback);
			const secondResult =
				await disabledService.createIssueWithDuplicateProtection(feedback);

			expect(secondResult.duplicateDetection.platform).not.toBe("state");
		});
	});

	describe("Platform-Based Duplicate Detection", () => {
		test("should detect GitHub duplicates", async () => {
			// Mock GitHub client to return duplicate
			mockGitHubClient.findDuplicateIssue = async () => ({
				isDuplicate: true,
				confidence: 0.9,
				reasons: ["Exact TestFlight ID match"],
				existingIssue: {
					id: 123,
					number: 45,
					title: "Existing Issue",
					html_url: "https://github.com/test/repo/issues/45",
					body: "Existing issue body",
				},
			});

			const feedback = createMockFeedback("github-duplicate-1");

			const result =
				await idempotencyService.createIssueWithDuplicateProtection(feedback);

			expect(result.duplicateDetection.isDuplicate).toBe(true);
			expect(result.duplicateDetection.platform).toBe("github");
			expect(result.duplicateDetection.confidence).toBe(0.9);
			expect(result.processedBy).toHaveLength(0);
		});

		test("should detect Linear duplicates", async () => {
			// Mock Linear client to return duplicate
			mockLinearClient.findDuplicateIssue = async () => ({
				id: "existing-linear-123",
				identifier: "TEST-45",
				title: "Existing Linear Issue",
				url: "https://linear.app/test/issue/TEST-45",
			});

			const feedback = createMockFeedback("linear-duplicate-1");

			const result =
				await idempotencyService.createIssueWithDuplicateProtection(feedback);

			expect(result.duplicateDetection.isDuplicate).toBe(true);
			expect(result.duplicateDetection.platform).toBe("linear");
			expect(result.duplicateDetection.confidence).toBe(1.0);
			expect(result.processedBy).toHaveLength(0);
		});

		test("should respect confidence threshold", async () => {
			// Mock low confidence duplicate
			mockGitHubClient.findDuplicateIssue = async () => ({
				isDuplicate: true,
				confidence: 0.5, // Below threshold
				reasons: ["Weak similarity match"],
				existingIssue: {
					id: 123,
					number: 45,
					title: "Weak Match",
					html_url: "https://github.com/test/repo/issues/45",
					body: "Weak match body",
				},
			});

			const feedback = createMockFeedback("low-confidence-1");

			const result =
				await idempotencyService.createIssueWithDuplicateProtection(feedback);

			// Should not treat as duplicate due to low confidence
			expect(result.duplicateDetection.isDuplicate).toBe(false);
			expect(result.processedBy.length).toBeGreaterThan(0);
		});
	});

	describe("Error Handling and Retry Logic", () => {
		test("should handle GitHub API failures gracefully", async () => {
			// Mock GitHub client to throw error
			mockGitHubClient.createIssueFromTestFlight = async () => {
				throw new Error("GitHub API Error");
			};

			const feedback = createMockFeedback("github-error-1");

			const result =
				await idempotencyService.createIssueWithDuplicateProtection(feedback, {
					preferredPlatform: "both",
				});

			expect(result.errors).toContain("GitHub: GitHub API Error");
			expect(result.processedBy).toContain("linear"); // Should still create Linear issue
			expect(result.processedBy).not.toContain("github");
		});

		test("should handle Linear API failures gracefully", async () => {
			// Mock Linear client to throw error
			mockLinearClient.createIssueFromTestFlight = async () => {
				throw new Error("Linear API Error");
			};

			const feedback = createMockFeedback("linear-error-1");

			const result =
				await idempotencyService.createIssueWithDuplicateProtection(feedback, {
					preferredPlatform: "both",
				});

			expect(result.errors).toContain("Linear: Linear API Error");
			expect(result.processedBy).toContain("github"); // Should still create GitHub issue
			expect(result.processedBy).not.toContain("linear");
		});

		test("should retry on transient failures", async () => {
			let callCount = 0;
			mockGitHubClient.findDuplicateIssue = async () => {
				callCount++;
				if (callCount < 2) {
					throw new Error("Transient error");
				}
				return {
					isDuplicate: false,
					confidence: 0,
					reasons: ["No duplicates found after retry"],
					existingIssue: null,
				};
			};

			const feedback = createMockFeedback("retry-test-1");

			const result =
				await idempotencyService.createIssueWithDuplicateProtection(feedback);

			expect(callCount).toBe(2); // Should have retried once
			expect(result.duplicateDetection.isDuplicate).toBe(false);
		});

		test("should timeout long-running searches", async () => {
			const timeoutService = new IdempotencyService({
				searchTimeoutMs: 100, // Very short timeout
			});

			// Mock slow search
			mockGitHubClient.findDuplicateIssue = async () => {
				await new Promise((resolve) => setTimeout(resolve, 200)); // Longer than timeout
				return {
					isDuplicate: false,
					confidence: 0,
					reasons: [],
					existingIssue: null,
				};
			};

			const feedback = createMockFeedback("timeout-test-1");

			const result =
				await timeoutService.createIssueWithDuplicateProtection(feedback);

			// Should complete despite timeout, possibly with errors
			expect(result.totalDuration).toBeLessThan(1000);
		});
	});

	describe("Configuration Options", () => {
		test("should skip duplicate detection when disabled", async () => {
			const feedback = createMockFeedback("skip-detection-1");

			const result =
				await idempotencyService.createIssueWithDuplicateProtection(feedback, {
					skipDuplicateDetection: true,
				});

			expect(result.duplicateDetection.isDuplicate).toBe(false);
			expect(result.processedBy.length).toBeGreaterThan(0);
		});

		test("should include action run ID in state tracking", async () => {
			const feedback = createMockFeedback("run-id-test-1");
			const runId = "test-run-123";

			await idempotencyService.createIssueWithDuplicateProtection(feedback, {
				actionRunId: runId,
			});

			// Process again to trigger state-based duplicate detection
			const result =
				await idempotencyService.createIssueWithDuplicateProtection(feedback);

			expect(result.duplicateDetection.isDuplicate).toBe(true);
			expect(
				result.duplicateDetection.reasons.some((r) => r.includes(runId)),
			).toBe(true);
		});
	});

	describe("Statistics and Diagnostics", () => {
		test("should provide comprehensive statistics", async () => {
			const feedback = createMockFeedback("stats-test-1");
			await idempotencyService.createIssueWithDuplicateProtection(feedback);

			const stats = await idempotencyService.getStatistics();

			expect(stats.stateTracking.totalProcessed).toBe(1);
			expect(stats.stateTracking.currentlyCached).toBe(1);
			expect(stats.configuration).toBeDefined();
			expect(stats.lastUpdated).toBeDefined();
		});

		test("should track cache age accurately", async () => {
			const feedback = createMockFeedback("cache-age-test-1");
			await idempotencyService.createIssueWithDuplicateProtection(feedback);

			const stats = await idempotencyService.getStatistics();
			expect(stats.stateTracking.cacheAge).toMatch(/^\d+h \d+m$/);
		});
	});

	describe("Comment Addition for Duplicates", () => {
		test("should add comments to existing GitHub issues", async () => {
			let commentAdded = false;
			mockGitHubClient.addCommentToIssue = async () => {
				commentAdded = true;
				return {
					id: 67890,
					body: "Additional TestFlight report",
					html_url: "https://github.com/test/repo/issues/42#issuecomment-67890",
				};
			};

			// Mock duplicate detection
			mockGitHubClient.findDuplicateIssue = async () => ({
				isDuplicate: true,
				confidence: 1.0,
				reasons: ["Exact match"],
				existingIssue: {
					id: 123,
					number: 42,
					title: "Existing Issue",
					html_url: "https://github.com/test/repo/issues/42",
					body: "Existing issue body",
				},
			});

			const feedback = createMockFeedback("comment-test-1");

			await idempotencyService.createIssueWithDuplicateProtection(feedback);

			expect(commentAdded).toBe(true);
		});

		test("should add comments to existing Linear issues", async () => {
			let commentAdded = false;
			mockLinearClient.addCommentToIssue = async () => {
				commentAdded = true;
				return {
					id: "comment-123",
					body: "Additional TestFlight report",
				};
			};

			// Mock duplicate detection
			mockLinearClient.findDuplicateIssue = async () => ({
				id: "existing-linear-123",
				identifier: "TEST-42",
				title: "Existing Linear Issue",
				url: "https://linear.app/test/issue/TEST-42",
			});

			const feedback = createMockFeedback("linear-comment-test-1");

			await idempotencyService.createIssueWithDuplicateProtection(feedback);

			expect(commentAdded).toBe(true);
		});
	});
});
