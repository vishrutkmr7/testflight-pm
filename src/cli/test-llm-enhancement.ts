#!/usr/bin/env bun

/**
 * CLI Testing Tool for LLM Enhancement
 * Interactive tool to test LLM functionality with various providers and feedback scenarios
 */

import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { ProcessedFeedbackData } from "../../types/testflight.js";
import type { CodebaseAnalysisResult } from "../analysis/codebase-analyzer.js";
import { getCodebaseAnalyzer } from "../analysis/codebase-analyzer.js";
import type {
	LLMEnhancementResponse,
	LLMUsageStats,
} from "../api/llm-client.js";
import { getLLMClient } from "../api/llm-client.js";

// Sample test scenarios
const TEST_SCENARIOS = {
	crash: {
		simple: {
			id: "test-crash-001",
			type: "crash" as const,
			timestamp: new Date(),
			userId: "test-user",
			appVersion: "2.0.1",
			buildVersion: "456",
			deviceInfo: {
				family: "iOS",
				model: "iPhone 15 Pro",
				osVersion: "17.2",
				locale: "en-US",
			},
			crashData: {
				trace: `Thread 0 Crashed:
0   MyApp                    0x0000000104abc123 -[LoginViewController viewDidLoad] + 45
1   UIKitCore               0x000000018d12e456 -[UIViewController loadViewIfRequired] + 234
2   UIKitCore               0x000000018d12e789 -[UIViewController view] + 67`,
				type: "EXC_BAD_ACCESS",
				exceptionType: "SIGSEGV",
				exceptionMessage:
					"Attempted to dereference garbage pointer 0x1234567890",
				logs: [],
			},
		},

		complex: {
			id: "test-crash-002",
			type: "crash" as const,
			timestamp: new Date(),
			userId: "test-user-2",
			appVersion: "2.0.1",
			buildVersion: "456",
			deviceInfo: {
				family: "iOS",
				model: "iPhone 14",
				osVersion: "17.1",
				locale: "fr-FR",
			},
			crashData: {
				trace: `Thread 0 Crashed:
0   MyApp                    0x0000000104abc123 UserAuthenticationManager.authenticateUser(username:password:completion:) + 156
1   MyApp                    0x0000000104def456 NetworkManager.makeRequest(endpoint:body:completion:) + 89
2   MyApp                    0x0000000104ghi789 APIClient.login(username:password:completion:) + 34
3   MyApp                    0x0000000104jkl012 LoginViewController.signInButtonTapped(_:) + 42`,
				type: "NSInvalidArgumentException",
				exceptionType: "NSInvalidArgumentException",
				exceptionMessage:
					"Invalid argument: nil credentials provided to authentication manager",
				logs: [],
			},
		},
	},

	feedback: {
		ui: {
			id: "test-feedback-001",
			type: "feedback" as const,
			timestamp: new Date(),
			userId: "test-user",
			appVersion: "2.0.1",
			buildVersion: "456",
			deviceInfo: {
				family: "iOS",
				model: "iPhone 15 Pro",
				osVersion: "17.2",
				locale: "en-US",
			},
			screenshotData: {
				text: "The sign in button is too small and hard to tap. The text is also very light and hard to read.",
				images: [],
				annotations: [
					{
						type: "arrow",
						coordinates: { x: 200, y: 400 },
						text: "Hard to tap",
					},
				],
			},
		},

		feature: {
			id: "test-feedback-002",
			type: "feedback" as const,
			timestamp: new Date(),
			userId: "test-user-2",
			appVersion: "2.0.1",
			buildVersion: "456",
			deviceInfo: {
				family: "iOS",
				model: "iPhone 14",
				osVersion: "17.1",
				locale: "en-US",
			},
			screenshotData: {
				text: "It would be great to have a dark mode option. The current bright white interface is hard on the eyes at night.",
				images: [],
				annotations: [],
			},
		},
	},
};

interface CLIOptions {
	scenario?: string;
	provider?: string;
	model?: string;
	output?: string;
	verbose?: boolean;
	analyze?: boolean;
	workspace?: string;
	interactive?: boolean;
	all?: boolean;
	help?: boolean;
}

