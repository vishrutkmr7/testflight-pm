/**
 * Enhanced Codebase Analyzer Tests
 * Comprehensive test suite for TestFlight-specific feedback analysis and code correlation
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CodebaseAnalyzer,
	getCodebaseAnalyzer,
} from "../src/analysis/codebase-analyzer.js";
import type { ProcessedFeedbackData } from "../types/testflight.js";

// Test workspace setup
let testWorkspace: string;

// Mock test feedback data
const mockCrashFeedback: ProcessedFeedbackData = {
	id: "crash-test-001",
	type: "crash",
	timestamp: new Date(),
	userId: "test-user",
	appVersion: "2.1.0",
	buildVersion: "456",
	deviceInfo: {
		model: "iPhone 15 Pro",
		os: "iOS 17.2",
		locale: "en-US",
	},
	crashData: {
		trace: `Exception in thread "main" at LoginViewController.swift:42
		at UserAuthenticationManager.authenticateUser(UserAuthenticationManager.swift:156)
		at NetworkManager.makeRequest(NetworkManager.swift:89)
		at APIClient.login(APIClient.swift:34)`,
		type: "Fatal Exception",
		exceptionType: "NSInvalidArgumentException",
		exceptionMessage: "Invalid credentials provided for user authentication",
		logs: [],
	},
};

const mockUIFeedback: ProcessedFeedbackData = {
	id: "ui-test-001",
	type: "feedback",
	timestamp: new Date(),
	userId: "test-user",
	appVersion: "2.1.0",
	buildVersion: "456",
	deviceInfo: {
		model: "iPhone 15 Pro",
		os: "iOS 17.2",
		locale: "en-US",
	},
	screenshotData: {
		text: "The 'Sign In' button is not responding when tapped. Login screen freezes.",
		annotations: [
			{
				type: "arrow",
				coordinates: { x: 200, y: 400 },
				text: "Button not working",
			},
		],
	},
};

// Sample code files for testing
const sampleSwiftFiles = {
	"LoginViewController.swift": `
import UIKit

class LoginViewController: UIViewController {
    @IBOutlet weak var signInButton: UIButton!
    @IBOutlet weak var usernameField: UITextField!
    @IBOutlet weak var passwordField: UITextField!
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
    }
    
    @IBAction func signInButtonTapped(_ sender: UIButton) {
        guard let username = usernameField.text,
              let password = passwordField.text else {
            showAlert("Please enter credentials")
            return
        }
        
        UserAuthenticationManager.shared.authenticateUser(username: username, password: password) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let token):
                    self.navigateToHome(with: token)
                case .failure(let error):
                    self.handleAuthError(error)
                }
            }
        }
    }
    
    private func handleAuthError(_ error: AuthError) {
        // Handle authentication errors
        showAlert(error.localizedDescription)
    }
}
`,

	"UserAuthenticationManager.swift": `
import Foundation

class UserAuthenticationManager {
    static let shared = UserAuthenticationManager()
    
    private let networkManager = NetworkManager()
    
    func authenticateUser(username: String, password: String, completion: @escaping (Result<String, AuthError>) -> Void) {
        let credentials = LoginCredentials(username: username, password: password)
        
        networkManager.makeRequest(endpoint: .login, body: credentials) { result in
            switch result {
            case .success(let data):
                if let token = self.parseAuthToken(from: data) {
                    completion(.success(token))
                } else {
                    completion(.failure(.invalidResponse))
                }
            case .failure(let error):
                completion(.failure(.networkError(error)))
            }
        }
    }
    
    private func parseAuthToken(from data: Data) -> String? {
        // Parse authentication token
        // Line 156 - potential crash location
        return try? JSONDecoder().decode(AuthResponse.self, from: data).token
    }
}
`,

	"NetworkManager.swift": `
import Foundation

class NetworkManager {
    private let session = URLSession.shared
    
    func makeRequest<T: Codable>(endpoint: APIEndpoint, body: T?, completion: @escaping (Result<Data, NetworkError>) -> Void) {
        guard let url = endpoint.url else {
            completion(.failure(.invalidURL))
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        
        if let body = body {
            do {
                request.httpBody = try JSONEncoder().encode(body)
            } catch {
                completion(.failure(.encodingError))
                return
            }
        }
        
        // Line 89 - network request execution
        session.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(.networkError(error)))
                return
            }
            
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                completion(.failure(.serverError))
                return
            }
            
            completion(.success(data ?? Data()))
        }.resume()
    }
}
`,

	"APIClient.swift": `
import Foundation

class APIClient {
    private let networkManager = NetworkManager()
    
    func login(username: String, password: String, completion: @escaping (Result<AuthResponse, APIError>) -> Void) {
        // Line 34 - API login method
        let credentials = LoginCredentials(username: username, password: password)
        
        networkManager.makeRequest(endpoint: .login, body: credentials) { result in
            switch result {
            case .success(let data):
                do {
                    let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
                    completion(.success(authResponse))
                } catch {
                    completion(.failure(.decodingError))
                }
            case .failure(let networkError):
                completion(.failure(.networkError(networkError)))
            }
        }
    }
}
`,

	"ButtonStyles.swift": `
import UIKit

extension UIButton {
    func applySignInStyle() {
        backgroundColor = .systemBlue
        setTitleColor(.white, for: .normal)
        layer.cornerRadius = 8
        titleLabel?.font = UIFont.boldSystemFont(ofSize: 16)
    }
    
    func setLoadingState(_ isLoading: Bool) {
        isEnabled = !isLoading
        if isLoading {
            // Show loading indicator
            setTitle("Signing In...", for: .normal)
        } else {
            setTitle("Sign In", for: .normal)
        }
    }
}
`,
};

beforeEach(async () => {
	// Create temporary test workspace
	testWorkspace = await mkdtemp(join(tmpdir(), "codebase-analyzer-test-"));

	// Create directory structure
	await mkdir(join(testWorkspace, "src"), { recursive: true });
	await mkdir(join(testWorkspace, "src", "controllers"), { recursive: true });
	await mkdir(join(testWorkspace, "src", "managers"), { recursive: true });
	await mkdir(join(testWorkspace, "src", "network"), { recursive: true });
	await mkdir(join(testWorkspace, "src", "extensions"), { recursive: true });

	// Write test files
	await writeFile(
		join(testWorkspace, "src", "controllers", "LoginViewController.swift"),
		sampleSwiftFiles["LoginViewController.swift"],
	);
	await writeFile(
		join(testWorkspace, "src", "managers", "UserAuthenticationManager.swift"),
		sampleSwiftFiles["UserAuthenticationManager.swift"],
	);
	await writeFile(
		join(testWorkspace, "src", "network", "NetworkManager.swift"),
		sampleSwiftFiles["NetworkManager.swift"],
	);
	await writeFile(
		join(testWorkspace, "src", "network", "APIClient.swift"),
		sampleSwiftFiles["APIClient.swift"],
	);
	await writeFile(
		join(testWorkspace, "src", "extensions", "ButtonStyles.swift"),
		sampleSwiftFiles["ButtonStyles.swift"],
	);
});

afterEach(async () => {
	// Clean up test workspace
	await rm(testWorkspace, { recursive: true, force: true });
});

describe("CodebaseAnalyzer Initialization", () => {
	test("should initialize with custom workspace root", () => {
		const analyzer = new CodebaseAnalyzer(testWorkspace);
		expect(analyzer).toBeDefined();
		expect(analyzer.workspaceRoot).toBe(testWorkspace);
	});

	test("should use current directory as default workspace", () => {
		const analyzer = new CodebaseAnalyzer();
		expect(analyzer).toBeDefined();
		expect(analyzer.workspaceRoot).toBeDefined();
	});

	test("should return singleton instance with same workspace", () => {
		const analyzer1 = getCodebaseAnalyzer(testWorkspace);
		const analyzer2 = getCodebaseAnalyzer(testWorkspace);
		expect(analyzer1).toBe(analyzer2);
	});

	test("should create new instance for different workspace", () => {
		const analyzer1 = getCodebaseAnalyzer(testWorkspace);
		const analyzer2 = getCodebaseAnalyzer("/different/path");
		expect(analyzer1).not.toBe(analyzer2);
	});
});

describe("TestFlight Crash Analysis", () => {
	let analyzer: CodebaseAnalyzer;

	beforeEach(() => {
		analyzer = new CodebaseAnalyzer(testWorkspace);
	});

	test("should analyze crash feedback and identify relevant code areas", async () => {
		const result = await analyzer.analyzeTestFlightFeedback(mockCrashFeedback);

		expect(result).toBeDefined();
		expect(result.relevantAreas).toHaveLength(4); // Should find 4 relevant files

		// Should identify the main crash file
		const loginControllerArea = result.relevantAreas.find((area) =>
			area.file.includes("LoginViewController.swift"),
		);
		expect(loginControllerArea).toBeDefined();
		expect(loginControllerArea?.confidence).toBeGreaterThan(0.8);
		expect(loginControllerArea?.reason).toContain("Stack trace reference");

		// Should identify authentication manager
		const authManagerArea = result.relevantAreas.find((area) =>
			area.file.includes("UserAuthenticationManager.swift"),
		);
		expect(authManagerArea).toBeDefined();
		expect(authManagerArea?.lines).toContain("156");
	});

	test("should extract patterns from crash stack trace", async () => {
		const result = await analyzer.analyzeTestFlightFeedback(mockCrashFeedback);

		// Should identify key components from stack trace
		expect(result.suggestions.possibleComponents).toContain(
			"LoginViewController",
		);
		expect(result.suggestions.possibleComponents).toContain(
			"UserAuthenticationManager",
		);
		expect(result.suggestions.possibleComponents).toContain("NetworkManager");
	});

	test("should identify exception-related patterns", async () => {
		const crashWithSpecificException: ProcessedFeedbackData = {
			...mockCrashFeedback,
			crashData: {
				...mockCrashFeedback.crashData!,
				exceptionType: "NSInvalidArgumentException",
				exceptionMessage: "Invalid argument: nil user credentials",
			},
		};

		const result = await analyzer.analyzeTestFlightFeedback(
			crashWithSpecificException,
		);

		// Should find areas related to credential handling
		const credentialRelatedAreas = result.relevantAreas.filter(
			(area) =>
				area.context.toLowerCase().includes("credential") ||
				area.context.toLowerCase().includes("username") ||
				area.context.toLowerCase().includes("password"),
		);

		expect(credentialRelatedAreas.length).toBeGreaterThan(0);
	});

	test("should handle iOS-specific crash patterns", async () => {
		const iosCrash: ProcessedFeedbackData = {
			...mockCrashFeedback,
			crashData: {
				trace: `
				Thread 0 Crashed:
				0   MyApp                         0x0000000104abc123 -[LoginViewController signInButtonTapped:] + 45
				1   UIKitCore                     0x000000018d12e456 -[UIControl sendAction:to:forEvent:] + 67
				2   UIKitCore                     0x000000018d12e789 -[UIControl _sendActionsForEvents:withEvent:] + 89
				`,
				type: "SIGABRT",
				exceptionType: "NSInvalidArgumentException",
				exceptionMessage: "unrecognized selector sent to instance",
				logs: [],
			},
		};

		const result = await analyzer.analyzeTestFlightFeedback(iosCrash);

		// Should identify iOS-specific patterns
		expect(result.relevantAreas.length).toBeGreaterThan(0);

		const iosSpecificArea = result.relevantAreas.find(
			(area) =>
				area.reason.includes("iOS crash pattern") ||
				area.context.includes("signInButtonTapped"),
		);
		expect(iosSpecificArea).toBeDefined();
	});
});

describe("UI Feedback Analysis", () => {
	let analyzer: CodebaseAnalyzer;

	beforeEach(() => {
		analyzer = new CodebaseAnalyzer(testWorkspace);
	});

	test("should analyze UI feedback and identify relevant interface components", async () => {
		const result = await analyzer.analyzeTestFlightFeedback(mockUIFeedback);

		expect(result).toBeDefined();
		expect(result.relevantAreas.length).toBeGreaterThan(0);

		// Should find login-related components
		const loginRelatedAreas = result.relevantAreas.filter(
			(area) =>
				area.file.includes("Login") ||
				area.context.toLowerCase().includes("signin") ||
				area.context.toLowerCase().includes("button"),
		);

		expect(loginRelatedAreas.length).toBeGreaterThan(0);
	});

	test("should extract UI component patterns from feedback text", async () => {
		const uiFeedbackWithComponents: ProcessedFeedbackData = {
			...mockUIFeedback,
			screenshotData: {
				text: "The navigation bar is overlapping with the status bar. The search button in the toolbar is too small.",
				annotations: [],
			},
		};

		const result = await analyzer.analyzeTestFlightFeedback(
			uiFeedbackWithComponents,
		);

		// Should identify UI component keywords
		expect(result.suggestions.possibleComponents).toEqual(
			expect.arrayContaining(["navigation", "toolbar", "search", "button"]),
		);
	});

	test("should correlate feedback with button implementations", async () => {
		const buttonFeedback: ProcessedFeedbackData = {
			...mockUIFeedback,
			screenshotData: {
				text: "Sign In button styling looks inconsistent with the app theme",
				annotations: [],
			},
		};

		const result = await analyzer.analyzeTestFlightFeedback(buttonFeedback);

		// Should find button-related code
		const buttonStyleArea = result.relevantAreas.find((area) =>
			area.file.includes("ButtonStyles.swift"),
		);
		expect(buttonStyleArea).toBeDefined();
		expect(buttonStyleArea?.reason).toContain("UI component match");
	});

	test("should handle screenshot annotations", async () => {
		const annotatedFeedback: ProcessedFeedbackData = {
			...mockUIFeedback,
			screenshotData: {
				text: "Login screen has issues",
				annotations: [
					{
						type: "arrow",
						coordinates: { x: 200, y: 400 },
						text: "Button not clickable",
					},
					{
						type: "highlight",
						coordinates: { x: 150, y: 350 },
						text: "Wrong color",
					},
				],
			},
		};

		const result = await analyzer.analyzeTestFlightFeedback(annotatedFeedback);

		// Should incorporate annotation context
		expect(result.relevantAreas.length).toBeGreaterThan(0);

		// Should find areas related to button interaction or styling
		const interactionAreas = result.relevantAreas.filter(
			(area) =>
				area.context.toLowerCase().includes("button") ||
				area.context.toLowerCase().includes("signin"),
		);
		expect(interactionAreas.length).toBeGreaterThan(0);
	});
});

describe("Code Pattern Matching", () => {
	let analyzer: CodebaseAnalyzer;

	beforeEach(() => {
		analyzer = new CodebaseAnalyzer(testWorkspace);
	});

	test("should match Swift-specific patterns", async () => {
		const swiftCrash: ProcessedFeedbackData = {
			...mockCrashFeedback,
			crashData: {
				...mockCrashFeedback.crashData!,
				trace: `
				Thread 0:
				0   MyApp    0x104abc123 UserAuthenticationManager.authenticateUser(username:password:completion:) + 67
				1   MyApp    0x104def456 LoginViewController.signInButtonTapped(_:) + 123
				`,
				exceptionMessage:
					"Fatal error: Unexpectedly found nil while unwrapping an Optional value",
			},
		};

		const result = await analyzer.analyzeTestFlightFeedback(swiftCrash);

		// Should identify Swift method patterns
		const swiftPatternArea = result.relevantAreas.find(
			(area) =>
				area.context.includes("authenticateUser") ||
				area.context.includes("signInButtonTapped"),
		);
		expect(swiftPatternArea).toBeDefined();
		expect(swiftPatternArea?.matchType).toBe("exact");
	});

	test("should perform fuzzy matching for similar code patterns", async () => {
		const fuzzyFeedback: ProcessedFeedbackData = {
			...mockCrashFeedback,
			crashData: {
				...mockCrashFeedback.crashData!,
				exceptionMessage: "Authentication failed due to network connectivity",
			},
		};

		const result = await analyzer.analyzeTestFlightFeedback(fuzzyFeedback);

		// Should find authentication and network related code with fuzzy matching
		const fuzzyMatches = result.relevantAreas.filter(
			(area) => area.matchType === "fuzzy" || area.matchType === "semantic",
		);
		expect(fuzzyMatches.length).toBeGreaterThan(0);
	});

	test("should provide confidence scores for matches", async () => {
		const result = await analyzer.analyzeTestFlightFeedback(mockCrashFeedback);

		// All areas should have confidence scores
		for (const area of result.relevantAreas) {
			expect(area.confidence).toBeGreaterThanOrEqual(0);
			expect(area.confidence).toBeLessThanOrEqual(1);
		}

		// Exact matches should have higher confidence
		const exactMatches = result.relevantAreas.filter(
			(area) => area.matchType === "exact",
		);
		if (exactMatches.length > 0) {
			expect(
				Math.max(...exactMatches.map((area) => area.confidence)),
			).toBeGreaterThan(0.7);
		}
	});
});

describe("Performance and Caching", () => {
	let analyzer: CodebaseAnalyzer;

	beforeEach(() => {
		analyzer = new CodebaseAnalyzer(testWorkspace);
	});

	test("should cache file contents for repeated analysis", async () => {
		// First analysis
		const result1 = await analyzer.analyzeTestFlightFeedback(mockCrashFeedback);
		expect(result1).toBeDefined();

		// Second analysis should be faster due to caching
		const startTime = Date.now();
		const result2 = await analyzer.analyzeTestFlightFeedback(mockUIFeedback);
		const endTime = Date.now();

		expect(result2).toBeDefined();
		expect(endTime - startTime).toBeLessThan(1000); // Should be fast due to caching
	});

	test("should handle large codebases efficiently", async () => {
		// Create additional files to simulate larger codebase
		for (let i = 0; i < 10; i++) {
			await writeFile(
				join(testWorkspace, `src/TestFile${i}.swift`),
				`
				class TestClass${i} {
					func testMethod() {
						// Test method ${i}
					}
				}
				`,
			);
		}

		const startTime = Date.now();
		const result = await analyzer.analyzeTestFlightFeedback(mockCrashFeedback);
		const endTime = Date.now();

		expect(result).toBeDefined();
		expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
	});

	test("should respect file size limits", async () => {
		// Create a very large file
		const largeContent = "// Large file content\n".repeat(10000);
		await writeFile(join(testWorkspace, "src/LargeFile.swift"), largeContent);

		const result = await analyzer.analyzeTestFlightFeedback(mockCrashFeedback);

		// Should still complete successfully
		expect(result).toBeDefined();
		expect(result.relevantAreas.length).toBeGreaterThan(0);
	});
});

describe("Error Handling", () => {
	test("should handle non-existent workspace gracefully", async () => {
		const analyzer = new CodebaseAnalyzer("/non/existent/path");

		const result = await analyzer.analyzeTestFlightFeedback(mockCrashFeedback);

		// Should return empty result without throwing
		expect(result).toBeDefined();
		expect(result.relevantAreas).toHaveLength(0);
		expect(result.confidence).toBe(0);
	});

	test("should handle empty feedback data", async () => {
		const analyzer = new CodebaseAnalyzer(testWorkspace);

		const emptyFeedback: ProcessedFeedbackData = {
			id: "empty-test",
			type: "feedback",
			timestamp: new Date(),
			userId: "test-user",
			appVersion: "1.0.0",
			buildVersion: "123",
			deviceInfo: {
				model: "iPhone 14 Pro",
				os: "iOS 17.1",
				locale: "en-US",
			},
		};

		const result = await analyzer.analyzeTestFlightFeedback(emptyFeedback);

		expect(result).toBeDefined();
		expect(result.relevantAreas).toHaveLength(0);
		expect(result.suggestions.possibleComponents).toHaveLength(0);
	});

	test("should handle corrupted files gracefully", async () => {
		// Create a corrupted file
		await writeFile(
			join(testWorkspace, "src/CorruptedFile.swift"),
			"\x00\x01\x02\x03",
		);

		const analyzer = new CodebaseAnalyzer(testWorkspace);
		const result = await analyzer.analyzeTestFlightFeedback(mockCrashFeedback);

		// Should still analyze other files successfully
		expect(result).toBeDefined();
		expect(result.relevantAreas.length).toBeGreaterThan(0);
	});
});
