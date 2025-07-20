/**
 * State Manager Tests
 * Tests for the TestFlight feedback state persistence system
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	clearStateManagerInstance,
	TestFlightStateManager,
} from "../src/utils/state-manager.js";
import type { ProcessedFeedbackData } from "../types/testflight.js";

// Mock feedback data for testing
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

describe("TestFlightStateManager", () => {
	let stateManager: TestFlightStateManager;

	beforeEach(() => {
		// Use in-memory state manager for testing
		stateManager = new TestFlightStateManager({
			stateFilePath: "/tmp/test-state.json",
			maxRetainedIds: 100,
			cacheExpiryHours: 24,
			enableGitHubActionsCache: false,
		});
	});

	afterEach(async () => {
		await stateManager.clearState();
		clearStateManagerInstance();
	});

	describe("Basic State Operations", () => {
		test("should initialize with empty state", async () => {
			const stats = await stateManager.getStats();
			expect(stats.totalProcessed).toBe(0);
			expect(stats.currentlyCached).toBe(0);
		});

		test("should track processed feedback IDs", async () => {
			const feedbackIds = ["feedback-1", "feedback-2", "feedback-3"];

			await stateManager.markAsProcessed(feedbackIds, "test-run-1");

			const stats = await stateManager.getStats();
			expect(stats.totalProcessed).toBe(3);
			expect(stats.currentlyCached).toBe(3);
			expect(stats.actionRunId).toBe("test-run-1");
		});

		test("should detect already processed feedback", async () => {
			const feedbackId = "feedback-test";

			// Initially not processed
			expect(await stateManager.isProcessed(feedbackId)).toBe(false);

			// Mark as processed
			await stateManager.markAsProcessed([feedbackId]);

			// Should now be detected as processed
			expect(await stateManager.isProcessed(feedbackId)).toBe(true);
		});

		test("should filter unprocessed feedback correctly", async () => {
			const allFeedback = [
				createMockFeedback("new-1"),
				createMockFeedback("new-2"),
				createMockFeedback("processed-1"),
				createMockFeedback("new-3"),
			];

			// Mark some as processed
			await stateManager.markAsProcessed(["processed-1"]);

			const unprocessed = await stateManager.filterUnprocessed(allFeedback);

			expect(unprocessed).toHaveLength(3);
			expect(unprocessed.map((f) => f.id)).toEqual(["new-1", "new-2", "new-3"]);
		});
	});

	describe("State Persistence", () => {
		test("should save and load state correctly", async () => {
			const feedbackIds = ["save-test-1", "save-test-2"];

			// Mark as processed and save
			await stateManager.markAsProcessed(feedbackIds, "save-test");
			await stateManager.saveState();

			// Create new instance and load state
			const newStateManager = new TestFlightStateManager({
				stateFilePath: "/tmp/test-state.json",
				enableGitHubActionsCache: false,
			});

			const stats = await newStateManager.getStats();
			expect(stats.totalProcessed).toBe(2);
			expect(stats.actionRunId).toBe("save-test");

			// Verify specific IDs are tracked
			expect(await newStateManager.isProcessed("save-test-1")).toBe(true);
			expect(await newStateManager.isProcessed("save-test-2")).toBe(true);
			expect(await newStateManager.isProcessed("not-processed")).toBe(false);

			await newStateManager.clearState();
		});

		test("should handle corrupted state gracefully", async () => {
			// Write invalid JSON to state file
			const fs = require("node:fs/promises");
			await fs.writeFile("/tmp/test-state.json", "invalid json", "utf8");

			// Should initialize fresh state instead of crashing
			const newStateManager = new TestFlightStateManager({
				stateFilePath: "/tmp/test-state.json",
				enableGitHubActionsCache: false,
			});

			const stats = await newStateManager.getStats();
			expect(stats.totalProcessed).toBe(0);
		});
	});

	describe("State Cleanup and Limits", () => {
		test("should enforce maximum retained IDs limit", async () => {
			const limitedStateManager = new TestFlightStateManager({
				stateFilePath: "/tmp/test-limited-state.json",
				maxRetainedIds: 5,
				enableGitHubActionsCache: false,
			});

			// Add more IDs than the limit
			const feedbackIds = Array.from({ length: 10 }, (_, i) => `feedback-${i}`);
			await limitedStateManager.markAsProcessed(feedbackIds);

			const stats = await limitedStateManager.getStats();
			expect(stats.currentlyCached).toBeLessThanOrEqual(5);
			expect(stats.totalProcessed).toBe(10);

			await limitedStateManager.clearState();
		});

		test("should clear expired cache", async () => {
			const expiredStateManager = new TestFlightStateManager({
				stateFilePath: "/tmp/test-expired-state.json",
				cacheExpiryHours: 0, // Expire immediately
				enableGitHubActionsCache: false,
			});

			await expiredStateManager.markAsProcessed(["expired-1"]);

			// Wait a bit and then load state (should be expired)
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Force reload by creating new instance
			const newExpiredStateManager = new TestFlightStateManager({
				stateFilePath: "/tmp/test-expired-state.json",
				cacheExpiryHours: 0,
				enableGitHubActionsCache: false,
			});

			// The expired state should be cleared
			expect(await newExpiredStateManager.isProcessed("expired-1")).toBe(false);

			await newExpiredStateManager.clearState();
		});
	});

	describe("Batch Operations", () => {
		test("should handle large batches efficiently", async () => {
			const largeBatch = Array.from({ length: 1000 }, (_, i) => `batch-${i}`);

			const startTime = Date.now();
			await stateManager.markAsProcessed(largeBatch);
			const endTime = Date.now();

			// Should complete in reasonable time (less than 1 second)
			expect(endTime - startTime).toBeLessThan(1000);

			const stats = await stateManager.getStats();
			expect(stats.totalProcessed).toBe(1000);
			expect(stats.currentlyCached).toBe(1000);
		});

		test("should deduplicate IDs in same batch", async () => {
			const duplicatedBatch = ["dup-1", "dup-2", "dup-1", "dup-3", "dup-2"];

			await stateManager.markAsProcessed(duplicatedBatch);

			const stats = await stateManager.getStats();
			expect(stats.totalProcessed).toBe(5); // Counts all attempts
			expect(stats.currentlyCached).toBe(3); // Only unique IDs stored
		});
	});

	describe("Error Handling", () => {
		test("should handle invalid feedback objects gracefully", async () => {
			const invalidFeedback = [
				{ id: "valid-1" } as ProcessedFeedbackData,
				// Note: Using 'any' for test data that intentionally doesn't match interface
				{ notAnId: "invalid" } as any,
				{ id: "valid-2" } as ProcessedFeedbackData,
			];

			const unprocessed = await stateManager.filterUnprocessed(invalidFeedback);

			// Should filter based on presence of id property
			expect(unprocessed).toHaveLength(2);
			expect(unprocessed.map((f) => f.id)).toEqual(["valid-1", "valid-2"]);
		});

		test("should handle empty arrays correctly", async () => {
			await stateManager.markAsProcessed([]);
			const unprocessed = await stateManager.filterUnprocessed([]);

			expect(unprocessed).toHaveLength(0);

			const stats = await stateManager.getStats();
			expect(stats.totalProcessed).toBe(0);
		});
	});

	describe("Performance Metrics", () => {
		test("should provide accurate statistics", async () => {
			const firstBatch = ["stat-1", "stat-2"];
			const secondBatch = ["stat-3", "stat-4", "stat-5"];

			await stateManager.markAsProcessed(firstBatch, "run-1");
			const firstStats = await stateManager.getStats();

			await stateManager.markAsProcessed(secondBatch, "run-2");
			const secondStats = await stateManager.getStats();

			expect(firstStats.totalProcessed).toBe(2);
			expect(firstStats.currentlyCached).toBe(2);
			expect(firstStats.actionRunId).toBe("run-1");

			expect(secondStats.totalProcessed).toBe(7); // 2 + 5
			expect(secondStats.currentlyCached).toBe(5); // 2 + 3 unique
			expect(secondStats.actionRunId).toBe("run-2");
		});

		test("should track cache age correctly", async () => {
			await stateManager.markAsProcessed(["age-test"]);
			const stats = await stateManager.getStats();

			// Cache age should be very recent (less than 1 second)
			expect(stats.cacheAge).toMatch(/^0h 0m$/);
		});
	});
});
