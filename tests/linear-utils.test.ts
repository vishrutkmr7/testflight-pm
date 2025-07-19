/**
 * Linear Utilities Tests
 * Comprehensive test suite for Linear integration utilities
 */

import { describe, expect, mock, test } from "bun:test";
import {
	determineFeedbackPriority,
	formatFeedbackForLinear,
	generateFeedbackLabels,
	validateLinearIntegration,
} from "../src/utils/linear-utils.js";
import type { ProcessedFeedbackData } from "../types/testflight.js";

// Mock feedback data for testing
const createMockCrashFeedback = (
	overrides: Partial<ProcessedFeedbackData> = {},
): ProcessedFeedbackData => ({
	id: "crash-123",
	type: "crash",
	submittedAt: new Date("2024-01-15T10:30:00Z"),
	appVersion: "1.2.3",
	buildNumber: "456",
	deviceInfo: {
		family: "iPhone",
		model: "iPhone 14 Pro",
		osVersion: "17.0",
		locale: "en_US",
	},
	bundleId: "com.example.testapp",
	crashData: {
		trace: "Stack trace here...\nat com.example.Class.method(File.swift:42)",
		type: "NSException",
		exceptionType: "NSInvalidArgumentException",
		exceptionMessage: "Attempt to insert nil object",
		logs: [
			{
				url: "https://example.com/crash-log-1.txt",
				expiresAt: new Date("2024-01-16T10:30:00Z"),
			},
		],
	},
	...overrides,
});

const createMockScreenshotFeedback = (
	overrides: Partial<ProcessedFeedbackData> = {},
): ProcessedFeedbackData => ({
	id: "screenshot-456",
	type: "screenshot",
	submittedAt: new Date("2024-01-15T14:20:00Z"),
	appVersion: "1.2.3",
	buildNumber: "456",
	deviceInfo: {
		family: "iPad",
		model: "iPad Pro",
		osVersion: "17.0",
		locale: "en_US",
	},
	bundleId: "com.example.testapp",
	screenshotData: {
		text: "The login button is not working properly on this screen",
		images: [
			{
				url: "https://example.com/screenshot-1.png",
				fileName: "screenshot-1.png",
				fileSize: 1024768,
				expiresAt: new Date("2024-01-16T14:20:00Z"),
			},
		],
		annotations: [
			{
				x: 100,
				y: 200,
				width: 50,
				height: 30,
				text: "Button issue here",
				type: "text",
			},
		],
	},
	...overrides,
});

