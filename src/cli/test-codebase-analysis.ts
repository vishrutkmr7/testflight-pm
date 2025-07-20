#!/usr/bin/env bun

/**
 * CLI Testing Tool for Codebase Analysis
 * Interactive tool to test codebase analysis functionality with different project structures
 */

import { readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import type { ProcessedFeedbackData } from "../../types/testflight.js";
import type {
	CodebaseAnalysisResult,
	RelevantCodeArea,
} from "../analysis/codebase-analyzer.js";
import { getCodebaseAnalyzer } from "../analysis/codebase-analyzer.js";

interface CLIOptions {
	workspace?: string;
	scenario?: string;
	output?: string;
	verbose?: boolean;
	interactive?: boolean;
	scan?: boolean;
	help?: boolean;
	confidence?: string;
	limit?: string;
}

// Test feedback scenarios for codebase analysis
const ANALYSIS_SCENARIOS = {
	"auth-crash": {
		id: "auth-crash-test",
		type: "crash" as const,
		timestamp: new Date(),
		userId: "test-user",
		appVersion: "1.0.0",
		buildVersion: "123",
		deviceInfo: {
			family: "iOS",
			model: "iPhone 14 Pro",
			osVersion: "17.1",
			locale: "en-US",
		},
		crashData: {
			trace: `Thread 0 Crashed:
0   MyApp                    0x104abc123 LoginViewController.signInButtonTapped(_:) + 42
1   MyApp                    0x104def456 UserAuthenticationManager.authenticateUser(username:password:completion:) + 156
2   MyApp                    0x104ghi789 NetworkManager.makeRequest(endpoint:body:completion:) + 89`,
			type: "NSInvalidArgumentException",
			exceptionType: "NSInvalidArgumentException",
			exceptionMessage: "Invalid credentials: nil username or password",
			logs: [],
		},
	},

	"ui-feedback": {
		id: "ui-feedback-test",
		type: "feedback" as const,
		timestamp: new Date(),
		userId: "test-user",
		appVersion: "1.0.0",
		buildVersion: "123",
		deviceInfo: {
			family: "iOS",
			model: "iPhone 14 Pro",
			osVersion: "17.1",
			locale: "en-US",
		},
		screenshotData: {
			text: "The navigation bar overlaps with the status bar. The back button is too close to the edge and hard to tap.",
			images: [],
			annotations: [
				{
					type: "arrow",
					coordinates: { x: 50, y: 50 },
					text: "Overlap issue",
				},
			],
		},
	},

	"network-error": {
		id: "network-error-test",
		type: "crash" as const,
		timestamp: new Date(),
		userId: "test-user",
		appVersion: "1.0.0",
		buildVersion: "123",
		deviceInfo: {
			family: "iOS",
			model: "iPhone 14 Pro",
			osVersion: "17.1",
			locale: "en-US",
		},
		crashData: {
			trace: `Thread 0 Crashed:
0   MyApp                    0x104abc123 APIClient.fetchUserData() + 67
1   MyApp                    0x104def456 NetworkService.performRequest(_:) + 123
2   Foundation               0x183456789 URLSessionTask.resume() + 45`,
			type: "NSURLErrorDomain",
			exceptionType: "NSURLErrorNetworkConnectionLost",
			exceptionMessage: "The network connection was lost",
			logs: [],
		},
	},

	"memory-leak": {
		id: "memory-leak-test",
		type: "crash" as const,
		timestamp: new Date(),
		userId: "test-user",
		appVersion: "1.0.0",
		buildVersion: "123",
		deviceInfo: {
			family: "iOS",
			model: "iPhone 14 Pro",
			osVersion: "17.1",
			locale: "en-US",
		},
		crashData: {
			trace: `Thread 0 Crashed:
0   MyApp                    0x104abc123 ImageCache.loadImage(url:completion:) + 234
1   MyApp                    0x104def456 PhotoViewController.loadPhotos() + 89
2   MyApp                    0x104ghi789 CollectionViewCell.configure(with:) + 45`,
			type: "EXC_BAD_ACCESS",
			exceptionType: "SIGSEGV",
			exceptionMessage: "Memory access violation in image loading",
			logs: [],
		},
	},
};

function printUsage(): void {
	console.log(`
🔍 Codebase Analysis Testing CLI

Usage: bun src/cli/test-codebase-analysis.ts [options]

Options:
  --workspace <path>    Workspace path to analyze (default: current directory)
  --scenario <name>     Test scenario (auth-crash, ui-feedback, network-error, memory-leak)
  --output <file>       Save analysis results to file
  --verbose             Enable verbose logging
  --interactive         Interactive mode
  --scan                Scan workspace for supported files
  --confidence <num>    Minimum confidence threshold (0.0-1.0)
  --limit <num>         Limit number of results
  --help                Show this help message

Examples:
  # Analyze current directory with auth crash scenario
  bun src/cli/test-codebase-analysis.ts --scenario auth-crash

  # Interactive analysis
  bun src/cli/test-codebase-analysis.ts --interactive --workspace /path/to/project

  # Scan workspace for files
  bun src/cli/test-codebase-analysis.ts --scan --workspace /path/to/project

  # Filter by confidence
  bun src/cli/test-codebase-analysis.ts --scenario ui-feedback --confidence 0.7
	`);
}

function parseOptions(): CLIOptions {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			workspace: { type: "string" },
			scenario: { type: "string" },
			output: { type: "string" },
			verbose: { type: "boolean" },
			interactive: { type: "boolean" },
			scan: { type: "boolean" },
			help: { type: "boolean" },
			confidence: { type: "string" },
			limit: { type: "string" },
		},
		allowPositionals: false,
	});

	return values as CLIOptions;
}

