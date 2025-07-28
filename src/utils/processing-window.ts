/**
 * Processing Window Calculator for TestFlight PM Action
 * Intelligently adjusts processing time windows based on action frequency
 * Prevents overlapping feedback processing and optimizes for different schedules
 */

import { getStateManager } from "./state-manager.js";

export interface ProcessingWindowConfig {
	defaultLookbackHours: number;
	bufferMinutes: number;
	maxLookbackHours: number;
	minLookbackMinutes: number;
	enableAdaptiveWindows: boolean;
	overlapPrevention: boolean;
}

export interface ScheduleDetectionResult {
	detectedFrequency: ScheduleFrequency;
	confidence: number;
	reasoning: string[];
	recommendedWindow: ProcessingWindow;
}

export interface ProcessingWindow {
	startTime: Date;
	endTime: Date;
	durationHours: number;
	bufferMinutes: number;
	rationale: string;
}

export type ScheduleFrequency =
	| "manual"
	| "continuous"
	| "hourly"
	| "every-2-hours"
	| "every-4-hours"
	| "every-6-hours"
	| "every-12-hours"
	| "daily"
	| "weekly";

/**
 * Processing Window Calculator with intelligent frequency detection
 */
export class ProcessingWindowCalculator {
	private readonly config: ProcessingWindowConfig;

	constructor(config?: Partial<ProcessingWindowConfig>) {
		this.config = {
			defaultLookbackHours: 24,
			bufferMinutes: 30, // Extra buffer to account for processing delays
			maxLookbackHours: 168, // 1 week max
			minLookbackMinutes: 15, // 15 minutes minimum
			enableAdaptiveWindows: true,
			overlapPrevention: true,
			...config,
		};
	}

	/**
	 * Calculates optimal processing window with frequency detection
	 */
	public async calculateOptimalWindow(
		explicitSince?: string,
		explicitFrequency?: ScheduleFrequency,
	): Promise<ProcessingWindow> {
		// If explicit time is provided, use it with validation
		if (explicitSince) {
			return this.createWindowFromExplicitTime(explicitSince);
		}

		// Detect or use explicit frequency
		let frequency: ScheduleFrequency;
		if (explicitFrequency) {
			frequency = explicitFrequency;
		} else if (this.config.enableAdaptiveWindows) {
			const detectionResult = await this.detectScheduleFrequency();
			frequency = detectionResult.detectedFrequency;
		} else {
			frequency = "daily";
		}

		// Calculate window based on detected frequency
		return this.calculateWindowForFrequency(frequency);
	}

	/**
	 * Detects the likely schedule frequency based on historical data
	 */
	public async detectScheduleFrequency(): Promise<ScheduleDetectionResult> {
		try {
			const stateManager = getStateManager();
			const stats = await stateManager.getStats();

			// Check for GitHub Actions environment indicators
			const githubActionsIndicators = this.detectGitHubActionsSchedule();

			if (githubActionsIndicators.frequency !== "manual") {
				return {
					detectedFrequency: githubActionsIndicators.frequency,
					confidence: githubActionsIndicators.confidence,
					reasoning: githubActionsIndicators.reasoning,
					recommendedWindow: this.calculateWindowForFrequency(
						githubActionsIndicators.frequency,
					),
				};
			}

			// Analyze historical processing patterns
			const historicalPattern = await this.analyzeHistoricalPattern(stats);

			if (historicalPattern.confidence > 0.7) {
				return {
					detectedFrequency: historicalPattern.frequency,
					confidence: historicalPattern.confidence,
					reasoning: historicalPattern.reasoning,
					recommendedWindow: this.calculateWindowForFrequency(
						historicalPattern.frequency,
					),
				};
			}

			// Default to daily if no clear pattern
			const defaultFrequency: ScheduleFrequency = "daily";
			return {
				detectedFrequency: defaultFrequency,
				confidence: 0.5,
				reasoning: [
					"No clear pattern detected",
					"Using conservative daily default",
				],
				recommendedWindow: this.calculateWindowForFrequency(defaultFrequency),
			};
		} catch (error) {
			console.warn(`Failed to detect schedule frequency: ${error}`);
			const defaultFrequency: ScheduleFrequency = "daily";
			return {
				detectedFrequency: defaultFrequency,
				confidence: 0.3,
				reasoning: [
					`Detection failed: ${(error as Error).message}`,
					"Using safe daily default",
				],
				recommendedWindow: this.calculateWindowForFrequency(defaultFrequency),
			};
		}
	}

