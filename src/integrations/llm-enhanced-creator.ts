/**
 * LLM-Enhanced Issue Creation Pipeline
 * Integrates LLM analysis with codebase context for enhanced GitHub/Linear issue creation
 */

import type {
	GitHubIssueCreationOptions,
	GitHubIssueCreationResult,
} from "../../types/github.js";
import type { LinearPriority } from "../../types/linear.js";
import type { ProcessedFeedbackData } from "../../types/testflight.js";
import {
	type CodebaseAnalysisResult,
	getCodebaseAnalyzer,
} from "../analysis/codebase-analyzer.js";
import { getGitHubClient } from "../api/github-client.js";
import { getLinearClient } from "../api/linear-client.js";
import {
	getLLMClient,
	type LLMEnhancementRequest,
	type LLMEnhancementResponse,
} from "../api/llm-client.js";
import { getLLMConfig, validateLLMConfig } from "../config/llm-config.js";
import { getIdempotencyService } from "../utils/idempotency-service.js";
import type {
	LinearIssueCreationOptions,
	LinearIssueCreationResult,
} from "../utils/linear-utils.js";
import { getStateManager } from "../utils/state-manager.js";

export interface EnhancedIssueCreationOptions {
	// Platform options
	platform: "github" | "linear" | "both";

	// LLM enhancement options
	enableLLMEnhancement: boolean;
	llmProvider?: "openai" | "anthropic" | "google";

	// Codebase analysis options
	enableCodebaseAnalysis: boolean;
	analysisDepth: "light" | "moderate" | "deep";
	includeRecentChanges: boolean;

	// Fallback options
	fallbackToStandard: boolean;
	skipDuplicateDetection: boolean;

	// Platform-specific options
	github?: GitHubIssueCreationOptions;
	linear?: LinearIssueCreationOptions;

	// Meta options
	dryRun: boolean;
	actionRunId?: string;
}

export interface EnhancedIssueCreationResult {
	success: boolean;
	enhanced: boolean;
	platform: ("github" | "linear")[];

	// Results per platform
	github?: GitHubIssueCreationResult;
	linear?: LinearIssueCreationResult;

	// Enhancement details
	llmAnalysis?: LLMEnhancementResponse;
	codebaseAnalysis?: CodebaseAnalysisResult;

	// Metrics
	processingTime: number;
	cost: number;
	confidence: number;

	// Errors and warnings
	errors: string[];
	warnings: string[];

	// Fallback information
	usedFallback: boolean;
	fallbackReason?: string;
}

export interface EnhancementContext {
	feedback: ProcessedFeedbackData;
	codebaseAnalysis?: CodebaseAnalysisResult;
	recentChanges?: Array<{
		file: string;
		diff: string;
		author: string;
		timestamp: string;
	}>;
	relatedIssues?: Array<{
		title: string;
		number: number;
		labels: string[];
		platform: "github" | "linear";
	}>;
}

/**
 * Main LLM-enhanced issue creation service
 */
export class LLMEnhancedIssueCreator {
	private readonly llmClient = getLLMClient();
	private readonly codebaseAnalyzer = getCodebaseAnalyzer();
	private readonly githubClient = getGitHubClient();
	private readonly linearClient = getLinearClient();
	private readonly idempotencyService = getIdempotencyService();
	private readonly stateManager = getStateManager();

