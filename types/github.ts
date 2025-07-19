/**
 * GitHub Issues API Type Definitions
 * Complete type definitions for GitHub REST API v4 integration
 */

/**
 * Core GitHub API Types
 */
export interface GitHubUser {
    id: number;
    login: string;
    name?: string;
    email?: string;
    avatar_url: string;
    html_url: string;
    type: 'User' | 'Bot' | 'Organization';
}

export interface GitHubLabel {
    id: number;
    name: string;
    color: string;
    description?: string;
    default: boolean;
    url: string;
}

export interface GitHubMilestone {
    id: number;
    number: number;
    title: string;
    description?: string;
    state: 'open' | 'closed';
    created_at: string;
    updated_at: string;
    due_on?: string;
    closed_at?: string;
    html_url: string;
}

export interface GitHubRepository {
    id: number;
    name: string;
    full_name: string;
    owner: GitHubUser;
    private: boolean;
    html_url: string;
    description?: string;
    default_branch: string;
}

/**
 * GitHub Issue Types
 */
export interface GitHubIssue {
    id: number;
    number: number;
    title: string;
    body?: string;
    state: 'open' | 'closed';
    state_reason?: 'completed' | 'reopened' | 'not_planned';
    user: GitHubUser;
    assignee?: GitHubUser;
    assignees: GitHubUser[];
    labels: GitHubLabel[];
    milestone?: GitHubMilestone;
    locked: boolean;
    comments: number;
    created_at: string;
    updated_at: string;
    closed_at?: string;
    html_url: string;
    url: string;
    repository?: GitHubRepository;
}

export interface GitHubComment {
    id: number;
    body: string;
    user: GitHubUser;
    created_at: string;
    updated_at: string;
    html_url: string;
    url: string;
    issue_url: string;
}

/**
 * GitHub API Request/Response Types
 */
export interface GitHubCreateIssueRequest {
    title: string;
    body?: string;
    assignee?: string;
    assignees?: string[];
    milestone?: number;
    labels?: (string | GitHubLabel)[];
}

export interface GitHubUpdateIssueRequest {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    state_reason?: 'completed' | 'reopened' | 'not_planned';
    assignee?: string | null;
    assignees?: string[];
    milestone?: number | null;
    labels?: (string | GitHubLabel)[];
}

export interface GitHubCreateCommentRequest {
    body: string;
}

export interface GitHubIssueSearchParams {
    q?: string;
    sort?: 'created' | 'updated' | 'comments';
    order?: 'asc' | 'desc';
    per_page?: number;
    page?: number;
    state?: 'open' | 'closed' | 'all';
    labels?: string;
    assignee?: string;
    creator?: string;
    mentioned?: string;
    milestone?: string;
    since?: string;
}

export interface GitHubSearchResponse<T> {
    total_count: number;
    incomplete_results: boolean;
    items: T[];
}

export interface GitHubApiError {
    message: string;
    documentation_url?: string;
    errors?: Array<{
        field?: string;
        code: string;
        message?: string;
        resource?: string;
    }>;
}

export interface GitHubRateLimit {
    limit: number;
    remaining: number;
    reset: number;
    used: number;
    resource: string;
}

export interface GitHubRateLimitResponse {
    rate: GitHubRateLimit;
    search: GitHubRateLimit;
    core: GitHubRateLimit;
    graphql: GitHubRateLimit;
}

/**
 * TestFlight Integration Types
 */
export interface GitHubIssueFromTestFlight {
    title: string;
    body: string;
    labels: string[];
    assignee?: string;
    milestone?: number;
    attachments: GitHubIssueAttachment[];
    metadata: {
        testflightFeedbackId: string;
        testflightFeedbackType: 'crash' | 'screenshot';
        appVersion: string;
        buildNumber: string;
        deviceModel: string;
        osVersion: string;
        submittedAt: string;
    };
}

export interface GitHubIssueAttachment {
    filename: string;
    content: string | Uint8Array;
    contentType: string;
    description?: string;
}

/**
 * GitHub Client Configuration
 */
export interface GitHubIntegrationConfig {
    token: string;
    owner: string;
    repo: string;
    defaultLabels: string[];
    crashLabels: string[];
    feedbackLabels: string[];
    defaultAssignee?: string;
    defaultMilestone?: number;
    enableDuplicateDetection: boolean;
    duplicateDetectionDays: number;
    enableScreenshotUpload: boolean;
    maxScreenshotSize: number; // in bytes
    rateLimitBuffer: number; // requests to keep in reserve
}

/**
 * GitHub Issue Creation Options
 */
export interface GitHubIssueCreationOptions {
    assignee?: string;
    assignees?: string[];
    milestone?: number;
    additionalLabels?: string[];
    enableDuplicateDetection?: boolean;
    customTitle?: string;
    customBody?: string;
    attachScreenshots?: boolean;
}

/**
 * GitHub Issue Creation Result
 */
export interface GitHubIssueCreationResult {
    issue: GitHubIssue;
    wasExisting: boolean;
    action: 'created' | 'updated' | 'comment_added';
    message: string;
    attachments?: {
        uploaded: number;
        failed: number;
        details: Array<{
            filename: string;
            success: boolean;
            error?: string;
            url?: string;
        }>;
    };
}

/**
 * GitHub Priority Mapping
 */
export type GitHubPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface GitHubPriorityConfig {
    [key: string]: {
        labels: string[];
        assignee?: string;
        milestone?: number;
    };
}

/**
 * Utility Types
 */
export interface GitHubApiResponse<T> {
    data: T;
    status: number;
    headers: Record<string, string>;
    rateLimit: {
        limit: number;
        remaining: number;
        reset: Date;
    };
}

export interface GitHubRequestOptions {
    retries?: number;
    retryDelay?: number;
    timeout?: number;
    includeRateLimit?: boolean;
}

/**
 * Screenshot Upload Types
 */
export interface GitHubScreenshotUpload {
    filename: string;
    content: Uint8Array;
    contentType: string;
    size: number;
}

export interface GitHubGistFile {
    filename: string;
    content: string;
}

export interface GitHubGist {
    id: string;
    html_url: string;
    description: string;
    public: boolean;
    files: Record<string, {
        filename: string;
        type: string;
        language?: string;
        raw_url: string;
        size: number;
        content?: string;
    }>;
    created_at: string;
    updated_at: string;
}

/**
 * Duplicate Detection Types
 */
export interface GitHubDuplicateDetectionResult {
    isDuplicate: boolean;
    existingIssue?: GitHubIssue;
    confidence: number;
    reasons: string[];
}

/**
 * All types are exported via their interface declarations above
 * This file provides comprehensive GitHub API integration types
 */ 