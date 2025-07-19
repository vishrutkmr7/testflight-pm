#!/usr/bin/env bun

/**
 * TestFlight PM GitHub Action Entry Point
 * Main script that runs when the action is executed
 */

import { getAuthInstance } from "./src/api/app-store-connect-auth.js";
import { validateLinearConfig } from "./src/api/linear-client.js";
import { getTestFlightClient } from "./src/api/testflight-client.js";
import { ACTION_DEFAULTS, DEFAULT_LABELS } from "./src/config/constants.js";
import { getConfig } from "./src/config/environment.js";
import type { LinearIssueCreationOptions } from "./src/utils/linear-utils.js";
import {
	createLinearIssueFromFeedback,
	determineFeedbackPriority,
	generateFeedbackLabels,
	getLinearIntegrationHealth,
} from "./src/utils/linear-utils.js";
import type { ProcessedFeedbackData } from "./types/testflight.js";

interface ActionInputs {
	createGithubIssues: boolean;
	createLinearIssues: boolean;
	monitorSince?: string;
	maxIssuesPerRun: number;
	feedbackTypes: "crashes" | "screenshots" | "all";
	issueLabels: string[];
	crashIssueLabels: string[];
	feedbackIssueLabels: string[];
	duplicateDetection: boolean;
	includeDeviceInfo: boolean;
	includeAppVersion: boolean;
	dryRun: boolean;
}

interface ActionOutputs {
	issuesCreated: number;
	crashesProcessed: number;
	feedbackProcessed: number;
	errorsEncountered: number;
	summary: string;
}

/**
 * GitHub Actions output functions
 */
function setOutput(name: string, value: string): void {
	console.log(`::set-output name=${name}::${value}`);
}

function setInfo(message: string): void {
	console.log(`::notice::${message}`);
}

function setWarning(message: string): void {
	console.log(`::warning::${message}`);
}

function setError(message: string): void {
	console.log(`::error::${message}`);
}

function _setDebug(message: string): void {
	console.log(`::debug::${message}`);
}

/**
 * Parse action inputs from environment variables
 */
function parseActionInputs(): ActionInputs {
	return {
		createGithubIssues:
			process.env.INPUT_CREATE_GITHUB_ISSUES?.toLowerCase() === "true",
		createLinearIssues:
			process.env.INPUT_CREATE_LINEAR_ISSUES?.toLowerCase() === "true",
		monitorSince: process.env.INPUT_MONITOR_SINCE,
		maxIssuesPerRun: Number.parseInt(
			process.env.INPUT_MAX_ISSUES_PER_RUN ||
				ACTION_DEFAULTS.MAX_ISSUES_PER_RUN.toString(),
			10,
		),
		feedbackTypes:
			(process.env.INPUT_FEEDBACK_TYPES as "crashes" | "screenshots" | "all") ||
			ACTION_DEFAULTS.FEEDBACK_TYPES,
		issueLabels: (
			process.env.INPUT_ISSUE_LABELS || DEFAULT_LABELS.BASE.join(",")
		)
			.split(",")
			.map((l) => l.trim()),
		crashIssueLabels: (
			process.env.INPUT_CRASH_ISSUE_LABELS || DEFAULT_LABELS.CRASH.join(",")
		)
			.split(",")
			.map((l) => l.trim()),
		feedbackIssueLabels: (
			process.env.INPUT_FEEDBACK_ISSUE_LABELS ||
			DEFAULT_LABELS.FEEDBACK.join(",")
		)
			.split(",")
			.map((l) => l.trim()),
		duplicateDetection:
			(
				process.env.INPUT_DUPLICATE_DETECTION ||
				ACTION_DEFAULTS.DUPLICATE_DETECTION.toString()
			).toLowerCase() === "true",
		includeDeviceInfo:
			(
				process.env.INPUT_INCLUDE_DEVICE_INFO ||
				ACTION_DEFAULTS.INCLUDE_DEVICE_INFO.toString()
			).toLowerCase() === "true",
		includeAppVersion:
			(
				process.env.INPUT_INCLUDE_APP_VERSION ||
				ACTION_DEFAULTS.INCLUDE_APP_VERSION.toString()
			).toLowerCase() === "true",
		dryRun:
			(
				process.env.INPUT_DRY_RUN || ACTION_DEFAULTS.DRY_RUN.toString()
			).toLowerCase() === "true",
	};
}

/**
 * Determines monitoring start date
 */
function getMonitoringSince(inputs: ActionInputs): Date {
	if (inputs.monitorSince) {
		try {
			return new Date(inputs.monitorSince);
		} catch (_error) {
			setWarning(
				`Invalid monitor-since date: ${inputs.monitorSince}. Using default (24 hours ago).`,
			);
		}
	}

	// Default to 24 hours ago
	const since = new Date();
	since.setHours(since.getHours() - 24);
	return since;
}

/**
 * Filters feedback based on input configuration
 */