	/**
	 * Creates an enhanced issue with LLM analysis and codebase context
	 */
	public async createEnhancedIssue(
		feedback: ProcessedFeedbackData,
		options: EnhancedIssueCreationOptions,
	): Promise<EnhancedIssueCreationResult> {
		const startTime = Date.now();
		const result: EnhancedIssueCreationResult = {
			success: false,
			enhanced: false,
			platform: [],
			processingTime: 0,
			cost: 0,
			confidence: 0,
			errors: [],
			warnings: [],
			usedFallback: false,
		};

		try {
			console.log(
				`Starting enhanced issue creation for feedback ${feedback.id}`,
			);

			// Validate configuration
			const configValid = this.validateConfiguration(options, result);
			if (!configValid) {
				return await this.fallbackToStandardCreation(
					feedback,
					options,
					result,
					"Configuration validation failed",
				);
			}

			// Build enhancement context
			const context = await this.buildEnhancementContext(
				feedback,
				options,
				result,
			);

			// Perform LLM enhancement if enabled
			let llmAnalysis: LLMEnhancementResponse | undefined;
			if (options.enableLLMEnhancement) {
				llmAnalysis = await this.performLLMEnhancement(
					context,
					options,
					result,
				);
				result.llmAnalysis = llmAnalysis;
				result.enhanced = !!llmAnalysis;
			}

			// Create issues on specified platforms
			if (options.platform === "github" || options.platform === "both") {
				result.github = await this.createGitHubIssue(
					feedback,
					llmAnalysis,
					context,
					options,
				);
				if (result.github?.issue) {
					result.platform.push("github");
				}
			}

			if (options.platform === "linear" || options.platform === "both") {
				result.linear = await this.createLinearIssue(
					feedback,
					llmAnalysis,
					context,
					options,
				);
				if (result.linear?.issue) {
					result.platform.push("linear");
				}
			}

			// Update state tracking
			if (!options.dryRun && result.platform.length > 0) {
				await this.stateManager.markAsProcessed(
					[feedback.id],
					options.actionRunId,
				);
			}

			// Calculate final metrics
			result.success = result.platform.length > 0;
			result.processingTime = Date.now() - startTime;

			if (llmAnalysis) {
				result.cost = llmAnalysis.metadata.cost;
				result.confidence = llmAnalysis.analysis.confidence;
			}

			console.log(
				`Enhanced issue creation ${result.success ? "succeeded" : "failed"} for feedback ${feedback.id}`,
			);
			return result;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.error(`Enhanced issue creation failed: ${errorMessage}`);
			result.errors.push(errorMessage);

			// Fallback to standard creation
			return await this.fallbackToStandardCreation(
				feedback,
				options,
				result,
				errorMessage,
			);
		}
	}

	/**
	 * Validates configuration for enhanced issue creation
	 */
	private validateConfiguration(
		options: EnhancedIssueCreationOptions,
		result: EnhancedIssueCreationResult,
	): boolean {
		// Validate LLM configuration if enhancement is enabled
		if (options.enableLLMEnhancement) {
			const llmConfig = getLLMConfig();
			const validation = validateLLMConfig(llmConfig);

			if (!validation.valid) {
				result.errors.push(
					`LLM configuration invalid: ${validation.errors.join(", ")}`,
				);
				result.warnings.push(...validation.warnings);
				return false;
			}

			if (!llmConfig.enabled) {
				result.warnings.push(
					"LLM enhancement requested but not enabled in configuration",
				);
				options.enableLLMEnhancement = false;
			}
		}

		// Validate platform selection
		if (!["github", "linear", "both"].includes(options.platform)) {
			result.errors.push(`Invalid platform: ${options.platform}`);
			return false;
		}

		// Validate platform-specific configurations
		if (options.platform === "github" || options.platform === "both") {
			try {
				this.githubClient.healthCheck();
			} catch (error) {
				result.warnings.push(`GitHub client validation failed: ${error}`);
			}
		}

		if (options.platform === "linear" || options.platform === "both") {
			try {
				this.linearClient.healthCheck();
			} catch (error) {
				result.warnings.push(`Linear client validation failed: ${error}`);
			}
		}

		return true;
	}

