/**
 * Linear Integration Utilities
 * High-level utilities for Linear issue creation and management from TestFlight feedback
 */

import type { LinearIssue, LinearPriority } from "../../types/linear.js";
import type { ProcessedFeedbackData } from "../../types/testflight.js";
import { getLinearClient, validateLinearConfig } from "../api/linear-client.js";
import { DEFAULT_LABEL_CONFIG } from "../config/index.js";

export interface LinearIssueCreationOptions {
	priority?: LinearPriority;
	assigneeId?: string;
	projectId?: string;
	additionalLabels?: string[];
	enableDuplicateDetection?: boolean;
	customTitle?: string;
	customDescription?: string;
}

export interface LinearIssueCreationResult {
	issue: LinearIssue;
	wasExisting: boolean;
	action: "created" | "updated" | "comment_added";
	message: string;
}

export interface LinearWorkflowConfig {
	crashPriority: LinearPriority;
	feedbackPriority: LinearPriority;
	autoAssigneeId?: string;
	defaultProjectId?: string;
	enableAutoTransitions: boolean;
	duplicateDetectionDays: number;
}

/**
 * Creates a Linear issue from TestFlight feedback with intelligent handling
 */
export async function createLinearIssueFromFeedback(
	feedback: ProcessedFeedbackData,
	options: LinearIssueCreationOptions = {},
): Promise<LinearIssueCreationResult> {
	if (!validateLinearConfig()) {
		throw new Error(
			"Linear is not configured. Please set LINEAR_API_TOKEN and LINEAR_TEAM_ID.",
		);
	}

	const client = getLinearClient();

	try {
		const issue = await client.createIssueFromTestFlight(
			feedback,
			options.additionalLabels || [],
			options.assigneeId,
			options.projectId,
		);

		// Check if this was a new issue or an update to existing
		const wasExisting =
			options.enableDuplicateDetection !== false &&
			(await client.findDuplicateIssue(feedback)) !== null;

		return {
			issue,
			wasExisting,
			action: wasExisting ? "comment_added" : "created",
			message: wasExisting
				? `Added comment to existing issue ${issue.identifier}`
				: `Created new issue ${issue.identifier}`,
		};
	} catch (error) {
		throw new Error(
			`Failed to create Linear issue from TestFlight feedback: ${error}`,
		);
	}
}

/**
 * Batch creates Linear issues from multiple TestFlight feedback items
 */
