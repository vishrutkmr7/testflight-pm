/**
 * Codebase Analysis Engine
 * Scans and analyzes codebase to identify relevant areas for TestFlight feedback
 */

import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { glob } from "fast-glob";
import type { ProcessedFeedbackData } from "../../types/testflight.js";

export interface CodebaseFile {
	path: string;
	content: string;
	size: number;
	language: string;
	lastModified: Date;
	lines: number;
}

export interface RelevantCodeArea {
	file: string;
	lines: string;
	content: string;
	confidence: number;
	reason: string;
	matchType: "exact" | "fuzzy" | "semantic" | "structural";
	metadata?: {
		functionName?: string;
		className?: string;
		componentName?: string;
		imports?: string[];
		exports?: string[];
	};
}

export interface CodebaseAnalysisResult {
	relevantFiles: RelevantCodeArea[];
	totalFilesScanned: number;
	processingTime: number;
	analysisDepth: "light" | "moderate" | "deep";
	suggestions: {
		possibleComponents: string[];
		suspectedModules: string[];
		relatedPatterns: string[];
	};
}

export interface AnalysisOptions {
	depth: "light" | "moderate" | "deep";
	includeTests: boolean;
	includeNodeModules: boolean;
	maxFileSize: number; // in bytes
	maxFilesToScan: number;
	confidenceThreshold: number;
	workspaceRoot?: string;
}

export interface PatternMatch {
	pattern: string;
	file: string;
	line: number;
	column?: number;
	context: string;
	confidence: number;
	matchType: "exact" | "fuzzy" | "semantic" | "structural";
}

/**
 * Main codebase analysis engine
 */
export class CodebaseAnalyzer {
	private fileCache: Map<string, CodebaseFile> = new Map();
	public readonly workspaceRoot: string; // Make public for factory access

	private defaultOptions: AnalysisOptions = {
		depth: "moderate",
		includeTests: false,
		includeNodeModules: false,
		maxFileSize: 500000, // 500KB
		maxFilesToScan: 1000,
		confidenceThreshold: 0.3,
	};

	constructor(workspaceRoot?: string) {
		this.workspaceRoot = workspaceRoot || process.cwd();
	}

	/**
	 * Analyzes codebase for TestFlight feedback relevance
	 */
	public async analyzeForFeedback(
		feedback: ProcessedFeedbackData,
		options: Partial<AnalysisOptions> = {},
	): Promise<CodebaseAnalysisResult> {
		const startTime = Date.now();
		const analysisOptions = { ...this.defaultOptions, ...options };

		try {
			// Scan codebase files
			const files = await this.scanCodebase(analysisOptions);
			console.log(`Scanned ${files.length} files for analysis`);

			// Extract patterns from feedback
			const patterns = this.extractFeedbackPatterns(feedback);

			// Find relevant code areas
			const relevantAreas = await this.findRelevantCodeAreas(
				files,
				patterns,
				feedback,
				analysisOptions,
			);

			// Generate suggestions
			const suggestions = this.generateSuggestions(relevantAreas, feedback);

			return {
				relevantFiles: relevantAreas.filter(
					(area) => area.confidence >= analysisOptions.confidenceThreshold,
				),
				totalFilesScanned: files.length,
				processingTime: Date.now() - startTime,
				analysisDepth: analysisOptions.depth,
				suggestions,
			};
		} catch (error) {
			console.error(`Codebase analysis failed: ${error}`);
			return {
				relevantFiles: [],
				totalFilesScanned: 0,
				processingTime: Date.now() - startTime,
				analysisDepth: analysisOptions.depth,
				suggestions: {
					possibleComponents: [],
					suspectedModules: [],
					relatedPatterns: [],
				},
			};
		}
	}

