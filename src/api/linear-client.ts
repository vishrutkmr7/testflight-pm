/**
 * Linear API Client
 * Secure utility for managing Linear issues, projects, and workflow integration via MCP
 */

import type {
	LinearComment,
	LinearCreateCommentRequest,
	LinearCreateIssueLinkInput,
	LinearCreateIssueRequest,
	LinearIntegrationConfig,
	LinearIssue,
	LinearIssueFromTestFlight,
	LinearIssueLabel,
	LinearIssueSearchParams,
	LinearIssueStatus,
	LinearPriority,
	LinearProject,
	LinearTeam,
	LinearUpdateIssueRequest,
	LinearUser,
} from "../../types/linear.js";
import type { ProcessedFeedbackData } from "../../types/testflight.js";
import {
	DEFAULT_LABELS,
	ERROR_MESSAGES,
	PRIORITY_LEVELS,
} from "../config/constants.js";
import { getConfig } from "../config/environment.js";

/**
 * Linear API Client with MCP integration, rate limiting awareness, and secure configuration
 */
export class LinearClient {
	private readonly config: LinearIntegrationConfig;
	private teamCache: LinearTeam | null = null;
	private statusCache: Map<string, LinearIssueStatus> = new Map();
	private labelCache: Map<string, LinearIssueLabel> = new Map();

	constructor() {
		const envConfig = getConfig();

		if (!envConfig.linear) {
			throw new Error(ERROR_MESSAGES.LINEAR_CONFIG_MISSING);
		}

		this.config = {
			apiToken: envConfig.linear.apiToken,
			teamId: envConfig.linear.teamId,
			defaultPriority: PRIORITY_LEVELS.NORMAL,
			defaultLabels: [...DEFAULT_LABELS.BASE],
			crashLabels: [...DEFAULT_LABELS.CRASH],
			feedbackLabels: [...DEFAULT_LABELS.FEEDBACK],
			enableDuplicateDetection: true,
			duplicateDetectionDays: 7,
		};
	}

	/**
	 * Creates a Linear issue from TestFlight feedback data
	 */
	public async createIssueFromTestFlight(
		feedback: ProcessedFeedbackData,
		additionalLabels: string[] = [],
		assigneeId?: string,
		projectId?: string,
	): Promise<LinearIssue> {
		try {
			// Check for duplicates if enabled
			if (this.config.enableDuplicateDetection) {
				const duplicateIssue = await this.findDuplicateIssue(feedback);
				if (duplicateIssue) {
					console.log(
						`Duplicate issue found: ${duplicateIssue.identifier}. Adding comment instead.`,
					);
					await this.addTestFlightCommentToIssue(duplicateIssue.id, feedback);
					return duplicateIssue;
				}
			}

			const issueData = this.prepareIssueFromTestFlight(
				feedback,
				additionalLabels,
				assigneeId,
				projectId,
			);

			// Get label IDs
			const labelIds = await this.resolveLabelIds(issueData.labels);

			const createRequest: LinearCreateIssueRequest = {
				title: issueData.title,
				description: issueData.description,
				teamId: issueData.teamId,
				priority: issueData.priority,
				assigneeId: issueData.assigneeId,
				projectId: issueData.projectId,
				labelIds,
				links: issueData.links,
			};

			// Use MCP function to create issue
			const createdIssue = await this.mcpCreateIssue(createRequest);

			console.log(
				`✅ Created Linear issue: ${createdIssue.identifier} - ${createdIssue.title}`,
			);
			return createdIssue;
		} catch (error) {
			throw new Error(
				`Failed to create Linear issue from TestFlight feedback: ${error}`,
			);
		}
	}

