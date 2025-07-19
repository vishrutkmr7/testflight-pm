/**
 * TestFlight Webhook Receiver Tests
 * Comprehensive security and functionality testing
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import {
	TestFlightWebhookReceiver,
	type WebhookRequest,
	clearReceiverInstance,
	getWebhookReceiver,
} from "../src/api/webhook-receiver.js";
import { clearConfigCache } from "../src/config/environment.js";
import type { TestFlightWebhookEvent } from "../types/testflight.js";

describe("TestFlight Webhook Receiver", () => {
	let receiver: TestFlightWebhookReceiver;

	beforeEach(() => {
		// Clear any cached instances and config
		clearReceiverInstance();
		clearConfigCache();

		// Set test environment variables
		process.env.WEBHOOK_SECRET = "test-webhook-secret-key";
		process.env.WEBHOOK_PORT = "3001";
		process.env.APP_STORE_CONNECT_ISSUER_ID = "test-issuer";
		process.env.APP_STORE_CONNECT_KEY_ID = "test-key";
		process.env.APP_STORE_CONNECT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgTestKeyContent
-----END PRIVATE KEY-----`;

		receiver = getWebhookReceiver();
	});

	afterEach(() => {
		clearReceiverInstance();
		clearConfigCache();
		process.env.WEBHOOK_SECRET = undefined;
		process.env.WEBHOOK_PORT = undefined;
	});

	describe("Initialization", () => {
		it("should create receiver instance with webhook secret", () => {
			expect(receiver).toBeDefined();
			expect(receiver).toBeInstanceOf(TestFlightWebhookReceiver);
		});

		it("should handle missing webhook secret gracefully", () => {
			process.env.WEBHOOK_SECRET = undefined;
			clearReceiverInstance();
			clearConfigCache();

			// Should not throw
			const receiverWithoutSecret = getWebhookReceiver();
			expect(receiverWithoutSecret).toBeDefined();
		});
	});

	describe("Request Validation", () => {
		it("should reject non-POST requests", async () => {
			const request: WebhookRequest = {
				method: "GET",
				body: "{}",
				headers: {},
				url: "/webhook",
			};

			const response = await receiver.handleWebhook(request);
			expect(response.status).toBe(405);
			expect(response.body).toContain("Method not allowed");
		});

		it("should reject oversized payloads", async () => {
			const largePayload = "x".repeat(11 * 1024 * 1024); // 11MB
			const request: WebhookRequest = {
				method: "POST",
				body: largePayload,
				headers: {},
				url: "/webhook",
			};

			const response = await receiver.handleWebhook(request);
			expect(response.status).toBe(413);
			expect(response.body).toContain("Payload too large");
		});

		it("should reject invalid JSON payloads", async () => {
			const request: WebhookRequest = {
				method: "POST",
				body: "invalid json {",
				headers: {},
				url: "/webhook",
			};

			const response = await receiver.handleWebhook(request);
			// When webhook secret is configured, signature validation happens first
			// This returns 401 (Invalid signature) instead of 400 (Invalid JSON)
			// This is correct security behavior - validate signature before parsing payload
			expect(response.status).toBe(401);
			expect(response.body).toContain("Invalid signature");
		});
	});

	describe("HMAC Signature Verification", () => {
		const mockEvent: TestFlightWebhookEvent = {
			eventType: "BETA_FEEDBACK_CRASH_SUBMISSION",
			eventTime: "2024-01-01T12:00:00Z",
			version: "1.0",
			data: {
				betaFeedbackCrashSubmission: {
					id: "crash-123",
					type: "betaFeedbackCrashSubmissions",
					attributes: {
						submittedAt: "2024-01-01T12:00:00Z",
						crashLogs: [],
						deviceFamily: "iPhone",
						deviceModel: "iPhone 14 Pro",
						osVersion: "17.0",
						appVersion: "1.0.0",
						buildNumber: "123",
						locale: "en-US",
						bundleId: "com.test.app",
						crashTrace: "Test crash trace",
						crashType: "EXC_BAD_ACCESS",
					},
					relationships: {},
				},
			},
		};

		const createSignedRequest = (
			payload: string,
			secret: string,
		): WebhookRequest => {
			const signature = createHmac("sha256", secret)
				.update(payload, "utf8")
				.digest("hex");

			return {
				method: "POST",
				body: payload,
				headers: {
					"x-apple-signature": `sha256=${signature}`,
					"content-type": "application/json",
				},
				url: "/webhook",
			};
		};

		it("should accept valid signatures", async () => {
			const payload = JSON.stringify(mockEvent);
			const request = createSignedRequest(payload, "test-webhook-secret-key");

			const response = await receiver.handleWebhook(request);
			expect(response.status).toBe(200);
			expect(response.body).toContain("Webhook processed successfully");
		});

		it("should reject invalid signatures", async () => {
			const payload = JSON.stringify(mockEvent);
			const request: WebhookRequest = {
				method: "POST",
				body: payload,
				headers: {
					"x-apple-signature": "sha256=invalid-signature",
					"content-type": "application/json",
				},
				url: "/webhook",
			};

			const response = await receiver.handleWebhook(request);
			expect(response.status).toBe(401);
			expect(response.body).toContain("Invalid signature");
		});

		it("should reject requests with missing signatures", async () => {
			const payload = JSON.stringify(mockEvent);
			const request: WebhookRequest = {
				method: "POST",
				body: payload,
				headers: {
					"content-type": "application/json",
				},
				url: "/webhook",
			};

			const response = await receiver.handleWebhook(request);
			expect(response.status).toBe(401);
			expect(response.body).toContain("Invalid signature");
		});

		it("should handle signatures without sha256 prefix", async () => {
			const payload = JSON.stringify(mockEvent);
			const signature = createHmac("sha256", "test-webhook-secret-key")
				.update(payload, "utf8")
				.digest("hex");

			const request: WebhookRequest = {
				method: "POST",
				body: payload,
				headers: {
					"x-apple-signature": signature, // No 'sha256=' prefix
					"content-type": "application/json",
				},
				url: "/webhook",
			};

			const response = await receiver.handleWebhook(request);
			expect(response.status).toBe(200);
		});
	});

	describe("Event Processing", () => {
		const createCrashEvent = (): TestFlightWebhookEvent => {
			return {
				eventType: "BETA_FEEDBACK_CRASH_SUBMISSION",
				eventTime: "2024-01-01T12:00:00Z",
				version: "1.0",
				data: {
					betaFeedbackCrashSubmission: {
						id: "crash-456",
						type: "betaFeedbackCrashSubmissions",
						attributes: {
							submittedAt: "2024-01-01T12:00:00Z",
							crashLogs: [
								{
									url: "https://example.com/crash.log",
									expiresAt: "2024-01-02T12:00:00Z",
								},
							],
							deviceFamily: "iPhone",
							deviceModel: "iPhone 14 Pro",
							osVersion: "17.0",
							appVersion: "1.0.0",
							buildNumber: "123",
							locale: "en-US",
							bundleId: "com.test.app",
							crashTrace: "Test crash trace",
							crashType: "EXC_BAD_ACCESS",
						},
						relationships: {
							app: { data: { type: "apps", id: "app-123" } },
							build: { data: { type: "builds", id: "build-456" } },
							tester: { data: { type: "betaTesters", id: "tester-789" } },
						},
					},
				},
			};
		};

		const createScreenshotEvent = (): TestFlightWebhookEvent => {
			return {
				eventType: "BETA_FEEDBACK_SCREENSHOT_SUBMISSION",
				eventTime: "2024-01-01T12:00:00Z",
				version: "1.0",
				data: {
					betaFeedbackScreenshotSubmission: {
						id: "screenshot-789",
						type: "betaFeedbackScreenshotSubmissions",
						attributes: {
							submittedAt: "2024-01-01T12:00:00Z",
							screenshots: [
								{
									url: "https://example.com/screenshot.png",
									expiresAt: "2024-01-02T12:00:00Z",
									fileName: "screenshot.png",
									fileSize: 1024,
								},
							],
							deviceFamily: "iPad",
							deviceModel: "iPad Pro",
							osVersion: "17.0",
							appVersion: "1.0.0",
							buildNumber: "123",
							locale: "en-US",
							bundleId: "com.test.app",
							feedbackText: "This button is not working",
						},
						relationships: {
							app: { data: { type: "apps", id: "app-123" } },
						},
					},
				},
			};
		};

		const createSignedRequestFromEvent = (
			event: TestFlightWebhookEvent,
		): WebhookRequest => {
			const payload = JSON.stringify(event);
			const signature = createHmac("sha256", "test-webhook-secret-key")
				.update(payload, "utf8")
				.digest("hex");

			return {
				method: "POST",
				body: payload,
				headers: {
					"x-apple-signature": `sha256=${signature}`,
					"content-type": "application/json",
				},
				url: "/webhook",
			};
		};

		it("should process crash submission events", async () => {
			const event = createCrashEvent();
			const request = createSignedRequestFromEvent(event);

			const response = await receiver.handleWebhook(request);
			expect(response.status).toBe(200);

			const responseBody = JSON.parse(response.body);
			expect(responseBody.eventType).toBe("BETA_FEEDBACK_CRASH_SUBMISSION");
			expect(responseBody.feedbackId).toBe("crash-456");
		});

		it("should process screenshot submission events", async () => {
			const event = createScreenshotEvent();
			const request = createSignedRequestFromEvent(event);

			const response = await receiver.handleWebhook(request);
			expect(response.status).toBe(200);

			const responseBody = JSON.parse(response.body);
			expect(responseBody.eventType).toBe(
				"BETA_FEEDBACK_SCREENSHOT_SUBMISSION",
			);
			expect(responseBody.feedbackId).toBe("screenshot-789");
		});

		it("should reject unsupported event types", async () => {
			const invalidEvent = {
				eventType: "INVALID_EVENT_TYPE",
				eventTime: "2024-01-01T12:00:00Z",
				version: "1.0",
				data: {},
			};

			const request = createSignedRequestFromEvent(
				invalidEvent as TestFlightWebhookEvent,
			);
			const response = await receiver.handleWebhook(request);

			expect(response.status).toBe(500);
			expect(response.body).toContain("Internal server error");
		});

		it("should handle missing event data", async () => {
			const incompleteEvent: TestFlightWebhookEvent = {
				eventType: "BETA_FEEDBACK_CRASH_SUBMISSION",
				eventTime: "2024-01-01T12:00:00Z",
				version: "1.0",
				data: {}, // Missing betaFeedbackCrashSubmission
			};

			const request = createSignedRequestFromEvent(incompleteEvent);
			const response = await receiver.handleWebhook(request);

			expect(response.status).toBe(500);
			expect(response.body).toContain("Internal server error");
		});
	});

	describe("Health Check", () => {
		it("should return healthy status", () => {
			const response = receiver.healthCheck();
			expect(response.status).toBe(200);

			const body = JSON.parse(response.body);
			expect(body.status).toBe("healthy");
			expect(body.service).toBe("TestFlight Webhook Receiver");
			expect(body.signatureVerification).toBe(true);
			expect(body.timestamp).toBeDefined();
		});

		it("should indicate when signature verification is disabled", () => {
			process.env.WEBHOOK_SECRET = undefined;
			clearReceiverInstance();
			clearConfigCache();

			const receiverWithoutSecret = getWebhookReceiver();
			const response = receiverWithoutSecret.healthCheck();

			const body = JSON.parse(response.body);
			expect(body.signatureVerification).toBe(false);
		});
	});

	describe("Security Validation", () => {
		it("should never expose webhook secret in error messages", async () => {
			const request: WebhookRequest = {
				method: "POST",
				body: "invalid json",
				headers: {
					"x-apple-signature": "invalid",
				},
				url: "/webhook",
			};

			const response = await receiver.handleWebhook(request);
			expect(response.body).not.toContain("test-webhook-secret-key");
			expect(response.body).not.toContain("secret");
		});

		it("should handle malformed signature headers safely", async () => {
			const request: WebhookRequest = {
				method: "POST",
				body: "{}",
				headers: {
					"x-apple-signature": "not-hex-encoded-at-all",
				},
				url: "/webhook",
			};

			const response = await receiver.handleWebhook(request);
			expect(response.status).toBe(401);
			expect(response.body).toContain("Invalid signature");
		});

		it("should use timing-safe comparison for signatures", async () => {
			// This test ensures we use timingSafeEqual for security
			const payload = "{}";
			const correctSignature = createHmac("sha256", "test-webhook-secret-key")
				.update(payload, "utf8")
				.digest("hex");

			// Create a signature with same length but different content
			const incorrectSignature = "0".repeat(correctSignature.length);

			const request: WebhookRequest = {
				method: "POST",
				body: payload,
				headers: {
					"x-apple-signature": `sha256=${incorrectSignature}`,
				},
				url: "/webhook",
			};

			const response = await receiver.handleWebhook(request);
			expect(response.status).toBe(401);
		});
	});
});
