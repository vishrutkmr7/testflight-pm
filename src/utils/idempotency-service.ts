/**
 * Idempotency Service for TestFlight PM Action
 * Coordinates duplicate detection across GitHub and Linear platforms
 * Implements robust retry mechanisms and multiple identifier matching
 */

import type { GitHubIssueCreationResult } from "../../types/github.js";
import type { ProcessedFeedbackData } from "../../types/testflight.js";
import { getGitHubClient } from "../api/github-client.js";
import { getLinearClient } from "../api/linear-client.js";
import { DEFAULT_HTTP_CONFIG } from "../config/index.js";
import type { LinearIssueCreationResult } from "../utils/linear-utils.js";
import { getStateManager } from "./state-manager.js";

export interface IdempotencyConfig {
	enableStateTracking: boolean;
	enableGitHubDuplicateDetection: boolean;
	enableLinearDuplicateDetection: boolean;
	retryAttempts: number;
	retryDelayMs: number;
	searchTimeoutMs: number;
	confidenceThreshold: number;
}

export interface DuplicateDetectionResult {
	isDuplicate: boolean;
	platform: "github" | "linear" | "state" | "none";
	existingIssue?: {
		id: string;
		url: string;
		number?: number;
		identifier?: string;
		title: string;
	};
	confidence: number;
	reasons: string[];
	searchDuration: number;
}

export interface CreateIssueOptions {
	preferredPlatform?: "github" | "linear" | "both";
	skipDuplicateDetection?: boolean;
	actionRunId?: string;
	customMetadata?: Record<string, unknown>;
}

export interface CreateIssueResult {
	github?: GitHubIssueCreationResult;
	linear?: LinearIssueCreationResult;
	duplicateDetection: DuplicateDetectionResult;
	processedBy: ("github" | "linear")[];
	totalDuration: number;
	errors: string[];
}

/**
 * Idempotency Service for coordinated duplicate detection and issue creation
 */
export class IdempotencyService {
	private readonly config: IdempotencyConfig;

	constructor(config?: Partial<IdempotencyConfig>) {
		this.config = {
			enableStateTracking: true,
			enableGitHubDuplicateDetection: true,
			enableLinearDuplicateDetection: true,
			retryAttempts: DEFAULT_HTTP_CONFIG.retries,
			retryDelayMs: DEFAULT_HTTP_CONFIG.retryDelay,
			searchTimeoutMs: 10000, // 10 seconds max for duplicate search
			confidenceThreshold: 0.7, // Minimum confidence for duplicate detection
			...config,
		};
	}

	/**
	 * Creates issues with comprehensive duplicate detection
	 */
	public async createIssueWithDuplicateProtection(
		feedback: ProcessedFeedbackData,
		options: CreateIssueOptions = {},
	): Promise<CreateIssueResult> {
		const startTime = Date.now();

		const result: CreateIssueResult = {
			duplicateDetection: {
				isDuplicate: false,
				platform: "none",
				confidence: 0,
				reasons: [],
				searchDuration: 0,
			},
			processedBy: [],
			totalDuration: 0,
			errors: [],
		};

		try {
			// Step 1: Check if already processed via state tracking
			if (this.config.enableStateTracking && !options.skipDuplicateDetection) {
				const stateResult = await this.checkStateForDuplicate(feedback);
				if (stateResult.isDuplicate) {
					result.duplicateDetection = stateResult;
					result.totalDuration = Date.now() - startTime;
					return result;
				}
			}

			// Step 2: Comprehensive duplicate detection across platforms
			if (!options.skipDuplicateDetection) {
				const duplicateResult =
					await this.performComprehensiveDuplicateCheck(feedback);

				if (
					duplicateResult.isDuplicate &&
					duplicateResult.confidence >= this.config.confidenceThreshold
				) {
					result.duplicateDetection = duplicateResult;

					// Add comment to existing issue if found
					await this.addCommentToExistingIssue(feedback, duplicateResult);

					result.totalDuration = Date.now() - startTime;
					return result;
				}

				result.duplicateDetection = duplicateResult;
			}

			// Step 3: Create new issues on requested platforms
			const { preferredPlatform = "both" } = options;

			// Create GitHub issue if requested
			if (preferredPlatform === "github" || preferredPlatform === "both") {
				try {
					const githubClient = getGitHubClient();
					result.github = await githubClient.createIssueFromTestFlight(
						feedback,
						{
							enableDuplicateDetection: false, // We've already done comprehensive checking
						},
					);
					result.processedBy.push("github");
				} catch (error) {
					result.errors.push(`GitHub: ${(error as Error).message}`);
				}
			}

			// Create Linear issue if requested
			if (preferredPlatform === "linear" || preferredPlatform === "both") {
				try {
					const linearClient = getLinearClient();
					const linearIssue = await linearClient.createIssueFromTestFlight(
						feedback,
						[], // additionalLabels
						undefined, // assigneeId
						undefined, // projectId
						undefined, // options - no enhancement for standard creation
					);

					// Convert to LinearIssueCreationResult format
					result.linear = {
						issue: linearIssue,
						wasExisting: false,
						action: "created",
						message: `Created new Linear issue ${linearIssue.identifier}`,
					};
					result.processedBy.push("linear");
				} catch (error) {
					result.errors.push(`Linear: ${(error as Error).message}`);
				}
			}

			// Step 4: Update state tracking
			if (this.config.enableStateTracking) {
				try {
					const stateManager = getStateManager();
					await stateManager.markAsProcessed(
						[feedback.id],
						options.actionRunId,
					);
				} catch (error) {
					console.warn(`Failed to update state tracking: ${error}`);
					result.errors.push(`State tracking: ${(error as Error).message}`);
				}
			}

			result.totalDuration = Date.now() - startTime;
			return result;
		} catch (error) {
			result.errors.push(`Service error: ${(error as Error).message}`);
			result.totalDuration = Date.now() - startTime;
			throw error;
		}
	}

