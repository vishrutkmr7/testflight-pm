/**
 * Linear API Client
 * Secure utility for managing Linear issues, projects, and workflow integration via official Linear SDK
 */

import { LinearClient as LinearSDK } from "@linear/sdk";
import type {
	LinearComment,
	LinearIntegrationConfig,
	LinearIssue,
	LinearIssueLabel,
	LinearIssueStatus,
	LinearPriority,
	LinearProject,
	LinearTeam,
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
 * Linear API Client with official SDK integration, rate limiting awareness, and secure configuration
 */
export class LinearClient {
	private readonly config: LinearIntegrationConfig;
	private readonly sdk: LinearSDK;
	private teamCache: LinearTeam | null = null;

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

		// Initialize the Linear SDK
		this.sdk = new LinearSDK({
			apiKey: this.config.apiToken,
		});
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

			// Create issue using Linear SDK
			const issueCreatePayload = await this.sdk.createIssue({
				title: issueData.title,
				description: issueData.description,
				teamId: issueData.teamId,
				priority: this.mapPriorityToLinearPriority(issueData.priority),
				assigneeId: issueData.assigneeId,
				projectId: issueData.projectId,
			});

			if (!issueCreatePayload.success) {
				throw new Error("Linear API error: Failed to create issue");
			}

			const createdIssue = await issueCreatePayload.issue;
			if (!createdIssue) {
				throw new Error("Failed to retrieve created issue from Linear");
			}

			// Convert to simplified LinearIssue format
			const linearIssue: LinearIssue =
				await this.convertToLinearIssue(createdIssue);

			console.log(
				`✅ Created Linear issue: ${linearIssue.identifier} - ${linearIssue.title}`,
			);
			return linearIssue;
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

			const updatePayload = await this.sdk.updateIssue(issueId, {
				stateId: status.id,
			});

			if (!updatePayload.success) {
				throw new Error("Linear API error: Failed to update issue");
			}

			const updatedIssue = await updatePayload.issue;
			if (!updatedIssue) {
				throw new Error("Failed to retrieve updated issue from Linear");
			}

			return await this.convertToLinearIssue(updatedIssue);
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
			const commentPayload = await this.sdk.createComment({
				issueId,
				body,
			});

			if (!commentPayload.success) {
				throw new Error("Linear API error: Failed to create comment");
			}

			const comment = await commentPayload.comment;
			if (!comment) {
				throw new Error("Failed to retrieve created comment from Linear");
			}

			const issueBasic = await comment.issue;
			const team = await this.getTeam();

			// Create a minimal LinearIssue object for the comment
			const issueForComment: LinearIssue = issueBasic
				? await this.convertToLinearIssue(issueBasic)
				: {
						id: "unknown",
						identifier: "unknown",
						title: "Unknown Issue",
						description: "",
						url: "",
						priority: 3,
						state: {
							id: "unknown",
							name: "Unknown",
							description: "",
							color: "#000000",
							position: 0,
							type: "backlog",
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							team,
						},
						assignee: undefined,
						team,
						labels: [],
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						estimate: 0,
						sortOrder: 0,
						number: 0,
						creator: await this.createFallbackUser(),
						parent: undefined,
						children: [],
						relations: [],
						comments: [],
						attachments: [],
						project: undefined,
						cycle: undefined,
						previousIdentifiers: [],
						customerTicketCount: 0,
						subscribers: [],
					};

			return {
				id: comment.id,
				body: comment.body,
				user: await this.convertToLinearUser(comment.user),
				issue: issueForComment,
				url: issueBasic ? `${issueBasic.url}#comment-${comment.id}` : "",
				createdAt: comment.createdAt.toISOString(),
				updatedAt: comment.updatedAt.toISOString(),
			};
		} catch (error) {
			throw new Error(`Failed to add comment to Linear issue: ${error}`);
		}
	}

	/**
	 * Searches for duplicate issues in Linear
	 */
	public async findDuplicateIssue(
		feedback: ProcessedFeedbackData,
	): Promise<LinearIssue | null> {
		try {
			// Simple search for issues containing the TestFlight ID
			const searchQuery = `TestFlight ID: ${feedback.id}`;

			const issues = await this.sdk.issues({
				filter: {
					team: { id: { eq: this.config.teamId } },
					or: [
						{ title: { containsIgnoreCase: feedback.id } },
						{ description: { containsIgnoreCase: searchQuery } },
					],
				},
				first: 5,
			});

			for (const issue of issues.nodes) {
				const description = await issue.description;
				if (description?.includes(`TestFlight ID: ${feedback.id}`)) {
					return await this.convertToLinearIssue(issue);
				}
			}

			return null;
		} catch (error) {
			console.warn(`Error searching for duplicate issues: ${error}`);
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
			const team = await this.sdk.team(this.config.teamId);

			this.teamCache = await this.convertToLinearTeam(team);
			return this.teamCache;
		} catch (error) {
			throw new Error(`Failed to get Linear team: ${error}`);
		}
	}

	/**
	 * Gets available issue statuses for the team
	 */
	public async getIssueStatuses(): Promise<LinearIssueStatus[]> {
		try {
			const states = await this.sdk.workflowStates({
				filter: {
					team: { id: { eq: this.config.teamId } },
				},
			});

			const statuses: LinearIssueStatus[] = [];
			for (const state of states.nodes) {
				statuses.push(await this.convertToLinearIssueStatus(state));
			}

			return statuses;
		} catch (error) {
			throw new Error(`Failed to get Linear issue statuses: ${error}`);
		}
	}

	/**
	 * Gets a specific issue status by name
	 */
	public async getIssueStatusByName(
		statusName: string,
	): Promise<LinearIssueStatus> {
		try {
			const states = await this.sdk.workflowStates({
				filter: {
					team: { id: { eq: this.config.teamId } },
					name: { eq: statusName },
				},
			});

			if (states.nodes.length === 0) {
				throw new Error(`Issue status '${statusName}' not found`);
			}

			return await this.convertToLinearIssueStatus(states.nodes[0]);
		} catch (error) {
			throw new Error(`Failed to get Linear issue status: ${error}`);
		}
	}

	/**
	 * Gets available issue labels for the team
	 */
	public async getIssueLabels(): Promise<LinearIssueLabel[]> {
		try {
			const labels = await this.sdk.issueLabels({
				filter: {
					team: { id: { eq: this.config.teamId } },
				},
			});

			const issueLabels: LinearIssueLabel[] = [];
			for (const label of labels.nodes) {
				issueLabels.push(await this.convertToLinearIssueLabel(label));
			}

			return issueLabels;
		} catch (error) {
			throw new Error(`Failed to get Linear issue labels: ${error}`);
		}
	}

	/**
	 * Gets recent issues from Linear
	 */
	public async getRecentIssues(limit = 20): Promise<LinearIssue[]> {
		try {
			const issues = await this.sdk.issues({
				filter: {
					team: { id: { eq: this.config.teamId } },
				},
				first: limit,
			});

			const linearIssues: LinearIssue[] = [];
			for (const issue of issues.nodes) {
				linearIssues.push(await this.convertToLinearIssue(issue));
			}

			return linearIssues;
		} catch (error) {
			throw new Error(`Failed to get recent Linear issues: ${error}`);
		}
	}

	/**
	 * Gets projects from Linear
	 */
	public async getProjects(): Promise<LinearProject[]> {
		try {
			const projects = await this.sdk.projects();

			const linearProjects: LinearProject[] = [];
			for (const project of projects.nodes) {
				linearProjects.push(await this.convertToLinearProject(project));
			}

			return linearProjects;
		} catch (error) {
			throw new Error(`Failed to get Linear projects: ${error}`);
		}
	}

	/**
	 * Gets current user information
	 */
	public async getCurrentUser(): Promise<LinearUser> {
		try {
			const viewer = await this.sdk.viewer;
			return await this.convertToLinearUser(viewer);
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
			// Test basic connectivity
			const [team, user] = await Promise.all([
				this.getTeam(),
				this.getCurrentUser(),
			]);

			return {
				status: "healthy",
				details: {
					teamName: team.name,
					teamKey: team.key,
					currentUser: user.name,
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

	/**
	 * Helper method to convert Linear SDK issue to our LinearIssue interface
	 */
	private async convertToLinearIssue(issue: any): Promise<LinearIssue> {
		const team = await this.getTeam();
		const state = await issue.state;
		const assignee = await issue.assignee;
		const creator = await issue.creator;

		return {
			id: issue.id,
			identifier: issue.identifier,
			title: issue.title,
			description: (await issue.description) || "",
			url: issue.url,
			priority: this.mapLinearPriorityToPriority(issue.priority),
			state: await this.convertToLinearIssueStatus(state),
			assignee: assignee ? await this.convertToLinearUser(assignee) : undefined,
			team,
			labels: [],
			createdAt: issue.createdAt.toISOString(),
			updatedAt: issue.updatedAt.toISOString(),
			estimate: issue.estimate || 0,
			sortOrder: issue.sortOrder || 0,
			number: issue.number,
			dueDate: issue.dueDate?.toISOString(),
			completedAt: issue.completedAt?.toISOString(),
			canceledAt: issue.canceledAt?.toISOString(),
			autoClosedAt: issue.autoClosedAt?.toISOString(),
			autoArchivedAt: issue.autoArchivedAt?.toISOString(),
			archivedAt: issue.archivedAt?.toISOString(),
			creator: creator
				? await this.convertToLinearUser(creator)
				: await this.createFallbackUser(),
			parent: undefined,
			children: [],
			relations: [],
			comments: [],
			attachments: [],
			project: undefined,
			cycle: undefined,
			previousIdentifiers: [],
			customerTicketCount: 0,
			subscribers: [],
		};
	}

	/**
	 * Creates a fallback user when no creator is available
	 */
	private async createFallbackUser(): Promise<LinearUser> {
		return {
			id: "unknown",
			name: "Unknown User",
			displayName: "Unknown User",
			email: "",
			avatarUrl: undefined,
			isMe: false,
			isAdmin: false,
			isGuest: true,
			active: false,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
	}

	/**
	 * Helper method to convert Linear SDK user to our LinearUser interface
	 */
	private async convertToLinearUser(user: any): Promise<LinearUser> {
		return {
			id: user.id,
			name: user.name,
			displayName: user.displayName || user.name,
			email: user.email,
			avatarUrl: user.avatarUrl,
			isMe: user.isMe || false,
			isAdmin: user.admin || false,
			isGuest: user.guest || false,
			active: user.active || true,
			createdAt: user.createdAt?.toISOString() || new Date().toISOString(),
			updatedAt: user.updatedAt?.toISOString() || new Date().toISOString(),
		};
	}

	/**
	 * Helper method to convert Linear SDK team to our LinearTeam interface
	 */
	private async convertToLinearTeam(team: any): Promise<LinearTeam> {
		return {
			id: team.id,
			name: team.name,
			key: team.key,
			description: (await team.description) || "",
			icon: team.icon,
			color: team.color,
			private: team.private || false,
			autoArchivePeriod: team.autoArchivePeriod || 0,
			autoCloseParentIssues: team.autoCloseParentIssues || false,
			cyclesEnabled: team.cyclesEnabled || false,
			cycleStartDay: team.cycleStartDay || 0,
			cycleDuration: team.cycleDuration || 1,
			cycleCooldownTime: team.cycleCooldownTime || 0,
			upcomingCycleCount: team.upcomingCycleCount || 0,
			timezone: team.timezone || "UTC",
			inviteHash: team.inviteHash || "",
			issueEstimationType: team.issueEstimationType || "notUsed",
			issueEstimationAllowZero: team.issueEstimationAllowZero || false,
			issueEstimationExtended: team.issueEstimationExtended || false,
			issueOrderingNoPriorityFirst: team.issueOrderingNoPriorityFirst || false,
			issueSortOrderDefaultToBottom:
				team.issueSortOrderDefaultToBottom || false,
			defaultIssueEstimate: team.defaultIssueEstimate,
			defaultTemplateForMembersId: team.defaultTemplateForMembersId,
			defaultTemplateForNonMembersId: team.defaultTemplateForNonMembersId,
			triageEnabled: team.triageEnabled || false,
			requirePriorityToLeaveTriage: team.requirePriorityToLeaveTriage || false,
			createdAt: team.createdAt?.toISOString() || new Date().toISOString(),
			updatedAt: team.updatedAt?.toISOString() || new Date().toISOString(),
			archivedAt: team.archivedAt?.toISOString(),
		};
	}

	/**
	 * Helper method to convert Linear SDK state to our LinearIssueStatus interface
	 */
	private async convertToLinearIssueStatus(
		state: any,
	): Promise<LinearIssueStatus> {
		const team = await this.getTeam();

		return {
			id: state.id,
			name: state.name,
			description: state.description,
			color: state.color,
			position: state.position || 0,
			type: this.mapStateTypeToLinearIssueState(state.type),
			createdAt: state.createdAt?.toISOString() || new Date().toISOString(),
			updatedAt: state.updatedAt?.toISOString() || new Date().toISOString(),
			archivedAt: state.archivedAt?.toISOString(),
			team,
		};
	}

	/**
	 * Helper method to convert Linear SDK label to our LinearIssueLabel interface
	 */
	private async convertToLinearIssueLabel(
		label: any,
	): Promise<LinearIssueLabel> {
		const team = await this.getTeam();

		return {
			id: label.id,
			name: label.name,
			color: label.color,
			description: (await label.description) || "",
			parent: undefined,
			children: [],
			createdAt: label.createdAt?.toISOString() || new Date().toISOString(),
			updatedAt: label.updatedAt?.toISOString() || new Date().toISOString(),
			archivedAt: label.archivedAt?.toISOString(),
			creator: await this.createFallbackUser(),
			team,
		};
	}

	/**
	 * Helper method to convert Linear SDK project to our LinearProject interface
	 */
	private async convertToLinearProject(project: any): Promise<LinearProject> {
		return {
			id: project.id,
			name: project.name,
			description: (await project.description) || "",
			slug: project.slug || project.name.toLowerCase().replace(/\s+/g, "-"),
			icon: project.icon,
			color: project.color,
			state: project.state || "planned",
			content: await project.content,
			priority: this.mapLinearPriorityToPriority(project.priority) as any,
			sortOrder: project.sortOrder || 0,
			startDate: project.startDate?.toISOString(),
			targetDate: project.targetDate?.toISOString(),
			completedAt: project.completedAt?.toISOString(),
			canceledAt: project.canceledAt?.toISOString(),
			autoArchivedAt: project.autoArchivedAt?.toISOString(),
			createdAt: project.createdAt?.toISOString() || new Date().toISOString(),
			updatedAt: project.updatedAt?.toISOString() || new Date().toISOString(),
			archivedAt: project.archivedAt?.toISOString(),
			creator: await this.convertToLinearUser(await project.creator),
			lead: undefined,
			members: [],
			teams: [],
			milestones: [],
			documents: [],
			links: [],
			requirements: [],
			roadmaps: [],
		};
	}

	/**
	 * Prepares Linear issue data from TestFlight feedback
	 */
	private prepareIssueFromTestFlight(
		feedback: ProcessedFeedbackData,
		additionalLabels: string[] = [],
		assigneeId?: string,
		projectId?: string,
	) {
		const isCrash = feedback.type === "crash";
		const typeIcon = isCrash ? "💥" : "📱";
		const typeLabel = isCrash ? "Crash Report" : "User Feedback";

		// Generate title
		let title = `${typeIcon} ${typeLabel}: ${feedback.appVersion} (${feedback.buildNumber})`;

		if (isCrash && feedback.crashData?.exceptionType) {
			title += ` - ${feedback.crashData.exceptionType}`;
		} else if (feedback.screenshotData?.text) {
			const shortText = feedback.screenshotData.text.substring(0, 40);
			title += ` - ${shortText}${shortText.length < feedback.screenshotData.text.length ? "..." : ""}`;
		}

		// Generate description
		let description = `## ${typeIcon} ${typeLabel} from TestFlight\n\n`;

		// Metadata table
		description += "| Field | Value |\n";
		description += "|-------|-------|\n";
		description += `| **TestFlight ID** | \`${feedback.id}\` |\n`;
		description += `| **App Version** | ${feedback.appVersion} (Build ${feedback.buildNumber}) |\n`;
		description += `| **Submitted** | ${feedback.submittedAt.toISOString()} |\n`;
		description += `| **Device** | ${feedback.deviceInfo.model} |\n`;
		description += `| **OS Version** | ${feedback.deviceInfo.osVersion} |\n`;
		description += `| **Locale** | ${feedback.deviceInfo.locale} |\n\n`;

		if (isCrash && feedback.crashData) {
			description += "### 🔍 Crash Details\n\n";
			description += `**Type:** ${feedback.crashData.type}\n\n`;

			if (feedback.crashData.exceptionType) {
				description += `**Exception:** \`${feedback.crashData.exceptionType}\`\n\n`;
			}

			if (feedback.crashData.exceptionMessage) {
				description += `**Message:**\n\`\`\`\n${feedback.crashData.exceptionMessage}\n\`\`\`\n\n`;
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
			description += "### 📝 User Feedback\n\n";

			if (feedback.screenshotData.text) {
				description += `**Feedback Text:**\n> ${feedback.screenshotData.text.replace(/\n/g, "\n> ")}\n\n`;
			}

			if (feedback.screenshotData.images.length > 0) {
				description += `**Screenshots:** ${feedback.screenshotData.images.length} attached\n\n`;
			}

			if (
				feedback.screenshotData.annotations &&
				feedback.screenshotData.annotations.length > 0
			) {
				description += `**Annotations:** ${feedback.screenshotData.annotations.length} user annotation(s)\n\n`;
			}
		}

		// Technical details
		description += "### 🛠️ Technical Information\n\n";
		description +=
			"<details>\n<summary>Device & Environment Details</summary>\n\n";
		description += `- **Device Family:** ${feedback.deviceInfo.family}\n`;
		description += `- **Device Model:** ${feedback.deviceInfo.model}\n`;
		description += `- **OS Version:** ${feedback.deviceInfo.osVersion}\n`;
		description += `- **Locale:** ${feedback.deviceInfo.locale}\n`;
		description += `- **Bundle ID:** ${feedback.bundleId}\n`;
		description += `- **Submission Time:** ${feedback.submittedAt.toISOString()}\n`;
		description += "\n</details>\n\n";

		description += `---\n*Automatically created from TestFlight feedback. ID: \`${feedback.id}\`*`;

		// Determine labels
		const baseLabels = isCrash
			? this.config.crashLabels
			: this.config.feedbackLabels;
		const allLabels = [
			...this.config.defaultLabels,
			...baseLabels,
			...additionalLabels,
		];

		// Determine priority based on feedback type
		let priority = this.config.defaultPriority;
		if (isCrash) {
			priority = 2; // High priority for crashes
		}

		return {
			title,
			description,
			teamId: this.config.teamId,
			priority,
			assigneeId,
			projectId,
			labels: allLabels,
		};
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
			commentBody += `\n**User Feedback:**\n> ${feedback.screenshotData.text}`;
		}

		return await this.addCommentToIssue(issueId, commentBody);
	}

	/**
	 * Maps our priority enum to Linear's priority number
	 */
	private mapPriorityToLinearPriority(
		priority: LinearPriority | number,
	): number {
		if (typeof priority === "number") {
			return priority;
		}

		switch (priority) {
			case 1:
				return 1; // Urgent
			case 2:
				return 2; // High
			case 3:
				return 3; // Normal
			case 4:
				return 4; // Low
			default:
				return 3; // Normal
		}
	}

	/**
	 * Maps Linear's priority number to our priority enum
	 */
	private mapLinearPriorityToPriority(priority?: number): LinearPriority {
		switch (priority) {
			case 1:
				return 1; // Urgent
			case 2:
				return 2; // High
			case 3:
				return 3; // Normal
			case 4:
				return 4; // Low
			default:
				return 3; // Normal
		}
	}

	/**
	 * Maps Linear state type to our issue state enum
	 */
	private mapStateTypeToLinearIssueState(
		stateType: string,
	): "backlog" | "unstarted" | "started" | "completed" | "canceled" {
		switch (stateType) {
			case "backlog":
				return "backlog";
			case "unstarted":
				return "unstarted";
			case "started":
				return "started";
			case "completed":
				return "completed";
			case "canceled":
				return "canceled";
			default:
				return "backlog";
		}
	}
}

// Global Linear client instance
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