async function scanWorkspace(
	workspacePath: string,
	verbose = false,
): Promise<{
	totalFiles: number;
	supportedFiles: number;
	filesByType: Record<string, number>;
	largestFiles: Array<{ file: string; size: number }>;
	summary: string;
}> {
	const filesByType: Record<string, number> = {};
	const fileSizes: Array<{ file: string; size: number }> = [];

	const supportedExtensions = new Set([
		".ts",
		".tsx",
		".js",
		".jsx",
		".swift",
		".m",
		".h",
		".mm",
		".kt",
		".java",
		".py",
		".rb",
		".php",
		".go",
		".rs",
		".cpp",
		".c",
		".vue",
		".svelte",
		".json",
		".xml",
		".yml",
		".yaml",
		".md",
	]);

	async function scanDirectory(dirPath: string): Promise<void> {
		const items = await readdir(dirPath);

		for (const item of items) {
			const fullPath = join(dirPath, item);
			const stats = await stat(fullPath);

			if (stats.isDirectory()) {
				// Skip common ignored directories
				if (
					!item.startsWith(".") &&
					item !== "node_modules" &&
					item !== "dist"
				) {
					await scanDirectory(fullPath);
				}
			} else if (stats.isFile()) {
				const ext = item.substring(item.lastIndexOf(".")).toLowerCase();
				filesByType[ext] = (filesByType[ext] || 0) + 1;

				if (supportedExtensions.has(ext)) {
					fileSizes.push({
						file: relative(workspacePath, fullPath),
						size: stats.size,
					});
				}

				if (verbose && supportedExtensions.has(ext)) {
					console.log(
						`  📄 ${relative(workspacePath, fullPath)} (${(stats.size / 1024).toFixed(1)}KB)`,
					);
				}
			}
		}
	}

	await scanDirectory(workspacePath);

	const totalFiles = Object.values(filesByType).reduce(
		(sum, count) => sum + count,
		0,
	);
	const supportedFiles = fileSizes.length;
	const largestFiles = fileSizes.sort((a, b) => b.size - a.size).slice(0, 10);

	// Generate summary
	const topExtensions = Object.entries(filesByType)
		.filter(([ext]) => supportedExtensions.has(ext))
		.sort(([, a], [, b]) => b - a)
		.slice(0, 5);

	const summary = `Found ${supportedFiles} supported files out of ${totalFiles} total files. 
Top file types: ${topExtensions.map(([ext, count]) => `${ext} (${count})`).join(", ")}`;

	return {
		totalFiles,
		supportedFiles,
		filesByType,
		largestFiles,
		summary,
	};
}