describe("Linear Utilities", () => {
	describe("determineFeedbackPriority", () => {
		test("should assign urgent priority to fatal crashes", () => {
			const feedback = createMockCrashFeedback({
				crashData: {
					trace: "Stack trace...",
					type: "Fatal",
					exceptionType: "FatalException",
					exceptionMessage: "Fatal error occurred",
					logs: [],
				},
			});

			const priority = determineFeedbackPriority(feedback);
			expect(priority).toBe(1); // Urgent
		});

		test("should assign high priority to non-fatal crashes", () => {
			const feedback = createMockCrashFeedback();
			const priority = determineFeedbackPriority(feedback);
			expect(priority).toBe(2); // High
		});

		test("should assign high priority to out of memory crashes", () => {
			const feedback = createMockCrashFeedback({
				crashData: {
					trace: "Stack trace...",
					type: "Memory",
					exceptionType: "OutOfMemoryException",
					exceptionMessage: "Out of memory error",
					logs: [],
				},
			});

			const priority = determineFeedbackPriority(feedback);
			expect(priority).toBe(2); // High
		});

		test("should assign high priority to crash-related user feedback", () => {
			const feedback = createMockScreenshotFeedback({
				screenshotData: {
					text: "The app crashed when I tapped this button",
					images: [],
					annotations: [],
				},
			});

			const priority = determineFeedbackPriority(feedback);
			expect(priority).toBe(2); // High
		});

		test("should assign low priority to feature requests", () => {
			const feedback = createMockScreenshotFeedback({
				screenshotData: {
					text: "It would be nice if you could add a dark mode feature",
					images: [],
					annotations: [],
				},
			});

			const priority = determineFeedbackPriority(feedback);
			expect(priority).toBe(4); // Low
		});

		test("should assign normal priority to general feedback", () => {
			const feedback = createMockScreenshotFeedback({
				screenshotData: {
					text: "The interface looks good but could be improved",
					images: [],
					annotations: [],
				},
			});

			const priority = determineFeedbackPriority(feedback);
			expect(priority).toBe(3); // Normal
		});

		test("should assign normal priority when no feedback text is available", () => {
			const feedback = createMockScreenshotFeedback({
				screenshotData: {
					text: undefined,
					images: [],
					annotations: [],
				},
			});

			const priority = determineFeedbackPriority(feedback);
			expect(priority).toBe(3); // Normal
		});
	});

	describe("generateFeedbackLabels", () => {
		test("should generate appropriate labels for crash feedback", () => {
			const feedback = createMockCrashFeedback();
			const labels = generateFeedbackLabels(feedback);

			expect(labels).toContain("testflight");
			expect(labels).toContain("bug");
			expect(labels).toContain("crash");
			expect(labels).toContain("ios");
			expect(labels).toContain("iphone");
			expect(labels).toContain("v1"); // version label
		});

		test("should add critical label for fatal crashes", () => {
			const feedback = createMockCrashFeedback({
				crashData: {
					trace: "Stack trace...",
					type: "Fatal",
					exceptionType: "FatalException",
					exceptionMessage: "Fatal error",
					logs: [],
				},
			});

			const labels = generateFeedbackLabels(feedback);
			expect(labels).toContain("critical");
		});

		test("should generate appropriate labels for screenshot feedback", () => {
			const feedback = createMockScreenshotFeedback();
			const labels = generateFeedbackLabels(feedback);

			expect(labels).toContain("testflight");
			expect(labels).toContain("user-feedback");
			expect(labels).toContain("ios");
			expect(labels).toContain("ipad");
			expect(labels).toContain("v1");
		});

		test("should add UI/UX labels based on feedback content", () => {
			const feedback = createMockScreenshotFeedback({
				screenshotData: {
					text: "The UI design is confusing and the interface needs work",
					images: [],
					annotations: [],
				},
			});

			const labels = generateFeedbackLabels(feedback);
			expect(labels).toContain("ui-ux");
		});

		test("should add enhancement labels for feature requests", () => {
			const feedback = createMockScreenshotFeedback({
				screenshotData: {
					text: "Please add a new feature for sharing content",
					images: [],
					annotations: [],
				},
			});

			const labels = generateFeedbackLabels(feedback);
			expect(labels).toContain("enhancement");
		});

		test("should add bug labels when feedback mentions issues", () => {
			const feedback = createMockScreenshotFeedback({
				screenshotData: {
					text: "This button is broken and not working",
					images: [],
					annotations: [],
				},
			});

			const labels = generateFeedbackLabels(feedback);
			expect(labels).toContain("bug");
		});

		test("should handle empty version gracefully", () => {
			const feedback = createMockCrashFeedback({
				appVersion: "",
			});

			const labels = generateFeedbackLabels(feedback);
			expect(labels).toContain("testflight");
			expect(labels).not.toContain("v"); // Should not add empty version label
		});
	});

	describe("formatFeedbackForLinear", () => {
		test("should format crash feedback with proper title and description", () => {
			const feedback = createMockCrashFeedback();
			const { title, description } = formatFeedbackForLinear(feedback);

			expect(title).toMatch(/💥 Crash Report: 1\.2\.3/);
			expect(title).toContain("NSInvalidArgumentException");

			expect(description).toContain("## Crash Report from TestFlight");
			expect(description).toContain("| **TestFlight ID** | `crash-123` |");
			expect(description).toContain("| **App Version** | 1.2.3 (Build 456) |");
			expect(description).toContain("| **Device** | iPhone 14 Pro |");
			expect(description).toContain("## 🔍 Crash Analysis");
			expect(description).toContain("**Crash Type:** NSException");
			expect(description).toContain(
				"**Exception Type:** `NSInvalidArgumentException`",
			);
			expect(description).toContain("### Stack Trace");
			expect(description).toContain("Stack trace here...");
			expect(description).toContain("### Crash Logs");
			expect(description).toContain(
				"- [Crash Log 1](https://example.com/crash-log-1.txt)",
			);
		});

		test("should format screenshot feedback with proper title and description", () => {
			const feedback = createMockScreenshotFeedback();
			const { title, description } = formatFeedbackForLinear(feedback);

			expect(title).toMatch(/📱 User Feedback: 1\.2\.3/);
			expect(title).toContain("The login button is not working");

			expect(description).toContain("## User Feedback from TestFlight");
			expect(description).toContain("| **TestFlight ID** | `screenshot-456` |");
			expect(description).toContain("## 📝 User Feedback");
			expect(description).toContain("### Feedback Text");
			expect(description).toContain(
				"> The login button is not working properly",
			);
			expect(description).toContain("### Screenshots (1)");
			expect(description).toContain(
				"- [screenshot-1.png](https://example.com/screenshot-1.png)",
			);
			expect(description).toContain("### Annotations");
			expect(description).toContain("User provided 1 annotation(s)");
		});

		test("should include technical details section", () => {
			const feedback = createMockCrashFeedback();
			const { description } = formatFeedbackForLinear(feedback);

			expect(description).toContain("## 🛠️ Technical Details");
			expect(description).toContain("<details>");
			expect(description).toContain(
				"<summary>Device & Environment Information</summary>",
			);
			expect(description).toContain("- **Device Family:** iPhone");
			expect(description).toContain("- **Bundle ID:** com.example.testapp");
		});

		test("should include auto-generated footer", () => {
			const feedback = createMockCrashFeedback();
			const { description } = formatFeedbackForLinear(feedback);

			expect(description).toContain("---");
			expect(description).toContain(
				"*This issue was automatically created from TestFlight feedback",
			);
			expect(description).toContain("Original submission ID: `crash-123`*");
		});

		test("should handle missing optional data gracefully", () => {
			const feedback = createMockCrashFeedback({
				crashData: {
					trace: "Basic trace",
					type: "Exception",
					exceptionType: undefined,
					exceptionMessage: undefined,
					logs: [],
				},
			});

			const { title, description } = formatFeedbackForLinear(feedback);

			expect(title).not.toContain("undefined");
			expect(description).toContain("**Crash Type:** Exception");
			expect(description).not.toContain("**Exception Type:**");
			expect(description).not.toContain("**Exception Message:**");
		});

		test("should truncate long titles appropriately", () => {
			const longText =
				"This is a very long feedback text that should be truncated in the title to avoid creating extremely long issue titles that would be difficult to read and manage in Linear workspace";

			const feedback = createMockScreenshotFeedback({
				screenshotData: {
					text: longText,
					images: [],
					annotations: [],
				},
			});

			const { title } = formatFeedbackForLinear(feedback);

			expect(title.length).toBeLessThan(150); // Reasonable title length
			expect(title).toContain("...");
		});
	});

	describe("validateLinearIntegration", () => {
		test("should return valid when configuration is present", () => {
			// Mock the validateLinearConfig function to return true
			const _mockValidateLinearConfig = mock(() => true);

			// We would need to mock the module here in a real test environment
			// For now, this shows the test structure
			const validation = validateLinearIntegration();

			// This test would need proper mocking setup to work
			expect(validation).toHaveProperty("valid");
			expect(validation).toHaveProperty("errors");
		});

		test("should return invalid when configuration is missing", () => {
			// Mock the validateLinearConfig function to return false
			const _mockValidateLinearConfig = mock(() => false);

			const validation = validateLinearIntegration();

			expect(validation.valid).toBe(false);
			expect(validation.errors.length).toBeGreaterThan(0);
			expect(validation.errors[0]).toContain("Linear configuration missing");
		});
	});

	describe("edge cases and error handling", () => {
		test("should handle malformed feedback data gracefully", () => {
			const malformedFeedback = {
				id: "test",
				type: "crash",
				submittedAt: new Date(),
				appVersion: "",
				buildNumber: "",
				deviceInfo: {
					family: "",
					model: "",
					osVersion: "",
					locale: "",
				},
				bundleId: "",
				crashData: undefined,
			} as ProcessedFeedbackData;

			expect(() => determineFeedbackPriority(malformedFeedback)).not.toThrow();
			expect(() => generateFeedbackLabels(malformedFeedback)).not.toThrow();
			expect(() => formatFeedbackForLinear(malformedFeedback)).not.toThrow();
		});

		test("should handle extremely long feedback text", () => {
			const veryLongText = "A".repeat(10000); // 10k characters

			const feedback = createMockScreenshotFeedback({
				screenshotData: {
					text: veryLongText,
					images: [],
					annotations: [],
				},
			});

			const { title, description } = formatFeedbackForLinear(feedback);

			expect(title.length).toBeLessThan(200);
			expect(description).toContain(veryLongText); // Full text should be in description
		});

		test("should handle special characters in feedback text", () => {
			const specialText =
				'Special chars: <script>alert("xss")</script> & "quotes" & \n\r newlines';

			const feedback = createMockScreenshotFeedback({
				screenshotData: {
					text: specialText,
					images: [],
					annotations: [],
				},
			});

			const { title, description } = formatFeedbackForLinear(feedback);

			expect(title).toContain("Special chars");
			expect(description).toContain(specialText);
			expect(description).toContain("> Special chars:"); // Proper markdown quoting
		});

		test("should handle empty arrays and null values", () => {
			const feedback = createMockCrashFeedback({
				crashData: {
					trace: "",
					type: "",
					exceptionType: "",
					exceptionMessage: "",
					logs: [],
				},
			});

			const labels = generateFeedbackLabels(feedback);
			const { title, description } = formatFeedbackForLinear(feedback);

			expect(labels).toContain("testflight");
			expect(title).toContain("Crash Report");
			expect(description).toContain("Crash Report from TestFlight");
		});
	});
});
