/**
 * GitHub Integration Utilities
 * High-level utilities for GitHub issue creation and management from TestFlight feedback
 */

import type {
	GitHubIssue,
	GitHubIssueCreationOptions,
	GitHubIssueCreationResult,
	GitHubPriority,
} from "../../types/github.js";
import type { ProcessedFeedbackData } from "../../types/testflight.js";
import { getGitHubClient, validateGitHubConfig } from "../api/github-client.js";
import { DEFAULT_LABELS, ERROR_MESSAGES } from "../config/constants.js";

/**
 * Creates a GitHub issue from TestFlight feedback with intelligent handling
 */
export async function createGitHubIssueFromFeedback(
	feedback: ProcessedFeedbackData,
	options: GitHubIssueCreationOptions = {},
): Promise<GitHubIssueCreationResult> {
	if (!validateGitHubConfig()) {
		throw new Error(ERROR_MESSAGES.GITHUB_CONFIG_MISSING);
	}

	const client = getGitHubClient();

	try {
		return await client.createIssueFromTestFlight(feedback, {
			...options,
			additionalLabels: [
				...generateFeedbackLabels(feedback),
				...(options.additionalLabels || []),
			],
		});
	} catch (error) {
		throw new Error(
			`Failed to create GitHub issue from TestFlight feedback: ${error}`,
		);
	}
}

/**
 * Batch creates GitHub issues from multiple TestFlight feedback items
 */
export async function createGitHubIssuesFromFeedbackBatch(
	feedbackItems: ProcessedFeedbackData[],
	options: GitHubIssueCreationOptions = {},
	maxConcurrent = 3, // Lower than Linear to respect GitHub rate limits
): Promise<GitHubIssueCreationResult[]> {
	if (!validateGitHubConfig()) {
		throw new Error(ERROR_MESSAGES.GITHUB_CONFIG_MISSING);
	}

	const results: GitHubIssueCreationResult[] = [];
	const errors: Array<{ feedback: ProcessedFeedbackData; error: Error }> = [];

	// Process in smaller batches to respect GitHub rate limits
	for (let i = 0; i < feedbackItems.length; i += maxConcurrent) {
		const batch = feedbackItems.slice(i, i + maxConcurrent);

		const batchPromises = batch.map(async (feedback) => {
			try {
				return await createGitHubIssueFromFeedback(feedback, options);
			} catch (error) {
				errors.push({ feedback, error: error as Error });
				return null;
			}
		});

		const batchResults = await Promise.all(batchPromises);
		results.push(
			...(batchResults.filter(
				(result) => result !== null,
			) as GitHubIssueCreationResult[]),
		);

		// Add delay between batches to be respectful to GitHub API
		if (i + maxConcurrent < feedbackItems.length) {
			await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay
		}
	}

	if (errors.length > 0) {
		console.warn(`Failed to create ${errors.length} GitHub issues:`, errors);
	}

	return results;
}

/**
 * Updates the status of a GitHub issue
 */
export async function updateGitHubIssueStatus(
	issueNumber: number,
	state: "open" | "closed",
	stateReason?: "completed" | "reopened" | "not_planned",
): Promise<GitHubIssue> {
	if (!validateGitHubConfig()) {
		throw new Error(ERROR_MESSAGES.GITHUB_CONFIG_MISSING);
	}

	const client = getGitHubClient();

	try {
		return await client.updateIssue(issueNumber, {
			state,
			state_reason: stateReason,
		});
	} catch (error) {
		throw new Error(`Failed to update GitHub issue status: ${error}`);
	}
}

/**
 * Adds a follow-up comment to a GitHub issue
 */
export async function addGitHubIssueComment(
	issueNumber: number,
	comment: string,
	includeTimestamp = true,
): Promise<void> {
	if (!validateGitHubConfig()) {
		throw new Error(ERROR_MESSAGES.GITHUB_CONFIG_MISSING);
	}

	const client = getGitHubClient();

	try {
		let finalComment = comment;
		if (includeTimestamp) {
			finalComment = `${comment}\n\n*Updated: ${new Date().toISOString()}*`;
		}

		await client.addCommentToIssue(issueNumber, finalComment);
	} catch (error) {
		throw new Error(`Failed to add comment to GitHub issue: ${error}`);
	}
}

