/**
 * TestFlight Webhook Receiver
 * Secure webhook endpoint for receiving real-time TestFlight feedback notifications
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { TestFlightWebhookEvent } from "../../types/testflight.js";
import { getConfig } from "../config/environment.js";

export interface WebhookRequest {
	body: string;
	headers: Record<string, string>;
	method: string;
	url: string;
}

export interface WebhookResponse {
	status: number;
	body: string;
	headers?: Record<string, string>;
}

export interface ProcessedWebhookEvent {
	eventType:
		| "BETA_FEEDBACK_CRASH_SUBMISSION"
		| "BETA_FEEDBACK_SCREENSHOT_SUBMISSION";
	eventTime: Date;
	feedbackId: string;
	feedbackType: "crash" | "screenshot";
	appId?: string;
	buildId?: string;
	testerId?: string;
	rawEvent: TestFlightWebhookEvent;
}

/**
 * TestFlight Webhook Receiver with HMAC verification and event processing
 */
export class TestFlightWebhookReceiver {
	private readonly webhookSecret: string;
	private readonly signatureHeader = "x-apple-signature";
	private readonly maxPayloadSize = 10 * 1024 * 1024; // 10MB max payload

	constructor() {
		const config = getConfig();
		this.webhookSecret = config.webhook?.secret || "";

		if (!this.webhookSecret) {
			console.warn(
				"Webhook secret not configured. Signature verification will be skipped.",
			);
		}
	}

	/**
	 * Main webhook handler - processes incoming webhook requests
	 */
	public async handleWebhook(
		request: WebhookRequest,
	): Promise<WebhookResponse> {
		try {
			// Validate request method
			if (request.method !== "POST") {
				return this.errorResponse(
					405,
					"Method not allowed. Only POST requests are accepted.",
				);
			}

			// Validate payload size
			if (request.body.length > this.maxPayloadSize) {
				return this.errorResponse(413, "Payload too large");
			}

			// Verify webhook signature
			if (this.webhookSecret) {
				const isValid = this.verifySignature(
					request.body,
					request.headers[this.signatureHeader],
				);
				if (!isValid) {
					console.warn("Webhook signature verification failed");
					return this.errorResponse(401, "Invalid signature");
				}
			}

			// Parse webhook payload
			let webhookEvent: TestFlightWebhookEvent;
			try {
				webhookEvent = JSON.parse(request.body);
			} catch (error) {
				console.error("Failed to parse webhook payload:", error);
				return this.errorResponse(400, "Invalid JSON payload");
			}

			// Process the webhook event
			const processedEvent = await this.processWebhookEvent(webhookEvent);

			// Log successful processing (without sensitive data)
			console.log(
				`Successfully processed ${processedEvent.eventType} event for feedback ID: ${processedEvent.feedbackId}`,
			);

			return {
				status: 200,
				body: JSON.stringify({
					message: "Webhook processed successfully",
					eventType: processedEvent.eventType,
					feedbackId: processedEvent.feedbackId,
				}),
				headers: { "Content-Type": "application/json" },
			};
		} catch (error) {
			console.error("Webhook processing error:", error);
			return this.errorResponse(500, "Internal server error");
		}
	}

	/**
	 * Verifies webhook signature using HMAC-SHA256
	 */
	private verifySignature(payload: string, signature?: string): boolean {
		if (!signature || !this.webhookSecret) {
			return false;
		}

		try {
			// Remove 'sha256=' prefix if present
			const cleanSignature = signature.replace(/^sha256=/, "");

			// Calculate expected signature
			const expectedSignature = createHmac("sha256", this.webhookSecret)
				.update(payload, "utf8")
				.digest("hex");

			// Use timing-safe comparison
			const expectedBuffer = Buffer.from(expectedSignature, "hex");
			const actualBuffer = Buffer.from(cleanSignature, "hex");

			if (expectedBuffer.length !== actualBuffer.length) {
				return false;
			}

			return timingSafeEqual(expectedBuffer, actualBuffer);
		} catch (error) {
			console.error("Signature verification error:", error);
			return false;
		}
	}

