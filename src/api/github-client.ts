/**
 * GitHub Issues API Client
 * Secure utility for managing GitHub issues, labels, and automated issue creation from TestFlight feedback
 */

import type {
	GitHubApiError,
	GitHubApiResponse,
	GitHubComment,
	GitHubCreateIssueRequest,
	GitHubDuplicateDetectionResult,
	GitHubGist,
	GitHubIntegrationConfig,
	GitHubIssue,
	GitHubIssueCreationOptions,
	GitHubIssueCreationResult,
	GitHubIssueFromTestFlight,
	GitHubIssueSearchParams,
	GitHubLabel,
	GitHubMilestone,
	GitHubRateLimit,
	GitHubRequestOptions,
	GitHubScreenshotUpload,
	GitHubSearchResponse,
	GitHubUpdateIssueRequest,
	GitHubUser,
} from "../../types/github.js";
import type { ProcessedFeedbackData } from "../../types/testflight.js";
import {
	API_ENDPOINTS,
	DEFAULT_LABEL_CONFIG,
	DEFAULT_HTTP_CONFIG,
	getConfiguration,
} from "../config/index.js";
import { getTestFlightClient } from "./testflight-client.js";

/**
 * GitHub Issues API Client with rate limiting awareness, screenshot attachment, and secure configuration
 */
export class GitHubClient {
	private readonly config: GitHubIntegrationConfig;
	private readonly baseUrl = API_ENDPOINTS.GITHUB;
	private readonly defaultTimeout = DEFAULT_HTTP_CONFIG.timeout;
	private readonly defaultRetries = DEFAULT_HTTP_CONFIG.retries;
	private readonly defaultRetryDelay = DEFAULT_HTTP_CONFIG.retryDelay;

	private labelsCache: Map<string, GitHubLabel> = new Map();
	private milestonesCache: Map<string, GitHubMilestone> = new Map();
	private rateLimitInfo: GitHubRateLimit | null = null;
	private lastCacheUpdate: { labels?: Date; milestones?: Date } = {};

	constructor() {
		const envConfig = getConfiguration();

		if (!envConfig.github) {
			throw new Error(
				"GitHub configuration not found. Please set GTHB_TOKEN, GITHUB_OWNER, and GITHUB_REPO.",
			);
		}

		this.config = {
			token: envConfig.github.token,
			owner: envConfig.github.owner,
			repo: envConfig.github.repo,
			defaultLabels: [...DEFAULT_LABEL_CONFIG.defaultLabels],
			crashLabels: [...DEFAULT_LABEL_CONFIG.crashLabels],
			feedbackLabels: [...DEFAULT_LABEL_CONFIG.feedbackLabels],
			enableDuplicateDetection: true,
			duplicateDetectionDays: 7,
			enableScreenshotUpload: true,
			maxScreenshotSize: 25 * 1024 * 1024, // 25MB (GitHub's limit)
			rateLimitBuffer: 100, // Keep 100 requests in reserve
		};
	}

