/**
 * Linear API Data Types
 * Complete TypeScript interfaces for Linear integration via MCP
 */

// Core Linear Types
export type LinearPriority = 0 | 1 | 2 | 3 | 4; // No priority, Urgent, High, Normal, Low
export type LinearIssueState =
	| "backlog"
	| "unstarted"
	| "started"
	| "completed"
	| "canceled";

export interface LinearUser {
	id: string;
	name: string;
	displayName: string;
	email: string;
	avatarUrl?: string;
	isMe: boolean;
	isAdmin: boolean;
	isGuest: boolean;
	active: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface LinearTeam {
	id: string;
	name: string;
	key: string;
	description?: string;
	icon?: string;
	color?: string;
	private: boolean;
	autoArchivePeriod: number;
	autoCloseParentIssues: boolean;
	cyclesEnabled: boolean;
	cycleStartDay: number;
	cycleDuration: number;
	cycleCooldownTime: number;
	upcomingCycleCount: number;
	timezone: string;
	inviteHash: string;
	issueEstimationType: string;
	issueEstimationAllowZero: boolean;
	issueEstimationExtended: boolean;
	issueOrderingNoPriorityFirst: boolean;
	issueSortOrderDefaultToBottom: boolean;
	defaultIssueEstimate?: number;
	defaultTemplateForMembersId?: string;
	defaultTemplateForNonMembersId?: string;
	triageEnabled: boolean;
	requirePriorityToLeaveTriage: boolean;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
}

export interface LinearProject {
	id: string;
	name: string;
	description?: string;
	slug: string;
	icon?: string;
	color?: string;
	state: "planned" | "started" | "completed" | "canceled" | "paused";
	content?: string;
	priority: LinearPriority;
	sortOrder: number;
	startDate?: string;
	targetDate?: string;
	completedAt?: string;
	canceledAt?: string;
	autoArchivedAt?: string;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
	creator: LinearUser;
	lead?: LinearUser;
	members: LinearUser[];
	teams: LinearTeam[];
	milestones: LinearMilestone[];
	documents: LinearDocument[];
	links: LinearProjectLink[];
	requirements: LinearRequirement[];
	roadmaps: LinearRoadmap[];
}

export interface LinearIssueStatus {
	id: string;
	name: string;
	description?: string;
	color: string;
	position: number;
	type: "backlog" | "unstarted" | "started" | "completed" | "canceled";
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
	team: LinearTeam;
}

export interface LinearIssueLabel {
	id: string;
	name: string;
	description?: string;
	color: string;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
	creator: LinearUser;
	team?: LinearTeam;
	parent?: LinearIssueLabel;
	children: LinearIssueLabel[];
}

export interface LinearCycle {
	id: string;
	number: number;
	name?: string;
	description?: string;
	startsAt: string;
	endsAt: string;
	completedAt?: string;
	autoArchivedAt?: string;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
	team: LinearTeam;
	issues: LinearIssue[];
	uncompletedIssuesUponClose: LinearIssue[];
	progress: number;
	completedIssueCountHistory: number[];
	issueCountHistory: number[];
	completedScopeHistory: number[];
	scopeHistory: number[];
}

export interface LinearMilestone {
	id: string;
	name: string;
	description?: string;
	sortOrder: number;
	targetDate?: string;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
	projects: LinearProject[];
}

export interface LinearDocument {
	id: string;
	title: string;
	content?: string;
	contentData?: Record<string, unknown>;
	slug: string;
	icon?: string;
	color?: string;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
	creator: LinearUser;
	project?: LinearProject;
}

export interface LinearProjectLink {
	id: string;
	url: string;
	label: string;
	createdAt: string;
	updatedAt: string;
	creator: LinearUser;
	project: LinearProject;
}

export interface LinearRequirement {
	id: string;
	content: string;
	position: number;
	createdAt: string;
	updatedAt: string;
	creator: LinearUser;
	project: LinearProject;
}

export interface LinearRoadmap {
	id: string;
	name: string;
	description?: string;
	slug: string;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
	creator: LinearUser;
	owner: LinearUser;
}

export interface LinearIssue {
	id: string;
	identifier: string;
	number: number;
	title: string;
	description?: string;
	priority: LinearPriority;
	estimate?: number;
	sortOrder: number;
	previousIdentifiers: string[];
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
	startedAt?: string;
	completedAt?: string;
	canceledAt?: string;
	autoArchivedAt?: string;
	autoClosedAt?: string;
	dueDate?: string;
	triagedAt?: string;
	snoozedUntilAt?: string;
	branchName?: string;
	customerTicketCount: number;
	team: LinearTeam;
	state: LinearIssueStatus;
	creator: LinearUser;
	assignee?: LinearUser;
	project?: LinearProject;
	cycle?: LinearCycle;
	parent?: LinearIssue;
	children: LinearIssue[];
	labels: LinearIssueLabel[];
	comments: LinearComment[];
	attachments: LinearAttachment[];
	relations: LinearIssueRelation[];
	subscribers: LinearUser[];
	url: string;
}

export interface LinearComment {
	id: string;
	body: string;
	bodyData?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	editedAt?: string;
	archivedAt?: string;
	user: LinearUser;
	issue: LinearIssue;
	parent?: LinearComment;
	children?: LinearComment[];
	resolvingUser?: LinearUser;
	resolvingComment?: LinearComment;
	resolvedAt?: string;
	url: string;
}

export interface LinearAttachment {
	id: string;
	title: string;
	subtitle?: string;
	url: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
	creator: LinearUser;
	issue?: LinearIssue;
	source: Record<string, unknown>;
	sourceType: string;
}

export interface LinearIssueRelation {
	id: string;
	type: "blocks" | "blocked" | "duplicate" | "related";
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
	issue: LinearIssue;
	relatedIssue: LinearIssue;
}

// Request/Response Types for MCP Integration
export interface LinearCreateIssueRequest {
	title: string;
	description?: string;
	teamId: string;
	assigneeId?: string;
	priority?: LinearPriority;
	stateId?: string;
	parentId?: string;
	projectId?: string;
	cycleId?: string;
	estimate?: number;
	dueDate?: string;
	labelIds?: string[];
	links?: LinearCreateIssueLinkInput[];
}

export interface LinearCreateIssueLinkInput {
	url: string;
	title: string;
}

export interface LinearUpdateIssueRequest {
	id: string;
	title?: string;
	description?: string;
	assigneeId?: string;
	priority?: LinearPriority;
	stateId?: string;
	parentId?: string;
	projectId?: string;
	cycleId?: string;
	estimate?: number;
	dueDate?: string;
	labelIds?: string[];
	links?: LinearCreateIssueLinkInput[];
}

export interface LinearCreateProjectRequest {
	name: string;
	description?: string;
	teamId: string;
	startDate?: string;
	targetDate?: string;
	summary?: string;
}

export interface LinearUpdateProjectRequest {
	id: string;
	name?: string;
	description?: string;
	startDate?: string;
	targetDate?: string;
	summary?: string;
}

export interface LinearCreateCommentRequest {
	issueId: string;
	body: string;
}

export interface LinearIssueSearchParams {
	query?: string;
	teamId?: string;
	assigneeId?: string;
	creatorId?: string;
	stateId?: string;
	priority?: LinearPriority;
	projectId?: string;
	cycleId?: string;
	parentId?: string;
	includeArchived?: boolean;
	limit?: number;
	after?: string;
	before?: string;
	orderBy?: "createdAt" | "updatedAt";
	createdAt?: string;
	updatedAt?: string;
}

// Processed Linear Data for TestFlight Integration
export interface LinearIssueFromTestFlight {
	title: string;
	description: string;
	teamId: string;
	priority: LinearPriority;
	labels: string[];
	links: LinearCreateIssueLinkInput[];
	assigneeId?: string;
	projectId?: string;
	metadata: {
		testflightFeedbackId: string;
		testflightFeedbackType: "crash" | "screenshot";
		appVersion: string;
		buildNumber: string;
		deviceModel: string;
		osVersion: string;
		submittedAt: string;
	};
}

// Error Handling
export interface LinearApiError {
	type: string;
	message: string;
	extensions?: {
		userPresentableMessage?: string;
		code?: string;
	};
}

export interface LinearApiResponse<T> {
	data?: T;
	errors?: LinearApiError[];
}

// Event Types for Webhook Integration (Future)
export interface LinearWebhookEvent {
	type: "Issue" | "Comment" | "Project" | "IssueLabel" | "Cycle";
	action: "create" | "update" | "remove";
	data:
		| LinearIssue
		| LinearComment
		| LinearProject
		| LinearIssueLabel
		| LinearCycle;
	updatedFrom?: Record<string, unknown>;
	url: string;
	createdAt: string;
}

// Utility Types
export type LinearEntityType =
	| "issue"
	| "project"
	| "comment"
	| "team"
	| "user"
	| "cycle"
	| "milestone";

export interface LinearEntityRef {
	id: string;
	type: LinearEntityType;
}

// Configuration for Linear Integration
export interface LinearIntegrationConfig {
	apiToken: string;
	teamId: string;
	defaultPriority: LinearPriority;
	defaultLabels: string[];
	crashLabels: string[];
	feedbackLabels: string[];
	autoAssigneeId?: string;
	defaultProjectId?: string;
	enableDuplicateDetection: boolean;
	duplicateDetectionDays: number;
}
