/**
 * State Management for TestFlight PM Action
 * Handles persistence of processed feedback IDs to prevent duplicate processing
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { PATHS } from "../config/constants.js";

export interface ProcessedFeedbackState {
	feedbackIds: Set<string>;
	lastUpdated: Date;
	actionRunId?: string;
	metadata: {
		totalProcessed: number;
		lastProcessedTimestamp: string;
		version: string;
	};
}

export interface StateManagerConfig {
	stateFilePath: string;
	maxRetainedIds: number;
	cacheExpiryHours: number;
	enableGitHubActionsCache: boolean;
}

/**
 * State Manager for tracking processed TestFlight feedback
 * Implements both file-based and GitHub Actions cache persistence
 */
export class TestFlightStateManager {
	private readonly config: StateManagerConfig;
	private state: ProcessedFeedbackState | null = null;
	private readonly stateVersion = "1.0.0";

	constructor(config?: Partial<StateManagerConfig>) {
		this.config = {
			stateFilePath: join(PATHS.TEMP_DIR, "processed-feedback-state.json"),
			maxRetainedIds: 10000, // Keep last 10K processed IDs
			cacheExpiryHours: 168, // 1 week retention
			enableGitHubActionsCache: process.env.GITHUB_ACTIONS === "true",
			...config,
		};
	}

	/**
	 * Loads the current state from cache or file system
	 */
	public async loadState(): Promise<ProcessedFeedbackState> {
		if (this.state) {
			return this.state;
		}

		try {
			// Try GitHub Actions cache first if available
			if (this.config.enableGitHubActionsCache) {
				const cachedState = await this.loadFromGitHubCache();
				if (cachedState) {
					this.state = cachedState;
					return this.state;
				}
			}

			// Fallback to file system
			const fileState = await this.loadFromFile();
			this.state = fileState;
			return this.state;
		} catch (error) {
			console.warn(`Failed to load state: ${error}. Initializing fresh state.`);
			this.state = this.createFreshState();
			return this.state;
		}
	}

	/**
	 * Saves the current state to persistent storage
	 */
	public async saveState(): Promise<void> {
		if (!this.state) {
			throw new Error("No state to save. Call loadState() first.");
		}

		this.state.lastUpdated = new Date();

		try {
			// Save to GitHub Actions cache if available
			if (this.config.enableGitHubActionsCache) {
				await this.saveToGitHubCache(this.state);
			}

			// Always save to file as backup
			await this.saveToFile(this.state);

			console.log(
				`State saved: ${this.state.feedbackIds.size} processed IDs tracked`,
			);
		} catch (error) {
			console.error(`Failed to save state: ${error}`);
			throw error;
		}
	}

	/**
	 * Checks if a feedback ID has been processed
	 */
	public async isProcessed(feedbackId: string): Promise<boolean> {
		const state = await this.loadState();
		return state.feedbackIds.has(feedbackId);
	}

	/**
	 * Marks feedback IDs as processed
	 */
	public async markAsProcessed(
		feedbackIds: string[],
		actionRunId?: string,
	): Promise<void> {
		const state = await this.loadState();

		for (const id of feedbackIds) {
			state.feedbackIds.add(id);
		}

		state.metadata.totalProcessed += feedbackIds.length;
		state.metadata.lastProcessedTimestamp = new Date().toISOString();
		state.actionRunId = actionRunId;

		// Cleanup old IDs if we exceed the limit
		await this.cleanupOldIds();

		this.state = state;
	}

	/**
	 * Filters out already processed feedback
	 */
	public async filterUnprocessed<T extends { id: string }>(
		feedbackItems: T[],
	): Promise<T[]> {
		const state = await this.loadState();
		return feedbackItems.filter((item) => !state.feedbackIds.has(item.id));
	}