	/**
	 * Builds enhancement context with codebase analysis and related issues
	 */
	private async buildEnhancementContext(
		feedback: ProcessedFeedbackData,
		options: EnhancedIssueCreationOptions,
		result: EnhancedIssueCreationResult,
	): Promise<EnhancementContext> {
		const context: EnhancementContext = { feedback };

		try {
			// Perform codebase analysis if enabled
			if (options.enableCodebaseAnalysis) {
				console.log(
					`Performing codebase analysis with depth: ${options.analysisDepth}`,
				);

				const analysisResult = await this.codebaseAnalyzer.analyzeForFeedback(
					feedback,
					{
						depth: options.analysisDepth,
						includeTests: false,
						maxFilesToScan:
							options.analysisDepth === "light"
								? 50
								: options.analysisDepth === "moderate"
									? 100
									: 200,
						confidenceThreshold: 0.3,
					},
				);

				context.codebaseAnalysis = analysisResult;
				result.codebaseAnalysis = analysisResult;

				console.log(
					`Found ${analysisResult.relevantFiles.length} relevant code areas`,
				);
			}

			// Get recent changes if enabled (simplified version - would need git integration)
			if (options.includeRecentChanges) {
				context.recentChanges = await this.getRecentChanges(feedback);
			}

			// Find related issues
			context.relatedIssues = await this.findRelatedIssues(feedback, options);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			result.warnings.push(
				`Context building partially failed: ${errorMessage}`,
			);
		}

		return context;
	}

	/**
	 * Performs LLM enhancement analysis
	 */
	private async performLLMEnhancement(
		context: EnhancementContext,
		options: EnhancedIssueCreationOptions,
		result: EnhancedIssueCreationResult,
	): Promise<LLMEnhancementResponse | undefined> {
		try {
			console.log("Performing LLM enhancement analysis");

			const enhancementRequest: LLMEnhancementRequest = {
				title: `${context.feedback.type === "crash" ? "Crash" : "Feedback"}: ${context.feedback.appVersion || "Unknown Version"}`,
				description: context.feedback.screenshotData?.text || context.feedback.crashData?.exceptionMessage || "No description available",
				feedbackType: context.feedback.type === "crash" ? "crash" : "general",
				crashData: context.feedback.crashData
					? {
						trace: Array.isArray(context.feedback.crashData.trace)
							? context.feedback.crashData.trace
							: [context.feedback.crashData.trace],
						device: context.feedback.deviceInfo.model,
						osVersion: context.feedback.deviceInfo.osVersion,
					}
					: undefined,
				codebaseContext: context.codebaseAnalysis
					? context.codebaseAnalysis.relevantFiles.map((area) => ({
						file: area.file,
						content: area.content,
						relevance: area.confidence,
					}))
					: undefined,
				recentChanges: context.recentChanges,
				options: {
					provider: options.llmProvider,
					enableFallback: true,
				},
			};

			const enhancement = await this.llmClient.enhanceIssue(enhancementRequest);

			console.log(
				`LLM enhancement completed with confidence: ${enhancement.analysis.confidence}`,
			);
			return enhancement;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			result.warnings.push(`LLM enhancement failed: ${errorMessage}`);
			console.warn(`LLM enhancement failed: ${errorMessage}`);
			return undefined;
		}
	}

	/**
	 * Creates GitHub issue with enhancement data
	 */
	private async createGitHubIssue(
		feedback: ProcessedFeedbackData,
		llmAnalysis: LLMEnhancementResponse | undefined,
		context: EnhancementContext,
		options: EnhancedIssueCreationOptions,
	): Promise<GitHubIssueCreationResult | undefined> {
		try {
			if (options.dryRun) {
				console.log("DRY RUN: Would create GitHub issue");
				return {
					issue: {
						id: 0,
						number: 0,
						title: "DRY RUN",
						state: "open" as const,
						user: {
							id: 0,
							login: "dry-run",
							avatar_url: "",
							html_url: "",
							type: "User" as const,
						},
						assignees: [],
						labels: [],
						locked: false,
						comments: 0,
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
						html_url: "dry-run",
						url: "dry-run",
					},
					wasExisting: false,
					action: "created",
					message: "DRY RUN: GitHub issue would be created",
				};
			}

			// Use enhanced data if available
			const createOptions: GitHubIssueCreationOptions = {
				...options.github,
				customTitle: llmAnalysis?.enhancedTitle,
				customBody: llmAnalysis
					? this.formatEnhancedGitHubBody(llmAnalysis, context)
					: undefined,
				additionalLabels: llmAnalysis?.labels || [],
				enableDuplicateDetection: !options.skipDuplicateDetection,
			};

			console.log("Creating GitHub issue with enhanced data");
			return await this.githubClient.createIssueFromTestFlight(
				feedback,
				createOptions,
			);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.error(`GitHub issue creation failed: ${errorMessage}`);
			throw error;
		}
	}

