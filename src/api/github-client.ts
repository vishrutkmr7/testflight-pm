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
import { API_ENDPOINTS, HTTP_CONFIG } from "../config/constants.js";
import { getConfig } from "../config/environment.js";
import { getTestFlightClient } from "./testflight-client.js";

/**
 * GitHub Issues API Client with rate limiting awareness, screenshot attachment, and secure configuration
 */
export class GitHubClient {
	private readonly config: GitHubIntegrationConfig;
	private readonly baseUrl = API_ENDPOINTS.GITHUB;
	private readonly defaultTimeout = HTTP_CONFIG.DEFAULT_TIMEOUT;
	private readonly defaultRetries = HTTP_CONFIG.DEFAULT_RETRIES;
	private readonly defaultRetryDelay = HTTP_CONFIG.DEFAULT_RETRY_DELAY;

	private labelsCache: Map<string, GitHubLabel> = new Map();
	private milestonesCache: Map<string, GitHubMilestone> = new Map();
	private rateLimitInfo: GitHubRateLimit | null = null;
	private lastCacheUpdate: { labels?: Date; milestones?: Date } = {};

	constructor() {
		const envConfig = getConfig();

		if (!envConfig.github) {
			throw new Error(
				"GitHub configuration not found. Please set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO.",
			);
		}

		this.config = {
			token: envConfig.github.token,
			owner: envConfig.github.owner,
			repo: envConfig.github.repo,
			defaultLabels: ["testflight", "feedback"],
			crashLabels: ["bug", "crash", "urgent"],
			feedbackLabels: ["enhancement", "user-feedback"],
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
	 * Searches for existing issues to detect duplicates
	 */
	public async findDuplicateIssue(
		feedback: ProcessedFeedbackData,
	): Promise<GitHubDuplicateDetectionResult> {
		try {
			const since = new Date();
			since.setDate(since.getDate() - this.config.duplicateDetectionDays);

			// Build search query with proper escaping
			const searchTerms: string[] = [
				`repo:${this.config.owner}/${this.config.repo}`,
				"is:issue",
				`created:>=${since.toISOString().split("T")[0]}`,
				`"TestFlight ID: ${this.escapeSearchTerm(feedback.id)}"`, // Exact TestFlight ID match
			];

			// Add additional search terms based on feedback type
			if (feedback.type === "crash" && feedback.crashData?.exceptionType) {
				const escapedExceptionType = this.escapeSearchTerm(
					feedback.crashData.exceptionType,
				);
				searchTerms.push(`"${escapedExceptionType}"`);
			}

			if (feedback.screenshotData?.text) {
				const cleanText = feedback.screenshotData.text.substring(0, 50);
				const escapedText = this.escapeSearchTerm(cleanText);
				searchTerms.push(`"${escapedText}"`);
			}

			const searchQuery = searchTerms.join(" ");

			const searchParams: GitHubIssueSearchParams = {
				q: searchQuery,
				sort: "created",
				order: "desc",
				per_page: 5,
			};

			const searchResults = await this.searchIssues(searchParams);

			// Look for exact matches based on TestFlight feedback ID
			const exactMatch = searchResults.items.find((issue) =>
				issue.body?.includes(`TestFlight ID: ${feedback.id}`),
			);

			if (exactMatch) {
				return {
					isDuplicate: true,
					existingIssue: exactMatch,
					confidence: 1.0,
					reasons: ["Exact TestFlight ID match found in issue body"],
				};
			}

			// Look for potential duplicates based on content similarity
			const potentialDuplicate = searchResults.items.find((issue) => {
				if (feedback.type === "crash" && feedback.crashData?.exceptionType) {
					return (
						issue.title.includes(feedback.crashData.exceptionType) ||
						issue.body?.includes(feedback.crashData.exceptionType)
					);
				}
				if (feedback.screenshotData?.text) {
					const feedbackWords = feedback.screenshotData.text
						.toLowerCase()
						.split(" ");
					const issueText = (
						issue.title +
						" " +
						(issue.body || "")
					).toLowerCase();
					const matchingWords = feedbackWords.filter(
						(word) => word.length > 3 && issueText.includes(word),
					).length;
					return matchingWords >= Math.min(3, feedbackWords.length * 0.3);
				}
				return false;
			});

			if (potentialDuplicate) {
				return {
					isDuplicate: true,
					existingIssue: potentialDuplicate,
					confidence: 0.7,
					reasons: ["Content similarity detected"],
				};
			}

			return {
				isDuplicate: false,
				confidence: 0,
				reasons: ["No similar issues found"],
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.warn(`Failed to search for duplicate issues: ${errorMessage}`);
			return {
				isDuplicate: false,
				confidence: 0,
				reasons: ["Duplicate detection failed"],
			};
		}
	}

	/**
	 * Searches GitHub issues
	 */
	public async searchIssues(
		params: GitHubIssueSearchParams,
	): Promise<GitHubSearchResponse<GitHubIssue>> {
		const queryParams = new URLSearchParams();
		Object.entries(params).forEach(([key, value]) => {
			if (value !== undefined) {
				queryParams.append(key, value.toString());
			}
		});

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
			: Infinity;
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
			: Infinity;
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
		details: any;
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
		body?: any,
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
						limit: parseInt(
							response.headers.get("x-ratelimit-limit") || "0",
							10,
						),
						remaining: parseInt(
							response.headers.get("x-ratelimit-remaining") || "0",
							10,
						),
						reset: new Date(
							parseInt(response.headers.get("x-ratelimit-reset") || "0", 10) *
								1000,
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
			const resetTimestamp = parseInt(reset, 10);
			// Validate the reset timestamp
			if (!Number.isNaN(resetTimestamp) && resetTimestamp > 0) {
				this.rateLimitInfo = {
					limit: parseInt(limit, 10),
					remaining: parseInt(remaining, 10),
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
		if (!this.rateLimitInfo) return;

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
					type: "betaFeedbackScreenshotSubmission",
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
				} as any);

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

		// Metadata table
		body += `| Field | Value |\n`;
		body += `|-------|-------|\n`;
		body += `| **TestFlight ID** | \`${feedback.id}\` |\n`;
		body += `| **App Version** | ${feedback.appVersion} (Build ${feedback.buildNumber}) |\n`;
		body += `| **Submitted** | ${feedback.submittedAt.toISOString()} |\n`;
		body += `| **Device** | ${feedback.deviceInfo.model} |\n`;
		body += `| **OS Version** | ${feedback.deviceInfo.osVersion} |\n`;
		body += `| **Locale** | ${feedback.deviceInfo.locale} |\n\n`;

		if (isCrash && feedback.crashData) {
			body += `### 🔍 Crash Details\n\n`;
			body += `**Type:** ${feedback.crashData.type}\n\n`;

			if (feedback.crashData.exceptionType) {
				body += `**Exception:** \`${feedback.crashData.exceptionType}\`\n\n`;
			}

			if (feedback.crashData.exceptionMessage) {
				body += `**Message:**\n\`\`\`\n${feedback.crashData.exceptionMessage}\n\`\`\`\n\n`;
			}

			body += `### Stack Trace\n\`\`\`\n${feedback.crashData.trace}\n\`\`\`\n\n`;

			if (feedback.crashData.logs.length > 0) {
				body += `### Crash Logs\n`;
				feedback.crashData.logs.forEach((log, index) => {
					body += `- [Crash Log ${index + 1}](${log.url}) (expires: ${log.expiresAt.toLocaleDateString()})\n`;
				});
				body += `\n`;
			}
		}

		if (feedback.screenshotData) {
			body += `### 📝 User Feedback\n\n`;

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
		body += `### 🛠️ Technical Information\n\n`;
		body += `<details>\n<summary>Device & Environment Details</summary>\n\n`;
		body += `- **Device Family:** ${feedback.deviceInfo.family}\n`;
		body += `- **Device Model:** ${feedback.deviceInfo.model}\n`;
		body += `- **OS Version:** ${feedback.deviceInfo.osVersion}\n`;
		body += `- **Locale:** ${feedback.deviceInfo.locale}\n`;
		body += `- **Bundle ID:** ${feedback.bundleId}\n`;
		body += `- **Submission Time:** ${feedback.submittedAt.toISOString()}\n`;
		body += `\n</details>\n\n`;

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
		let screenshotSection = `\n\n### 📸 Screenshots\n\n`;

		attachmentResults.details.forEach((detail) => {
			if (detail.success && detail.url) {
				screenshotSection += `- [${detail.filename}](${detail.url})\n`;
			} else {
				screenshotSection += `- ❌ ${detail.filename} (failed to upload)\n`;
			}
		});

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
		const config = getConfig();
		return !!(
			config.github?.token &&
			config.github?.owner &&
			config.github?.repo
		);
	} catch {
		return false;
	}
}