function filterFeedback(
	allFeedback: ProcessedFeedbackData[],
	inputs: ActionInputs,
): ProcessedFeedbackData[] {
	let filtered = allFeedback;

	// Filter by feedback type
	if (inputs.feedbackTypes !== "all") {
		if (inputs.feedbackTypes === "crashes") {
			filtered = filtered.filter((f) => f.type === "crash");
		} else if (inputs.feedbackTypes === "screenshots") {
			filtered = filtered.filter((f) => f.type === "screenshot");
		}
	}

	// Limit the number of items to process
	if (filtered.length > inputs.maxIssuesPerRun) {
		setWarning(
			`Found ${filtered.length} feedback items, but limiting to ${inputs.maxIssuesPerRun} per action run.`,
		);
		filtered = filtered.slice(0, inputs.maxIssuesPerRun);
	}

	return filtered;
}

/**
 * Generates issue title with configurable options
 */
function generateIssueTitle(
	feedback: ProcessedFeedbackData,
	inputs: ActionInputs,
): string {
	const typeIcon = feedback.type === "crash" ? "💥" : "📱";
	const typeLabel = feedback.type === "crash" ? "Crash" : "Feedback";

	let title = `${typeIcon} ${typeLabel}`;

	if (inputs.includeAppVersion) {
		title += `: ${feedback.appVersion}`;
		if (feedback.buildNumber) {
			title += ` (${feedback.buildNumber})`;
		}
	}

	if (feedback.type === "crash" && feedback.crashData?.exceptionType) {
		title += ` - ${feedback.crashData.exceptionType}`;
	} else if (feedback.type === "screenshot" && feedback.screenshotData?.text) {
		const shortText = feedback.screenshotData.text.substring(0, 50);
		title += ` - ${shortText}${shortText.length < feedback.screenshotData.text.length ? "..." : ""}`;
	}

	if (inputs.includeDeviceInfo) {
		title += ` (${feedback.deviceInfo.model})`;
	}

	return title;
}

/**
 * Create GitHub issue (placeholder - will be implemented when GitHub API integration is ready)
 */
async function createGitHubIssue(
	feedback: ProcessedFeedbackData,
	inputs: ActionInputs,
): Promise<boolean> {
	if (inputs.dryRun) {
		setInfo(
			`[DRY RUN] Would create GitHub issue: ${generateIssueTitle(feedback, inputs)}`,
		);
		return true;
	}

	// TODO: Implement GitHub Issues API integration (VJ-17)
	setWarning(
		"GitHub Issues integration not yet implemented. Issue creation skipped.",
	);
	return false;
}

/**
 * Create Linear issue using the new Linear integration
 */
async function createLinearIssue(
	feedback: ProcessedFeedbackData,
	inputs: ActionInputs,
): Promise<boolean> {
	if (inputs.dryRun) {
		setInfo(
			`[DRY RUN] Would create Linear issue: ${generateIssueTitle(feedback, inputs)}`,
		);
		return true;
	}

	try {
		// Check if Linear is configured
		if (!validateLinearConfig()) {
			setWarning(
				"Linear integration not configured. Please set LINEAR_API_TOKEN and LINEAR_TEAM_ID.",
			);
			return false;
		}

		// Determine priority and labels based on feedback type
		const priority = determineFeedbackPriority(feedback);
		const feedbackLabels = generateFeedbackLabels(feedback);

		// Combine with action-configured labels
		const baseLabels = [...inputs.issueLabels];
		if (feedback.type === "crash") {
			baseLabels.push(...inputs.crashIssueLabels);
		} else {
			baseLabels.push(...inputs.feedbackIssueLabels);
		}

		const allLabels = [...new Set([...baseLabels, ...feedbackLabels])]; // Remove duplicates

		const options: LinearIssueCreationOptions = {
			priority,
			additionalLabels: allLabels,
			enableDuplicateDetection: inputs.duplicateDetection,
		};

		const result = await createLinearIssueFromFeedback(feedback, options);

		setInfo(`✅ ${result.message}`);

		if (result.action === "created") {
			setInfo(`📋 Linear issue created: ${result.issue.url}`);
		} else {
			setInfo(`💬 Added comment to existing Linear issue: ${result.issue.url}`);
		}

		return true;
	} catch (error) {
		setError(`Failed to create Linear issue: ${error}`);
		return false;
	}
}

/**
 * Main action runner
 */
