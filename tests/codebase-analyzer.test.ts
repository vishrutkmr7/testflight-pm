import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { AnalysisOptions } from "../src/analysis/codebase-analyzer";
import { CodebaseAnalyzer } from "../src/analysis/codebase-analyzer";
import type { ProcessedFeedbackData } from "../types/testflight";

// Mock file system
const mockFileSystem = {
	readFile: mock(async (path: string) => {
		const mockFiles: Record<string, string> = {
			"src/ListView.swift": `
        class ListView: UITableViewController {
          var items: [Item] = []
          
          func itemAt(index: Int) -> Item? {
            return items[index] // Potential crash here
          }
          
          override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
            return items.count
          }
        }
      `,
			"src/UserService.swift": `
        class UserService {
          func authenticateUser(credentials: LoginCredentials) async throws -> User {
            let response = try await APIClient.post("/auth/login", body: credentials)
            return User(from: response)
          }
        }
      `,
		};

		if (mockFiles[path]) {
			return mockFiles[path];
		}
		throw new Error(`File not found: ${path}`);
	}),

	glob: mock(async (pattern: string) => {
		if (pattern.includes("**/*.swift")) {
			return ["src/ListView.swift", "src/UserService.swift"];
		}
		return [];
	}),

	exists: mock(async (path: string) => {
		return ["src/ListView.swift", "src/UserService.swift"].includes(path);
	}),
};

import fs from "node:fs/promises";
// Mock fast-glob and fs
import glob from "fast-glob";

Object.assign(glob, mockFileSystem.glob);
Object.assign(fs, {
	readFile: mockFileSystem.readFile,
	stat: mockFileSystem.exists,
});