	/**
	 * Checks state manager for already processed feedback
	 */
	private async checkStateForDuplicate(
		feedback: ProcessedFeedbackData,
	): Promise<DuplicateDetectionResult> {
		const startTime = Date.now();

		try {
			const stateManager = getStateManager();
			const isProcessed = await stateManager.isProcessed(feedback.id);

			if (isProcessed) {
				const stats = await stateManager.getStats();
				return {
					isDuplicate: true,
					platform: "state",
					confidence: 1.0,
					reasons: [
						`Feedback ID ${feedback.id} already processed`,
						`Last processed: ${stats.lastProcessedAt}`,
						`Run ID: ${stats.actionRunId || "unknown"}`,
					],
					searchDuration: Date.now() - startTime,
				};
			}

			return {
				isDuplicate: false,
				platform: "state",
				confidence: 0,
				reasons: ["Not found in state tracking"],
				searchDuration: Date.now() - startTime,
			};
		} catch (error) {
			console.warn(`State duplicate check failed: ${error}`);
			return {
				isDuplicate: false,
				platform: "state",
				confidence: 0,
				reasons: [`State check failed: ${(error as Error).message}`],
				searchDuration: Date.now() - startTime,
			};
		}
	}

	/**
	 * Performs comprehensive duplicate detection across platforms
	 */
	private async performComprehensiveDuplicateCheck(
		feedback: ProcessedFeedbackData,
	): Promise<DuplicateDetectionResult> {
		const startTime = Date.now();
		const results: DuplicateDetectionResult[] = [];

		// Check GitHub for duplicates
		if (this.config.enableGitHubDuplicateDetection) {
			try {
				const githubResult = await this.checkGitHubForDuplicates(feedback);
				results.push(githubResult);
			} catch (error) {
				console.warn(`GitHub duplicate check failed: ${error}`);
				results.push({
					isDuplicate: false,
					platform: "github",
					confidence: 0,
					reasons: [`GitHub search failed: ${(error as Error).message}`],
					searchDuration: 0,
				});
			}
		}

		// Check Linear for duplicates
		if (this.config.enableLinearDuplicateDetection) {
			try {
				const linearResult = await this.checkLinearForDuplicates(feedback);
				results.push(linearResult);
			} catch (error) {
				console.warn(`Linear duplicate check failed: ${error}`);
				results.push({
					isDuplicate: false,
					platform: "linear",
					confidence: 0,
					reasons: [`Linear search failed: ${(error as Error).message}`],
					searchDuration: 0,
				});
			}
		}

		// Return the highest confidence duplicate result
		const duplicateResults = results.filter((r) => r.isDuplicate);
		if (duplicateResults.length > 0) {
			const bestMatch = duplicateResults.reduce((best, current) =>
				current.confidence > best.confidence ? current : best,
			);

			bestMatch.searchDuration = Date.now() - startTime;
			bestMatch.reasons.push(
				...results
					.flatMap((r) => r.reasons)
					.filter((reason) => !bestMatch.reasons.includes(reason)),
			);

			return bestMatch;
		}

		// No duplicates found
		return {
			isDuplicate: false,
			platform: "none",
			confidence: 0,
			reasons: results.flatMap((r) => r.reasons),
			searchDuration: Date.now() - startTime,
		};
	}