	/**
	 * Updates an existing Linear issue status
	 */
	public async updateIssueStatus(
		issueId: string,
		statusName: string,
	): Promise<LinearIssue> {
		try {
			const status = await this.getIssueStatusByName(statusName);

			const updateRequest: LinearUpdateIssueRequest = {
				id: issueId,
				stateId: status.id,
			};

			const updatedIssue = await this.mcpUpdateIssue(updateRequest);
			console.log(
				`✅ Updated Linear issue ${updatedIssue.identifier} status to: ${statusName}`,
			);
			return updatedIssue;
		} catch (error) {
			throw new Error(`Failed to update Linear issue status: ${error}`);
		}
	}

	/**
	 * Adds a comment to an existing Linear issue
	 */
	public async addCommentToIssue(
		issueId: string,
		body: string,
	): Promise<LinearComment> {
		try {
			const commentRequest: LinearCreateCommentRequest = {
				issueId,
				body,
			};

			const comment = await this.mcpCreateComment(commentRequest);
			console.log(`✅ Added comment to Linear issue: ${issueId}`);
			return comment;
		} catch (error) {
			throw new Error(`Failed to add comment to Linear issue: ${error}`);
		}
	}

	/**
	 * Searches for existing issues to detect duplicates
	 */
	public async findDuplicateIssue(
		feedback: ProcessedFeedbackData,
	): Promise<LinearIssue | null> {
		try {
			const since = new Date();
			since.setDate(since.getDate() - this.config.duplicateDetectionDays);

			let searchQuery = `feedback:${feedback.id}`;

			// For crashes, also search by exception type and app version
			if (feedback.crashData) {
				if (feedback.crashData.exceptionType) {
					searchQuery += ` OR "${feedback.crashData.exceptionType}"`;
				}
				searchQuery += ` AND version:${feedback.appVersion}`;
			}

			// For screenshots, search by feedback text
			if (feedback.screenshotData?.text) {
				const cleanText = feedback.screenshotData.text
					.substring(0, 50)
					.replace(/"/g, "");
				searchQuery += ` OR "${cleanText}"`;
			}

			const searchParams: LinearIssueSearchParams = {
				query: searchQuery,
				teamId: this.config.teamId,
				createdAt: `>${since.toISOString()}`,
				limit: 5,
			};

			const issues = await this.mcpListIssues(searchParams);

			// Look for exact matches based on TestFlight feedback ID in issue description
			const duplicateIssue = issues.find((issue: LinearIssue) =>
				issue.description?.includes(`TestFlight ID: ${feedback.id}`),
			);

			return duplicateIssue || null;
		} catch (error) {
			console.warn(`Failed to search for duplicate issues: ${error}`);
			return null;
		}
	}

	/**
	 * Gets the configured team information
	 */
	public async getTeam(): Promise<LinearTeam> {
		if (this.teamCache) {
			return this.teamCache;
		}

		try {
			const team = await this.mcpGetTeam(this.config.teamId);
			this.teamCache = team;
			return team;
		} catch (error) {
			throw new Error(`Failed to get Linear team: ${error}`);
		}
	}

	/**
	 * Gets all available issue statuses for the team
	 */
	public async getIssueStatuses(): Promise<LinearIssueStatus[]> {
		try {
			const statuses = await this.mcpListIssueStatuses(this.config.teamId);

			// Cache the statuses
			for (const status of statuses) {
				this.statusCache.set(status.name.toLowerCase(), status);
			}

			return statuses;
		} catch (error) {
			throw new Error(`Failed to get Linear issue statuses: ${error}`);
		}
	}

	/**
	 * Gets an issue status by name
	 */
	public async getIssueStatusByName(
		statusName: string,
	): Promise<LinearIssueStatus> {
		const normalizedName = statusName.toLowerCase();

		if (this.statusCache.has(normalizedName)) {
			const status = this.statusCache.get(normalizedName);
			if (status) {
				return status;
			}
		}

		try {
			const status = await this.mcpGetIssueStatus(
				statusName,
				this.config.teamId,
			);
			this.statusCache.set(normalizedName, status);
			return status;
		} catch (error) {
			throw new Error(
				`Failed to get Linear issue status '${statusName}': ${error}`,
			);
		}
	}

	/**
	 * Gets all available labels for the team
	 */
	public async getIssueLabels(): Promise<LinearIssueLabel[]> {
		try {
			const labels = await this.mcpListIssueLabels(this.config.teamId);

			// Cache the labels
			for (const label of labels) {
				this.labelCache.set(label.name.toLowerCase(), label);
			}

			return labels;
		} catch (error) {
			throw new Error(`Failed to get Linear issue labels: ${error}`);
		}
	}

	/**
	 * Lists recent issues for the team
	 */
	public async getRecentIssues(limit = 20): Promise<LinearIssue[]> {
		try {
			const searchParams: LinearIssueSearchParams = {
				teamId: this.config.teamId,
				limit,
				orderBy: "updatedAt",
			};

			return await this.mcpListIssues(searchParams);
		} catch (error) {
			throw new Error(`Failed to get recent Linear issues: ${error}`);
		}
	}

	/**
	 * Lists all projects for the team
	 */
	public async getProjects(): Promise<LinearProject[]> {
		try {
			return await this.mcpListProjects(this.config.teamId);
		} catch (error) {
			throw new Error(`Failed to get Linear projects: ${error}`);
		}
	}

	/**
	 * Gets current user information
	 */
	public async getCurrentUser(): Promise<LinearUser> {
		try {
			const users = await this.mcpListUsers();
			const currentUser = users.find((user: LinearUser) => user.isMe);

			if (!currentUser) {
				throw new Error("Current user not found in Linear workspace");
			}

			return currentUser;
		} catch (error) {
			throw new Error(`Failed to get current Linear user: ${error}`);
		}
	}

	/**
	 * Health check for Linear integration
	 */
	public async healthCheck(): Promise<{
		status: "healthy" | "unhealthy";
		details: {
			teamName?: string;
			teamKey?: string;
			currentUser?: string;
			configuredTeamId?: string;
			error?: string;
			timestamp: string;
		};
	}> {
		try {
			const team = await this.getTeam();
			const currentUser = await this.getCurrentUser();

			return {
				status: "healthy",
				details: {
					teamName: team.name,
					teamKey: team.key,
					currentUser: currentUser.displayName,
					configuredTeamId: this.config.teamId,
					timestamp: new Date().toISOString(),
				},
			};
		} catch (error) {
			return {
				status: "unhealthy",
				details: {
					error: (error as Error).message,
					configuredTeamId: this.config.teamId,
					timestamp: new Date().toISOString(),
				},
			};
		}
	}

	// Private MCP wrapper methods
	// These will be implemented to use the actual MCP tools at runtime

	private async mcpCreateIssue(
		_request: LinearCreateIssueRequest,
	): Promise<LinearIssue> {
		// This will be implemented to use the MCP Linear tools
		// For now, return a mock response to satisfy TypeScript
		throw new Error(
			"MCP Linear integration not yet connected. Please implement MCP tool integration.",
		);
	}

	private async mcpUpdateIssue(
		_request: LinearUpdateIssueRequest,
	): Promise<LinearIssue> {
		// This will be implemented to use the MCP Linear tools
		throw new Error(
			"MCP Linear integration not yet connected. Please implement MCP tool integration.",
		);
	}

	private async mcpCreateComment(
		_request: LinearCreateCommentRequest,
	): Promise<LinearComment> {
		// This will be implemented to use the MCP Linear tools
		throw new Error(
			"MCP Linear integration not yet connected. Please implement MCP tool integration.",
		);
	}

	private async mcpListIssues(
		_params: LinearIssueSearchParams,
	): Promise<LinearIssue[]> {
		// This will be implemented to use the MCP Linear tools
		throw new Error(
			"MCP Linear integration not yet connected. Please implement MCP tool integration.",
		);
	}

	private async mcpGetTeam(_teamId: string): Promise<LinearTeam> {
		// This will be implemented to use the MCP Linear tools
		throw new Error(
			"MCP Linear integration not yet connected. Please implement MCP tool integration.",
		);
	}

	private async mcpListIssueStatuses(
		_teamId: string,
	): Promise<LinearIssueStatus[]> {
		// This will be implemented to use the MCP Linear tools
		throw new Error(
			"MCP Linear integration not yet connected. Please implement MCP tool integration.",
		);
	}

	private async mcpGetIssueStatus(
		_statusName: string,
		_teamId: string,
	): Promise<LinearIssueStatus> {
		// This will be implemented to use the MCP Linear tools
		throw new Error(
			"MCP Linear integration not yet connected. Please implement MCP tool integration.",
		);
	}

	private async mcpListIssueLabels(
		_teamId: string,
	): Promise<LinearIssueLabel[]> {
		// This will be implemented to use the MCP Linear tools
		throw new Error(
			"MCP Linear integration not yet connected. Please implement MCP tool integration.",
		);
	}

	private async mcpListProjects(_teamId: string): Promise<LinearProject[]> {
		// This will be implemented to use the MCP Linear tools
		throw new Error(
			"MCP Linear integration not yet connected. Please implement MCP tool integration.",
		);
	}

	private async mcpListUsers(): Promise<LinearUser[]> {
		// This will be implemented to use the MCP Linear tools
		throw new Error(
			"MCP Linear integration not yet connected. Please implement MCP tool integration.",
		);
	}

	/**
	 * Prepares issue data from TestFlight feedback
	 */
	private prepareIssueFromTestFlight(
		feedback: ProcessedFeedbackData,
		additionalLabels: string[] = [],
		assigneeId?: string,
		projectId?: string,
	): LinearIssueFromTestFlight {
		const isCrash = feedback.type === "crash";
		const typeIcon = isCrash ? "💥" : "📱";
		const typeLabel = isCrash ? "Crash Report" : "User Feedback";

		// Generate title
		let title = `${typeIcon} ${typeLabel}: ${feedback.appVersion} (${feedback.buildNumber})`;

		if (isCrash && feedback.crashData?.exceptionType) {
			title += ` - ${feedback.crashData.exceptionType}`;
		} else if (feedback.screenshotData?.text) {
			const shortText = feedback.screenshotData.text.substring(0, 50);
			title += ` - ${shortText}${shortText.length < feedback.screenshotData.text.length ? "..." : ""}`;
		}

		// Generate description
		let description = `## ${typeLabel} from TestFlight\n\n`;
		description += `**TestFlight ID:** ${feedback.id}\n`;
		description += `**App Version:** ${feedback.appVersion} (${feedback.buildNumber})\n`;
		description += `**Submitted:** ${feedback.submittedAt.toISOString()}\n`;
		description += `**Device:** ${feedback.deviceInfo.model} (${feedback.deviceInfo.osVersion})\n`;
		description += `**Locale:** ${feedback.deviceInfo.locale}\n\n`;

		if (isCrash && feedback.crashData) {
			description += "### Crash Details\n";
			description += `**Type:** ${feedback.crashData.type}\n`;
			if (feedback.crashData.exceptionType) {
				description += `**Exception:** ${feedback.crashData.exceptionType}\n`;
			}
			if (feedback.crashData.exceptionMessage) {
				description += `**Message:** ${feedback.crashData.exceptionMessage}\n`;
			}
			description += `\n### Stack Trace\n\`\`\`\n${feedback.crashData.trace}\n\`\`\`\n`;
		}

		if (feedback.screenshotData) {
			description += "### User Feedback\n";
			if (feedback.screenshotData.text) {
				description += `**Feedback Text:**\n${feedback.screenshotData.text}\n\n`;
			}
			description += `**Screenshots:** ${feedback.screenshotData.images.length} attached\n`;
		}

		// Determine priority
		let priority: LinearPriority = this.config.defaultPriority;
		if (isCrash) {
			// Crashes get higher priority
			priority = feedback.crashData?.exceptionType
				?.toLowerCase()
				.includes("fatal")
				? 1
				: 2;
		}

		// Combine labels
		const baseLabels = isCrash
			? this.config.crashLabels
			: this.config.feedbackLabels;
		const allLabels = [
			...this.config.defaultLabels,
			...baseLabels,
			...additionalLabels,
		];

		// Create links for crash logs and screenshots
		const links: LinearCreateIssueLinkInput[] = [];

		if (feedback.crashData?.logs) {
			feedback.crashData.logs.forEach((log, index) => {
				links.push({
					url: log.url,
					title: `Crash Log ${index + 1}`,
				});
			});
		}

		if (feedback.screenshotData?.images) {
			feedback.screenshotData.images.forEach((image, index) => {
				links.push({
					url: image.url,
					title: `Screenshot ${index + 1}: ${image.fileName}`,
				});
			});
		}

		return {
			title,
			description,
			teamId: this.config.teamId,
			priority,
			labels: allLabels,
			links,
			assigneeId: assigneeId || this.config.autoAssigneeId,
			projectId: projectId || this.config.defaultProjectId,
			metadata: {
				testflightFeedbackId: feedback.id,
				testflightFeedbackType: feedback.type,
				appVersion: feedback.appVersion,
				buildNumber: feedback.buildNumber,
				deviceModel: feedback.deviceInfo.model,
				osVersion: feedback.deviceInfo.osVersion,
				submittedAt: feedback.submittedAt.toISOString(),
			},
		};
	}

	/**
	 * Resolves label names to IDs
	 */
	private async resolveLabelIds(labelNames: string[]): Promise<string[]> {
		try {
			// Ensure labels are cached
			if (this.labelCache.size === 0) {
				await this.getIssueLabels();
			}

			const labelIds: string[] = [];
			const missingLabels: string[] = [];

			for (const labelName of labelNames) {
				const normalizedName = labelName.toLowerCase();
				const label = this.labelCache.get(normalizedName);

				if (label) {
					labelIds.push(label.id);
				} else {
					missingLabels.push(labelName);
				}
			}

			if (missingLabels.length > 0) {
				console.warn(
					`Labels not found in Linear workspace: ${missingLabels.join(", ")}`,
				);
			}

			return labelIds;
		} catch (error) {
			console.warn(`Failed to resolve label IDs: ${error}`);
			return [];
		}
	}

	/**
	 * Adds a TestFlight-specific comment to an existing issue
	 */
	private async addTestFlightCommentToIssue(
		issueId: string,
		feedback: ProcessedFeedbackData,
	): Promise<LinearComment> {
		const typeIcon = feedback.type === "crash" ? "💥" : "📱";

		let commentBody = `${typeIcon} **Additional TestFlight ${feedback.type} report**\n\n`;
		commentBody += `**TestFlight ID:** ${feedback.id}\n`;
		commentBody += `**Submitted:** ${feedback.submittedAt.toISOString()}\n`;
		commentBody += `**Device:** ${feedback.deviceInfo.model} (${feedback.deviceInfo.osVersion})\n`;

		if (feedback.screenshotData?.text) {
			commentBody += `\n**User Feedback:**\n${feedback.screenshotData.text}`;
		}

		return await this.addCommentToIssue(issueId, commentBody);
	}
}

/**
 * Global Linear client instance
 * Singleton pattern for Linear client management
 */
let _linearClientInstance: LinearClient | null = null;

export function getLinearClient(): LinearClient {
	if (!_linearClientInstance) {
		_linearClientInstance = new LinearClient();
	}
	return _linearClientInstance;
}

/**
 * Clears the global Linear client instance (useful for testing)
 */
export function clearLinearClientInstance(): void {
	_linearClientInstance = null;
}

/**
 * Utility function to validate Linear configuration
 */
export function validateLinearConfig(): boolean {
	try {
		const config = getConfig();
		return !!(config.linear?.apiToken && config.linear?.teamId);
	} catch {
		return false;
	}
}