	/**
	 * Calculates processing window for specific frequency
	 */
	private calculateWindowForFrequency(
		frequency: ScheduleFrequency,
	): ProcessingWindow {
		const now = new Date();
		const endTime = new Date(now);

		let durationHours: number;
		let { bufferMinutes } = this.config;
		let rationale: string;

		switch (frequency) {
			case "continuous":
				durationHours = 0.25; // 15 minutes
				bufferMinutes = 5;
				rationale = "Continuous monitoring with minimal overlap";
				break;

			case "hourly":
				durationHours = 1.5; // 1.5 hours with buffer
				bufferMinutes = 15;
				rationale = "Hourly schedule with 30-minute overlap buffer";
				break;

			case "every-2-hours":
				durationHours = 2.5;
				bufferMinutes = 15;
				rationale = "2-hour schedule with 30-minute overlap buffer";
				break;

			case "every-4-hours":
				durationHours = 4.5;
				bufferMinutes = 30;
				rationale = "4-hour schedule with 30-minute overlap buffer";
				break;

			case "every-6-hours":
				durationHours = 6.5;
				bufferMinutes = 30;
				rationale = "6-hour schedule with 30-minute overlap buffer";
				break;

			case "every-12-hours":
				durationHours = 12.5;
				bufferMinutes = 30;
				rationale = "12-hour schedule with 30-minute overlap buffer";
				break;

			case "daily":
				durationHours = 25; // 25 hours to ensure no gaps
				bufferMinutes = 60;
				rationale = "Daily schedule with 1-hour overlap buffer";
				break;

			case "weekly":
				durationHours = 168 + 24; // 1 week + 1 day buffer
				bufferMinutes = 120;
				rationale = "Weekly schedule with 1-day overlap buffer";
				break;

			default:
				durationHours = this.config.defaultLookbackHours;
				bufferMinutes = this.config.bufferMinutes;
				rationale = "Manual trigger using default lookback period";
				break;
		}

		// Apply constraints
		durationHours = Math.min(durationHours, this.config.maxLookbackHours);
		durationHours = Math.max(
			durationHours,
			this.config.minLookbackMinutes / 60,
		);

		// Calculate start time
		const startTime = new Date(endTime);
		startTime.setTime(startTime.getTime() - durationHours * 60 * 60 * 1000);

		// Apply buffer
		if (this.config.overlapPrevention && bufferMinutes > 0) {
			startTime.setTime(startTime.getTime() - bufferMinutes * 60 * 1000);
			rationale += ` (${bufferMinutes}min buffer applied)`;
		}

		return {
			startTime,
			endTime,
			durationHours,
			bufferMinutes,
			rationale,
		};
	}

	/**
	 * Creates window from explicit time string
	 */
	private createWindowFromExplicitTime(
		explicitSince: string,
	): ProcessingWindow {
		const now = new Date();
		let startTime: Date;

		try {
			// Try parsing as ISO date first
			startTime = new Date(explicitSince);

			// If that fails, try parsing as relative time (e.g., "24h", "7d")
			if (Number.isNaN(startTime.getTime())) {
				startTime = this.parseRelativeTime(explicitSince);
			}
		} catch (error) {
			console.warn(
				`Invalid explicit time "${explicitSince}": ${error}. Using default.`,
			);
			startTime = new Date(
				now.getTime() - this.config.defaultLookbackHours * 60 * 60 * 1000,
			);
		}

		// Validate the start time is reasonable
		const maxLookback = new Date(
			now.getTime() - this.config.maxLookbackHours * 60 * 60 * 1000,
		);
		const minLookback = new Date(
			now.getTime() - this.config.minLookbackMinutes * 60 * 1000,
		);

		if (startTime < maxLookback) {
			console.warn(
				`Explicit time too far back. Limiting to ${this.config.maxLookbackHours} hours.`,
			);
			startTime = maxLookback;
		}

		if (startTime > minLookback) {
			console.warn(
				`Explicit time too recent. Setting to ${this.config.minLookbackMinutes} minutes ago.`,
			);
			startTime = minLookback;
		}

		const durationMs = now.getTime() - startTime.getTime();
		const durationHours = durationMs / (1000 * 60 * 60);

		return {
			startTime,
			endTime: now,
			durationHours,
			bufferMinutes: 0,
			rationale: `Explicit time provided: ${explicitSince}`,
		};
	}