/**
 * Determines the appropriate priority for a TestFlight feedback item
 */
export function determineFeedbackPriority(
	feedback: ProcessedFeedbackData,
): GitHubPriority {
	// Crash reports get higher priority
	if (feedback.type === "crash") {
		if (
			feedback.crashData?.exceptionType?.toLowerCase().includes("fatal") ||
			feedback.crashData?.exceptionType?.toLowerCase().includes("abort")
		) {
			return "urgent";
		}
		if (
			feedback.crashData?.exceptionType
				?.toLowerCase()
				.includes("out of memory") ||
			feedback.crashData?.exceptionType
				?.toLowerCase()
				.includes("segmentation fault") ||
			feedback.crashData?.exceptionType
				?.toLowerCase()
				.includes("access violation")
		) {
			return "high";
		}
		return "high"; // All other crashes are high priority
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
			text.includes("blocking") ||
			text.includes("can't") ||
			text.includes("cannot") ||
			text.includes("won't") ||
			text.includes("error") ||
			text.includes("bug")
		) {
			return "high";
		}

		// Look for enhancement keywords
		if (
			text.includes("feature") ||
			text.includes("improvement") ||
			text.includes("suggest") ||
			text.includes("would be nice") ||
			text.includes("could you") ||
			text.includes("wish") ||
			text.includes("enhancement") ||
			text.includes("add")
		) {
			return "low";
		}

		return "normal";
	}

	return "normal"; // Default priority
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
		labels.push(...DEFAULT_LABELS.CRASH);

		// Severity-based labels
		if (
			feedback.crashData?.exceptionType?.toLowerCase().includes("fatal") ||
			feedback.crashData?.exceptionType?.toLowerCase().includes("abort")
		) {
			labels.push("critical", "urgent");
		}

		// Exception type-based labels
		if (feedback.crashData?.exceptionType?.toLowerCase().includes("memory")) {
			labels.push("memory-issue");
		}
		if (feedback.crashData?.exceptionType?.toLowerCase().includes("network")) {
			labels.push("network-issue");
		}
	} else if (feedback.type === "screenshot") {
		labels.push("user-feedback");

		// Content-based labels
		if (feedback.screenshotData?.text) {
			const text = feedback.screenshotData.text.toLowerCase();

			if (
				text.includes("ui") ||
				text.includes("interface") ||
				text.includes("design") ||
				text.includes("layout") ||
				text.includes("button") ||
				text.includes("screen")
			) {
				labels.push("ui-ux");
			}

			if (
				text.includes("feature") ||
				text.includes("improvement") ||
				text.includes("enhancement") ||
				text.includes("add") ||
				text.includes("would like") ||
				text.includes("suggest")
			) {
				labels.push("enhancement");
			}

			if (
				text.includes("bug") ||
				text.includes("broken") ||
				text.includes("not working") ||
				text.includes("error") ||
				text.includes("wrong") ||
				text.includes("issue")
			) {
				labels.push("bug");
			}

			if (
				text.includes("performance") ||
				text.includes("slow") ||
				text.includes("lag") ||
				text.includes("freeze") ||
				text.includes("hang")
			) {
				labels.push("performance");
			}

			if (
				text.includes("accessibility") ||
				text.includes("a11y") ||
				text.includes("screen reader") ||
				text.includes("voice over") ||
				text.includes("contrast")
			) {
				labels.push("accessibility");
			}
		}
	}

	// Platform/device-based labels
	if (feedback.deviceInfo.family.toLowerCase().includes("iphone")) {
		labels.push("ios", "iphone");
	} else if (feedback.deviceInfo.family.toLowerCase().includes("ipad")) {
		labels.push("ios", "ipad");
	} else if (feedback.deviceInfo.family.toLowerCase().includes("mac")) {
		labels.push("macos");
	}

	// iOS version-based labels
	const majorVersion = feedback.deviceInfo.osVersion.split(".")[0];
	if (majorVersion) {
		labels.push(`ios-${majorVersion}`);
	}

	// App version-based labels
	const appMajorVersion = feedback.appVersion.split(".")[0];
	if (appMajorVersion) {
		labels.push(`v${appMajorVersion}`);
	}

	// Remove duplicates and return
	return Array.from(new Set(labels));
}