function printUsage(): void {
	console.log(`
🧪 LLM Enhancement Testing CLI

Usage: bun src/cli/test-llm-enhancement.ts [options]

Options:
  --scenario <name>     Test scenario (crash.simple, crash.complex, feedback.ui, feedback.feature)
  --provider <name>     LLM provider (openai, anthropic, google, deepseek, xai)
  --model <name>        Specific model to use
  --output <file>       Save results to file
  --verbose             Enable verbose logging
  --analyze             Include codebase analysis
  --workspace <path>    Workspace path for codebase analysis
  --interactive         Interactive mode
  --all                 Run all test scenarios
  --help                Show this help message

Examples:
  # Test simple crash scenario with OpenAI
  bun src/cli/test-llm-enhancement.ts --scenario crash.simple --provider openai

  # Test with codebase analysis
  bun src/cli/test-llm-enhancement.ts --scenario feedback.ui --analyze --workspace .

  # Interactive mode
  bun src/cli/test-llm-enhancement.ts --interactive

  # Run all scenarios
  bun src/cli/test-llm-enhancement.ts --all --output results.json
	`);
}

function parseOptions(): CLIOptions {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			scenario: { type: "string" },
			provider: { type: "string" },
			model: { type: "string" },
			output: { type: "string" },
			verbose: { type: "boolean" },
			analyze: { type: "boolean" },
			workspace: { type: "string" },
			interactive: { type: "boolean" },
			all: { type: "boolean" },
			help: { type: "boolean" },
		},
		allowPositionals: false,
	});

	return values as CLIOptions;
}

function getScenario(scenarioPath: string): ProcessedFeedbackData {
	const [category, name] = scenarioPath.split(".");

	if (!TEST_SCENARIOS[category as keyof typeof TEST_SCENARIOS]) {
		throw new Error(`Unknown scenario category: ${category}`);
	}

	const scenario =
		TEST_SCENARIOS[category as keyof typeof TEST_SCENARIOS][
			name as keyof (typeof TEST_SCENARIOS)["crash"]
		];
	if (!scenario) {
		throw new Error(`Unknown scenario: ${scenarioPath}`);
	}

	return scenario;
}