	/**
	 * Parses relative time strings like "24h", "7d", "30m"
	 */
	private parseRelativeTime(timeString: string): Date {
		const now = new Date();
		const regex = /^(\d+)([mhd])$/i;
		const match = timeString.match(regex);

		if (!match || !match[1] || !match[2]) {
			throw new Error(`Invalid relative time format: ${timeString}`);
		}

		const value = parseInt(match[1], 10);
		const unit = match[2].toLowerCase();

		let milliseconds: number;
		switch (unit) {
			case "m":
				milliseconds = value * 60 * 1000;
				break;
			case "h":
				milliseconds = value * 60 * 60 * 1000;
				break;
			case "d":
				milliseconds = value * 24 * 60 * 60 * 1000;
				break;
			default:
				throw new Error(`Invalid time unit: ${unit}`);
		}

		return new Date(now.getTime() - milliseconds);
	}

	/**
	 * Detects GitHub Actions schedule from environment
	 */
	private detectGitHubActionsSchedule(): {
		frequency: ScheduleFrequency;
		confidence: number;
		reasoning: string[];
	} {
		const reasoning: string[] = [];

		// Check if running in GitHub Actions
		if (process.env.GITHUB_ACTIONS !== "true") {
			reasoning.push("Not running in GitHub Actions");
			return {
				frequency: "manual",
				confidence: 0.3,
				reasoning,
			};
		}

		reasoning.push("Running in GitHub Actions");

		// Check trigger event
		const triggerEvent = process.env.GITHUB_EVENT_NAME;
		if (triggerEvent === "workflow_dispatch") {
			reasoning.push("Triggered manually via workflow_dispatch");
			return {
				frequency: "manual",
				confidence: 0.9,
				reasoning,
			};
		}

		if (triggerEvent === "schedule") {
			reasoning.push("Triggered via scheduled event");

			// Try to detect frequency from workflow context
			// Note: This is limited without access to the actual workflow file
			// In a real implementation, we could read .github/workflows/*.yml
			const workflowName: string | undefined = process.env.GITHUB_WORKFLOW;
			if (workflowName) {
				reasoning.push(`Workflow: ${workflowName}`);

				// Heuristic detection based on workflow name
				const name = workflowName.toLowerCase();
				if (name.includes("hourly")) {
					return { frequency: "hourly", confidence: 0.8, reasoning };
				}
				if (name.includes("6") && name.includes("hour")) {
					return { frequency: "every-6-hours", confidence: 0.8, reasoning };
				}
				if (name.includes("daily")) {
					return { frequency: "daily", confidence: 0.8, reasoning };
				}
			}

			reasoning.push("Scheduled event but frequency unclear");
			return {
				frequency: "daily", // Conservative default
				confidence: 0.6,
				reasoning,
			};
		}

		reasoning.push(`Unknown trigger event: ${triggerEvent}`);
		return {
			frequency: "manual",
			confidence: 0.5,
			reasoning,
		};
	}

