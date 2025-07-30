/**
 * LLM Prompt Templates - DEPRECATED
 * This module has been superseded by secure-prompts.ts
 * 
 * This file now serves as a compatibility layer that redirects all calls
 * to the new secure prompt system. All legacy methods are deprecated.
 * 
 * For new code, use: import { getSecurePromptManager } from "../config/secure-prompts.js"
 */

import type { ProcessedFeedbackData } from "../../types/testflight.js";
import type { CodebaseAnalysisResult } from "../analysis/codebase-analyzer.js";
import { getSecurePromptManager, type SecurePromptTemplate } from "../config/secure-prompts.js";

export interface PromptContext {
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
	platform: "github" | "linear";
	projectType?: "ios" | "android" | "web" | "desktop";
}

export interface EnhancementTemplate {
	systemPrompt: string;
	userPrompt: string;
	outputSchema: object;
	examples: Array<{
		input: string;
		output: string;
	}>;
	securityValidated?: boolean;
}

/**
 * Prompt template manager - DEPRECATED
 * Use SecurePromptManager instead for enhanced security
 * @deprecated Use getSecurePromptManager() instead
 */
export class PromptTemplateManager {
	private readonly securePromptManager = getSecurePromptManager();
	
	/**
	 * Gets the appropriate template based on feedback type
	 * @deprecated Use SecurePromptManager.getCrashAnalysisTemplate() or getFeedbackAnalysisTemplate() instead
	 */
	public getTemplate(context: PromptContext): EnhancementTemplate {
		console.warn('[DEPRECATED] PromptTemplateManager.getTemplate() is deprecated. Use SecurePromptManager instead.');
		return this.getSecureTemplate(context);
	}
	
	/**
	 * Gets secure template using the new secure prompt manager
	 */
	public getSecureTemplate(context: PromptContext): EnhancementTemplate {
		const { feedback, platform } = context;
		
		let secureTemplate: SecurePromptTemplate;
		
		if (feedback.type === "crash") {
			secureTemplate = this.securePromptManager.getCrashAnalysisTemplate(
				platform, 
				!!context.codebaseAnalysis
			);
		} else {
			secureTemplate = this.securePromptManager.getFeedbackAnalysisTemplate(
				platform, 
				feedback.type
			);
		}
		
		// Convert to legacy format for backward compatibility
		return {
			systemPrompt: secureTemplate.systemPrompt,
			userPrompt: this.buildMinimalUserPrompt(context),
			outputSchema: secureTemplate.outputSchema,
			examples: this.getExamples(feedback.type),
			securityValidated: secureTemplate.securityValidated
		};
	}
	
	/**
	 * Builds a minimal user prompt (most functionality moved to LLM client)
	 */
	private buildMinimalUserPrompt(context: PromptContext): string {
		const { feedback } = context;
		
		if (feedback.type === "crash" && feedback.crashData) {
			return `Crash Analysis Request for ${feedback.appVersion} (Build ${feedback.buildNumber})`;
		}
		
		if (feedback.screenshotData) {
			return `User Feedback Analysis for ${feedback.appVersion} (Build ${feedback.buildNumber})`;
		}
		
		return "Analysis request - details will be provided by the LLM client.";
	}
	
	/**
	 * Gets examples for feedback type
	 */
	private getExamples(feedbackType: string): Array<{ input: string; output: string }> {
		if (feedbackType === "crash") {
			return [
				{
					input: "App crashed with NSInvalidArgumentException",
					output: JSON.stringify({
						title: "💥 Critical Crash: NSInvalidArgumentException in Login Flow",
						description: "App experiencing critical crashes during user authentication...",
						labels: ["crash", "urgent", "authentication"],
						priority: "urgent",
					}),
				},
			];
		}
		
		return [
			{
				input: "User feedback about UI issues",
				output: JSON.stringify({
					title: "🎨 UI Enhancement: Improve User Interface Elements",
					description: "User feedback indicates issues with current UI design...",
					labels: ["enhancement", "ui", "user-feedback"],
					priority: "normal",
				}),
			},
		];
	}
}

/**
 * Global prompt template manager instance
 * @deprecated Use getSecurePromptManager() instead
 */
let _templateManagerInstance: PromptTemplateManager | null = null;

/**
 * @deprecated Use getSecurePromptManager() instead
 */
export function getPromptTemplateManager(): PromptTemplateManager {
	console.warn('[DEPRECATED] getPromptTemplateManager() is deprecated. Use getSecurePromptManager() instead.');
	if (!_templateManagerInstance) {
		_templateManagerInstance = new PromptTemplateManager();
	}
	return _templateManagerInstance;
}

/**
 * Clears the global template manager instance (useful for testing)
 * @deprecated
 */
export function clearPromptTemplateManagerInstance(): void {
	_templateManagerInstance = null;
}

/**
 * Convenience function to get secure template for context
 * @deprecated Use getSecurePromptManager().getCrashAnalysisTemplate() or getFeedbackAnalysisTemplate() instead
 */
export function getEnhancementTemplate(
	context: PromptContext,
): EnhancementTemplate {
	console.warn('[DEPRECATED] getEnhancementTemplate() is deprecated. Use getSecurePromptManager() instead.');
	const manager = getPromptTemplateManager();
	return manager.getSecureTemplate(context);
}

/**
 * Gets secure enhancement template with input validation
 * This is the recommended migration path - but prefer using getSecurePromptManager() directly
 */
export function getSecureEnhancementTemplate(
	context: PromptContext,
): EnhancementTemplate {
	const manager = getPromptTemplateManager();
	return manager.getSecureTemplate(context);
}

// Re-export secure prompt manager for convenience
export { getSecurePromptManager } from "../config/secure-prompts.js";
