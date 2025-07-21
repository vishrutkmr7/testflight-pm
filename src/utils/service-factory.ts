/**
 * Service Factory
 * Implements Dependency Inversion and Factory patterns for better testability and extensibility
 */

import type {
	GitHubDuplicateDetectionResult,
	GitHubIssueCreationResult,
} from "../../types/github.js";
import type { LinearIssue } from "../../types/linear.js";
import type { ProcessedFeedbackData } from "../../types/testflight.js";

// Type imports for proper client typing
interface GitHubClientInterface {
	createIssueFromTestFlight(
		feedback: ProcessedFeedbackData,
		options?: Record<string, unknown>,
	): Promise<GitHubIssueCreationResult>;
	findDuplicateIssue(
		feedback: ProcessedFeedbackData,
	): Promise<GitHubDuplicateDetectionResult>;
	healthCheck(): Promise<HealthCheckResult>;
}

interface LinearClientInterface {
	createIssueFromTestFlight(
		feedback: ProcessedFeedbackData,
		additionalLabels?: string[],
		assigneeId?: string,
		projectId?: string,
	): Promise<LinearIssue>;
	findDuplicateIssue(
		feedback: ProcessedFeedbackData,
	): Promise<LinearIssue | null>;
	healthCheck(): Promise<HealthCheckResult>;
}

/**
 * Abstract issue creation service interface
 */
export interface IssueCreationService {
	createIssueFromFeedback(
		feedback: ProcessedFeedbackData,
		options?: Record<string, unknown>,
	): Promise<IssueCreationResult>;

	findDuplicateIssue(
		feedback: ProcessedFeedbackData,
	): Promise<DuplicateDetectionResult | null>;

	healthCheck(): Promise<HealthCheckResult>;
}

/**
 * Generic issue creation result
 */
export interface IssueCreationResult {
	id: string;
	url: string;
	title: string;
	identifier?: string;
	number?: number;
	wasExisting: boolean;
	action: "created" | "updated" | "comment_added";
	message: string;
	platform: "github" | "linear";
}

/**
 * Generic duplicate detection result
 */
export interface DuplicateDetectionResult {
	isDuplicate: boolean;
	confidence: number;
	reasons: string[];
	existingIssue?: {
		id: string;
		url: string;
		title: string;
		identifier?: string;
		number?: number;
	};
}

/**
 * Generic health check result
 */
export interface HealthCheckResult {
	status: "healthy" | "degraded" | "unhealthy";
	details: Record<string, unknown>;
	recommendations?: string[];
}

/**
 * Concrete GitHub issue creation service
 */
export class GitHubIssueService implements IssueCreationService {
	constructor(private githubClient: GitHubClientInterface) {}

	async createIssueFromFeedback(
		feedback: ProcessedFeedbackData,
		options?: Record<string, unknown>,
	): Promise<IssueCreationResult> {
		const result = await this.githubClient.createIssueFromTestFlight(
			feedback,
			options,
		);

		return {
			id: result.issue.id.toString(),
			url: result.issue.html_url,
			title: result.issue.title,
			number: result.issue.number,
			wasExisting: result.wasExisting || false,
			action: result.wasExisting ? "comment_added" : "created",
			message: `GitHub issue ${result.wasExisting ? "updated" : "created"}: #${result.issue.number}`,
			platform: "github",
		};
	}

	async findDuplicateIssue(
		feedback: ProcessedFeedbackData,
	): Promise<DuplicateDetectionResult | null> {
		const result = await this.githubClient.findDuplicateIssue(feedback);

		if (!result.isDuplicate) {
			return null;
		}

		return {
			isDuplicate: true,
			confidence: result.confidence,
			reasons: result.reasons,
			existingIssue: result.existingIssue
				? {
						id: result.existingIssue.id.toString(),
						url: result.existingIssue.html_url,
						title: result.existingIssue.title,
						number: result.existingIssue.number,
					}
				: undefined,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		return await this.githubClient.healthCheck();
	}
}

/**
 * Concrete Linear issue creation service
 */
export class LinearIssueService implements IssueCreationService {
	constructor(private linearClient: LinearClientInterface) {}

	async createIssueFromFeedback(
		feedback: ProcessedFeedbackData,
		options?: Record<string, unknown>,
	): Promise<IssueCreationResult> {
		// Extract Linear-specific options from the generic options object
		const additionalLabels = (options?.additionalLabels as string[]) || [];
		const assigneeId = options?.assigneeId as string | undefined;
		const projectId = options?.projectId as string | undefined;

		const result = await this.linearClient.createIssueFromTestFlight(
			feedback,
			additionalLabels,
			assigneeId,
			projectId,
		);

		return {
			id: result.id,
			url: result.url,
			title: result.title,
			identifier: result.identifier,
			wasExisting: false, // Linear client doesn't provide this info, defaulting to false
			action: "created", // Defaulting to created since we can't determine from current API
			message: `Linear issue created: ${result.identifier}`,
			platform: "linear",
		};
	}