	/**
	 * Creates a GitHub issue from TestFlight feedback data
	 */
	public async createIssueFromTestFlight(
		feedback: ProcessedFeedbackData,
		options: GitHubIssueCreationOptions = {},
	): Promise<GitHubIssueCreationResult> {
		try {
			// Check for duplicates if enabled
			if (
				options.enableDuplicateDetection !== false &&
				this.config.enableDuplicateDetection
			) {
				const duplicateResult = await this.findDuplicateIssue(feedback);
				if (duplicateResult.isDuplicate && duplicateResult.existingIssue) {
					console.log(
						`Duplicate issue found: #${duplicateResult.existingIssue.number}. Adding comment instead.`,
					);
					await this.addTestFlightCommentToIssue(
						duplicateResult.existingIssue.number,
						feedback,
					);
					return {
						issue: duplicateResult.existingIssue,
						wasExisting: true,
						action: "comment_added",
						message: `Added comment to existing issue #${duplicateResult.existingIssue.number}`,
					};
				}
			}

			const issueData = await this.prepareIssueFromTestFlight(
				feedback,
				options,
			);

			// Handle screenshot attachments if enabled
			let attachmentResults:
				| {
					uploaded: number;
					failed: number;
					details: Array<{
						filename: string;
						success: boolean;
						error?: string;
						url?: string;
					}>;
				}
				| undefined;
			if (
				options.attachScreenshots !== false &&
				this.config.enableScreenshotUpload &&
				issueData.attachments.length > 0
			) {
				attachmentResults = await this.uploadScreenshots(
					issueData.attachments as GitHubScreenshotUpload[],
					feedback,
				);
				// Add screenshot links to issue body
				if (attachmentResults.uploaded > 0) {
					issueData.body += this.formatScreenshotLinks(attachmentResults);
				}
			}

			const createRequest: GitHubCreateIssueRequest = {
				title: issueData.title,
				body: issueData.body,
				labels: issueData.labels,
				assignee: options.assignee || issueData.assignee,
				assignees: options.assignees,
				milestone: options.milestone || issueData.milestone,
			};

			const createdIssue = await this.createIssue(createRequest);

			console.log(
				`✅ Created GitHub issue: #${createdIssue.number} - ${createdIssue.title}`,
			);

			return {
				issue: createdIssue,
				wasExisting: false,
				action: "created",
				message: `Created new issue #${createdIssue.number}`,
				attachments: attachmentResults,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			throw new Error(
				`Failed to create GitHub issue from TestFlight feedback: ${errorMessage}`,
			);
		}
	}

	/**
	 * Creates a new GitHub issue
	 */
	public async createIssue(
		request: GitHubCreateIssueRequest,
	): Promise<GitHubIssue> {
		const response = await this.makeApiRequest<GitHubIssue>(
			"POST",
			`/repos/${this.config.owner}/${this.config.repo}/issues`,
			request,
		);
		return response.data;
	}

	/**
	 * Updates an existing GitHub issue
	 */
	public async updateIssue(
		issueNumber: number,
		request: GitHubUpdateIssueRequest,
	): Promise<GitHubIssue> {
		const response = await this.makeApiRequest<GitHubIssue>(
			"PATCH",
			`/repos/${this.config.owner}/${this.config.repo}/issues/${issueNumber}`,
			request,
		);
		return response.data;
	}

	/**
	 * Adds a comment to an existing GitHub issue
	 */
	public async addCommentToIssue(
		issueNumber: number,
		body: string,
	): Promise<GitHubComment> {
		const response = await this.makeApiRequest<GitHubComment>(
			"POST",
			`/repos/${this.config.owner}/${this.config.repo}/issues/${issueNumber}/comments`,
			{ body },
		);
		return response.data;
	}

	/**
	 * Searches for existing issues to detect duplicates with enhanced detection and retry logic
	 */
	public async findDuplicateIssue(
		feedback: ProcessedFeedbackData,
	): Promise<GitHubDuplicateDetectionResult> {
		const maxRetries = 3;
		const retryDelay = 1000; // 1 second

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const since = new Date();
				since.setDate(since.getDate() - this.config.duplicateDetectionDays);

				// Generate feedback hash for enhanced matching
				const feedbackHash = this.generateFeedbackHash(feedback);

				// Multiple search strategies for enhanced duplicate detection
				const searchStrategies = [
					// Strategy 1: Exact TestFlight ID match
					{
						name: "exact_id",
						query: `repo:${this.config.owner}/${this.config.repo} is:issue "TestFlight ID: ${this.escapeSearchTerm(feedback.id)}"`,
						confidence: 1.0,
					},
					// Strategy 2: Feedback hash match
					{
						name: "feedback_hash",
						query: `repo:${this.config.owner}/${this.config.repo} is:issue "FEEDBACK_HASH:${feedbackHash}"`,
						confidence: 1.0,
					},
					// Strategy 3: Comment search for existing TestFlight ID
					{
						name: "comment_search",
						query: `repo:${this.config.owner}/${this.config.repo} is:issue commenter:app/github-actions "TestFlight ID: ${this.escapeSearchTerm(feedback.id)}"`,
						confidence: 0.95,
					},
				];

				// Add content-based search strategies
				if (feedback.type === "crash" && feedback.crashData?.exceptionType) {
					const escapedExceptionType = this.escapeSearchTerm(
						feedback.crashData.exceptionType,
					);
					searchStrategies.push({
						name: "exception_type",
						query: `repo:${this.config.owner}/${this.config.repo} is:issue "${escapedExceptionType}" ${feedback.appVersion}`,
						confidence: 0.8,
					});
				}

				if (feedback.screenshotData?.text) {
					const cleanText = feedback.screenshotData.text.substring(0, 50);
					const escapedText = this.escapeSearchTerm(cleanText);
					searchStrategies.push({
						name: "screenshot_text",
						query: `repo:${this.config.owner}/${this.config.repo} is:issue "${escapedText}"`,
						confidence: 0.7,
					});
				}

				// Execute search strategies in order of confidence
				for (const strategy of searchStrategies) {
					try {
						const searchParams: GitHubIssueSearchParams = {
							q: strategy.query,
							sort: "created",
							order: "desc",
							per_page: 10,
						};

						const searchResults = await this.searchIssues(searchParams);

						// Check for matches using multiple criteria
						for (const issue of searchResults.items) {
							const matchResult = this.analyzeIssueMatch(
								issue,
								feedback,
								strategy,
							);
							if (matchResult.isMatch && matchResult.confidence >= 0.7) {
								return {
									isDuplicate: true,
									existingIssue: issue,
									confidence: matchResult.confidence,
									reasons: [
										`Match found via ${strategy.name} strategy`,
										...matchResult.reasons,
									],
								};
							}
						}
					} catch (strategyError) {
						console.warn(
							`Search strategy ${strategy.name} failed: ${strategyError}`,
						);
					}
				}

				// No duplicates found
				return {
					isDuplicate: false,
					confidence: 0,
					reasons: ["No duplicates found after comprehensive search"],
				};
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);

				if (attempt === maxRetries) {
					console.error(
						`Duplicate detection failed after ${maxRetries + 1} attempts: ${errorMessage}`,
					);
					return {
						isDuplicate: false,
						confidence: 0,
						reasons: [`Duplicate detection failed: ${errorMessage}`],
					};
				}

				console.warn(
					`Duplicate detection attempt ${attempt + 1} failed: ${errorMessage}. Retrying...`,
				);
				await this.sleep(retryDelay * 2 ** attempt);
			}
		}

		// This should never be reached due to the maxRetries check above
		throw new Error("Unexpected end of retry loop");
	}

	/**
	 * Analyzes if an issue matches the given feedback
	 */
	private analyzeIssueMatch(
		issue: GitHubIssue,
		feedback: ProcessedFeedbackData,
		strategy: { name: string; confidence: number },
	): { isMatch: boolean; confidence: number; reasons: string[] } {
		const reasons: string[] = [];
		let baseConfidence = strategy.confidence;

		// Check for exact TestFlight ID in body
		if (issue.body?.includes(`TestFlight ID: ${feedback.id}`)) {
			return {
				isMatch: true,
				confidence: 1.0,
				reasons: ["Exact TestFlight ID match in issue body"],
			};
		}

		// Check for feedback hash in body
		const feedbackHash = this.generateFeedbackHash(feedback);
		if (issue.body?.includes(`FEEDBACK_HASH:${feedbackHash}`)) {
			return {
				isMatch: true,
				confidence: 1.0,
				reasons: ["Exact feedback hash match in issue body"],
			};
		}

		// Check for TestFlight ID in HTML comments
		if (issue.body?.includes(`<!-- TESTFLIGHT_ID:${feedback.id} -->`)) {
			return {
				isMatch: true,
				confidence: 1.0,
				reasons: ["TestFlight ID found in issue metadata"],
			};
		}

		// Content-based matching
		if (feedback.type === "crash" && feedback.crashData?.exceptionType) {
			const hasExceptionInTitle = issue.title.includes(
				feedback.crashData.exceptionType,
			);
			const hasExceptionInBody = issue.body?.includes(
				feedback.crashData.exceptionType,
			);

			if (hasExceptionInTitle || hasExceptionInBody) {
				reasons.push("Exception type match found");

				// Check for same app version
				if (issue.body?.includes(feedback.appVersion)) {
					reasons.push("Same app version detected");
					baseConfidence += 0.1;
				}

				// Check for same device
				if (issue.body?.includes(feedback.deviceInfo.model)) {
					reasons.push("Same device model detected");
					baseConfidence += 0.05;
				}

				return {
					isMatch: baseConfidence >= 0.7,
					confidence: Math.min(baseConfidence, 0.95),
					reasons,
				};
			}
		}

		if (feedback.screenshotData?.text && strategy.name === "screenshot_text") {
			const feedbackWords = feedback.screenshotData.text
				.toLowerCase()
				.split(/\s+/);
			const issueText = `${issue.title} ${issue.body || ""}`.toLowerCase();

			const significantWords = feedbackWords.filter((word) => word.length > 3);
			const matchingWords = significantWords.filter((word) =>
				issueText.includes(word),
			);

			if (matchingWords.length >= Math.min(3, significantWords.length * 0.4)) {
				const confidence = Math.min(
					baseConfidence,
					0.6 + (matchingWords.length / significantWords.length) * 0.3,
				);

				return {
					isMatch: confidence >= 0.7,
					confidence,
					reasons: [
						`${matchingWords.length}/${significantWords.length} significant words match`,
					],
				};
			}
		}

		return {
			isMatch: false,
			confidence: 0,
			reasons: ["No significant matches found"],
		};
	}

	/**
	 * Searches GitHub issues
	 */
	public async searchIssues(
		params: GitHubIssueSearchParams,
	): Promise<GitHubSearchResponse<GitHubIssue>> {
		const queryParams = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) {
				queryParams.append(key, value.toString());
			}
		}

		const response = await this.makeApiRequest<
			GitHubSearchResponse<GitHubIssue>
		>("GET", `/search/issues?${queryParams.toString()}`);
		return response.data;
	}

	/**
	 * Gets repository labels with caching
	 */
	public async getLabels(): Promise<GitHubLabel[]> {
		const cacheAge = this.lastCacheUpdate.labels
			? Date.now() - this.lastCacheUpdate.labels.getTime()
			: Number.POSITIVE_INFINITY;
		const cacheExpiryMs = 5 * 60 * 1000; // 5 minutes

		if (this.labelsCache.size === 0 || cacheAge > cacheExpiryMs) {
			const response = await this.makeApiRequest<GitHubLabel[]>(
				"GET",
				`/repos/${this.config.owner}/${this.config.repo}/labels?per_page=100`,
			);

			this.labelsCache.clear();
			for (const label of response.data) {
				this.labelsCache.set(label.name.toLowerCase(), label);
			}
			this.lastCacheUpdate.labels = new Date();
		}

		return Array.from(this.labelsCache.values());
	}

	/**
	 * Gets repository milestones with caching
	 */
	public async getMilestones(): Promise<GitHubMilestone[]> {
		const cacheAge = this.lastCacheUpdate.milestones
			? Date.now() - this.lastCacheUpdate.milestones.getTime()
			: Number.POSITIVE_INFINITY;
		const cacheExpiryMs = 5 * 60 * 1000; // 5 minutes

		if (this.milestonesCache.size === 0 || cacheAge > cacheExpiryMs) {
			const response = await this.makeApiRequest<GitHubMilestone[]>(
				"GET",
				`/repos/${this.config.owner}/${this.config.repo}/milestones?state=open&per_page=100`,
			);

			this.milestonesCache.clear();
			for (const milestone of response.data) {
				this.milestonesCache.set(milestone.title.toLowerCase(), milestone);
			}
			this.lastCacheUpdate.milestones = new Date();
		}

		return Array.from(this.milestonesCache.values());
	}

	/**
	 * Uploads screenshots to GitHub Gists for attachment
	 */
	private async uploadScreenshots(
		screenshots: GitHubScreenshotUpload[],
		feedback: ProcessedFeedbackData,
	): Promise<{
		uploaded: number;
		failed: number;
		details: Array<{
			filename: string;
			success: boolean;
			error?: string;
			url?: string;
		}>;
	}> {
		const results = {
			uploaded: 0,
			failed: 0,
			details: [] as Array<{
				filename: string;
				success: boolean;
				error?: string;
				url?: string;
			}>,
		};

		// Validate input
		if (!screenshots || screenshots.length === 0) {
			return results;
		}

		for (const screenshot of screenshots) {
			try {
				// Check file size - fix: convert bytes to MB for display
				if (screenshot.size > this.config.maxScreenshotSize) {
					results.failed++;
					const sizeMB = (screenshot.size / (1024 * 1024)).toFixed(2);
					const limitMB = (
						this.config.maxScreenshotSize /
						(1024 * 1024)
					).toFixed(0);
					results.details.push({
						filename: screenshot.filename,
						success: false,
						error: `File size (${sizeMB}MB) exceeds limit (${limitMB}MB)`,
					});
					continue;
				}

				// Validate content type
				if (!screenshot.contentType.startsWith("image/")) {
					results.failed++;
					results.details.push({
						filename: screenshot.filename,
						success: false,
						error: `Invalid content type: ${screenshot.contentType}. Only images are supported.`,
					});
					continue;
				}

				// Create a Gist with the screenshot - improved approach
				const gistDescription = `TestFlight Screenshot - ${feedback.type} - ${feedback.id} - ${screenshot.filename}`;

				// For binary content, we need to encode properly
				let content: string;
				if (screenshot.content instanceof Uint8Array) {
					// Convert Uint8Array to base64 for text-based Gist storage
					content = Buffer.from(screenshot.content).toString("base64");
				} else {
					// Already a string (base64 or text)
					content = screenshot.content;
				}

				const gist = await this.createGist({
					description: gistDescription,
					public: false,
					files: {
						[screenshot.filename]: {
							content: content,
						},
					},
				});

				results.uploaded++;
				results.details.push({
					filename: screenshot.filename,
					success: true,
					url: gist.html_url,
				});
			} catch (error) {
				results.failed++;
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				results.details.push({
					filename: screenshot.filename,
					success: false,
					error: errorMessage,
				});
			}
		}

		return results;
	}

	/**
	 * Creates a GitHub Gist
	 */
	private async createGist(gistData: {
		description: string;
		public: boolean;
		files: Record<string, { content: string }>;
	}): Promise<GitHubGist> {
		const response = await this.makeApiRequest<GitHubGist>(
			"POST",
			"/gists",
			gistData,
		);
		return response.data;
	}

	/**
	 * Gets current rate limit information
	 */
	public async getRateLimit(): Promise<GitHubRateLimit> {
		const response = await this.makeApiRequest<{ rate: GitHubRateLimit }>(
			"GET",
			"/rate_limit",
		);
		return response.data.rate;
	}

	/**
	 * Health check for GitHub integration
	 */
	public async healthCheck(): Promise<{
		status: "healthy" | "unhealthy";
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
	}> {
		try {
			const rateLimit = await this.getRateLimit();
			const user = await this.getCurrentUser();

			return {
				status: "healthy",
				details: {
					repository: `${this.config.owner}/${this.config.repo}`,
					currentUser: user.login,
					rateLimit: {
						remaining: rateLimit.remaining,
						limit: rateLimit.limit,
						reset: new Date(rateLimit.reset * 1000).toISOString(),
					},
					timestamp: new Date().toISOString(),
				},
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			return {
				status: "unhealthy",
				details: {
					error: errorMessage,
					repository: `${this.config.owner}/${this.config.repo}`,
					timestamp: new Date().toISOString(),
				},
			};
		}
	}

	/**
	 * Gets current authenticated user
	 */
	private async getCurrentUser(): Promise<GitHubUser> {
		const response = await this.makeApiRequest<GitHubUser>("GET", "/user");
		return response.data;
	}

	/**
	 * Makes an authenticated API request with retry logic and rate limiting
	 */
	private async makeApiRequest<T>(
		method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
		endpoint: string,
		body?: unknown,
		options: GitHubRequestOptions = {},
	): Promise<GitHubApiResponse<T>> {
		const {
			retries = this.defaultRetries,
			retryDelay = this.defaultRetryDelay,
			timeout = this.defaultTimeout,
		} = options;

		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				// Check rate limit before making request
				await this.waitForRateLimit();

				const url = endpoint.startsWith("http")
					? endpoint
					: `${this.baseUrl}${endpoint}`;

				const response = await fetch(url, {
					method,
					headers: {
						Authorization: `Bearer ${this.config.token}`,
						Accept: "application/vnd.github+json",
						"X-GitHub-Api-Version": "2022-11-28",
						"User-Agent": "TestFlight-PM/1.0",
						...(body ? { "Content-Type": "application/json" } : {}),
					},
					body: body ? JSON.stringify(body) : undefined,
					signal: AbortSignal.timeout(timeout),
				});

				// Update rate limit info
				this.updateRateLimitInfo(response);

				// Handle error responses with better error checking
				if (!response.ok) {
					const errorText = await response.text();
					let errorData: GitHubApiError;

					try {
						errorData = JSON.parse(errorText);
					} catch {
						throw new Error(`HTTP ${response.status}: ${response.statusText}`);
					}

					// Don't retry on client errors (4xx) except rate limiting
					if (
						response.status >= 400 &&
						response.status < 500 &&
						response.status !== 429
					) {
						throw new Error(
							`GitHub API Error (${response.status}): ${errorData.message || response.statusText}`,
						);
					}

					throw new Error(
						`GitHub API Error: ${errorData.message || response.statusText}`,
					);
				}

				// Parse and return response
				const data = await response.json();

				return {
					data: data as T,
					status: response.status,
					headers: Object.fromEntries(response.headers.entries()),
					rateLimit: {
						limit: Number.parseInt(
							response.headers.get("x-ratelimit-limit") || "0",
							10,
						),
						remaining: Number.parseInt(
							response.headers.get("x-ratelimit-remaining") || "0",
							10,
						),
						reset: new Date(
							Number.parseInt(
								response.headers.get("x-ratelimit-reset") || "0",
								10,
							) * 1000,
						),
					},
				};
			} catch (error) {
				lastError = error as Error;

				// Don't retry on authentication errors or client errors
				if (
					lastError.message.includes("authentication") ||
					lastError.message.includes("401") ||
					lastError.message.includes("403") ||
					lastError.message.includes("404")
				) {
					throw lastError;
				}

				// Don't retry on the last attempt
				if (attempt === retries) {
					break;
				}

				// Wait before retrying (exponential backoff)
				const delay = retryDelay * 2 ** attempt;
				await this.sleep(delay);
			}
		}

		const errorMessage = lastError?.message || "Unknown error";
		throw new Error(
			`Request failed after ${retries + 1} attempts: ${errorMessage}`,
		);
	}

	/**
	 * Updates rate limit information from response headers
	 */
	private updateRateLimitInfo(response: Response): void {
		const limit = response.headers.get("x-ratelimit-limit");
		const remaining = response.headers.get("x-ratelimit-remaining");
		const reset = response.headers.get("x-ratelimit-reset");

		if (limit && remaining && reset) {
			const resetTimestamp = Number.parseInt(reset, 10);
			// Validate the reset timestamp
			if (!Number.isNaN(resetTimestamp) && resetTimestamp > 0) {
				this.rateLimitInfo = {
					limit: Number.parseInt(limit, 10),
					remaining: Number.parseInt(remaining, 10),
					reset: resetTimestamp,
					used: 0,
					resource: "core",
				};
			}
		}
	}

	/**
	 * Waits if we're close to hitting rate limits
	 */
	private async waitForRateLimit(): Promise<void> {
		if (!this.rateLimitInfo) {
			return;
		}

		// If we're close to the buffer limit, wait until reset
		if (this.rateLimitInfo.remaining <= this.config.rateLimitBuffer) {
			const now = Math.floor(Date.now() / 1000);
			const waitTime = (this.rateLimitInfo.reset - now) * 1000;

			// Only wait if the wait time is positive and reasonable (max 1 hour)
			if (waitTime > 0 && waitTime <= 3600000) {
				console.log(
					`Rate limit approaching. Waiting ${Math.ceil(waitTime / 1000)} seconds...`,
				);
				await this.sleep(waitTime);
			}
		}
	}

	/**
	 * Prepares issue data from TestFlight feedback
	 */
	private async prepareIssueFromTestFlight(
		feedback: ProcessedFeedbackData,
		options: GitHubIssueCreationOptions,
	): Promise<GitHubIssueFromTestFlight> {
		const isCrash = feedback.type === "crash";
		const typeIcon = isCrash ? "💥" : "📱";
		const typeLabel = isCrash ? "Crash Report" : "User Feedback";

		// Generate title
		let title =
			options.customTitle ||
			`${typeIcon} ${typeLabel}: ${feedback.appVersion} (${feedback.buildNumber})`;

		if (isCrash && feedback.crashData?.exceptionType) {
			title += ` - ${feedback.crashData.exceptionType}`;
		} else if (feedback.screenshotData?.text) {
			const shortText = feedback.screenshotData.text.substring(0, 40);
			title += ` - ${shortText}${shortText.length < feedback.screenshotData.text.length ? "..." : ""}`;
		}

		// Generate description
		const body = options.customBody || this.formatIssueBody(feedback);

		// Determine labels
		const baseLabels = isCrash
			? this.config.crashLabels
			: this.config.feedbackLabels;
		const allLabels = [
			...this.config.defaultLabels,
			...baseLabels,
			...(options.additionalLabels || []),
		];

		// Prepare screenshot attachments with proper validation
		const attachments: GitHubScreenshotUpload[] = [];
		if (
			feedback.screenshotData?.images &&
			this.config.enableScreenshotUpload &&
			feedback.screenshotData.images.length > 0
		) {
			const testFlightClient = getTestFlightClient();

			try {
				const screenshots = await testFlightClient.downloadScreenshots({
					id: feedback.id,
					type: "betaFeedbackScreenshotSubmissions",
					attributes: {
						submittedAt: feedback.submittedAt.toISOString(),
						appVersion: feedback.appVersion,
						buildNumber: feedback.buildNumber,
						deviceFamily: feedback.deviceInfo.family,
						deviceModel: feedback.deviceInfo.model,
						osVersion: feedback.deviceInfo.osVersion,
						locale: feedback.deviceInfo.locale,
						bundleId: feedback.bundleId,
						feedbackText: feedback.screenshotData.text || "",
						screenshots: feedback.screenshotData.images.map((img, _index) => ({
							url: img.url,
							fileName: img.fileName,
							fileSize: img.fileSize,
							expiresAt: img.expiresAt.toISOString(),
						})),
						annotations: feedback.screenshotData.annotations || [],
					},
					relationships: {},
				});

				screenshots.forEach((screenshot, index) => {
					const imageInfo = feedback.screenshotData?.images?.[index];
					if (imageInfo) {
						attachments.push({
							filename: imageInfo.fileName,
							content: screenshot,
							contentType: "image/png",
							size: screenshot.length,
						});
					}
				});
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				console.warn(
					`Failed to download screenshots for issue: ${errorMessage}`,
				);
			}
		}

		return {
			title,
			body,
			labels: allLabels,
			assignee: this.config.defaultAssignee,
			milestone: this.config.defaultMilestone,
			attachments,
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
	 * Formats the issue body from TestFlight feedback
	 */
	private formatIssueBody(feedback: ProcessedFeedbackData): string {
		const isCrash = feedback.type === "crash";
		const typeIcon = isCrash ? "💥" : "📱";
		const typeLabel = isCrash ? "Crash Report" : "User Feedback";

		let body = `## ${typeIcon} ${typeLabel} from TestFlight\n\n`;

		// Add multiple unique identifiers for enhanced duplicate detection
		body += `<!-- TESTFLIGHT_ID:${feedback.id} -->\n`;
		body += `<!-- FEEDBACK_HASH:${this.generateFeedbackHash(feedback)} -->\n`;
		body += `<!-- CREATION_TIMESTAMP:${Date.now()} -->\n\n`;

		// Metadata table
		body += "| Field | Value |\n";
		body += "|-------|-------|\n";
		body += `| **TestFlight ID** | \`${feedback.id}\` |\n`;
		body += `| **App Version** | ${feedback.appVersion} (Build ${feedback.buildNumber}) |\n`;
		body += `| **Submitted** | ${feedback.submittedAt.toISOString()} |\n`;
		body += `| **Device** | ${feedback.deviceInfo.model} |\n`;
		body += `| **OS Version** | ${feedback.deviceInfo.osVersion} |\n`;
		body += `| **Locale** | ${feedback.deviceInfo.locale} |\n\n`;

		if (isCrash && feedback.crashData) {
			body += "### 🔍 Crash Details\n\n";
			body += `**Type:** ${feedback.crashData.type}\n\n`;

			if (feedback.crashData.exceptionType) {
				body += `**Exception:** \`${feedback.crashData.exceptionType}\`\n\n`;
			}

			if (feedback.crashData.exceptionMessage) {
				body += `**Message:**\n\`\`\`\n${feedback.crashData.exceptionMessage}\n\`\`\`\n\n`;
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
			body += "### 📝 User Feedback\n\n";

			if (feedback.screenshotData.text) {
				body += `**Feedback Text:**\n> ${feedback.screenshotData.text.replace(/\n/g, "\n> ")}\n\n`;
			}

			if (feedback.screenshotData.images.length > 0) {
				body += `**Screenshots:** ${feedback.screenshotData.images.length} attached\n\n`;
			}

			if (
				feedback.screenshotData.annotations &&
				feedback.screenshotData.annotations.length > 0
			) {
				body += `**Annotations:** ${feedback.screenshotData.annotations.length} user annotation(s)\n\n`;
			}
		}

		// Technical details
		body += "### 🛠️ Technical Information\n\n";
		body += "<details>\n<summary>Device & Environment Details</summary>\n\n";
		body += `- **Device Family:** ${feedback.deviceInfo.family}\n`;
		body += `- **Device Model:** ${feedback.deviceInfo.model}\n`;
		body += `- **OS Version:** ${feedback.deviceInfo.osVersion}\n`;
		body += `- **Locale:** ${feedback.deviceInfo.locale}\n`;
		body += `- **Bundle ID:** ${feedback.bundleId}\n`;
		body += `- **Submission Time:** ${feedback.submittedAt.toISOString()}\n`;
		body += "\n</details>\n\n";

		body += `---\n*Automatically created from TestFlight feedback. ID: \`${feedback.id}\`*`;

		return body;
	}

	/**
	 * Formats screenshot links for inclusion in issue body
	 */
	private formatScreenshotLinks(attachmentResults: {
		uploaded: number;
		failed: number;
		details: Array<{ filename: string; success: boolean; url?: string }>;
	}): string {
		let screenshotSection = "\n\n### 📸 Screenshots\n\n";

		for (const detail of attachmentResults.details) {
			if (detail.success && detail.url) {
				screenshotSection += `- [${detail.filename}](${detail.url})\n`;
			} else {
				screenshotSection += `- ❌ ${detail.filename} (failed to upload)\n`;
			}
		}

		if (attachmentResults.failed > 0) {
			screenshotSection += `\n*Note: ${attachmentResults.failed} screenshot(s) failed to upload*\n`;
		}

		return screenshotSection;
	}

	/**
	 * Adds a TestFlight-specific comment to an existing issue
	 */
	private async addTestFlightCommentToIssue(
		issueNumber: number,
		feedback: ProcessedFeedbackData,
	): Promise<GitHubComment> {
		const typeIcon = feedback.type === "crash" ? "💥" : "📱";

		let commentBody = `${typeIcon} **Additional TestFlight ${feedback.type} report**\n\n`;
		commentBody += `**TestFlight ID:** ${feedback.id}\n`;
		commentBody += `**Submitted:** ${feedback.submittedAt.toISOString()}\n`;
		commentBody += `**Device:** ${feedback.deviceInfo.model} (${feedback.deviceInfo.osVersion})\n`;

		if (feedback.screenshotData?.text) {
			commentBody += `\n**User Feedback:**\n> ${feedback.screenshotData.text}`;
		}

		return await this.addCommentToIssue(issueNumber, commentBody);
	}

	/**
	 * Escapes special characters in search terms to prevent search injection
	 */
	private escapeSearchTerm(term: string): string {
		return term.replace(/['"\\]/g, "\\$&");
	}

	/**
	 * Generates a unique hash for feedback content to aid in duplicate detection
	 */
	private generateFeedbackHash(feedback: ProcessedFeedbackData): string {
		const hashInput = [
			feedback.id,
			feedback.type,
			feedback.appVersion,
			feedback.buildNumber,
			feedback.deviceInfo.model,
			feedback.deviceInfo.osVersion,
			feedback.crashData?.exceptionType || "",
			feedback.screenshotData?.text?.substring(0, 100) || "",
		].join("|");

		// Simple hash function for duplicate detection
		let hash = 0;
		for (let i = 0; i < hashInput.length; i++) {
			const char = hashInput.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash &= hash; // Convert to 32-bit integer
		}

		return Math.abs(hash).toString(36);
	}

	/**
	 * Utility function for sleeping/waiting
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

/**
 * Global GitHub client instance
 * Singleton pattern for GitHub client management
 */
let _githubClientInstance: GitHubClient | null = null;

export function getGitHubClient(): GitHubClient {
	if (!_githubClientInstance) {
		_githubClientInstance = new GitHubClient();
	}
	return _githubClientInstance;
}

/**
 * Clears the global GitHub client instance (useful for testing)
 */
export function clearGitHubClientInstance(): void {
	_githubClientInstance = null;
}

/**
 * Utility function to validate GitHub configuration
 */
export function validateGitHubConfig(): boolean {
	try {
		const config = getConfiguration();
		return !!(
			config.github?.token &&
			config.github?.owner &&
			config.github?.repo
		);
	} catch {
		return false;
	}
}