	/**
	 * Checks GitHub for duplicate issues with retry logic
	 */
	private async checkGitHubForDuplicates(
		feedback: ProcessedFeedbackData,
	): Promise<DuplicateDetectionResult> {
		const startTime = Date.now();

		for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
			try {
				const githubClient = getGitHubClient();
				const duplicateResult = await Promise.race([
					githubClient.findDuplicateIssue(feedback),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error("Search timeout")),
							this.config.searchTimeoutMs,
						),
					),
				]);

				if (duplicateResult.isDuplicate && duplicateResult.existingIssue) {
					return {
						isDuplicate: true,
						platform: "github",
						existingIssue: {
							id: duplicateResult.existingIssue.id.toString(),
							url: duplicateResult.existingIssue.html_url,
							number: duplicateResult.existingIssue.number,
							title: duplicateResult.existingIssue.title,
						},
						confidence: duplicateResult.confidence,
						reasons: duplicateResult.reasons,
						searchDuration: Date.now() - startTime,
					};
				}

				return {
					isDuplicate: false,
					platform: "github",
					confidence: 0,
					reasons: duplicateResult.reasons,
					searchDuration: Date.now() - startTime,
				};
			} catch (error) {
				if (attempt === this.config.retryAttempts) {
					throw error;
				}

				const delay = this.config.retryDelayMs * 2 ** attempt;
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		throw new Error("All retry attempts failed");
	}

	/**
	 * Checks Linear for duplicate issues with retry logic
	 */
	private async checkLinearForDuplicates(
		feedback: ProcessedFeedbackData,
	): Promise<DuplicateDetectionResult> {
		const startTime = Date.now();

		for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
			try {
				const linearClient = getLinearClient();
				const duplicateIssue = await Promise.race([
					linearClient.findDuplicateIssue(feedback),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error("Search timeout")),
							this.config.searchTimeoutMs,
						),
					),
				]);

				if (duplicateIssue) {
					return {
						isDuplicate: true,
						platform: "linear",
						existingIssue: {
							id: duplicateIssue.id,
							url: duplicateIssue.url,
							identifier: duplicateIssue.identifier,
							title: duplicateIssue.title,
						},
						confidence: 1.0, // Linear client doesn't return confidence yet
						reasons: [
							`Found exact match in Linear: ${duplicateIssue.identifier}`,
						],
						searchDuration: Date.now() - startTime,
					};
				}

				return {
					isDuplicate: false,
					platform: "linear",
					confidence: 0,
					reasons: ["No duplicate found in Linear"],
					searchDuration: Date.now() - startTime,
				};
			} catch (error) {
				if (attempt === this.config.retryAttempts) {
					throw error;
				}

				const delay = this.config.retryDelayMs * 2 ** attempt;
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		throw new Error("All retry attempts failed");
	}

	/**
	 * Adds a comment to existing issue when duplicate is found
	 */
	private async addCommentToExistingIssue(
		feedback: ProcessedFeedbackData,
		duplicateResult: DuplicateDetectionResult,
	): Promise<void> {
		if (!duplicateResult.isDuplicate || !duplicateResult.existingIssue) {
			return;
		}

		const typeIcon = feedback.type === "crash" ? "💥" : "📱";
		const commentBody =
			`${typeIcon} **Additional TestFlight ${feedback.type} report detected**\n\n` +
			`**TestFlight ID:** ${feedback.id}\n` +
			`**Submitted:** ${feedback.submittedAt.toISOString()}\n` +
			`**Device:** ${feedback.deviceInfo.model} (${feedback.deviceInfo.osVersion})\n` +
			`**Detection:** Found by idempotency service (confidence: ${duplicateResult.confidence.toFixed(2)})\n\n` +
			`*Note: This feedback was automatically detected as duplicate and no new issue was created.*`;

		try {
			if (
				duplicateResult.platform === "github" &&
				duplicateResult.existingIssue.number
			) {
				const githubClient = getGitHubClient();
				await githubClient.addCommentToIssue(
					duplicateResult.existingIssue.number,
					commentBody,
				);
				console.log(
					`Added comment to GitHub issue #${duplicateResult.existingIssue.number}`,
				);
			} else if (duplicateResult.platform === "linear") {
				const linearClient = getLinearClient();
				await linearClient.addCommentToIssue(
					duplicateResult.existingIssue.id,
					commentBody,
				);
				console.log(
					`Added comment to Linear issue ${duplicateResult.existingIssue.identifier}`,
				);
			}
		} catch (error) {
			console.warn(`Failed to add comment to existing issue: ${error}`);
		}
	}

	/**
	 * Gets comprehensive statistics about duplicate detection performance
	 */
	public async getStatistics(): Promise<{
		stateTracking: {
			totalProcessed: number;
			currentlyCached: number;
			cacheAge: string;
		};
		configuration: IdempotencyConfig;
		lastUpdated: string;
	}> {
		const stateManager = getStateManager();
		const stateStats = await stateManager.getStats();

		return {
			stateTracking: {
				totalProcessed: stateStats.totalProcessed,
				currentlyCached: stateStats.currentlyCached,
				cacheAge: stateStats.cacheAge,
			},
			configuration: this.config,
			lastUpdated: new Date().toISOString(),
		};
	}
}

/**
 * Global idempotency service instance
 */
let _idempotencyServiceInstance: IdempotencyService | null = null;

export function getIdempotencyService(): IdempotencyService {
	if (!_idempotencyServiceInstance) {
		_idempotencyServiceInstance = new IdempotencyService();
	}
	return _idempotencyServiceInstance;
}

/**
 * Clears the global idempotency service instance (useful for testing)
 */
export function clearIdempotencyServiceInstance(): void {
	_idempotencyServiceInstance = null;
}