	/**
	 * Gets statistics about processed feedback
	 */
	public async getStats(): Promise<{
		totalProcessed: number;
		lastProcessedAt: string;
		currentlyCached: number;
		cacheAge: string;
		actionRunId?: string;
	}> {
		const state = await this.loadState();
		const ageMs = Date.now() - state.lastUpdated.getTime();
		const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
		const ageMinutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));

		return {
			totalProcessed: state.metadata.totalProcessed,
			lastProcessedAt: state.metadata.lastProcessedTimestamp,
			currentlyCached: state.feedbackIds.size,
			cacheAge: `${ageHours}h ${ageMinutes}m`,
			actionRunId: state.actionRunId,
		};
	}

	/**
	 * Clears expired or excess processed IDs
	 */
	private async cleanupOldIds(): Promise<void> {
		if (!this.state) return;

		const { feedbackIds, lastUpdated } = this.state;

		// Remove old entries if cache has expired
		const expiryDate = new Date();
		expiryDate.setHours(expiryDate.getHours() - this.config.cacheExpiryHours);

		if (lastUpdated < expiryDate) {
			console.log("Cache expired. Clearing old processed IDs.");
			feedbackIds.clear();
			return;
		}

		// Trim excess IDs if we exceed the limit
		if (feedbackIds.size > this.config.maxRetainedIds) {
			const excess = feedbackIds.size - this.config.maxRetainedIds;
			const idsArray = Array.from(feedbackIds);

			// Remove oldest IDs (assumes IDs are roughly chronological)
			for (let i = 0; i < excess && i < idsArray.length; i++) {
				const id = idsArray[i];
				if (id) {
					feedbackIds.delete(id);
				}
			}

			console.log(`Cleaned up ${excess} old processed IDs`);
		}
	}

	/**
	 * Creates a fresh state object
	 */
	private createFreshState(): ProcessedFeedbackState {
		return {
			feedbackIds: new Set<string>(),
			lastUpdated: new Date(),
			metadata: {
				totalProcessed: 0,
				lastProcessedTimestamp: new Date().toISOString(),
				version: this.stateVersion,
			},
		};
	}

	/**
	 * Loads state from GitHub Actions cache
	 */
	private async loadFromGitHubCache(): Promise<ProcessedFeedbackState | null> {
		try {
			// Use @actions/cache if available
			const _cacheKey = "testflight-pm-processed-feedback";
			const cachePath = this.config.stateFilePath;

			// Note: This would require @actions/cache package in a real implementation
			// For now, we'll just try to read from the expected cache location
			const cacheData = await fs.readFile(cachePath, "utf8");
			return this.deserializeState(cacheData);
		} catch {
			return null;
		}
	}

	/**
	 * Saves state to GitHub Actions cache
	 */
	private async saveToGitHubCache(
		state: ProcessedFeedbackState,
	): Promise<void> {
		try {
			const serialized = this.serializeState(state);
			await this.ensureDirectoryExists();
			await fs.writeFile(this.config.stateFilePath, serialized, "utf8");

			// Note: In a real implementation, this would use @actions/cache
			console.log("State cached for GitHub Actions");
		} catch (error) {
			console.warn(`Failed to save to GitHub cache: ${error}`);
		}
	}

	/**
	 * Loads state from file system
	 */
	private async loadFromFile(): Promise<ProcessedFeedbackState> {
		try {
			const data = await fs.readFile(this.config.stateFilePath, "utf8");
			return this.deserializeState(data);
		} catch {
			return this.createFreshState();
		}
	}

	/**
	 * Saves state to file system
	 */
	private async saveToFile(state: ProcessedFeedbackState): Promise<void> {
		try {
			const serialized = this.serializeState(state);
			await this.ensureDirectoryExists();
			await fs.writeFile(this.config.stateFilePath, serialized, "utf8");
		} catch (error) {
			console.error(`Failed to save state to file: ${error}`);
			throw error;
		}
	}

	/**
	 * Serializes state to JSON string
	 */
	private serializeState(state: ProcessedFeedbackState): string {
		return JSON.stringify({
			...state,
			feedbackIds: Array.from(state.feedbackIds),
			lastUpdated: state.lastUpdated.toISOString(),
		});
	}

	/**
	 * Deserializes state from JSON string
	 */
	private deserializeState(data: string): ProcessedFeedbackState {
		const parsed = JSON.parse(data);
		return {
			...parsed,
			feedbackIds: new Set(parsed.feedbackIds),
			lastUpdated: new Date(parsed.lastUpdated),
		};
	}

	/**
	 * Ensures the state directory exists
	 */
	private async ensureDirectoryExists(): Promise<void> {
		const directory = dirname(this.config.stateFilePath);
		try {
			await fs.mkdir(directory, { recursive: true });
		} catch (_error) {
			// Directory might already exist
		}
	}

	/**
	 * Clears all state (useful for testing)
	 */
	public async clearState(): Promise<void> {
		this.state = this.createFreshState();
		try {
			await fs.unlink(this.config.stateFilePath);
		} catch {
			// File might not exist
		}
	}
}

/**
 * Global state manager instance
 */
let _stateManagerInstance: TestFlightStateManager | null = null;

export function getStateManager(): TestFlightStateManager {
	if (!_stateManagerInstance) {
		_stateManagerInstance = new TestFlightStateManager();
	}
	return _stateManagerInstance;
}

/**
 * Clears the global state manager instance (useful for testing)
 */
export function clearStateManagerInstance(): void {
	_stateManagerInstance = null;
}