/**
 * Formats TestFlight feedback for GitHub issue description
 */
export function formatFeedbackForGitHub(feedback: ProcessedFeedbackData): {
	title: string;
	body: string;
} {
	const isCrash = feedback.type === "crash";
	const typeIcon = isCrash ? "💥" : "📱";
	const typeLabel = isCrash ? "Crash Report" : "User Feedback";

	// Enhanced title with more context
	let title = `${typeIcon} ${typeLabel}: ${feedback.appVersion}`;

	if (isCrash && feedback.crashData?.exceptionType) {
		title += ` - ${feedback.crashData.exceptionType}`;
	} else if (feedback.screenshotData?.text) {
		const shortText = feedback.screenshotData.text.substring(0, 50).trim();
		title += ` - ${shortText}${shortText.length < feedback.screenshotData.text.length ? "..." : ""}`;
	}

	// Comprehensive description with GitHub-flavored markdown
	let body = `## ${typeIcon} ${typeLabel} from TestFlight\n\n`;

	// Feedback metadata table
	body += "| Field | Value |\n";
	body += "|-------|-------|\n";
	body += `| **TestFlight ID** | \`${feedback.id}\` |\n`;
	body += `| **App Version** | ${feedback.appVersion} (Build ${feedback.buildNumber}) |\n`;
	body += `| **Submitted** | ${feedback.submittedAt.toISOString()} |\n`;
	body += `| **Device** | ${feedback.deviceInfo.model} |\n`;
	body += `| **OS Version** | ${feedback.deviceInfo.osVersion} |\n`;
	body += `| **Locale** | ${feedback.deviceInfo.locale} |\n\n`;

	if (isCrash && feedback.crashData) {
		body += "## 🔍 Crash Analysis\n\n";
		body += `**Crash Type:** ${feedback.crashData.type}\n\n`;

		if (feedback.crashData.exceptionType) {
			body += `**Exception Type:** \`${feedback.crashData.exceptionType}\`\n\n`;
		}

		if (feedback.crashData.exceptionMessage) {
			body += `**Exception Message:**\n\`\`\`\n${feedback.crashData.exceptionMessage}\n\`\`\`\n\n`;
		}

		body += `### Stack Trace\n\`\`\`\n${feedback.crashData.trace}\n\`\`\`\n\n`;

		if (feedback.crashData.logs.length > 0) {
			body += "### Crash Logs\n";
			feedback.crashData.logs.forEach((log, index) => {
				body += `- [Crash Log ${index + 1}](${log.url}) (expires: ${log.expiresAt.toLocaleDateString()})\n`;
			});
			body += "\n";
		}
	}

	if (feedback.screenshotData) {
		body += "## 📝 User Feedback\n\n";

		if (feedback.screenshotData.text) {
			body += "### Feedback Text\n";
			body += `> ${feedback.screenshotData.text.replace(/\n/g, "\n> ")}\n\n`;
		}

		if (feedback.screenshotData.images.length > 0) {
			body += `### Screenshots (${feedback.screenshotData.images.length})\n`;
			body += "Screenshots will be attached to this issue automatically.\n\n";
		}

		if (
			feedback.screenshotData.annotations &&
			feedback.screenshotData.annotations.length > 0
		) {
			body += "### Annotations\n";
			body += `User provided ${feedback.screenshotData.annotations.length} annotation(s) on screenshots.\n\n`;
		}
	}

	// Technical details section
	body += "## 🛠️ Technical Details\n\n";
	body += "<details>\n<summary>Device & Environment Information</summary>\n\n";
	body += `- **Device Family:** ${feedback.deviceInfo.family}\n`;
	body += `- **Device Model:** ${feedback.deviceInfo.model}\n`;
	body += `- **OS Version:** ${feedback.deviceInfo.osVersion}\n`;
	body += `- **Locale:** ${feedback.deviceInfo.locale}\n`;
	body += `- **Bundle ID:** ${feedback.bundleId}\n`;
	body += `- **Submission Time:** ${feedback.submittedAt.toISOString()}\n`;
	body += "\n</details>\n\n";

	// Auto-generated footer
	body += "---\n";
	body += "*This issue was automatically created from TestFlight feedback.*\n";
	body += `*Original submission ID: \`${feedback.id}\`*\n`;
	body += `*Priority: ${determineFeedbackPriority(feedback)}*`;

	return { title, body };
}