describe("CodebaseAnalyzer", () => {
	let analyzer: CodebaseAnalyzer;

	beforeEach(() => {
		// Reset mocks
		mockFileSystem.readFile.mockClear();
		mockFileSystem.glob.mockClear();
		mockFileSystem.exists.mockClear();

		analyzer = new CodebaseAnalyzer("/test/project/root");
	});

	describe("analyzeForFeedback", () => {
		it("should analyze crash feedback and find relevant files", async () => {
			const crashFeedback: ProcessedFeedbackData = {
				id: "test-crash",
				type: "crash",
				appVersion: "1.0.0",
				buildNumber: "123",
				deviceInfo: {
					model: "iPhone 15",
					osVersion: "17.0",
					family: "iPhone",
					locale: "en_US",
				},
				submittedAt: new Date("2024-01-01T00:00:00Z"),
				crashData: {
					type: "SIGABRT",
					exceptionType: "NSRangeException",
					exceptionMessage: "Array index beyond bounds",
					trace: "ListView itemAt tableView",
					logs: [],
				},
				bundleId: "com.test.app",
			};

			const result = await analyzer.analyzeForFeedback(crashFeedback);

			expect(result).toBeDefined();
			expect(result.totalFilesScanned).toBeGreaterThanOrEqual(0);
			expect(result.processingTime).toBeGreaterThan(0);
			expect(result.analysisDepth).toBeDefined();
			expect(result.suggestions).toBeDefined();
			expect(Array.isArray(result.relevantFiles)).toBe(true);
		});

		it("should analyze screenshot feedback", async () => {
			const screenshotFeedback: ProcessedFeedbackData = {
				id: "test-screenshot",
				type: "screenshot",
				appVersion: "1.0.0",
				buildNumber: "123",
				bundleId: "com.test.app",
				deviceInfo: {
					model: "iPhone 15",
					osVersion: "17.0",
					family: "iPhone",
					locale: "en_US",
				},
				submittedAt: new Date("2024-01-01T00:00:00Z"),
				screenshotData: {
					text: "Login button not responding when tapped",
					images: [
						{
							fileName: "login_screen.png",
							url: "https://example.com/login_screen.png",
							fileSize: 2048,
							expiresAt: new Date("2024-12-31T23:59:59Z"),
						},
					],
				},
			};

			const result = await analyzer.analyzeForFeedback(screenshotFeedback);

			expect(result).toBeDefined();
			expect(result.totalFilesScanned).toBeGreaterThanOrEqual(0);
			expect(result.processingTime).toBeGreaterThan(0);
			expect(result.suggestions).toBeDefined();
		});

		it("should handle analysis options", async () => {
			const feedback: ProcessedFeedbackData = {
				id: "test-options",
				type: "crash",
				appVersion: "1.0.0",
				buildNumber: "123",
				bundleId: "com.test.app",
				deviceInfo: {
					model: "iPhone 15",
					osVersion: "17.0",
					family: "iPhone",
					locale: "en_US",
				},
				submittedAt: new Date("2024-01-01T00:00:00Z"),
			};

			const options: Partial<AnalysisOptions> = {
				depth: "light",
				maxFilesToScan: 10,
				confidenceThreshold: 0.5,
			};

			const result = await analyzer.analyzeForFeedback(feedback, options);

			expect(result.analysisDepth).toBe("light");
			expect(result.totalFilesScanned).toBeLessThanOrEqual(10);
		});

		it("should handle errors gracefully", async () => {
			// Mock file system to throw errors
			mockFileSystem.glob.mockRejectedValueOnce(new Error("File system error"));

			const feedback: ProcessedFeedbackData = {
				id: "test-error",
				type: "crash",
				appVersion: "1.0.0",
				buildNumber: "123",
				bundleId: "com.test.app",
				deviceInfo: {
					model: "iPhone 15",
					osVersion: "17.0",
					family: "iPhone",
					locale: "en_US",
				},
				submittedAt: new Date("2024-01-01T00:00:00Z"),
			};

			const result = await analyzer.analyzeForFeedback(feedback);

			// Should return empty result instead of throwing
			expect(result.relevantFiles).toEqual([]);
			expect(result.totalFilesScanned).toBe(0);
			expect(result.processingTime).toBeGreaterThan(0);
		});

		it("should filter results by confidence threshold", async () => {
			const feedback: ProcessedFeedbackData = {
				id: "test-confidence",
				type: "crash",
				appVersion: "1.0.0",
				buildNumber: "123",
				bundleId: "com.test.app",
				deviceInfo: {
					model: "iPhone 15",
					osVersion: "17.0",
					family: "iPhone",
					locale: "en_US",
				},
				submittedAt: new Date("2024-01-01T00:00:00Z"),
				crashData: {
					type: "SIGABRT",
					trace: "very_specific_unique_function_name_12345",
					logs: [],
				},
			};

			const highThresholdOptions: Partial<AnalysisOptions> = {
				confidenceThreshold: 0.9,
			};

			const lowThresholdOptions: Partial<AnalysisOptions> = {
				confidenceThreshold: 0.1,
			};

			const highThresholdResult = await analyzer.analyzeForFeedback(
				feedback,
				highThresholdOptions,
			);
			const lowThresholdResult = await analyzer.analyzeForFeedback(
				feedback,
				lowThresholdOptions,
			);

			// Higher confidence threshold should return fewer or equal results
			expect(highThresholdResult.relevantFiles.length).toBeLessThanOrEqual(
				lowThresholdResult.relevantFiles.length,
			);
		});
	});

	describe("constructor", () => {
		it("should initialize with workspace root", () => {
			const customAnalyzer = new CodebaseAnalyzer("/custom/root");
			expect(customAnalyzer).toBeInstanceOf(CodebaseAnalyzer);
		});

		it("should use default workspace root", () => {
			const defaultAnalyzer = new CodebaseAnalyzer();
			expect(defaultAnalyzer).toBeInstanceOf(CodebaseAnalyzer);
		});
	});

	describe("integration", () => {
		it("should perform end-to-end analysis with real-like data", async () => {
			const realFeedback: ProcessedFeedbackData = {
				id: "prod-crash-001",
				type: "crash",
				appVersion: "2.1.4",
				buildNumber: "2024.01.15.1",
				bundleId: "com.test.app",
				deviceInfo: {
					model: "iPhone 15 Pro",
					osVersion: "17.2.1",
					family: "iPhone",
					locale: "en_US",
				},
				submittedAt: new Date("2024-01-15T14:30:22Z"),
				crashData: {
					type: "SIGABRT",
					exceptionType: "NSInvalidArgumentException",
					exceptionMessage:
						"Attempt to insert non-property list object for key",
					trace: `
            0  CoreFoundation  __exceptionPreprocess + 172
            1  libobjc.A.dylib  objc_exception_throw + 56
            2  CoreFoundation   _CFPropertyListValidateData + 128
            3  TestFlightPM     -[UserService saveUserData:] + 44
            4  TestFlightPM     -[ProfileViewController updateProfile] + 92
          `,
					logs: [],
				},
			};

			const result = await analyzer.analyzeForFeedback(realFeedback, {
				depth: "moderate",
				confidenceThreshold: 0.3,
				maxFilesToScan: 50,
			});

			expect(result.totalFilesScanned).toBeGreaterThanOrEqual(0);
			expect(result.processingTime).toBeGreaterThan(0);
			expect(result.analysisDepth).toBe("moderate");

			// Check that suggestions are properly structured
			expect(result.suggestions.possibleComponents).toBeDefined();
			expect(result.suggestions.suspectedModules).toBeDefined();
			expect(result.suggestions.relatedPatterns).toBeDefined();

			// All relevant files should meet confidence threshold
			result.relevantFiles.forEach((file) => {
				expect(file.confidence).toBeGreaterThanOrEqual(0.3);
				expect(file.file).toBeDefined();
				expect(file.reason).toBeDefined();
				expect(file.matchType).toBeDefined();
			});
		});
	});
});
