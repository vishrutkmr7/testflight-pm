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
import { getConfiguration } from "./src/config/index.js";

import type { EnhancedIssueCreationResult } from "./src/integrations/llm-enhanced-creator.js";
import type { IdempotencyService } from "./src/utils/idempotency-service.js";
import { getIdempotencyService } from "./src/utils/idempotency-service.js";
import {
	getSystemHealthMonitor,
	quickHealthCheck,
} from "./src/utils/monitoring/index.js";
import type { ProcessingWindow } from "./src/utils/processing-window.js";
import {
	type IssueCreationResult,
	IssueServiceFactory,
} from "./src/utils/service-factory.js";
import { getStateManager } from "./src/utils/state-manager.js";
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
	isDebugMode: boolean;
	platform: "github" | "linear" | "both";
}

async function run(): Promise<void> {
	try {
		// Initialize and validate system
		core.info("🚀 Starting TestFlight PM Enhanced Processing");

		// Get debug mode early for enhanced logging
		const isDebugMode = core.getBooleanInput("debug");

		// Perform initial health check
		core.info("🔍 Performing system health check...");
		const healthCheck = await quickHealthCheck();

		// Enhanced health check debugging
		if (isDebugMode) {
			const monitor = getSystemHealthMonitor();
			const detailedHealth = await monitor.checkSystemHealth();
			core.debug("🔍 Detailed health check results:");
			detailedHealth.components.forEach(component => {
				core.debug(`  ${component.component}: ${component.status} (${component.responseTime}ms)`);
				if (component.error) {
					core.debug(`    Error: ${component.error}`);
				}
				if (component.recommendations && component.recommendations.length > 0) {
					core.debug(`    Recommendations: ${component.recommendations.join(', ')}`);
				}
				// Show environment variable status for Environment Configuration in debug mode
				if (component.component === 'Environment Configuration' && component.details?.environmentVariables) {
					const envVars = component.details.environmentVariables as Record<string, Record<string, boolean>>;
					if (envVars?.core) {
						core.debug(`    Environment variables:`);
						Object.entries(envVars.core).forEach(([key, value]) => {
							core.debug(`      ${key}: ${value ? 'present' : 'missing'}`);
						});
					}
				}
			});
		}

		if (healthCheck.status === "unhealthy") {
			core.error("❌ System health check failed - detailed analysis:");
			healthCheck.criticalIssues.forEach(issue => core.error(`  • ${issue}`));

			// Always show detailed health info for unhealthy status, not just in debug mode
			core.error("🐛 Debug info - All health check components:");
			const monitor = getSystemHealthMonitor();
			const detailedHealth = await monitor.checkSystemHealth();
			detailedHealth.components.forEach(c => {
				const status = c.status === "healthy" ? "✅" : c.status === "degraded" ? "⚠️" : "❌";
				core.error(`  ${status} ${c.component}: ${c.status} - ${c.error || 'No error'}`);

				// Show detailed environment configuration errors
				if (c.component === 'Environment Configuration' && c.status !== "healthy") {
					if (c.details?.missingCoreConfig && Array.isArray(c.details.missingCoreConfig) && c.details.missingCoreConfig.length > 0) {
						core.error(`    ❌ Missing core config: ${c.details.missingCoreConfig.join(', ')}`);
					}
					if (c.details?.platformIssues && Array.isArray(c.details.platformIssues) && c.details.platformIssues.length > 0) {
						core.error(`    ⚠️ Platform issues: ${c.details.platformIssues.join(', ')}`);
					}
					if (c.details?.environmentVariables) {
						const envVars = c.details.environmentVariables as Record<string, Record<string, boolean>>;
						if (envVars?.core) {
							core.error(`    🔧 Environment variables status:`);
							Object.entries(envVars.core).forEach(([key, value]) => {
								const icon = value ? "✅" : "❌";
								core.error(`      ${icon} ${key}: ${value ? 'present' : 'missing'}`);
							});
						}
					}
				}
			});

			core.setFailed(`System health check failed: ${healthCheck.message}`);
			return;
		}

		if (healthCheck.status === "degraded") {
			// Only show degraded warning if there are actual actionable issues
			// Skip warnings for optional components that are simply not configured
			if (healthCheck.criticalIssues.length > 0 || isDebugMode) {
				core.warning(`System health degraded: ${healthCheck.message}`);
				if (isDebugMode) {
					core.warning("🐛 Debug info - Non-critical issues identified");
				}
			} else {
				// Log at info level for optional component warnings
				core.info(`ℹ️ ${healthCheck.message}`);
			}
		} else {
			core.info(`✅ System health check passed: ${healthCheck.message}`);
		}

		// Load and validate configuration
		const _config = getConfiguration();

		// Configuration validation is now handled by the health check system
		core.info("✅ Configuration validated via health check system");

		// Get processing configuration
		const enableLLMEnhancement = core.getBooleanInput("enable_llm_enhancement");
		const enableCodebaseAnalysis = core.getBooleanInput(
			"enable_codebase_analysis",
		);
		const enableDuplicateDetection = core.getBooleanInput(
			"enable_duplicate_detection",
		);
		const isDryRun = core.getBooleanInput("dry_run");

		// Get platform configuration  
		const platform = (core.getInput("platform") || "github").toLowerCase() as "github" | "linear" | "both";

		// Enhanced debug logging
		if (isDebugMode) {
			core.info("🐛 Debug mode enabled - verbose logging active");
			core.debug("Environment variables check:");
			core.debug(`  NODE_ENV: ${process.env.NODE_ENV}`);
			core.debug(`  GITHUB_ACTIONS: ${process.env.GITHUB_ACTIONS}`);
			core.debug(`  RUNNER_OS: ${process.env.RUNNER_OS}`);
			core.debug(`  GITHUB_REPOSITORY: ${process.env.GITHUB_REPOSITORY}`);
		}

		core.info(
			`🔧 Configuration: Platform=${platform}, LLM=${enableLLMEnhancement}, Analysis=${enableCodebaseAnalysis}, Duplicates=${enableDuplicateDetection}, DryRun=${isDryRun}, Debug=${isDebugMode}`,
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
			isDebugMode,
			llmClient,
			codebaseAnalyzer,
			serviceFactory,
			idempotencyService,
			platform,
		};

		// Debug workflow state
		if (isDebugMode) {
			core.debug("🔧 Workflow state initialized:");
			core.debug(`  Platform: ${workflowState.platform}`);
			core.debug(`  TestFlight client: ${!!workflowState.testFlightClient}`);
			core.debug(`  LLM client: ${!!workflowState.llmClient}`);
			core.debug(`  Codebase analyzer: ${!!workflowState.codebaseAnalyzer}`);
			core.debug(`  Service factory: ${!!workflowState.serviceFactory}`);
			core.debug(`  Idempotency service: ${!!workflowState.idempotencyService}`);
			core.debug(`  Processing window: ${workflowState.processingWindow.startTime.toISOString()} to ${workflowState.processingWindow.endTime.toISOString()}`);
		}

		// Get TestFlight feedback with enhanced crash logs
		core.info("📱 Fetching TestFlight feedback...");

		// Get bundle ID from configuration for app resolution
		const config = getConfiguration();
		const { bundleId } = config.appStoreConnect;

		const feedbackData = await testFlightClient.getEnhancedRecentFeedback(
			processingWindow.startTime,
			bundleId,
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

			// Enhanced failure analysis with detailed health check
			const monitor = getSystemHealthMonitor();
			const detailedHealth = await monitor.checkSystemHealth();

			// Only show truly problematic components (unhealthy or critical degraded)
			const criticalComponents = detailedHealth.components.filter(c => {
				if (c.status === "unhealthy") {
					return true;
				}
				if (c.status === "degraded") {
					// Only show degraded components that affect core functionality
					return c.component === "TestFlight Integration" ||
						(c.component === "Environment Configuration" &&
							c.details?.missingCoreConfig &&
							Array.isArray(c.details.missingCoreConfig) &&
							c.details.missingCoreConfig.length > 0);
				}
				return false;
			});

			if (criticalComponents.length > 0) {
				core.error("🔍 Critical component issues at failure:");
				criticalComponents.forEach(component => {
					const status = component.status === "degraded" ? "⚠️" : "❌";
					core.error(`  ${status} ${component.component}: ${component.status}`);
					if (component.error) {
						core.error(`    📋 Error: ${component.error}`);
					}
					// Special handling for Environment Configuration to show missing variables
					if (component.component === 'Environment Configuration' && component.details) {
						if (component.details.missingCoreConfig && Array.isArray(component.details.missingCoreConfig) && component.details.missingCoreConfig.length > 0) {
							core.error(`    ❌ Missing core config: ${component.details.missingCoreConfig.join(', ')}`);
						}
						if (component.details.platformIssues && Array.isArray(component.details.platformIssues) && component.details.platformIssues.length > 0) {
							core.error(`    ⚠️ Platform issues: ${component.details.platformIssues.join(', ')}`);
						}
					}
				});
			} else {
				core.info("ℹ️ All system components are functioning properly - failure is not due to configuration issues");
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
		core.error(`  Platform: ${process.env.INPUT_PLATFORM || process.env.PLATFORM || "github"}`);
		core.error(`  GitHub Repository: ${process.env.GITHUB_REPOSITORY || "unknown"}`);
		core.error(`  Runner OS: ${process.env.RUNNER_OS || "unknown"}`);
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
		isDebugMode,
		platform,
	} = state;

	let issueCreated = false;
	let issueUpdated = false;
	const _issueResult: unknown = null;

	if (isDebugMode) {
		core.debug(`🔍 Processing feedback item: ${feedback.id}`);
		core.debug(`  Type: ${feedback.type}`);
		core.debug(`  App Version: ${feedback.appVersion}`);
		core.debug(`  Build Number: ${feedback.buildNumber}`);
		core.debug(`  Device: ${feedback.deviceInfo.model}`);
		core.debug(`  OS: ${feedback.deviceInfo.osVersion}`);
		core.debug(`  Submitted: ${feedback.submittedAt.toISOString()}`);
	}

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
		let createResult: import('./src/utils/idempotency-service.js').CreateIssueResult | null = null; // For standard issue creation results

		if (enableLLMEnhancement && llmClient) {
			core.info(`🤖 Using LLM enhancement for feedback: ${feedback.id}`);

			// Use LLM enhanced creator
			const enhancedCreator = await import(
				"./src/integrations/llm-enhanced-creator.js"
			).then((m) => m.getLLMEnhancedIssueCreator());

			issueResult = await enhancedCreator.createEnhancedIssue(feedback, {
				platform: platform,
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
					`✅ Enhanced issue created: ${issueResult.github?.issue?.url ||
					issueResult.linear?.issue?.url ||
					"URL not available"
					}`,
				);
			}
		} else {
			// Standard issue creation with platform support
			core.info(`📝 Creating standard issue for feedback: ${feedback.id} on platform: ${platform}`);

			// Use idempotency service which already supports multiple platforms
			const { idempotencyService } = state;
			createResult = await idempotencyService.createIssueWithDuplicateProtection(feedback, {
				preferredPlatform: platform,
				skipDuplicateDetection: !enableDuplicateDetection,
			});

			// Convert CreateIssueResult to IssueCreationResult format for consistency
			if (createResult.processedBy.length > 0) {
				issueCreated = true;
				// Use the first successful result for the URL - convert to IssueCreationResult
				const githubResult = createResult.github;
				const linearResult = createResult.linear;

				if (githubResult) {
					issueResult = {
						id: githubResult.issue.id.toString(),
						url: githubResult.issue.html_url,
						title: githubResult.issue.title,
						number: githubResult.issue.number,
						wasExisting: githubResult.wasExisting || false,
						action: githubResult.wasExisting ? "comment_added" : "created",
						message: `GitHub issue ${githubResult.wasExisting ? "updated" : "created"}: #${githubResult.issue.number}`,
						platform: "github",
					};
				} else if (linearResult) {
					issueResult = {
						id: linearResult.issue.id,
						url: linearResult.issue.url,
						title: linearResult.issue.title,
						identifier: linearResult.issue.identifier,
						wasExisting: linearResult.wasExisting || false,
						action: linearResult.wasExisting ? "comment_added" : "created",
						message: `Linear issue ${linearResult.wasExisting ? "updated" : "created"}: ${linearResult.issue.identifier}`,
						platform: "linear",
					};
				}

				if (!issueResult) {
					// Fallback to constructing a basic result
					issueResult = {
						id: "unknown",
						url: "unknown",
						title: "Issue created",
						platform: platform === "both" ? "github" : platform,
						wasExisting: false,
						action: "created",
						message: `Issue created on ${createResult.processedBy.join(", ")}`,
					};
				}
				core.info(`✅ Standard issue created on ${createResult.processedBy.join(", ")}`);
			} else {
				core.error(`❌ Failed to create issue on any platform. Errors: ${createResult.errors.join("; ")}`);
			}
		}

		// Extract URL from different result types
		let issueUrl = "";
		if (issueResult) {
			if ("url" in issueResult) {
				// IssueCreationResult from standard issue creation
				issueUrl = issueResult.url;
			} else if ("github" in issueResult || "linear" in issueResult) {
				// EnhancedIssueCreationResult from LLM enhancement
				issueUrl =
					issueResult.github?.issue?.url ||
					issueResult.linear?.issue?.url ||
					"";
			}
		}

		// For standard issue creation using idempotency service, also check the createResult
		if (!issueUrl && createResult && typeof issueResult === "object" && "processedBy" in createResult) {
			if (createResult.github?.issue) {
				issueUrl = createResult.github.issue.html_url;
			} else if (createResult.linear?.issue) {
				issueUrl = createResult.linear.issue.url;
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