/**
 * Gets priority labels for GitHub based on feedback priority
 */
export function getPriorityLabels(priority: GitHubPriority): string[] {
	const priorityLabels: Record<GitHubPriority, string[]> = {
		urgent: ["priority: urgent", "urgent"],
		high: ["priority: high", "high priority"],
		normal: ["priority: normal"],
		low: ["priority: low", "low priority"],
	};

	return priorityLabels[priority] || [];
}

/**
 * Validates that all required GitHub configuration is present
 */
export function validateGitHubIntegration(): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	if (!validateGitHubConfig()) {
		errors.push(
			"GitHub configuration missing. Please set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO.",
		);
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Gets health status of GitHub integration
 */
export async function getGitHubIntegrationHealth(): Promise<{
	status: "healthy" | "degraded" | "unhealthy";
	details: {
		repository?: string;
		currentUser?: string;
		rateLimit?: {
			remaining: number;
			limit: number;
			reset: string;
		};
		error?: string;
		timestamp: string;
	};
	recommendations?: string[];
}> {
	try {
		const validation = validateGitHubIntegration();
		if (!validation.valid) {
			return {
				status: "unhealthy",
				details: {
					error: validation.errors.join(", "),
					timestamp: new Date().toISOString(),
				},
				recommendations: [
					"Set GITHUB_TOKEN environment variable",
					"Set GITHUB_OWNER environment variable",
					"Set GITHUB_REPO environment variable",
					"Verify GitHub API access permissions",
				],
			};
		}

		const client = getGitHubClient();
		const healthCheck = await client.healthCheck();

		return {
			status: healthCheck.status === "healthy" ? "healthy" : "degraded",
			details: healthCheck.details,
			recommendations:
				healthCheck.status !== "healthy"
					? [
							"Verify GitHub token is valid and has proper permissions",
							"Check repository owner and name are correct",
							"Ensure network connectivity to GitHub API",
							"Verify repository access permissions",
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
				"Check GitHub API connectivity",
				"Verify authentication credentials",
				"Review repository permissions",
				"Check GitHub API rate limits",
			],
		};
	}
}

/**
 * Combines issue creation for both GitHub and Linear (if both are configured)
 */
export async function createIssueFromTestFlightFeedback(
	feedback: ProcessedFeedbackData,
	options: {
		github?: GitHubIssueCreationOptions;
		linear?: unknown; // Would import proper type from linear-utils if needed
		preferredPlatform?: "github" | "linear" | "both";
	} = {},
): Promise<{
	github?: GitHubIssueCreationResult;
	linear?: unknown;
	errors: string[];
}> {
	const results: {
		github?: GitHubIssueCreationResult;
		linear?: unknown;
		errors: string[];
	} = { errors: [] };

	const { preferredPlatform = "both" } = options;

	// Create GitHub issue if configured and requested
	if (
		(preferredPlatform === "github" || preferredPlatform === "both") &&
		validateGitHubConfig()
	) {
		try {
			results.github = await createGitHubIssueFromFeedback(
				feedback,
				options.github,
			);
		} catch (error) {
			results.errors.push(`GitHub: ${(error as Error).message}`);
		}
	}

	// Linear integration would go here if both are to be used
	// This allows the utility to work with both platforms

	return results;
}