	/**
	 * Scans codebase for relevant files
	 */
	private async scanCodebase(
		options: AnalysisOptions,
	): Promise<CodebaseFile[]> {
		const patterns = [
			"**/*.{ts,tsx,js,jsx,swift,m,h,mm}",
			"**/*.{kt,java,py,rb,php,go,rs}",
			"**/*.{vue,svelte,json}",
		];

		if (options.includeTests) {
			patterns.push("**/*.{test,spec}.{ts,tsx,js,jsx}");
		}

		const globOptions = {
			cwd: this.workspaceRoot,
			absolute: false,
			ignore: this.buildIgnorePatterns(options),
		};

		const filePaths = await glob(patterns, globOptions);
		const limitedPaths = filePaths.slice(0, options.maxFilesToScan);

		const files: CodebaseFile[] = [];

		for (const filePath of limitedPaths) {
			try {
				const file = await this.loadFile(filePath, options);
				if (file) {
					files.push(file);
				}
			} catch (error) {
				console.warn(`Failed to load file ${filePath}: ${error}`);
			}
		}

		return files;
	}

	/**
	 * Loads and parses a single file
	 */
	private async loadFile(
		filePath: string,
		options: AnalysisOptions,
	): Promise<CodebaseFile | null> {
		const fullPath = resolve(this.workspaceRoot, filePath);

		try {
			// Check cache first
			if (this.fileCache.has(filePath)) {
				const cached = this.fileCache.get(filePath);
				if (cached) {
					const stats = await stat(fullPath);
					if (stats.mtime <= cached.lastModified) {
						return cached;
					}
				}
			}

			const stats = await stat(fullPath);

			// Skip large files
			if (stats.size > options.maxFileSize) {
				return null;
			}

			const content = await readFile(fullPath, "utf-8");
			const language = this.detectLanguage(filePath);
			const lines = content.split("\n").length;

			const file: CodebaseFile = {
				path: filePath,
				content,
				size: stats.size,
				language,
				lastModified: stats.mtime,
				lines,
			};

			// Cache the file
			this.fileCache.set(filePath, file);

			return file;
		} catch (_error) {
			return null;
		}
	}

	/**
	 * Extracts search patterns from TestFlight feedback
	 */
	private extractFeedbackPatterns(feedback: ProcessedFeedbackData): string[] {
		const patterns: string[] = [];

		if (feedback.type === "crash" && feedback.crashData) {
			// Extract patterns from crash data
			if (feedback.crashData.exceptionType) {
				patterns.push(feedback.crashData.exceptionType);
			}

			if (feedback.crashData?.trace) {
				// Extract patterns from stack trace
				const stackPatterns = this.extractStackTracePatterns(
					feedback.crashData.trace,
				);
				patterns.push(...stackPatterns);
			}

			if (feedback.crashData?.exceptionMessage) {
				// Extract meaningful words from exception message
				const messagePatterns = this.extractCrashPatterns(
					feedback.crashData.exceptionMessage,
				);
				patterns.push(...messagePatterns);
			}
		}

		// Extract patterns from feedback content
		if (feedback.screenshotData?.text) {
			const uiPatterns = this.extractUIPatterns(feedback.screenshotData.text);
			patterns.push(...uiPatterns);
		}

		// Add device-specific patterns
		patterns.push(feedback.deviceInfo.model);
		patterns.push(feedback.deviceInfo.osVersion);

		// Add app version patterns
		patterns.push(feedback.appVersion);
		patterns.push(feedback.buildNumber);

		return patterns.filter((p) => p && p.length > 2); // Filter out short patterns
	}