	async findDuplicateIssue(
		feedback: ProcessedFeedbackData,
	): Promise<DuplicateDetectionResult | null> {
		const duplicate = await this.linearClient.findDuplicateIssue(feedback);

		if (!duplicate) {
			return null;
		}

		return {
			isDuplicate: true,
			confidence: 0.9, // Linear client doesn't return confidence scores yet
			reasons: ["Found existing Linear issue with matching TestFlight ID"],
			existingIssue: {
				id: duplicate.id,
				url: duplicate.url,
				title: duplicate.title,
				identifier: duplicate.identifier,
			},
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		return await this.linearClient.healthCheck();
	}
}

/**
 * Service registry for dependency injection
 */
export class ServiceRegistry {
	private services: Map<string, IssueCreationService> = new Map();
	private defaultService: string | null = null;

	/**
	 * Register a service implementation
	 */
	register(
		name: string,
		service: IssueCreationService,
		isDefault = false,
	): void {
		this.services.set(name, service);

		if (isDefault || this.defaultService === null) {
			this.defaultService = name;
		}
	}

	/**
	 * Get a service by name
	 */
	get(name: string): IssueCreationService {
		const service = this.services.get(name);

		if (!service) {
			throw new Error(`Service not found: ${name}`);
		}

		return service;
	}

	/**
	 * Get the default service
	 */
	getDefault(): IssueCreationService {
		if (!this.defaultService) {
			throw new Error("No default service registered");
		}

		return this.get(this.defaultService);
	}

	/**
	 * Get all registered services
	 */
	getAll(): IssueCreationService[] {
		return Array.from(this.services.values());
	}

	/**
	 * Get service names
	 */
	getServiceNames(): string[] {
		return Array.from(this.services.keys());
	}

	/**
	 * Check if service exists
	 */
	has(name: string): boolean {
		return this.services.has(name);
	}

	/**
	 * Set default service
	 */
	setDefault(name: string): void {
		if (!this.has(name)) {
			throw new Error(`Cannot set default to non-existent service: ${name}`);
		}

		this.defaultService = name;
	}
}

/**
 * Factory for creating and managing issue creation services
 */
export class IssueServiceFactory {
	private static instance: IssueServiceFactory | null = null;
	private registry: ServiceRegistry = new ServiceRegistry();

	private constructor() {
		// Initialize with available services
		this.initializeServices();
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(): IssueServiceFactory {
		if (!IssueServiceFactory.instance) {
			IssueServiceFactory.instance = new IssueServiceFactory();
		}

		return IssueServiceFactory.instance;
	}

	/**
	 * Initialize available services
	 */
	private initializeServices(): void {
		try {
			// Dynamic imports to avoid circular dependencies
			import("../api/github-client.js")
				.then(({ getGitHubClient }) => {
					const githubService = new GitHubIssueService(getGitHubClient());
					this.registry.register("github", githubService, true);
				})
				.catch((error) => {
					console.warn("Failed to initialize GitHub service:", error);
				});

			import("../api/linear-client.js")
				.then(({ getLinearClient }) => {
					const linearService = new LinearIssueService(getLinearClient());
					this.registry.register("linear", linearService);
				})
				.catch((error) => {
					console.warn("Failed to initialize Linear service:", error);
				});
		} catch (error) {
			console.error("Failed to initialize services:", error);
		}
	}

	/**
	 * Create issue using specified service
	 */
	async createIssue(
		platform: string,
		feedback: ProcessedFeedbackData,
		options?: Record<string, unknown>,
	): Promise<IssueCreationResult> {
		const service = this.registry.get(platform);
		return await service.createIssueFromFeedback(feedback, options);
	}

	/**
	 * Create issue using default service
	 */
	async createIssueWithDefault(
		feedback: ProcessedFeedbackData,
		options?: Record<string, unknown>,
	): Promise<IssueCreationResult> {
		const service = this.registry.getDefault();
		return await service.createIssueFromFeedback(feedback, options);
	}

	/**
	 * Find duplicates across all services
	 */
	async findDuplicatesAcrossServices(
		feedback: ProcessedFeedbackData,
	): Promise<DuplicateDetectionResult[]> {
		const services = this.registry.getAll();
		const results = await Promise.allSettled(
			services.map((service) => service.findDuplicateIssue(feedback)),
		);

		return results
			.filter(
				(result): result is PromiseFulfilledResult<DuplicateDetectionResult> =>
					result.status === "fulfilled" && result.value !== null,
			)
			.map((result) => result.value);
	}

	/**
	 * Health check all services
	 */
	async healthCheckAllServices(): Promise<Record<string, HealthCheckResult>> {
		const serviceNames = this.registry.getServiceNames();
		const results: Record<string, HealthCheckResult> = {};

		await Promise.allSettled(
			serviceNames.map(async (name) => {
				try {
					const service = this.registry.get(name);
					results[name] = await service.healthCheck();
				} catch (error) {
					results[name] = {
						status: "unhealthy",
						details: {
							error: (error as Error).message,
							timestamp: new Date().toISOString(),
						},
					};
				}
			}),
		);

		return results;
	}

	/**
	 * Get available service names
	 */
	getAvailableServices(): string[] {
		return this.registry.getServiceNames();
	}
}
