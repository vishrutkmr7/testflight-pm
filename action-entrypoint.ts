/**
 * GitHub Action Entrypoint for TestFlight PM Enhanced Processing
 * Production-ready entrypoint with comprehensive validation, health checks, and monitoring
 */

import * as core from "@actions/core";
import type { CodebaseAnalyzer } from "./src/analysis/codebase-analyzer.js";
import { getCodebaseAnalyzer } from "./src/analysis/codebase-analyzer.js";
import type { LLMClient } from "./src/api/llm-client.js";
import { getLLMClient } from "./src/api/llm-client.js";
import { getTestFlightClient } from "./src/api/testflight-client.js";
import { getConfig } from "./src/config/environment.js";
import type { EnhancedIssueCreationResult } from "./src/integrations/llm-enhanced-creator.js";
import type { IdempotencyService } from "./src/utils/idempotency-service.js";
import { getIdempotencyService } from "./src/utils/idempotency-service.js";
import {
	getSystemHealthMonitor,
	quickHealthCheck,
} from "./src/utils/monitoring.js";
import type { ProcessingWindow } from "./src/utils/processing-window.js";
import {
	type IssueCreationResult,
	IssueServiceFactory,
} from "./src/utils/service-factory.js";
import { getStateManager } from "./src/utils/state-manager.js";
import { Validation } from "./src/utils/validation.js";
import type { ProcessedFeedbackData } from "./types/testflight.js";

interface ActionResults {
	feedbackId: string;
	issueCreated: boolean;
	issueUpdated: boolean;
	issueUrl: string;
	processingTime: number;
}

interface WorkflowState {
	testFlightClient: ReturnType<typeof getTestFlightClient>;
	processingWindow: ProcessingWindow;
	enableLLMEnhancement: boolean;
	enableCodebaseAnalysis: boolean;
	enableDuplicateDetection: boolean;
	llmClient: LLMClient | null;
	codebaseAnalyzer: CodebaseAnalyzer | null;
	serviceFactory: IssueServiceFactory;
	idempotencyService: IdempotencyService;
	isDryRun: boolean;
}