	/**
	 * Extracts patterns from stack trace with enhanced TestFlight crash analysis
	 */
	private extractStackTracePatterns(trace: string): string[] {
		const patterns: string[] = [];

		// Enhanced TestFlight/iOS specific patterns
		const stackRegexes = [
			// iOS/Swift patterns (enhanced for TestFlight)
			/(\w+\.\w+):(\d+)/g, // File:line
			/(\w+)\.(\w+)\(/g, // Class.method(
			/-\[(\w+) (\w+)\]/g, // Objective-C method calls
			/\+\[(\w+) (\w+)\]/g, // Objective-C class method calls

			// TestFlight specific crash patterns
			/(\w+ViewController)\.(\w+)/g, // View controller methods
			/(\w+View)\.(\w+)/g, // View-related crashes
			/(\w+Manager)\.(\w+)/g, // Manager classes
			/(\w+Service)\.(\w+)/g, // Service classes
			/(\w+Delegate)\.(\w+)/g, // Delegate patterns

			// SwiftUI specific patterns
			/(\w+)\.body\.getter/g, // SwiftUI view body
			/closure.*in (\w+)/g, // Swift closures
			/(\w+)\$(\w+)/g, // Swift internal names

			// Core frameworks (common in TestFlight crashes)
			/UIKit\.(\w+)/g, // UIKit crashes
			/Foundation\.(\w+)/g, // Foundation crashes
			/CoreData\.(\w+)/g, // Core Data issues
			/Network\.(\w+)/g, // Network-related crashes
			/AVFoundation\.(\w+)/g, // Media-related crashes

			// Memory/performance patterns
			/EXC_BAD_ACCESS/g, // Memory access violations
			/SIGABRT/g, // Abort signals
			/SIGSEGV/g, // Segmentation violations
			/OutOfMemoryError/g, // Memory issues

			// Android patterns (for cross-platform apps)
			/at ([\w.]+)\.([\w$]+)\(/g, // at package.Class.method(
			/(\w+Exception)/g, // Exception types
			/(\w+Activity)\.(\w+)/g, // Android activities
			/(\w+Fragment)\.(\w+)/g, // Android fragments

			// React Native patterns (if applicable)
			/RCT(\w+)/g, // React Native components
			/Bridge\.(\w+)/g, // RN Bridge calls

			// JavaScript patterns (for hybrid apps)
			/at (\w+) \(/g, // at function (
			/(\w+Error)/g, // Error types
			/(\w+\.js):(\d+):(\d+)/g, // JS file:line:column
		];

		for (const regex of stackRegexes) {
			const matches = trace.matchAll(regex);
			for (const match of matches) {
				if (match[1]) patterns.push(match[1]);
				if (match[2]) patterns.push(match[2]);
				if (match[3]) patterns.push(match[3]);
			}
		}

		// Extract framework-specific patterns for better correlation
		this.extractFrameworkPatterns(trace, patterns);

		return patterns;
	}

	/**
	 * Extracts framework-specific patterns for TestFlight crashes
	 */
	private extractFrameworkPatterns(trace: string, patterns: string[]): void {
		// iOS Framework patterns
		const iosFrameworks = [
			"UIKit",
			"Foundation",
			"CoreData",
			"CoreGraphics",
			"QuartzCore",
			"AVFoundation",
			"CoreLocation",
			"MapKit",
			"StoreKit",
			"GameKit",
			"CloudKit",
			"HealthKit",
			"HomeKit",
			"WatchKit",
			"CoreML",
			"ARKit",
			"RealityKit",
			"Vision",
			"Speech",
			"CoreBluetooth",
		];

		for (const framework of iosFrameworks) {
			if (trace.includes(framework)) {
				patterns.push(framework);
			}
		}

		// Third-party SDK patterns (common in TestFlight apps)
		const thirdPartySDKs = [
			"Firebase",
			"Crashlytics",
			"Analytics",
			"Alamofire",
			"Realm",
			"SDWebImage",
			"Lottie",
			"SnapKit",
			"RxSwift",
			"Charts",
		];

		for (const sdk of thirdPartySDKs) {
			if (trace.toLowerCase().includes(sdk.toLowerCase())) {
				patterns.push(sdk);
			}
		}
	}

	/**
	 * Extract patterns from crash messages with enhanced TestFlight analysis
	 */
	private extractCrashPatterns(message: string): string[] {
		const patterns: string[] = [];

		// Extract quoted strings
		const quotedRegex = /"([^"]+)"/g;
		for (const match of message.matchAll(quotedRegex)) {
			if (match[1]) patterns.push(match[1]);
		}

		// Extract camelCase identifiers
		const camelCaseRegex = /\b[a-z]+(?:[A-Z][a-z]*)+\b/g;
		for (const match of message.matchAll(camelCaseRegex)) {
			patterns.push(match[0]);
		}

		return patterns;
	}

	/**
	 * Extract patterns from UI feedback text
	 */
	private extractUIPatterns(text: string): string[] {
		const patterns: string[] = [];

		// Extract quoted UI text
		const quotedRegex = /"([^"]+)"|'([^']+)'/g;
		for (const match of text.matchAll(quotedRegex)) {
			const quoted = match[1] || match[2];
			if (quoted && quoted.length > 2) {
				patterns.push(quoted);
			}
		}

