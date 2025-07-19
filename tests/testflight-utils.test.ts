/**
 * TestFlight Utilities Test Suite
 * Comprehensive tests for secure TestFlight data fetching
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	clearAuthInstance,
	getAuthInstance,
} from "../src/api/app-store-connect-auth.js";
import {
	clearClientInstance,
	getTestFlightClient,
} from "../src/api/testflight-client.js";
import { clearConfigCache, getConfig } from "../src/config/environment.js";

describe("Environment Configuration", () => {
	beforeEach(() => {
		clearConfigCache();
	});

	afterEach(() => {
		clearConfigCache();
	});

	it("should load configuration from environment variables", () => {
		// Set test environment variables
		process.env.APP_STORE_CONNECT_ISSUER_ID = "test-issuer-id";
		process.env.APP_STORE_CONNECT_KEY_ID = "test-key-id";
		process.env.APP_STORE_CONNECT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg
-----END PRIVATE KEY-----`;

		const config = getConfig();

		expect(config.appStoreConnect.issuerId).toBe("test-issuer-id");
		expect(config.appStoreConnect.keyId).toBe("test-key-id");
		expect(config.appStoreConnect.privateKey).toContain("BEGIN PRIVATE KEY");
	});

	it("should throw error for missing required environment variables", () => {
		// Clear environment variables
		delete process.env.APP_STORE_CONNECT_ISSUER_ID;
		delete process.env.APP_STORE_CONNECT_KEY_ID;
		delete process.env.APP_STORE_CONNECT_PRIVATE_KEY;

		expect(() => getConfig()).toThrow("Required environment variable");
	});

	it("should validate private key format", () => {
		process.env.APP_STORE_CONNECT_ISSUER_ID = "test-issuer-id";
		process.env.APP_STORE_CONNECT_KEY_ID = "test-key-id";
		process.env.APP_STORE_CONNECT_PRIVATE_KEY = "invalid-key-format";

		expect(() => getConfig()).toThrow("Invalid private key format");
	});

	it("should never log or expose secret values", () => {
		const originalLog = console.log;
		const originalError = console.error;
		const logs: string[] = [];

		console.log = (...args) => logs.push(args.join(" "));
		console.error = (...args) => logs.push(args.join(" "));

		try {
			process.env.APP_STORE_CONNECT_ISSUER_ID = "test-issuer-id";
			process.env.APP_STORE_CONNECT_KEY_ID = "test-key-id";
			process.env.APP_STORE_CONNECT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
secret-key-content-here
-----END PRIVATE KEY-----`;

			const _config = getConfig();

			// Verify secret values are not in logs
			const allLogs = logs.join(" ");
			expect(allLogs).not.toContain("secret-key-content-here");
			expect(allLogs).not.toContain("test-issuer-id");
			expect(allLogs).not.toContain("test-key-id");
		} finally {
			console.log = originalLog;
			console.error = originalError;
		}
	});
});

describe("App Store Connect Authentication", () => {
	beforeEach(() => {
		clearAuthInstance();
		clearConfigCache();

		// Set up test environment
		process.env.APP_STORE_CONNECT_ISSUER_ID = "test-issuer-id";
		process.env.APP_STORE_CONNECT_KEY_ID = "test-key-id";
		process.env.APP_STORE_CONNECT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgTestKeyContentHere
-----END PRIVATE KEY-----`;
	});

	afterEach(() => {
		clearAuthInstance();
		clearConfigCache();
	});

	it("should create auth instance without exposing secrets", () => {
		const auth = getAuthInstance();
		expect(auth).toBeDefined();

		const tokenInfo = auth.getTokenInfo();
		expect(tokenInfo.isValid).toBe(false); // No token generated yet
	});

	it("should handle token generation errors securely", async () => {
		const auth = getAuthInstance();

		try {
			// This will fail due to invalid test key, but should not expose secrets
			await auth.getValidToken();
		} catch (error) {
			const errorMessage = (error as Error).message;
			expect(errorMessage).not.toContain("test-issuer-id");
			expect(errorMessage).not.toContain("test-key-id");
			expect(errorMessage).not.toContain("TestKeyContentHere");
		}
	});

	it("should manage token lifecycle correctly", () => {
		const auth = getAuthInstance();

		// Initially no token
		expect(auth.getTokenInfo().isValid).toBe(false);

		// Clear token should work without errors
		auth.clearToken();
		expect(auth.getTokenInfo().isValid).toBe(false);
	});
});

describe("TestFlight Client", () => {
	beforeEach(() => {
		clearClientInstance();
		clearAuthInstance();
		clearConfigCache();

		// Set up test environment
		process.env.APP_STORE_CONNECT_ISSUER_ID = "test-issuer-id";
		process.env.APP_STORE_CONNECT_KEY_ID = "test-key-id";
		process.env.APP_STORE_CONNECT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgTestKeyContentHere
-----END PRIVATE KEY-----`;
	});

	afterEach(() => {
		clearClientInstance();
		clearAuthInstance();
		clearConfigCache();
	});

	it("should create client instance successfully", () => {
		const client = getTestFlightClient();
		expect(client).toBeDefined();
		expect(client.getRateLimitInfo()).toBeNull(); // No requests made yet
	});

	it("should handle API errors without exposing authentication details", async () => {
		const client = getTestFlightClient();

		try {
			// This will fail due to invalid credentials, but should handle errors securely
			await client.getCrashReports();
		} catch (error) {
			const errorMessage = (error as Error).message;
			// Error message should not contain sensitive information
			expect(errorMessage).not.toContain("test-issuer-id");
			expect(errorMessage).not.toContain("TestKeyContentHere");
		}
	});

	it("should build URLs correctly without exposing secrets", async () => {
		const client = getTestFlightClient();

		// Access private method for testing (TypeScript will complain but it works at runtime)
		const buildUrl = (client as any).buildUrl.bind(client);

		const url = buildUrl("/betaFeedbackCrashSubmissions", {
			limit: 10,
			sort: "-submittedAt",
			filter: { submittedAt: ">2023-01-01" },
		});

		expect(url).toContain("api.appstoreconnect.apple.com");
		expect(url).toContain("limit=10");
		expect(url).toContain("sort=-submittedAt");
		expect(url).toContain("filter%5BsubmittedAt%5D=%3E2023-01-01");

		// Should not contain any secrets
		expect(url).not.toContain("test-issuer-id");
		expect(url).not.toContain("test-key-id");
	});

	it("should process crash reports correctly", () => {
		const client = getTestFlightClient();

		const mockCrashReport = {
			id: "crash-123",
			type: "betaFeedbackCrashSubmissions" as const,
			attributes: {
				submittedAt: "2023-01-01T12:00:00Z",
				crashLogs: [
					{ url: "https://example.com/log", expiresAt: "2023-01-02T12:00:00Z" },
				],
				deviceFamily: "iPhone",
				deviceModel: "iPhone 14",
				osVersion: "16.0",
				appVersion: "1.0.0",
				buildNumber: "100",
				locale: "en-US",
				bundleId: "com.test.app",
				crashTrace: "Stack trace here",
				crashType: "EXC_BAD_ACCESS",
			},
			relationships: {},
		};

		// Access private method for testing
		const {processCrashReport} = client as any;
		const processed = processCrashReport(mockCrashReport);

		expect(processed.id).toBe("crash-123");
		expect(processed.type).toBe("crash");
		expect(processed.appVersion).toBe("1.0.0");
		expect(processed.deviceInfo.model).toBe("iPhone 14");
		expect(processed.crashData?.trace).toBe("Stack trace here");
	});
});

describe("Security Validation", () => {
	it("should never expose secrets in error messages", () => {
		const originalError = console.error;
		const errors: string[] = [];

		console.error = (...args) => errors.push(args.join(" "));

		try {
			// Set up environment with secrets
			process.env.APP_STORE_CONNECT_ISSUER_ID = "secret-issuer-123";
			process.env.APP_STORE_CONNECT_KEY_ID = "secret-key-456";
			process.env.APP_STORE_CONNECT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
SuperSecretKeyContentThatShouldNeverBeLogged
-----END PRIVATE KEY-----`;

			// Force an error by providing invalid configuration
			process.env.APP_STORE_CONNECT_PRIVATE_KEY = "invalid-format";

			try {
				getConfig();
			} catch (error) {
				// Error should not contain secrets
				const errorMessage = (error as Error).message;
				expect(errorMessage).not.toContain("secret-issuer-123");
				expect(errorMessage).not.toContain("secret-key-456");
				expect(errorMessage).not.toContain(
					"SuperSecretKeyContentThatShouldNeverBeLogged",
				);
			}

			// Console errors should not contain secrets either
			const allErrors = errors.join(" ");
			expect(allErrors).not.toContain("secret-issuer-123");
			expect(allErrors).not.toContain("secret-key-456");
			expect(allErrors).not.toContain(
				"SuperSecretKeyContentThatShouldNeverBeLogged",
			);
		} finally {
			console.error = originalError;
		}
	});

	it("should validate environment variable presence", () => {
		// Clear all environment variables
		delete process.env.APP_STORE_CONNECT_ISSUER_ID;
		delete process.env.APP_STORE_CONNECT_KEY_ID;
		delete process.env.APP_STORE_CONNECT_PRIVATE_KEY;
		delete process.env.APP_STORE_CONNECT_PRIVATE_KEY_PATH;

		clearConfigCache();

		expect(() => getConfig()).toThrow(
			"Required environment variable APP_STORE_CONNECT_ISSUER_ID is not set or is empty",
		);
	});

	it("should validate private key format strictly", () => {
		// Test various invalid formats
		const invalidFormatTests = [
			{
				key: "just-a-string",
				expectedError:
					"Invalid private key format. Must be a PEM formatted private key.",
			},
			{
				key: "BEGIN PRIVATE KEY\ncontent\nEND PRIVATE KEY",
				expectedError:
					"Invalid private key format. Must be a PEM formatted private key.",
			},
			{
				key: "-----BEGIN CERTIFICATE-----\ncontent\n-----END CERTIFICATE-----",
				expectedError:
					"Invalid private key format. Must be a PEM formatted private key.",
			},
			{
				key: "-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----",
				expectedError:
					"Invalid private key format. Private key appears to be empty.",
			},
		];

		for (const test of invalidFormatTests) {
			// Set up environment for each test
			process.env.APP_STORE_CONNECT_ISSUER_ID = "test-issuer";
			process.env.APP_STORE_CONNECT_KEY_ID = "test-key";
			process.env.APP_STORE_CONNECT_PRIVATE_KEY = test.key;
			clearConfigCache();

			expect(() => getConfig()).toThrow(test.expectedError);
		}

		// Test empty string separately (it should trigger the "must be set" error)
		process.env.APP_STORE_CONNECT_ISSUER_ID = "test-issuer";
		process.env.APP_STORE_CONNECT_KEY_ID = "test-key";
		process.env.APP_STORE_CONNECT_PRIVATE_KEY = "";
		clearConfigCache();

		expect(() => getConfig()).toThrow(
			"Either APP_STORE_CONNECT_PRIVATE_KEY or APP_STORE_CONNECT_PRIVATE_KEY_PATH must be set",
		);
	});
});

describe("Integration Tests", () => {
	it("should handle complete workflow without exposing secrets", async () => {
		// Set up proper test environment
		process.env.APP_STORE_CONNECT_ISSUER_ID = "test-issuer-id";
		process.env.APP_STORE_CONNECT_KEY_ID = "test-key-id";
		process.env.APP_STORE_CONNECT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgTestKeyContentHere
-----END PRIVATE KEY-----`;

		try {
			// Load configuration
			const config = getConfig();
			expect(config).toBeDefined();

			// Create auth instance
			const auth = getAuthInstance();
			expect(auth).toBeDefined();

			// Create client instance
			const client = getTestFlightClient();
			expect(client).toBeDefined();

			// All instances should be created without exposing secrets
			// The actual API calls will fail due to test credentials, but that's expected
		} catch (error) {
			// Even in error cases, secrets should not be exposed
			const errorMessage = (error as Error).message;
			expect(errorMessage).not.toContain("TestKeyContentHere");
			expect(errorMessage).not.toContain("test-issuer-id");
		}
	});
});