export async function createLinearIssuesFromFeedbackBatch(
	feedbackItems: ProcessedFeedbackData[],
	options: LinearIssueCreationOptions = {},
	maxConcurrent = 5,
): Promise<LinearIssueCreationResult[]> {
	if (!validateLinearConfig()) {
		throw new Error(
			"Linear is not configured. Please set LINEAR_API_TOKEN and LINEAR_TEAM_ID.",
		);
	}

	const results: LinearIssueCreationResult[] = [];
	const errors: Array<{ feedback: ProcessedFeedbackData; error: Error }> = [];

	// Process in batches to avoid overwhelming the API
	for (let i = 0; i < feedbackItems.length; i += maxConcurrent) {
		const batch = feedbackItems.slice(i, i + maxConcurrent);

		const batchPromises = batch.map(async (feedback) => {
			try {
				return await createLinearIssueFromFeedback(feedback, options);
			} catch (error) {
				errors.push({ feedback, error: error as Error });
				return null;
			}
		});

		const batchResults = await Promise.all(batchPromises);
		results.push(
			...(batchResults.filter(
				(result) => result !== null,
			) as LinearIssueCreationResult[]),
		);

		// Add small delay between batches to be respectful to the API
		if (i + maxConcurrent < feedbackItems.length) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	if (errors.length > 0) {
		console.warn(`Failed to create ${errors.length} Linear issues:`, errors);
	}

	return results;
}

/**
 * Updates the status of a Linear issue based on TestFlight feedback analysis
 */
export async function updateLinearIssueStatus(
	issueId: string,
	status: "backlog" | "todo" | "in_progress" | "done" | "canceled",
): Promise<LinearIssue> {
	if (!validateLinearConfig()) {
		throw new Error(
			"Linear is not configured. Please set LINEAR_API_TOKEN and LINEAR_TEAM_ID.",
		);
	}

	const client = getLinearClient();

	try {
		return await client.updateIssueStatus(issueId, status);
	} catch (error) {
		throw new Error(`Failed to update Linear issue status: ${error}`);
	}
}

/**
 * Adds a follow-up comment to a Linear issue
 */
export async function addLinearIssueComment(
	issueId: string,
	comment: string,
	includeTimestamp = true,
): Promise<void> {
	if (!validateLinearConfig()) {
		throw new Error(
			"Linear is not configured. Please set LINEAR_API_TOKEN and LINEAR_TEAM_ID.",
		);
	}

	const client = getLinearClient();

	try {
		let finalComment = comment;
		if (includeTimestamp) {
			finalComment = `${comment}\n\n*Updated: ${new Date().toISOString()}*`;
		}

		await client.addCommentToIssue(issueId, finalComment);
	} catch (error) {
		throw new Error(`Failed to add comment to Linear issue: ${error}`);
	}
}

/**
 * Determines the appropriate priority for a TestFlight feedback item
 */
export function determineFeedbackPriority(
	feedback: ProcessedFeedbackData,
): LinearPriority {
	// Crash reports get higher priority
	if (feedback.type === "crash") {
		if (feedback.crashData?.exceptionType?.toLowerCase().includes("fatal")) {
			return 1; // Urgent
		}
		if (
			feedback.crashData?.exceptionType
				?.toLowerCase()
				.includes("out of memory") ||
			feedback.crashData?.exceptionType
				?.toLowerCase()
				.includes("segmentation fault")
		) {
			return 2; // High
		}
		return 2; // High for other crashes
	}

	// Screenshot feedback priority based on content
	if (feedback.type === "screenshot" && feedback.screenshotData?.text) {
		const text = feedback.screenshotData.text.toLowerCase();

		// Look for urgent keywords
		if (
			text.includes("crash") ||
			text.includes("broken") ||
			text.includes("not working") ||
			text.includes("urgent") ||
			text.includes("critical") ||
			text.includes("blocking")
		) {
			return 2; // High
		}

		// Look for enhancement keywords
		if (
			text.includes("feature") ||
			text.includes("improvement") ||
			text.includes("suggest") ||
			text.includes("would be nice") ||
			text.includes("could you")
		) {
			return 4; // Low
		}

		return 3; // Normal
	}

	return 3; // Normal default
}

/**
 * Generates appropriate labels for a TestFlight feedback item
 */
export function generateFeedbackLabels(
	feedback: ProcessedFeedbackData,
): string[] {
	const labels: string[] = ["testflight"];

	// Type-based labels
	if (feedback.type === "crash") {
		labels.push(...DEFAULT_LABEL_CONFIG.crashLabels);

		// Severity-based labels
		if (feedback.crashData?.exceptionType?.toLowerCase().includes("fatal")) {
			labels.push("critical");
		}
	} else if (feedback.type === "screenshot") {
		labels.push("user-feedback");

		// Content-based labels
		if (feedback.screenshotData?.text) {
			const text = feedback.screenshotData.text.toLowerCase();

			if (
				text.includes("ui") ||
				text.includes("interface") ||
				text.includes("design")
			) {
				labels.push("ui-ux");
			}

			if (text.includes("feature") || text.includes("improvement")) {
				labels.push("enhancement");
			}

			if (
				text.includes("bug") ||
				text.includes("broken") ||
				text.includes("not working")
			) {
				labels.push("bug");
			}
		}
	}

	// Platform/device-based labels
	if (feedback.deviceInfo.family.toLowerCase().includes("iphone")) {
		labels.push("ios", "iphone");
	} else if (feedback.deviceInfo.family.toLowerCase().includes("ipad")) {
		labels.push("ios", "ipad");
	}

	// Version-based labels
	const majorVersion = feedback.appVersion.split(".")[0];
	if (majorVersion) {
		labels.push(`v${majorVersion}`);
	}

	return labels;
}

/**
 * Formats TestFlight feedback for Linear issue description
 */
export function formatFeedbackForLinear(feedback: ProcessedFeedbackData): {
	title: string;
	description: string;
} {
	const isCrash = feedback.type === "crash";
	const typeIcon = isCrash ? "💥" : "📱";
	const typeLabel = isCrash ? "Crash Report" : "User Feedback";

	// Enhanced title with more context
	let title = `${typeIcon} ${typeLabel}: ${feedback.appVersion}`;

	if (isCrash && feedback.crashData?.exceptionType) {
		title += ` - ${feedback.crashData.exceptionType}`;
	} else if (feedback.screenshotData?.text) {
		const shortText = feedback.screenshotData.text.substring(0, 40).trim();
		title += ` - ${shortText}${shortText.length < feedback.screenshotData.text.length ? "..." : ""}`;
	}

	// Comprehensive description with metadata
	let description = `## ${typeLabel} from TestFlight\n\n`;

	// Feedback metadata table
	description += "| Field | Value |\n";
	description += "|-------|-------|\n";
	description += `| **TestFlight ID** | \`${feedback.id}\` |\n`;
	description += `| **App Version** | ${feedback.appVersion} (Build ${feedback.buildNumber}) |\n`;
	description += `| **Submitted** | ${feedback.submittedAt.toISOString()} |\n`;
	description += `| **Device** | ${feedback.deviceInfo.model} |\n`;
	description += `| **OS Version** | ${feedback.deviceInfo.osVersion} |\n`;
	description += `| **Locale** | ${feedback.deviceInfo.locale} |\n\n`;

	if (isCrash && feedback.crashData) {
		description += "## 🔍 Crash Analysis\n\n";
		description += `**Crash Type:** ${feedback.crashData.type}\n\n`;

		if (feedback.crashData.exceptionType) {
			description += `**Exception Type:** \`${feedback.crashData.exceptionType}\`\n\n`;
		}

		if (feedback.crashData.exceptionMessage) {
			description += `**Exception Message:**\n\`\`\`\n${feedback.crashData.exceptionMessage}\n\`\`\`\n\n`;
		}

		description += `### Stack Trace\n\`\`\`\n${feedback.crashData.trace}\n\`\`\`\n\n`;

		if (feedback.crashData.logs.length > 0) {
			description += "### Crash Logs\n";
			feedback.crashData.logs.forEach((log, index) => {
				description += `- [Crash Log ${index + 1}](${log.url}) (expires: ${log.expiresAt.toLocaleDateString()})\n`;
			});
			description += "\n";
		}
	}

	if (feedback.screenshotData) {
		description += "## 📝 User Feedback\n\n";

		if (feedback.screenshotData.text) {
			description += "### Feedback Text\n";
			description += `> ${feedback.screenshotData.text.replace(/\n/g, "\n> ")}\n\n`;
		}

		// ENHANCEMENT: Add system context for screenshot feedback
		if (feedback.screenshotData.systemInfo) {
			description += "### 📊 System Context at Feedback\n\n";
			const sysInfo = feedback.screenshotData.systemInfo;

			description += "| Context | Value |\n";
			description += "|---------|-------|\n";

			if (sysInfo.applicationState) {
				const stateIcon = sysInfo.applicationState === "foreground" ? "🟢" :
					sysInfo.applicationState === "background" ? "🟡" : "🔴";
				description += `| ${stateIcon} **App State** | ${sysInfo.applicationState} |\n`;
			}

			if (sysInfo.batteryLevel !== undefined) {
				const batteryIcon = sysInfo.batteryLevel < 20 ? "🪫" : sysInfo.batteryLevel < 50 ? "🔋" : "🔋";
				description += `| ${batteryIcon} **Battery** | ${sysInfo.batteryLevel}% |\n`;
			}

			if (sysInfo.memoryPressure) {
				const memoryIcon = sysInfo.memoryPressure === "critical" ? "🚨" :
					sysInfo.memoryPressure === "warning" ? "⚠️" : "✅";
				description += `| ${memoryIcon} **Memory** | ${sysInfo.memoryPressure} |\n`;
			}

			if (sysInfo.thermalState) {
				const thermalIcon = sysInfo.thermalState === "critical" ? "🔥" :
					sysInfo.thermalState === "serious" ? "🌡️" : "❄️";
				description += `| ${thermalIcon} **Thermal** | ${sysInfo.thermalState} |\n`;
			}

			if (sysInfo.diskSpaceRemaining !== undefined) {
				const spaceGB = Math.round((sysInfo.diskSpaceRemaining / (1024 ** 3)) * 10) / 10;
				const spaceIcon = spaceGB < 1 ? "💾" : "💿";
				description += `| ${spaceIcon} **Free Space** | ${spaceGB}GB |\n`;
			}

			description += "\n";
		}

		if (feedback.screenshotData.submissionMethod) {
			description += `### Submission Method\n${feedback.screenshotData.submissionMethod}\n\n`;
		}

		if (feedback.screenshotData.testerNotes) {
			description += "### Tester Notes\n";
			description += `> ${feedback.screenshotData.testerNotes.replace(/\n/g, "\n> ")}\n\n`;
		}

		if (feedback.screenshotData.images.length > 0) {
			description += `### Screenshots (${feedback.screenshotData.images.length})\n`;
			feedback.screenshotData.images.forEach((image, _index) => {
				description += `- [${image.fileName}](${image.url}) (${Math.round(image.fileSize / 1024)}KB, expires: ${image.expiresAt.toLocaleDateString()})\n`;
			});
			description += "\n";
		}

		if (
			feedback.screenshotData.annotations &&
			feedback.screenshotData.annotations.length > 0
		) {
			description += "### Annotations\n";
			description += `User provided ${feedback.screenshotData.annotations.length} annotation(s) on screenshots.\n\n`;
		}
	}

	// Debugging information
	description += "## 🛠️ Technical Details\n\n";
	description +=
		"<details>\n<summary>Device & Environment Information</summary>\n\n";
	description += `- **Device Family:** ${feedback.deviceInfo.family}\n`;
	description += `- **Device Model:** ${feedback.deviceInfo.model}\n`;
	description += `- **OS Version:** ${feedback.deviceInfo.osVersion}\n`;
	description += `- **Locale:** ${feedback.deviceInfo.locale}\n`;
	description += `- **Bundle ID:** ${feedback.bundleId}\n`;
	description += `- **Submission Time:** ${feedback.submittedAt.toISOString()}\n`;
	description += "\n</details>\n\n";

	// Auto-generated footer
	description += "---\n";
	description += `*This issue was automatically created from TestFlight feedback. Original submission ID: \`${feedback.id}\`*`;

	return { title, description };
}

/**
 * Validates that all required Linear configuration is present
 */
export function validateLinearIntegration(): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	if (!validateLinearConfig()) {
		errors.push(
			"Linear configuration missing. Please set LINEAR_API_TOKEN and LINEAR_TEAM_ID.",
		);
	}

	// Additional validation could be added here
	// e.g., API connectivity test, team access verification, etc.

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Gets health status of Linear integration
 */
export async function getLinearIntegrationHealth(): Promise<{
	status: "healthy" | "degraded" | "unhealthy";
	details: {
		teamName?: string;
		teamKey?: string;
		currentUser?: string;
		configuredTeamId?: string;
		error?: string;
		timestamp: string;
	};
	recommendations?: string[];
}> {
	try {
		const validation = validateLinearIntegration();
		if (!validation.valid) {
			return {
				status: "unhealthy",
				details: {
					error: validation.errors.join(", "),
					timestamp: new Date().toISOString(),
				},
				recommendations: [
					"Set LINEAR_API_TOKEN environment variable",
					"Set LINEAR_TEAM_ID environment variable",
					"Verify Linear API access permissions",
				],
			};
		}

		const client = getLinearClient();
		const healthCheck = await client.healthCheck();

		return {
			status: healthCheck.status === "healthy" ? "healthy" : "degraded",
			details: healthCheck.details,
			recommendations:
				healthCheck.status !== "healthy"
					? [
						"Verify Linear API token is valid",
						"Check Linear team ID is correct",
						"Ensure network connectivity to Linear API",
					]
					: undefined,
		};
	} catch (error) {
		return {
			status: "unhealthy",
			details: {
				error: (error as Error).message,
				timestamp: new Date().toISOString(),
			},
			recommendations: [
				"Check Linear API connectivity",
				"Verify authentication credentials",
				"Review Linear workspace permissions",
			],
		};
	}
}