async function runCodebaseAnalysis(
	workspacePath: string,
	scenario: ProcessedFeedbackData,
	options: {
		verbose?: boolean;
		confidenceThreshold?: number;
		limit?: number;
	} = {},
): Promise<{
	scenario: ProcessedFeedbackData;
	analysis: CodebaseAnalysisResult;
	metrics: {
		duration: number;
		filesScanned: number;
		areasFound: number;
	};
	error?: string;
}> {
	const startTime = Date.now();

	try {
		if (options.verbose) {
			console.log(`🔍 Analyzing workspace: ${workspacePath}`);
			console.log(`📋 Scenario: ${scenario.id} (${scenario.type})`);
		}

		const analyzer = getCodebaseAnalyzer(workspacePath);
		const analysis = await analyzer.analyzeForFeedback(scenario);

		// Apply filters
		let filteredAreas = analysis.relevantFiles;

		if (options.confidenceThreshold) {
			filteredAreas = filteredAreas.filter(
				(area: RelevantCodeArea) =>
					area.confidence >= (options.confidenceThreshold || 0),
			);
		}

		if (options.limit) {
			filteredAreas = filteredAreas.slice(0, options.limit);
		}

		const _filteredAnalysis = {
			...analysis,
			relevantFiles: filteredAreas,
		};

		const duration = Date.now() - startTime;

		if (options.verbose) {
			console.log(`✅ Analysis complete in ${duration}ms`);
			console.log(`📊 Found ${filteredAreas.length} relevant areas`);
		}

		return {
			scenario,
			analysis: {
				relevantFiles: filteredAreas,
				totalFilesScanned: analysis.totalFilesScanned,
				processingTime: analysis.processingTime,
				analysisDepth: analysis.analysisDepth,
				suggestions: {
					possibleComponents: analysis.suggestions.possibleComponents,
					suspectedModules: analysis.suggestions.suspectedModules,
					relatedPatterns: analysis.suggestions.relatedPatterns,
				},
			},
			metrics: {
				duration,
				filesScanned: analysis.totalFilesScanned,
				areasFound: filteredAreas.length,
			},
		};
	} catch (error) {
		return {
			scenario,
			analysis: {
				relevantFiles: [],
				totalFilesScanned: 0,
				processingTime: Date.now() - startTime,
				analysisDepth: 0,
				suggestions: {
					possibleComponents: [],
					suspectedModules: [],
					relatedPatterns: [],
				},
			},
			metrics: {
				duration: Date.now() - startTime,
				filesScanned: 0,
				areasFound: 0,
			},
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function formatAnalysisResults(result: {
	scenario: unknown;
	analysis: CodebaseAnalysisResult | null;
	metrics: unknown;
	error?: string;
}): void {
	console.log("\n🎯 Analysis Results:");
	console.log("=".repeat(50));

	if (result.error) {
		console.error(`❌ Error: ${result.error}`);
		return;
	}

	const { analysis, metrics } = result;

	console.log(`⏱️  Duration: ${metrics.duration}ms`);
	console.log(`📊 Areas Found: ${metrics.areasFound}`);
	console.log(
		`🎯 Overall Confidence: ${(analysis.confidence * 100).toFixed(1)}%`,
	);

	if (analysis.relevantAreas.length > 0) {
		console.log("\n📋 Relevant Code Areas:");
		console.log("-".repeat(30));

		for (const [i, area] of analysis.relevantAreas.entries()) {
			console.log(`${i + 1}. ${area.file}:${area.lines}`);
			console.log(`   🎯 Confidence: ${(area.confidence * 100).toFixed(1)}%`);
			console.log(`   🔍 Type: ${area.matchType}`);
			console.log(`   💭 Reason: ${area.reason}`);
			console.log(
				`   📝 Context: ${area.context.substring(0, 100)}${area.context.length > 100 ? "..." : ""}`,
			);
			console.log();
		}
	}

	if (analysis.suggestions.possibleComponents.length > 0) {
		console.log("🧩 Suggested Components:");
		console.log(`   ${analysis.suggestions.possibleComponents.join(", ")}`);
	}

	if (analysis.suggestions.relatedFiles.length > 0) {
		console.log("\n📁 Related Files:");
		for (const file of analysis.suggestions.relatedFiles) {
			console.log(`   • ${file}`);
		}
	}
}

async function runInteractiveMode(workspacePath: string): Promise<void> {
	console.log("🎮 Interactive Codebase Analysis");
	console.log(`📁 Workspace: ${workspacePath}\n`);

	// Show available scenarios
	console.log("Available scenarios:");
	for (const [key, scenario] of Object.entries(ANALYSIS_SCENARIOS)) {
		console.log(
			`  • ${key} - ${scenario.type} (${scenario.crashData ? "crash" : "feedback"})`,
		);
	}

	console.log("\nEnter scenario name:");
	const scenarioInput = await getInput();

	const scenario =
		ANALYSIS_SCENARIOS[scenarioInput.trim() as keyof typeof ANALYSIS_SCENARIOS];
	if (!scenario) {
		console.error(`❌ Unknown scenario: ${scenarioInput}`);
		return;
	}

	console.log("Minimum confidence threshold (0.0-1.0, default: 0.3):");
	const confidenceInput = await getInput();
	const confidence = confidenceInput.trim()
		? parseFloat(confidenceInput.trim())
		: 0.3;

	console.log("Maximum results to show (default: 10):");
	const limitInput = await getInput();
	const limit = limitInput.trim() ? parseInt(limitInput.trim(), 10) : 10;

	console.log("\n🔍 Running analysis...");

	const result = await runCodebaseAnalysis(workspacePath, scenario, {
		verbose: true,
		confidenceThreshold: confidence,
		limit,
	});

	formatAnalysisResults(result);
}

async function getInput(): Promise<string> {
	return new Promise((resolve) => {
		process.stdin.setEncoding("utf8");
		process.stdin.once("data", (data) => {
			resolve(data.toString().trim());
		});
	});
}

async function main(): Promise<void> {
	const options = parseOptions();

	if (options.help) {
		printUsage();
		return;
	}

	const workspacePath = options.workspace || process.cwd();

	console.log("🔍 Codebase Analysis Testing CLI");
	console.log("=".repeat(40));
	console.log(`📁 Workspace: ${workspacePath}\n`);

	try {
		if (options.scan) {
			console.log("🔍 Scanning workspace...");
			const scanResult = await scanWorkspace(workspacePath, options.verbose);

			console.log("\n📊 Workspace Scan Results:");
			console.log("=".repeat(30));
			console.log(scanResult.summary);
			console.log(`📄 Total Files: ${scanResult.totalFiles}`);
			console.log(`✅ Supported Files: ${scanResult.supportedFiles}`);

			console.log("\n📈 File Types:");
			const sortedTypes = Object.entries(scanResult.filesByType)
				.sort(([, a], [, b]) => b - a)
				.slice(0, 10);

			for (const [ext, count] of sortedTypes) {
				console.log(`  ${ext}: ${count}`);
			}

			if (scanResult.largestFiles.length > 0) {
				console.log("\n📏 Largest Files:");
				for (const { file, size } of scanResult.largestFiles.slice(0, 5)) {
					console.log(`  ${file} (${(size / 1024).toFixed(1)}KB)`);
				}
			}

			return;
		}

		if (options.interactive) {
			await runInteractiveMode(workspacePath);
			return;
		}

		if (options.scenario) {
			const scenario =
				ANALYSIS_SCENARIOS[options.scenario as keyof typeof ANALYSIS_SCENARIOS];
			if (!scenario) {
				console.error(`❌ Unknown scenario: ${options.scenario}`);
				process.exit(1);
			}

			const confidenceThreshold = options.confidence
				? parseFloat(options.confidence)
				: undefined;
			const limit = options.limit ? parseInt(options.limit, 10) : undefined;

			const result = await runCodebaseAnalysis(workspacePath, scenario, {
				verbose: options.verbose,
				confidenceThreshold,
				limit,
			});

			formatAnalysisResults(result);

			if (options.output) {
				await writeFile(options.output, JSON.stringify(result, null, 2));
				console.log(`\n💾 Results saved to ${options.output}`);
			}
		} else {
			console.log(
				"❌ No action specified. Use --scenario, --scan, or --interactive",
			);
			printUsage();
			process.exit(1);
		}
	} catch (error) {
		console.error(`❌ Fatal error: ${error}`);
		process.exit(1);
	}
}

if (import.meta.main) {
	main();
}