	/**
	 * Analyzes historical processing patterns
	 */
	private async analyzeHistoricalPattern(stats: {
		totalProcessed: number;
		lastProcessedAt: string;
		currentlyCached: number;
		cacheAge: string;
		actionRunId?: string;
	}): Promise<{
		frequency: ScheduleFrequency;
		confidence: number;
		reasoning: string[];
	}> {
		const reasoning: string[] = [];

		// Enhanced historical pattern analysis
		let detectedFrequency: ScheduleFrequency = "daily";
		let confidence = 0.3;

		try {
			const { totalProcessed, lastProcessedAt, actionRunId } = stats;

			reasoning.push(`Total processed: ${totalProcessed || 0}`);
			reasoning.push(`Cache age: ${stats.cacheAge || "unknown"}`);

			// Analyze processing frequency based on historical data
			if (totalProcessed > 0 && lastProcessedAt) {
				const lastProcessedDate = new Date(lastProcessedAt);
				const timeSinceLastRun = Date.now() - lastProcessedDate.getTime();
				const hoursSinceLastRun = timeSinceLastRun / (1000 * 60 * 60);

				reasoning.push(`Hours since last run: ${hoursSinceLastRun.toFixed(1)}`);

				// Determine frequency based on time gaps
				if (hoursSinceLastRun <= 1.5) {
					detectedFrequency = "hourly";
					confidence = 0.8;
					reasoning.push("Recent processing indicates hourly schedule");
				} else if (hoursSinceLastRun <= 3) {
					detectedFrequency = "every-2-hours";
					confidence = 0.7;
					reasoning.push("Processing pattern suggests 2-hour intervals");
				} else if (hoursSinceLastRun <= 6) {
					detectedFrequency = "every-4-hours";
					confidence = 0.6;
					reasoning.push("Processing pattern suggests 4-hour intervals");
				} else if (hoursSinceLastRun <= 12) {
					detectedFrequency = "every-6-hours";
					confidence = 0.5;
					reasoning.push("Processing pattern suggests 6-hour intervals");
				} else if (hoursSinceLastRun <= 36) {
					detectedFrequency = "daily";
					confidence = 0.7;
					reasoning.push("Processing pattern indicates daily schedule");
				} else {
					detectedFrequency = "weekly";
					confidence = 0.4;
					reasoning.push("Infrequent processing suggests weekly schedule");
				}

				// Check for GitHub Action run ID pattern
				if (actionRunId) {
					reasoning.push(
						`Automated execution detected (Run ID: ${actionRunId})`,
					);
					confidence += 0.1;
				}

				// Volume-based adjustments
				if (totalProcessed > 100) {
					reasoning.push("High processing volume suggests frequent monitoring");
					if (detectedFrequency === "weekly") {
						detectedFrequency = "daily";
						confidence += 0.1;
					}
				} else if (totalProcessed < 10) {
					reasoning.push(
						"Low processing volume suggests less frequent monitoring",
					);
					confidence = Math.max(0.3, confidence - 0.1);
				}
			} else {
				reasoning.push(
					"No historical data available - using default frequency detection",
				);
				detectedFrequency = "daily";
				confidence = 0.4;
			}
		} catch (error) {
			reasoning.push(`Historical analysis failed: ${error}`);
			confidence = 0.3;
		}

		return {
			frequency: detectedFrequency,
			confidence: Math.min(1.0, Math.max(0.1, confidence)),
			reasoning,
		};
	}

	/**
	 * Gets diagnostic information about processing windows
	 */
	public async getDiagnostics(): Promise<{
		currentConfig: ProcessingWindowConfig;
		detectedSchedule: ScheduleDetectionResult;
		recommendedWindow: ProcessingWindow;
		stateInfo: {
			totalProcessed: number;
			lastProcessedAt: string;
			currentlyCached: number;
			cacheAge: string;
			actionRunId?: string;
		};
	}> {
		const detectedSchedule = await this.detectScheduleFrequency();
		const stateManager = getStateManager();
		const stateInfo = await stateManager.getStats();

		return {
			currentConfig: this.config,
			detectedSchedule,
			recommendedWindow: detectedSchedule.recommendedWindow,
			stateInfo,
		};
	}
}

/**
 * Global processing window calculator instance
 */
let _calculatorInstance: ProcessingWindowCalculator | null = null;

export function getProcessingWindowCalculator(): ProcessingWindowCalculator {
	if (!_calculatorInstance) {
		_calculatorInstance = new ProcessingWindowCalculator();
	}
	return _calculatorInstance;
}

/**
 * Clears the global calculator instance (useful for testing)
 */
export function clearProcessingWindowCalculatorInstance(): void {
	_calculatorInstance = null;
}

/**
 * Helper function for backward compatibility with existing code
 */
export async function getOptimalMonitoringSince(
	explicitSince?: string,
	explicitFrequency?: ScheduleFrequency,
): Promise<Date> {
	const calculator = getProcessingWindowCalculator();
	const window = await calculator.calculateOptimalWindow(
		explicitSince,
		explicitFrequency,
	);
	return window.startTime;
}