async function runAction(): Promise<ActionOutputs> {
	const outputs: ActionOutputs = {
		issuesCreated: 0,
		crashesProcessed: 0,
		feedbackProcessed: 0,
		errorsEncountered: 0,
		summary: "",
	};

	try {
		setInfo("🚀 Starting TestFlight PM Action");

		// Parse inputs
		const inputs = parseActionInputs();
		const since = getMonitoringSince(inputs);

		setInfo(
			`📊 Configuration: ${inputs.feedbackTypes} feedback since ${since.toISOString()}`,
		);
		setInfo(
			`🎯 Targets: GitHub=${inputs.createGithubIssues}, Linear=${inputs.createLinearIssues}`,
		);

		if (inputs.dryRun) {
			setInfo("🧪 Running in DRY RUN mode - no issues will be created");
		}

		// Validate configuration
		const _config = getConfig();
		setInfo("✅ Configuration loaded and validated");

		// Check Linear health if enabled
		if (inputs.createLinearIssues) {
			setInfo("🔍 Checking Linear integration health...");
			const linearHealth = await getLinearIntegrationHealth();

			if (linearHealth.status === "unhealthy") {
				setError(
					`Linear integration is unhealthy: ${JSON.stringify(linearHealth.details)}`,
				);
				if (linearHealth.recommendations) {
					for (const rec of linearHealth.recommendations) {
						setWarning(`💡 Recommendation: ${rec}`);
					}
				}
				outputs.errorsEncountered++;
				return outputs;
			}
			if (linearHealth.status === "degraded") {
				setWarning(
					`Linear integration is degraded: ${JSON.stringify(linearHealth.details)}`,
				);
				if (linearHealth.recommendations) {
					for (const rec of linearHealth.recommendations) {
						setWarning(`💡 Recommendation: ${rec}`);
					}
				}
			} else {
				setInfo(
					`✅ Linear integration healthy: ${linearHealth.details.teamName} (${linearHealth.details.currentUser})`,
				);
			}
		}

		// Test authentication
		setInfo("🔐 Testing App Store Connect authentication...");
		const authInstance = getAuthInstance();
		await authInstance.getValidToken();
		setInfo("✅ App Store Connect authentication successful");

		// Initialize TestFlight client
		setInfo("📱 Initializing TestFlight data client...");
		const testFlightClient = getTestFlightClient();

		// Fetch feedback
		setInfo(`📥 Fetching TestFlight feedback since ${since.toISOString()}...`);
		const allFeedback = await testFlightClient.getRecentFeedback(since);
		setInfo(`📊 Found ${allFeedback.length} total feedback items`);

		if (allFeedback.length === 0) {
			setInfo("ℹ️ No feedback found for the specified period");
			outputs.summary = JSON.stringify(
				{
					feedbackItemsFound: 0,
					feedbackItemsProcessed: 0,
					crashReports: 0,
					userFeedback: 0,
					issuesCreated: 0,
					errorsEncountered: 0,
					monitoringSince: since.toISOString(),
					dryRun: inputs.dryRun,
				},
				null,
				2,
			);
			return outputs;
		}

		// Filter feedback based on inputs
		const feedbackToProcess = filterFeedback(allFeedback, inputs);
		setInfo(`🔄 Processing ${feedbackToProcess.length} feedback items`);

		// Count by type
		const crashes = feedbackToProcess.filter((f) => f.type === "crash");
		const screenshots = feedbackToProcess.filter(
			(f) => f.type === "screenshot",
		);
		outputs.crashesProcessed = crashes.length;
		outputs.feedbackProcessed = screenshots.length;

		setInfo(
			`📋 Breakdown: ${crashes.length} crash reports, ${screenshots.length} user feedback items`,
		);

		// Process each feedback item
		for (const feedback of feedbackToProcess) {
			try {
				setInfo(`Processing ${feedback.type} feedback: ${feedback.id}`);

				let issueCreated = false;

				// Create GitHub issue if requested
				if (inputs.createGithubIssues) {
					const success = await createGitHubIssue(feedback, inputs);
					if (success) issueCreated = true;
				}

				// Create Linear issue if requested
				if (inputs.createLinearIssues) {
					const success = await createLinearIssue(feedback, inputs);
					if (success) issueCreated = true;
				}

				if (issueCreated) {
					outputs.issuesCreated++;
				}
			} catch (error) {
				setError(`Failed to process feedback ${feedback.id}: ${error}`);
				outputs.errorsEncountered++;
			}
		}

		// Generate summary
		const summary = {
			feedbackItemsFound: allFeedback.length,
			feedbackItemsProcessed: feedbackToProcess.length,
			crashReports: outputs.crashesProcessed,
			userFeedback: outputs.feedbackProcessed,
			issuesCreated: outputs.issuesCreated,
			errorsEncountered: outputs.errorsEncountered,
			monitoringSince: since.toISOString(),
			dryRun: inputs.dryRun,
		};

		outputs.summary = JSON.stringify(summary, null, 2);

		setInfo("✅ TestFlight PM Action completed successfully");
		setInfo(
			`📊 Summary: ${outputs.issuesCreated} issues created, ${outputs.errorsEncountered} errors`,
		);
	} catch (error) {
		setError(`Action failed: ${error}`);
		outputs.errorsEncountered++;
		throw error;
	}

	return outputs;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
	try {
		const outputs = await runAction();

		// Set GitHub Actions outputs
		setOutput("issues-created", outputs.issuesCreated.toString());
		setOutput("crashes-processed", outputs.crashesProcessed.toString());
		setOutput("feedback-processed", outputs.feedbackProcessed.toString());
		setOutput("errors-encountered", outputs.errorsEncountered.toString());
		setOutput("summary", outputs.summary);

		// Exit with appropriate code
		process.exit(outputs.errorsEncountered > 0 ? 1 : 0);
	} catch (error) {
		setError(`Fatal error: ${error}`);
		process.exit(1);
	}
}

// Run the action if this file is the main module
if (import.meta.main) {
	main();
}