		return patterns;
	}

	/**
	 * Finds relevant code areas based on patterns
	 */
	private async findRelevantCodeAreas(
		files: CodebaseFile[],
		patterns: string[],
		feedback: ProcessedFeedbackData,
		options: AnalysisOptions,
	): Promise<RelevantCodeArea[]> {
		const relevantAreas: RelevantCodeArea[] = [];

		for (const file of files) {
			const areas = await this.analyzeFileForPatterns(
				file,
				patterns,
				feedback,
				options,
			);
			relevantAreas.push(...areas);
		}

		// Sort by confidence and limit results
		relevantAreas.sort((a, b) => b.confidence - a.confidence);

		const maxResults =
			options.depth === "light" ? 5 : options.depth === "moderate" ? 10 : 15;
		return relevantAreas.slice(0, maxResults);
	}

	/**
	 * Analyzes a single file for pattern matches
	 */
	private async analyzeFileForPatterns(
		file: CodebaseFile,
		patterns: string[],
		feedback: ProcessedFeedbackData,
		options: AnalysisOptions,
	): Promise<RelevantCodeArea[]> {
		const areas: RelevantCodeArea[] = [];
		const lines = file.content.split("\n");

		for (const pattern of patterns) {
			const matches = this.findPatternInFile(file, pattern);

			for (const match of matches) {
				const confidence = this.calculateConfidence(match, file, feedback);

				if (confidence >= options.confidenceThreshold) {
					// Extract context around the match
					const startLine = Math.max(0, match.line - 3);
					const endLine = Math.min(lines.length - 1, match.line + 3);
					const contextLines = lines.slice(startLine, endLine + 1);

					areas.push({
						file: file.path,
						lines: `${startLine + 1}-${endLine + 1}`,
						content: contextLines.join("\n"),
						confidence,
						reason: `Pattern "${pattern}" found (${match.matchType} match)`,
						matchType: match.matchType,
						metadata: this.extractMetadata(file, match.line),
					});
				}
			}
		}

		// Look for structural patterns based on feedback type
		if (feedback.type === "crash") {
			const crashAreas = this.findCrashRelatedAreas(file, feedback);
			areas.push(...crashAreas);
		} else {
			const uiAreas = this.findUIRelatedAreas(file, feedback);
			areas.push(...uiAreas);
		}

		return areas;
	}

	/**
	 * Finds pattern matches in a file
	 */
	private findPatternInFile(
		file: CodebaseFile,
		pattern: string,
	): PatternMatch[] {
		const matches: PatternMatch[] = [];
		const lines = file.content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;

			// Exact match
			const exactIndex = line.toLowerCase().indexOf(pattern.toLowerCase());
			if (exactIndex !== -1) {
				matches.push({
					pattern,
					file: file.path,
					line: i,
					column: exactIndex,
					context: line.trim(),
					confidence: 0.9,
					matchType: "exact",
				});
				continue;
			}

			// Fuzzy match (allowing for slight variations)
			if (this.fuzzyMatch(line, pattern)) {
				matches.push({
					pattern,
					file: file.path,
					line: i,
					context: line.trim(),
					confidence: 0.7,
					matchType: "fuzzy",
				});
			}
		}

		return matches;
	}

	/**
	 * Performs fuzzy string matching
	 */
	private fuzzyMatch(text: string, pattern: string): boolean {
		const lowerText = text.toLowerCase();
		const lowerPattern = pattern.toLowerCase();

		// Simple fuzzy matching - check if most characters are present
		if (lowerPattern.length < 3) return false;

		let matchCount = 0;
		let lastIndex = -1;

		for (const char of lowerPattern) {
			const index = lowerText.indexOf(char, lastIndex + 1);
			if (index !== -1) {
				matchCount++;
				lastIndex = index;
			}
		}

		return matchCount / lowerPattern.length >= 0.7; // 70% character match
	}

	/**
	 * Calculates confidence score for a pattern match
	 */
	private calculateConfidence(
		match: PatternMatch,
		file: CodebaseFile,
		feedback: ProcessedFeedbackData,
	): number {
		let confidence = match.confidence;

		// Boost confidence for certain file types
		if (feedback.type === "crash") {
			if (file.language === "swift" || file.language === "objc")
				confidence += 0.1;
			if (file.path.includes("crash") || file.path.includes("error"))
				confidence += 0.2;
		} else {
			if (file.path.includes("ui") || file.path.includes("component"))
				confidence += 0.1;
			if (file.path.includes("screen") || file.path.includes("view"))
				confidence += 0.1;
		}

		// Boost confidence for main source files (not tests)
		if (!file.path.includes("test") && !file.path.includes("spec")) {
			confidence += 0.05;
		}

		// Reduce confidence for very large files
		if (file.lines > 1000) {
			confidence -= 0.1;
		}

		// Boost confidence for recent files (would need git integration)
		// For now, boost smaller files as they're more likely to be focused
		if (file.lines < 200) {
			confidence += 0.05;
		}

		return Math.min(1.0, Math.max(0.0, confidence));
	}

	/**
	 * Finds crash-related code areas
	 */
	private findCrashRelatedAreas(
		file: CodebaseFile,
		_feedback: ProcessedFeedbackData,
	): RelevantCodeArea[] {
		const areas: RelevantCodeArea[] = [];
		const lines = file.content.split("\n");

		// Look for error handling patterns
		const errorPatterns = [
			/throw\s+/i,
			/NSException/i,
			/Error\s*\(/i,
			/fatalError/i,
			/assertionFailure/i,
		];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line) {
				for (const pattern of errorPatterns) {
					if (pattern.test(line)) {
						const startLine = Math.max(0, i - 2);
						const endLine = Math.min(lines.length - 1, i + 5);
						const contextLines = lines.slice(startLine, endLine + 1);

						areas.push({
							file: file.path,
							lines: `${startLine + 1}-${endLine + 1}`,
							content: contextLines.join("\n"),
							confidence: 0.6,
							reason: "Contains error handling code",
							matchType: "structural",
							metadata: this.extractMetadata(file, i),
						});
						break;
					}
				}
			}
		}

		return areas;
	}

	/**
	 * Finds UI-related code areas
	 */
	private findUIRelatedAreas(
		file: CodebaseFile,
		_feedback: ProcessedFeedbackData,
	): RelevantCodeArea[] {
		const areas: RelevantCodeArea[] = [];
		const lines = file.content.split("\n");

		// Look for UI patterns
		const uiPatterns = [
			/UIButton/i,
			/UIViewController/i,
			/UIView/i,
			/Button/i,
			/View/i,
			/Component/i,
			/render\s*\(/i,
			/useState/i,
			/useEffect/i,
			/@State/i,
			/@IBAction/i,
			/@IBOutlet/i,
		];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line) {
				for (const pattern of uiPatterns) {
					if (pattern.test(line)) {
						const startLine = Math.max(0, i - 2);
						const endLine = Math.min(lines.length - 1, i + 5);
						const contextLines = lines.slice(startLine, endLine + 1);

						areas.push({
							file: file.path,
							lines: `${startLine + 1}-${endLine + 1}`,
							content: contextLines.join("\n"),
							confidence: 0.5,
							reason: "Contains UI-related code",
							matchType: "structural",
							metadata: this.extractMetadata(file, i),
						});
						break;
					}
				}
			}
		}

		return areas;
	}

	/**
	 * Extracts metadata from code at a specific line
	 */
	private extractMetadata(
		file: CodebaseFile,
		lineNumber: number,
	): Record<string, unknown> {
		const lines = file.content.split("\n");
		const metadata: Record<string, unknown> = {};

		// Look backwards for function/class/component definitions
		for (let i = lineNumber; i >= Math.max(0, lineNumber - 10); i--) {
			const line = lines[i];
			if (!line) continue;

			// Extract function/method names
			const functionMatch = line.match(/(?:function|func|def)\s+(\w+)/);
			if (functionMatch) {
				metadata.function = functionMatch[1];
			}

			// Extract class names
			const classMatch = line.match(/(?:class|struct|interface)\s+(\w+)/);
			if (classMatch) {
				metadata.class = classMatch[1];
			}
		}

		return metadata;
	}

	/**
	 * Generates suggestions based on analysis results
	 */
	private generateSuggestions(
		relevantAreas: RelevantCodeArea[],
		_feedback: ProcessedFeedbackData,
	): {
		possibleComponents: string[];
		suspectedModules: string[];
		relatedPatterns: string[];
	} {
		const componentNames = new Set<string>();
		const moduleNames = new Set<string>();
		const patterns = new Set<string>();

		for (const area of relevantAreas) {
			// Extract component names
			if (area.metadata?.componentName) {
				componentNames.add(area.metadata.componentName);
			}
			if (area.metadata?.className) {
				componentNames.add(area.metadata.className);
			}

			// Extract module names from file paths
			const pathParts = area.file.split("/");
			if (pathParts.length > 1) {
				const parentDir = pathParts[pathParts.length - 2];
				if (parentDir) {
					moduleNames.add(parentDir); // Parent directory
				}
			}

			// Extract patterns from reasons
			patterns.add(area.reason);
		}

		return {
			possibleComponents: Array.from(componentNames).slice(0, 5),
			suspectedModules: Array.from(moduleNames).slice(0, 5),
			relatedPatterns: Array.from(patterns).slice(0, 5),
		};
	}

	/**
	 * Detects programming language from file extension
	 */
	private detectLanguage(filePath: string): string {
		const ext = extname(filePath).toLowerCase();
		const languageMap: Record<string, string> = {
			".ts": "typescript",
			".tsx": "typescript",
			".js": "javascript",
			".jsx": "javascript",
			".swift": "swift",
			".m": "objc",
			".h": "objc",
			".mm": "objc",
			".kt": "kotlin",
			".java": "java",
			".py": "python",
			".rb": "ruby",
			".php": "php",
			".go": "go",
			".rs": "rust",
			".cpp": "cpp",
			".c": "c",
			".vue": "vue",
			".svelte": "svelte",
		};

		return languageMap[ext] || "unknown";
	}

	/**
	 * Builds ignore patterns for file scanning
	 */
	private buildIgnorePatterns(options: AnalysisOptions): string[] {
		const patterns = [
			"**/node_modules/**",
			"**/build/**",
			"**/dist/**",
			"**/coverage/**",
			"**/.git/**",
			"**/.DS_Store",
			"**/*.log",
			"**/*.lock",
		];

		if (!options.includeTests) {
			patterns.push(
				"**/*.test.*",
				"**/*.spec.*",
				"**/tests/**",
				"**/__tests__/**",
			);
		}

		if (!options.includeNodeModules) {
			patterns.push("**/node_modules/**");
		}

		return patterns;
	}

	/**
	 * Clears file cache
	 */
	public clearCache(): void {
		this.fileCache.clear();
	}

	/**
	 * Gets cache statistics
	 */
	public getCacheStats(): { size: number; files: string[] } {
		return {
			size: this.fileCache.size,
			files: Array.from(this.fileCache.keys()),
		};
	}
}

/**
 * Global codebase analyzer instance
 */
let _analyzerInstance: CodebaseAnalyzer | null = null;

export function getCodebaseAnalyzer(workspaceRoot?: string): CodebaseAnalyzer {
	if (
		!_analyzerInstance ||
		(workspaceRoot && workspaceRoot !== _analyzerInstance.workspaceRoot)
	) {
		_analyzerInstance = new CodebaseAnalyzer(workspaceRoot);
	}
	return _analyzerInstance;
}

/**
 * Clears the global analyzer instance (useful for testing)
 */
export function clearCodebaseAnalyzerInstance(): void {
	_analyzerInstance = null;
}