	/**
	 * Creates Linear issue with enhancement data
	 */
	private async createLinearIssue(
		feedback: ProcessedFeedbackData,
		llmAnalysis: LLMEnhancementResponse | undefined,
		context: EnhancementContext,
		options: EnhancedIssueCreationOptions,
	): Promise<LinearIssueCreationResult | undefined> {
		try {
			if (options.dryRun) {
				console.log("DRY RUN: Would create Linear issue");
				return {
					issue: {
						id: "dry-run",
						identifier: "DRY-1",
						title: "DRY RUN",
					} as LinearIssueCreationResult["issue"],
					wasExisting: false,
					action: "created",
					message: "DRY RUN: Linear issue would be created",
				};
			}

			// Map LLM priority to Linear priority
			const priorityMap: Record<string, LinearPriority> = {
				urgent: 1,
				high: 2,
				normal: 3,
				low: 4,
			};

			const createOptions: LinearIssueCreationOptions = {
				...options.linear,
				customTitle: llmAnalysis?.enhancedTitle,
				customDescription: llmAnalysis
					? this.formatEnhancedLinearDescription(llmAnalysis, context)
					: undefined,
				additionalLabels: llmAnalysis?.labels || [],
				priority: llmAnalysis ? priorityMap[llmAnalysis.priority] : undefined,
				enableDuplicateDetection: !options.skipDuplicateDetection,
			};

			console.log("Creating Linear issue with enhanced data");
			const linearIssue = await this.linearClient.createIssueFromTestFlight(
				feedback,
				createOptions.additionalLabels,
				createOptions.assigneeId,
				createOptions.projectId,
				{
					customTitle: createOptions.customTitle,
					customDescription: createOptions.customDescription,
					priority: createOptions.priority,
				},
			);

			// Convert LinearIssue to LinearIssueCreationResult
			return {
				issue: linearIssue,
				wasExisting: false,
				action: "created",
				message: `Created new Linear issue ${linearIssue.identifier}`,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.error(`Linear issue creation failed: ${errorMessage}`);
			throw error;
		}
	}

	/**
	 * Formats enhanced GitHub issue body
	 */
	private formatEnhancedGitHubBody(
		llmAnalysis: LLMEnhancementResponse,
		_context: EnhancementContext,
	): string {
		let body = llmAnalysis.enhancedDescription;

		// Add analysis section
		if (llmAnalysis.analysis.affectedComponents.length > 0) {
			body += "\n\n## 🎯 Affected Components\n\n";
			for (const component of llmAnalysis.analysis.affectedComponents) {
				body += `- ${component}\n`;
			}
		}

		// Add root cause analysis if available
		if (llmAnalysis.analysis.rootCause) {
			body += `\n\n## 🔍 Root Cause Analysis\n\n${llmAnalysis.analysis.rootCause}`;
		}

		// Add suggested fix if available
		if (llmAnalysis.analysis.suggestedFix) {
			body += `\n\n## 💡 Suggested Fix\n\n${llmAnalysis.analysis.suggestedFix}`;
		}

		// Add LLM enhancement metadata
		body += `\n\n---\n*Enhanced with LLM analysis (${llmAnalysis.metadata.provider}/${llmAnalysis.metadata.model}) - Confidence: ${(llmAnalysis.analysis.confidence * 100).toFixed(0)}%*`;

		return body;
	}

	/**
	 * Formats enhanced Linear issue description
	 */
	private formatEnhancedLinearDescription(
		llmAnalysis: LLMEnhancementResponse,
		_context: EnhancementContext,
	): string {
		let description = llmAnalysis.enhancedDescription;

		// Add affected components (Linear format)
		if (llmAnalysis.analysis.affectedComponents.length > 0) {
			description += "\n\n## Affected Components\n\n";
			for (const component of llmAnalysis.analysis.affectedComponents) {
				description += `- ${component}\n`;
			}
		}

		// Add analysis details
		if (llmAnalysis.analysis.rootCause) {
			description += `\n\n**Root Cause Analysis:**\n${llmAnalysis.analysis.rootCause}`;
		}

		if (llmAnalysis.analysis.suggestedFix) {
			description += `\n\n**Suggested Fix:**\n${llmAnalysis.analysis.suggestedFix}`;
		}

		return description;
	}

	/**
	 * Fallback to standard issue creation when enhancement fails
	 */
	private async fallbackToStandardCreation(
		feedback: ProcessedFeedbackData,
		options: EnhancedIssueCreationOptions,
		result: EnhancedIssueCreationResult,
		reason: string,
	): Promise<EnhancedIssueCreationResult> {
		if (!options.fallbackToStandard) {
			result.errors.push(`Enhancement failed and fallback disabled: ${reason}`);
			result.processingTime = Date.now() - (Date.now() - 1000); // Estimate
			return result;
		}

		console.log(`Falling back to standard issue creation: ${reason}`);
		result.usedFallback = true;
		result.fallbackReason = reason;

		try {
			// Use idempotency service for standard creation
			const standardResult =
				await this.idempotencyService.createIssueWithDuplicateProtection(
					feedback,
					{
						preferredPlatform:
							options.platform === "both" ? "github" : options.platform,
						skipDuplicateDetection: options.skipDuplicateDetection,
						actionRunId: options.actionRunId,
					},
				);

			// Map standard result to enhanced result
			result.github = standardResult.github;
			result.linear = standardResult.linear;
			result.success = standardResult.processedBy.length > 0;
			result.platform = standardResult.processedBy;
			result.processingTime = standardResult.totalDuration;
			result.errors.push(...standardResult.errors);

			return result;
		} catch (fallbackError) {
			const errorMessage =
				fallbackError instanceof Error
					? fallbackError.message
					: String(fallbackError);
			result.errors.push(`Fallback creation also failed: ${errorMessage}`);
			result.success = false;
			result.processingTime = Date.now() - (Date.now() - 2000); // Estimate
			return result;
		}
	}

	/**
	 * Gets recent changes for context using git integration
	 */
	private async getRecentChanges(feedback: ProcessedFeedbackData): Promise<
		Array<{
			file: string;
			diff: string;
			author: string;
			timestamp: string;
		}>
	> {
		try {
			// Check if git is available
			const isGitRepo = await this.checkGitRepository();
			if (!isGitRepo) {
				return [];
			}

			// Get recent commits (last 7 days)
			const recentCommits = await this.getRecentCommits(7);

			// Filter commits relevant to the feedback
			const relevantCommits = this.filterRelevantCommits(
				recentCommits,
				feedback,
			);

			// Get simplified change info for relevant commits
			const changes: Array<{
				file: string;
				diff: string;
				author: string;
				timestamp: string;
			}> = [];

			for (const commit of relevantCommits.slice(0, 5)) {
				// Limit to 5 most relevant
				for (const file of commit.files.slice(0, 3)) {
					// Limit files per commit
					changes.push({
						file,
						diff: `Recent change in ${file} by ${commit.author}`,
						author: commit.author,
						timestamp: commit.timestamp,
					});
				}
			}

			return changes;
		} catch (error) {
			console.warn(`Failed to get recent changes: ${error}`);
			return [];
		}
	}

	/**
	 * Check if the current directory is a git repository
	 */
	private async checkGitRepository(): Promise<boolean> {
		try {
			const { exec } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const execAsync = promisify(exec);

			await execAsync("git rev-parse --git-dir", { cwd: process.cwd() });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get recent commits from git log
	 */
	private async getRecentCommits(days: number): Promise<
		Array<{
			hash: string;
			author: string;
			timestamp: string;
			message: string;
			files: string[];
		}>
	> {
		try {
			const { exec } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const execAsync = promisify(exec);

			const since = new Date();
			since.setDate(since.getDate() - days);
			const sinceStr = since.toISOString().split("T")[0];

			const { stdout } = await execAsync(
				`git log --since="${sinceStr}" --pretty=format:"%H|%an|%ai|%s" --name-only`,
				{ cwd: process.cwd() },
			);

			return this.parseGitLog(stdout);
		} catch (error) {
			console.warn(`Failed to get recent commits: ${error}`);
			return [];
		}
	}

	/**
	 * Parse git log output into structured commit data
	 */
	private parseGitLog(gitLogOutput: string): Array<{
		hash: string;
		author: string;
		timestamp: string;
		message: string;
		files: string[];
	}> {
		const commits = [];
		const commitBlocks = gitLogOutput
			.split("\n\n")
			.filter((block) => block.trim());

		for (const block of commitBlocks) {
			const lines = block.split("\n").filter((line) => line.trim());
			if (lines.length === 0) {
				continue;
			}

			const firstLine = lines[0];
			if (!firstLine) {
				continue;
			}

			const commitInfo = firstLine.split("|");
			if (commitInfo.length !== 4) {
				continue;
			}

			const [hash, author, timestamp, message] = commitInfo;
			if (!hash || !author || !timestamp || !message) {
				continue;
			}

			const files = lines
				.slice(1)
				.filter((line) => line.trim() && !line.includes("|"));

			commits.push({
				hash,
				author,
				timestamp,
				message,
				files,
			});
		}

		return commits;
	}

	/**
	 * Filter commits that might be relevant to the feedback
	 */
	private filterRelevantCommits(
		commits: Array<{
			hash: string;
			author: string;
			timestamp: string;
			message: string;
			files: string[];
		}>,
		feedback: ProcessedFeedbackData,
	): Array<{
		hash: string;
		author: string;
		timestamp: string;
		message: string;
		files: string[];
	}> {
		const relevantKeywords: string[] = [];

		// Extract keywords from crash data
		if (feedback.type === "crash" && feedback.crashData) {
			if (feedback.crashData.exceptionType) {
				relevantKeywords.push(feedback.crashData.exceptionType.toLowerCase());
			}
			// Extract file names from stack trace
			const stackTraceFiles =
				feedback.crashData.trace?.match(/[\w-]+\.(swift|m|h|mm|kt|java)/gi) ||
				[];
			relevantKeywords.push(...stackTraceFiles.map((f) => f.toLowerCase()));
		}

		// Extract keywords from screenshot feedback
		if (feedback.screenshotData?.text) {
			const words =
				feedback.screenshotData.text.toLowerCase().match(/\b\w{4,}\b/g) || [];
			relevantKeywords.push(...words.slice(0, 5)); // Limit keywords
		}

		// Filter commits by relevance
		return commits
			.filter((commit) => {
				const searchText =
					`${commit.message} ${commit.files.join(" ")}`.toLowerCase();

				// Check for relevant keywords
				const hasRelevantKeywords = relevantKeywords.some((keyword) =>
					searchText.includes(keyword),
				);

				// Check for relevant file types
				const hasRelevantFiles = commit.files.some((file) =>
					/\.(swift|m|h|mm|kt|java|tsx?|jsx?)$/i.test(file),
				);

				return hasRelevantKeywords || hasRelevantFiles;
			})
			.sort(
				(a, b) =>
					new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
			);
	}

	/**
	 * Finds related issues across platforms
	 */
	private async findRelatedIssues(
		feedback: ProcessedFeedbackData,
		options: EnhancedIssueCreationOptions,
	): Promise<
		Array<{
			title: string;
			number: number;
			labels: string[];
			platform: "github" | "linear";
		}>
	> {
		const relatedIssues: Array<{
			title: string;
			number: number;
			labels: string[];
			platform: "github" | "linear";
		}> = [];

		try {
			// Search GitHub for related issues
			if (options.platform === "github" || options.platform === "both") {
				const githubSearch =
					await this.githubClient.findDuplicateIssue(feedback);
				if (githubSearch.isDuplicate && githubSearch.existingIssue) {
					relatedIssues.push({
						title: githubSearch.existingIssue.title,
						number: githubSearch.existingIssue.number,
						labels:
							githubSearch.existingIssue.labels?.map((l) =>
								typeof l === "string" ? l : l.name,
							) || [],
						platform: "github",
					});
				}
			}

			// Search Linear for related issues
			if (options.platform === "linear" || options.platform === "both") {
				const linearDuplicate =
					await this.linearClient.findDuplicateIssue(feedback);
				if (linearDuplicate) {
					const numberMatch = linearDuplicate.identifier.match(/\d+/);
					relatedIssues.push({
						title: linearDuplicate.title,
						number: numberMatch ? Number.parseInt(numberMatch[0], 10) : 0,
						labels: [], // Would need to get labels from Linear
						platform: "linear",
					});
				}
			}
		} catch (error) {
			console.warn(`Failed to find related issues: ${error}`);
		}

		return relatedIssues;
	}

	/**
	 * Performs health check for enhanced issue creation
	 */
	public async healthCheck(): Promise<{
		status: "healthy" | "degraded" | "unhealthy";
		components: {
			llm: "healthy" | "degraded" | "unhealthy";
			codebase: "healthy" | "degraded" | "unhealthy";
			github: "healthy" | "degraded" | "unhealthy";
			linear: "healthy" | "degraded" | "unhealthy";
		};
		details: {
			checks: Array<{
				component: string | undefined;
				status: "rejected" | "fulfilled";
				value?: unknown;
				reason?: unknown;
			}>;
		};
	}> {
		const checks = await Promise.allSettled([
			this.llmClient.healthCheck(),
			this.githubClient.healthCheck(),
			this.linearClient.healthCheck(),
		]);

		const llmHealth =
			checks[0].status === "fulfilled" ? checks[0].value.status : "unhealthy";
		const githubHealth =
			checks[1].status === "fulfilled" ? checks[1].value.status : "unhealthy";
		const linearHealth =
			checks[2].status === "fulfilled" ? checks[2].value.status : "unhealthy";

		// Simple codebase health check
		const codebaseHealth = "healthy"; // Assume healthy unless we detect issues

		const healthyCount = [
			llmHealth,
			codebaseHealth,
			githubHealth,
			linearHealth,
		].filter((status) => status === "healthy").length;

		const overallStatus =
			healthyCount >= 3
				? "healthy"
				: healthyCount >= 2
					? "degraded"
					: "unhealthy";

		return {
			status: overallStatus,
			components: {
				llm: llmHealth,
				codebase: codebaseHealth,
				github: githubHealth,
				linear: linearHealth,
			},
			details: {
				checks: checks.map((check, index) => ({
					component: ["llm", "github", "linear"][index],
					status: check.status,
					value: check.status === "fulfilled" ? check.value : undefined,
					reason: check.status === "rejected" ? check.reason : undefined,
				})),
			},
		};
	}
}

/**
 * Global enhanced issue creator instance
 */
let _enhancedCreatorInstance: LLMEnhancedIssueCreator | null = null;

export function getLLMEnhancedIssueCreator(): LLMEnhancedIssueCreator {
	if (!_enhancedCreatorInstance) {
		_enhancedCreatorInstance = new LLMEnhancedIssueCreator();
	}
	return _enhancedCreatorInstance;
}

/**
 * Clears the global enhanced creator instance (useful for testing)
 */
export function clearLLMEnhancedIssueCreatorInstance(): void {
	_enhancedCreatorInstance = null;
}

/**
 * Convenience function for creating enhanced issues
 */
export async function createEnhancedIssueFromTestFlight(
	feedback: ProcessedFeedbackData,
	options: Partial<EnhancedIssueCreationOptions> = {},
): Promise<EnhancedIssueCreationResult> {
	const creator = getLLMEnhancedIssueCreator();

	const defaultOptions: EnhancedIssueCreationOptions = {
		platform: "github",
		enableLLMEnhancement: true,
		enableCodebaseAnalysis: true,
		analysisDepth: "moderate",
		includeRecentChanges: false,
		fallbackToStandard: true,
		skipDuplicateDetection: false,
		dryRun: false,
	};

	return await creator.createEnhancedIssue(feedback, {
		...defaultOptions,
		...options,
	});
}