async function runEnhancementTest(
	scenario: ProcessedFeedbackData,
	options: {
		provider?: string;
		model?: string;
		verbose?: boolean;
		analyze?: boolean;
		workspace?: string;
	},
): Promise<{
	scenario: ProcessedFeedbackData;
	enhancement: LLMEnhancementResponse;
	analysis?: CodebaseAnalysisResult;
	metrics: {
		duration: number;
		tokenUsage?: LLMUsageStats;
		cost?: number;
	};
	error?: string;
}> {
	const startTime = Date.now();

	try {
		if (options.verbose) {
			console.log(`🔬 Testing scenario: ${scenario.id}`);
			console.log(`📱 Type: ${scenario.type}`);
			console.log(`📋 Provider: ${options.provider || "default"}`);
		}

		// Initialize LLM client
		const llmClient = getLLMClient();

		// Perform codebase analysis if requested
		let analysis: CodebaseAnalysisResult | undefined;
		if (options.analyze) {
			if (options.verbose) {
				console.log(`🔍 Analyzing codebase at ${options.workspace || "."}`);
			}

			const analyzer = getCodebaseAnalyzer(options.workspace);
			analysis = await analyzer.analyzeTestFlightFeedback(scenario);

			if (options.verbose) {
				console.log(
					`📊 Found ${analysis.relevantAreas.length} relevant areas (confidence: ${(analysis.confidence * 100).toFixed(1)}%)`,
				);
			}
		}

		// Get enhancement
		if (options.verbose) {
			console.log("✨ Generating LLM enhancement...");
		}

		const enhancement = await llmClient.enhanceFeedback(scenario, analysis);
		const duration = Date.now() - startTime;

		// Get usage metrics
		const usage = llmClient.getUsageStats();

		if (options.verbose) {
			console.log(`✅ Enhancement complete in ${duration}ms`);
			console.log(`💰 Cost: $${usage.totalCost.toFixed(4)}`);
		}

		return {
			scenario,
			enhancement,
			analysis,
			metrics: {
				duration,
				tokenUsage: usage,
				cost: usage.totalCost,
			},
		};
	} catch (error) {
		return {
			scenario,
			enhancement: null,
			analysis: undefined,
			metrics: {
				duration: Date.now() - startTime,
			},
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function runInteractiveMode(): Promise<void> {
	console.log("🎮 Interactive LLM Enhancement Testing");
	console.log("\nAvailable scenarios:");

	// List available scenarios
	for (const [category, scenarios] of Object.entries(TEST_SCENARIOS)) {
		console.log(`\n📁 ${category}:`);
		for (const [name, scenario] of Object.entries(scenarios)) {
			console.log(
				`  • ${category}.${name} - ${scenario.type} (${scenario.id})`,
			);
		}
	}

	// Get user input
	console.log("\nEnter scenario (e.g., 'crash.simple'):");
	const scenarioInput = await getInput();

	console.log("Enable codebase analysis? (y/n):");
	const analyzeInput = await getInput();
	const analyze = analyzeInput.toLowerCase().startsWith("y");

	let workspace = ".";
	if (analyze) {
		console.log("Workspace path (default: '.'):");
		const workspaceInput = await getInput();
		if (workspaceInput.trim()) {
			workspace = workspaceInput.trim();
		}
	}

	try {
		const scenario = getScenario(scenarioInput.trim());
		const result = await runEnhancementTest(scenario, {
			verbose: true,
			analyze,
			workspace,
		});

		console.log("\n🎯 Results:");
		console.log("=".repeat(50));

		if (result.error) {
			console.error(`❌ Error: ${result.error}`);
		} else {
			console.log(`📝 Title: ${result.enhancement.title}`);
			console.log(`🏷️  Labels: ${result.enhancement.labels.join(", ")}`);
			console.log(`⚡ Priority: ${result.enhancement.priority}`);
			console.log(`⏱️  Duration: ${result.metrics.duration}ms`);
			console.log(`💰 Cost: $${result.metrics.cost?.toFixed(4) || "0.0000"}`);

			console.log("\n📋 Description:");
			console.log(result.enhancement.description);

			if (result.analysis) {
				console.log(
					`\n🔍 Analysis: ${result.analysis.relevantAreas.length} relevant areas found`,
				);
				for (const area of result.analysis.relevantAreas.slice(0, 3)) {
					console.log(
						`  • ${area.file}:${area.lines} (${(area.confidence * 100).toFixed(1)}%)`,
					);
				}
			}
		}
	} catch (error) {
		console.error(`❌ Error: ${error}`);
	}
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

	console.log("🧪 LLM Enhancement Testing CLI");
	console.log("=".repeat(40));

	try {
		if (options.interactive) {
			await runInteractiveMode();
			return;
		}

		if (options.all) {
			console.log("🚀 Running all test scenarios...\n");

			const results = [];

			for (const [category, scenarios] of Object.entries(TEST_SCENARIOS)) {
				for (const [name, scenario] of Object.entries(scenarios)) {
					const scenarioName = `${category}.${name}`;
					console.log(`Testing ${scenarioName}...`);

					const result = await runEnhancementTest(scenario, {
						provider: options.provider,
						model: options.model,
						verbose: options.verbose,
						analyze: options.analyze,
						workspace: options.workspace,
					});

					results.push({
						scenario: scenarioName,
						...result,
					});

					if (result.error) {
						console.log(`❌ Failed: ${result.error}`);
					} else {
						console.log(
							`✅ Success (${result.metrics.duration}ms, $${result.metrics.cost?.toFixed(4) || "0.0000"})`,
						);
					}
				}
			}

			// Save results if requested
			if (options.output) {
				await writeFile(options.output, JSON.stringify(results, null, 2));
				console.log(`\n💾 Results saved to ${options.output}`);
			}

			// Print summary
			const successful = results.filter((r) => !r.error).length;
			const totalCost = results.reduce(
				(sum, r) => sum + (r.metrics.cost || 0),
				0,
			);
			const avgDuration =
				results.reduce((sum, r) => sum + r.metrics.duration, 0) /
				results.length;

			console.log(`\n📊 Summary:`);
			console.log(`✅ Successful: ${successful}/${results.length}`);
			console.log(`💰 Total Cost: $${totalCost.toFixed(4)}`);
			console.log(`⏱️  Average Duration: ${avgDuration.toFixed(0)}ms`);
		} else if (options.scenario) {
			const scenario = getScenario(options.scenario);
			const result = await runEnhancementTest(scenario, {
				provider: options.provider,
				model: options.model,
				verbose: true,
				analyze: options.analyze,
				workspace: options.workspace,
			});

			if (result.error) {
				console.error(`❌ Error: ${result.error}`);
				process.exit(1);
			}

			console.log("\n🎯 Enhancement Result:");
			console.log("=".repeat(30));
			console.log(
				JSON.stringify(
					{
						title: result.enhancement.title,
						labels: result.enhancement.labels,
						priority: result.enhancement.priority,
						description: `${result.enhancement.description.substring(0, 200)}...`,
						metrics: result.metrics,
					},
					null,
					2,
				),
			);

			if (options.output) {
				await writeFile(options.output, JSON.stringify(result, null, 2));
				console.log(`\n💾 Full results saved to ${options.output}`);
			}
		} else {
			console.log(
				"❌ No scenario specified. Use --scenario, --all, or --interactive",
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