	/**
	 * Processes webhook event and extracts relevant information
	 */
	private async processWebhookEvent(
		event: TestFlightWebhookEvent,
	): Promise<ProcessedWebhookEvent> {
		const eventTime = new Date(event.eventTime);

		if (event.eventType === "BETA_FEEDBACK_CRASH_SUBMISSION") {
			const crashData = event.data.betaFeedbackCrashSubmission;
			if (!crashData) {
				throw new Error("Missing crash submission data in webhook event");
			}

			return {
				eventType: event.eventType,
				eventTime,
				feedbackId: crashData.id,
				feedbackType: "crash",
				appId: crashData.relationships?.app?.data?.id,
				buildId: crashData.relationships?.build?.data?.id,
				testerId: crashData.relationships?.tester?.data?.id,
				rawEvent: event,
			};
		}

		if (event.eventType === "BETA_FEEDBACK_SCREENSHOT_SUBMISSION") {
			const screenshotData = event.data.betaFeedbackScreenshotSubmission;
			if (!screenshotData) {
				throw new Error("Missing screenshot submission data in webhook event");
			}

			return {
				eventType: event.eventType,
				eventTime,
				feedbackId: screenshotData.id,
				feedbackType: "screenshot",
				appId: screenshotData.relationships?.app?.data?.id,
				buildId: screenshotData.relationships?.build?.data?.id,
				testerId: screenshotData.relationships?.tester?.data?.id,
				rawEvent: event,
			};
		}

		throw new Error(`Unsupported webhook event type: ${event.eventType}`);
	}

	/**
	 * Creates a standardized error response
	 */
	private errorResponse(status: number, message: string): WebhookResponse {
		return {
			status,
			body: JSON.stringify({ error: message }),
			headers: { "Content-Type": "application/json" },
		};
	}

	/**
	 * Health check endpoint for webhook receiver
	 */
	public healthCheck(): WebhookResponse {
		return {
			status: 200,
			body: JSON.stringify({
				status: "healthy",
				service: "TestFlight Webhook Receiver",
				timestamp: new Date().toISOString(),
				signatureVerification: !!this.webhookSecret,
			}),
			headers: { "Content-Type": "application/json" },
		};
	}
}

/**
 * Global webhook receiver instance
 */
let _receiverInstance: TestFlightWebhookReceiver | null = null;

export function getWebhookReceiver(): TestFlightWebhookReceiver {
	if (!_receiverInstance) {
		_receiverInstance = new TestFlightWebhookReceiver();
	}
	return _receiverInstance;
}

/**
 * Clears the global receiver instance (useful for testing)
 */
export function clearReceiverInstance(): void {
	_receiverInstance = null;
}

interface ExpressRequest {
	body?: string;
	headers?: Record<string, string>;
	method?: string;
	url?: string;
}

interface ExpressResponse {
	status: (code: number) => ExpressResponse;
	setHeader: (key: string, value: string) => void;
	send: (data: string) => void;
}

type ExpressNext = () => void;

/**
 * Express-like middleware wrapper for easy integration
 */
export function createWebhookMiddleware() {
	const receiver = getWebhookReceiver();

	return async (
		req: ExpressRequest,
		res: ExpressResponse,
		_next?: ExpressNext,
	) => {
		try {
			const request: WebhookRequest = {
				body: req.body || "",
				headers: req.headers || {},
				method: req.method || "GET",
				url: req.url || "",
			};

			const response = await receiver.handleWebhook(request);

			res.status(response.status);
			if (response.headers) {
				for (const [key, value] of Object.entries(response.headers)) {
					res.setHeader(key, value);
				}
			}
			res.send(response.body);
		} catch (error) {
			console.error("Webhook middleware error:", error);
			res.status(500).send(JSON.stringify({ error: "Internal server error" }));
		}
	};
}

/**
 * Bun HTTP server handler
 */
export function createBunWebhookHandler() {
	const receiver = getWebhookReceiver();

	return async (request: Request): Promise<Response> => {
		try {
			const webhookRequest: WebhookRequest = {
				body: await request.text(),
				headers: Object.fromEntries(request.headers.entries()),
				method: request.method,
				url: request.url,
			};

			const response = await receiver.handleWebhook(webhookRequest);

			return new Response(response.body, {
				status: response.status,
				headers: response.headers,
			});
		} catch (error) {
			console.error("Bun webhook handler error:", error);
			return new Response(JSON.stringify({ error: "Internal server error" }), {
				status: 500,
				headers: { "Content-Type": "application/json" },
			});
		}
	};
}