async function run(): Promise<void> {
	try {
		// Initialize and validate system
		core.info("🚀 Starting TestFlight PM Enhanced Processing");

		// Perform initial health check
		core.info("🔍 Performing system health check...");
		const healthCheck = await quickHealthCheck();

		if (healthCheck.status === "unhealthy") {
			core.setFailed(`System health check failed: ${healthCheck.message}`);
			core.error(`Critical issues: ${healthCheck.criticalIssues.join(", ")}`);
			return;
		}

		if (healthCheck.status === "degraded") {
			core.warning(`System health degraded: ${healthCheck.message}`);
		} else {
			core.info(`✅ System health check passed: ${healthCheck.message}`);
		}

		// Load and validate configuration
		const _config = getConfig();

		// Validate configuration
		core.info("🔧 Validating configuration...");
		const envValidation = Validation.environment(process.env);

		if (!envValidation.valid) {
			core.setFailed(
				`Configuration validation failed: ${envValidation.errors.join(", ")}`,
			);
			return;
		}

		if (envValidation.warnings.length > 0) {
			envValidation.warnings.forEach((warning) => core.warning(warning));
		}

		core.info("✅ Configuration validation passed");

		// Get processing configuration
		const enableLLMEnhancement = core.getBooleanInput("enable_llm_enhancement");
		const enableCodebaseAnalysis = core.getBooleanInput(
			"enable_codebase_analysis",
		);
		const enableDuplicateDetection = core.getBooleanInput(
			"enable_duplicate_detection",
		);
		const isDryRun = core.getBooleanInput("dry_run");

		core.info(
			`🔧 Configuration: LLM=${enableLLMEnhancement}, Analysis=${enableCodebaseAnalysis}, Duplicates=${enableDuplicateDetection}, DryRun=${isDryRun}`,
		);

		// Initialize services
		const testFlightClient = getTestFlightClient();
		const llmClient = enableLLMEnhancement ? getLLMClient() : null;
		const codebaseAnalyzer = enableCodebaseAnalysis
			? getCodebaseAnalyzer()
			: null;
		const serviceFactory = IssueServiceFactory.getInstance();
		const idempotencyService = getIdempotencyService();

		// Calculate processing window
		const windowCalculator = await import(
			"./src/utils/processing-window.js"
		).then((m) => m.getProcessingWindowCalculator());
		const explicitSince = core.getInput("since");
		const processingWindow = await windowCalculator.calculateOptimalWindow(
			explicitSince || undefined,
		);

		core.info(
			`⏰ Processing window: ${processingWindow.startTime.toISOString()} to ${processingWindow.endTime.toISOString()}`,
		);

		const workflowState: WorkflowState = {
			testFlightClient,
			processingWindow,
			enableLLMEnhancement,
			enableCodebaseAnalysis,
			enableDuplicateDetection,
			isDryRun,
			llmClient,
			codebaseAnalyzer,
			serviceFactory,
			idempotencyService,
		};

		// Get TestFlight feedback
		core.info("📱 Fetching TestFlight feedback...");
		const feedbackData = await testFlightClient.getRecentFeedback(
			processingWindow.startTime,
		);

		if (feedbackData.length === 0) {
			core.info("✅ No new TestFlight feedback found");
			return;
		}

		core.info(`📊 Found ${feedbackData.length} feedback items to process`);

		// Filter unprocessed feedback
		const stateManager = getStateManager();
		const unprocessedFeedback =
			await stateManager.filterUnprocessed(feedbackData);

		if (unprocessedFeedback.length === 0) {
			core.info("✅ All feedback has already been processed");
			return;
		}

		core.info(`🔄 Processing ${unprocessedFeedback.length} new feedback items`);

		// Process each feedback item
		const results: ActionResults[] = [];
		let totalLLMRequests = 0;
		let totalLLMCost = 0;

		if (llmClient) {
			const stats = llmClient.getUsageStats();
			totalLLMRequests = stats.requestCount;
			totalLLMCost = stats.totalCostAccrued;
		}

		for (const feedback of unprocessedFeedback) {
			try {
				core.info(`🔍 Processing feedback: ${feedback.id} (${feedback.type})`);

				const result = await processFeedbackItem(feedback, workflowState);
				results.push(result);

				if (!isDryRun) {
					await stateManager.markAsProcessed([feedback.id]);
				}

				core.info(`✅ Successfully processed: ${feedback.id}`);
			} catch (error) {
				core.error(
					`❌ Failed to process feedback ${feedback.id}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		// Output results
		const summary = {
			totalProcessed: results.length,
			issuesCreated: results.filter((r) => r.issueCreated).length,
			issuesUpdated: results.filter((r) => r.issueUpdated).length,
			llmRequestsMade: totalLLMRequests,
			llmCostIncurred: totalLLMCost,
			processingTime: results.reduce((sum, r) => sum + r.processingTime, 0),
			timestamp: new Date().toISOString(),
		};

		core.setOutput("processing_summary", JSON.stringify(summary, null, 2));
		core.setOutput("issues_created", String(summary.issuesCreated));
		core.setOutput("issues_updated", String(summary.issuesUpdated));
		core.setOutput("llm_requests_made", String(summary.llmRequestsMade));
		core.setOutput("llm_cost_incurred", String(summary.llmCostIncurred));

		core.info(
			`🎉 Processing complete! Created: ${summary.issuesCreated}, Updated: ${summary.issuesUpdated}, Cost: $${summary.llmCostIncurred.toFixed(4)}`,
		);

		// Final health check and monitoring
		core.info("🔍 Performing final system health check...");
		try {
			const finalHealthCheck = await quickHealthCheck();
			if (finalHealthCheck.status === "unhealthy") {
				core.warning(
					`Final health check shows issues: ${finalHealthCheck.message}`,
				);
				core.warning(
					`Critical issues: ${finalHealthCheck.criticalIssues.join(", ")}`,
				);
			} else {
				core.info(`✅ Final health check passed: ${finalHealthCheck.message}`);
			}

			// Get detailed system health for debugging
			const monitor = getSystemHealthMonitor();
			const detailedHealth = await monitor.checkSystemHealth();

			if (detailedHealth.recommendations.length > 0) {
				core.info("📋 System recommendations:");
				detailedHealth.recommendations.forEach((rec) =>
					core.info(`  • ${rec}`),
				);
			}
		} catch (healthError) {
			core.warning(`Final health check failed: ${healthError}`);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);

		// Enhanced error reporting
		core.error(`❌ Action failed: ${errorMessage}`);

		if (error instanceof Error && error.stack) {
			core.debug(`Error stack: ${error.stack}`);
		}

		// Try to perform health check to understand failure
		try {
			const failureHealthCheck = await quickHealthCheck();
			core.error(`System status at failure: ${failureHealthCheck.status}`);
			if (failureHealthCheck.criticalIssues.length > 0) {
				core.error(
					`Critical issues: ${failureHealthCheck.criticalIssues.join(", ")}`,
				);
			}
		} catch (healthError) {
			core.error(
				`Could not perform health check after failure: ${healthError}`,
			);
		}

		// Provide helpful debugging information
		core.error("🔍 Debugging information:");
		core.error(`  Node.js version: ${process.version}`);
		core.error(`  Environment: ${process.env.NODE_ENV || "unknown"}`);
		core.error(
			`  Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
		);
		core.error(`  Uptime: ${Math.round(process.uptime())}s`);

		core.setFailed(errorMessage);
	}
}

async function processFeedbackItem(
	feedback: ProcessedFeedbackData,
	state: WorkflowState,
): Promise<ActionResults> {
	const startTime = Date.now();
	const {
		enableLLMEnhancement,
		enableDuplicateDetection,
		llmClient,
		codebaseAnalyzer,
		serviceFactory,
		isDryRun,
	} = state;

	let issueCreated = false;
	let issueUpdated = false;
	const _issueResult: unknown = null;

	try {
		// Check for duplicates first
		if (enableDuplicateDetection) {
			core.info(
				`🔍 Checking for duplicate issues for feedback: ${feedback.id}`,
			);

			const duplicateResult =
				await serviceFactory.findDuplicatesAcrossServices(feedback);

			if (duplicateResult.length > 0) {
				const duplicate = duplicateResult[0];
				if (duplicate?.isDuplicate && duplicate.existingIssue) {
					core.info(`⚠️ Duplicate found: ${duplicate.existingIssue.url}`);
					issueUpdated = true;
					// Add comment to existing issue would go here
					return {
						feedbackId: feedback.id,
						issueCreated: false,
						issueUpdated: true,
						issueUrl: duplicate.existingIssue.url,
						processingTime: Date.now() - startTime,
					};
				}
			}
		}

		// Perform codebase analysis if enabled
		let codebaseAnalysis = null;
		if (codebaseAnalyzer) {
			core.info(`🔍 Analyzing codebase for feedback: ${feedback.id}`);
			codebaseAnalysis = await codebaseAnalyzer.analyzeForFeedback(feedback);
			core.info(
				`📊 Found ${codebaseAnalysis.relevantFiles.length} relevant code areas`,
			);
		}

		// Create or enhance issue
		let issueResult: EnhancedIssueCreationResult | IssueCreationResult | null =
			null;

		if (enableLLMEnhancement && llmClient) {
			core.info(`🤖 Using LLM enhancement for feedback: ${feedback.id}`);

			// Use LLM enhanced creator
			const enhancedCreator = await import(
				"./src/integrations/llm-enhanced-creator.js"
			).then((m) => m.getLLMEnhancedIssueCreator());

			issueResult = await enhancedCreator.createEnhancedIssue(feedback, {
				platform: "github", // Could be configurable
				enableLLMEnhancement: true,
				enableCodebaseAnalysis: !!codebaseAnalyzer,
				analysisDepth: "moderate",
				includeRecentChanges: true,
				fallbackToStandard: true,
				skipDuplicateDetection: !enableDuplicateDetection,
				dryRun: isDryRun,
			});

			if ("success" in issueResult && issueResult.success) {
				issueCreated = true;
				core.info(
					`✅ Enhanced issue created: ${
						issueResult.github?.issue?.url ||
						issueResult.linear?.issue?.url ||
						"URL not available"
					}`,
				);
			}
		} else {
			// Standard issue creation
			core.info(`📝 Creating standard issue for feedback: ${feedback.id}`);

			issueResult = await serviceFactory.createIssueWithDefault(feedback);
			issueCreated = true;
			core.info(`✅ Standard issue created: ${issueResult.url}`);
		}

		// Extract URL from different result types
		let issueUrl = "";
		if (issueResult) {
			if ("url" in issueResult) {
				// IssueCreationResult
				issueUrl = issueResult.url;
			} else if ("github" in issueResult || "linear" in issueResult) {
				// EnhancedIssueCreationResult
				issueUrl =
					issueResult.github?.issue?.url ||
					issueResult.linear?.issue?.url ||
					"";
			}
		}

		return {
			feedbackId: feedback.id,
			issueCreated,
			issueUpdated,
			issueUrl,
			processingTime: Date.now() - startTime,
		};
	} catch (error) {
		core.error(
			`❌ Error processing feedback ${feedback.id}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return {
			feedbackId: feedback.id,
			issueCreated: false,
			issueUpdated: false,
			issueUrl: "",
			processingTime: Date.now() - startTime,
		};
	}
}

// Run the action
run();
