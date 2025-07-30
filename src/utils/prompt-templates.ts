/**
 * LLM Prompt Templates - DEPRECATED
 * This module has been superseded by secure-prompts.ts
 * Migrated to use secure prompt storage and injection prevention
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
	securityValidated?: boolean; // Added for backward compatibility
}

/**
 * Prompt template manager for different feedback types - DEPRECATED
 * Use SecurePromptManager instead for enhanced security
 */
export class PromptTemplateManager {
	private readonly securePromptManager = getSecurePromptManager();
	
	/**
	 * Gets the appropriate template based on feedback type
	 * @deprecated Use SecurePromptManager instead
	 */
	public getTemplate(context: PromptContext): EnhancementTemplate {
		console.warn('[DEPRECATED] PromptTemplateManager.getTemplate() is deprecated. Use SecurePromptManager instead.');
		
		const { feedback } = context;

		if (feedback.type === "crash") {
			return this.getCrashReportTemplate(context);
		}

		return this.getUserFeedbackTemplate(context);
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
			userPrompt: this.buildSecureUserPrompt(context, secureTemplate),
			outputSchema: secureTemplate.outputSchema,
			examples: this.getExamples(feedback.type),
			securityValidated: secureTemplate.securityValidated
		};
	}

	/**
	 * Creates a crash report analysis template
	 * @deprecated Use getSecureTemplate instead
	 */
	private getCrashReportTemplate(context: PromptContext): EnhancementTemplate {
		// Extract context for template generation
		const { feedback: _feedback, codebaseAnalysis, platform } = context;

		const systemPrompt = `You are an expert software engineer analyzing iOS/mobile app crash reports from TestFlight. Your task is to create high-quality, actionable bug reports with technical analysis and relevant code area identification.

Focus on:
- Technical root cause analysis
- Stack trace interpretation  
- Impact assessment and severity classification
- Code area identification and correlation
- Reproducibility analysis
- Recommended fix approaches

Platform context: ${platform || "iOS"}
Codebase analysis available: ${!!codebaseAnalysis}`;

		return {
			systemPrompt,
			userPrompt: this.buildSecureCrashUserPrompt(context),
			outputSchema: {
				type: "object",
				properties: {
					title: { type: "string" },
					description: { type: "string" },
					labels: { type: "array", items: { type: "string" } },
					priority: {
						type: "string",
						enum: ["urgent", "high", "normal", "low"],
					},
				},
				required: ["title", "description", "labels", "priority"],
			},
			examples: [
				{
					input: "App crashed with NSInvalidArgumentException",
					output: JSON.stringify({
						title:
							"💥 Critical Crash: NSInvalidArgumentException in Login Flow",
						description:
							"App experiencing critical crashes during user authentication...",
						labels: ["crash", "urgent", "authentication"],
						priority: "urgent",
					}),
				},
			],
		};
	}

	/**
	 * Creates a user feedback enhancement template
	 * @deprecated Use getSecureTemplate instead
	 */
	private getUserFeedbackTemplate(context: PromptContext): EnhancementTemplate {
		const { feedback, platform } = context;

		const systemPrompt = `You are an expert product manager and UX designer analyzing user feedback from TestFlight. Your task is to create actionable feature requests and improvement tasks with user experience insights.

Focus on:
- User experience analysis
- Feature gap identification
- UI/UX improvement recommendations
- Priority assessment based on user impact
- Implementation complexity estimation
- User journey optimization

Platform context: ${platform || "iOS"}
Feedback type: ${feedback.type}`;

		return {
			systemPrompt,
			userPrompt: this.buildSecureFeedbackUserPrompt(context),
			outputSchema: {
				type: "object",
				properties: {
					title: { type: "string" },
					description: { type: "string" },
					labels: { type: "array", items: { type: "string" } },
					priority: {
						type: "string",
						enum: ["urgent", "high", "normal", "low"],
					},
				},
				required: ["title", "description", "labels", "priority"],
			},
			examples: [
				{
					input: "User feedback about UI issues",
					output: JSON.stringify({
						title: "🎨 UI Enhancement: Improve User Interface Elements",
						description:
							"User feedback indicates issues with current UI design...",
						labels: ["enhancement", "ui", "user-feedback"],
						priority: "normal",
					}),
				},
			],
		};
	}

	/**
	 * Builds secure user prompt with input validation
	 */
	private buildSecureUserPrompt(context: PromptContext, secureTemplate: SecurePromptTemplate): string {
		const { feedback } = context;
		
		if (feedback.type === "crash") {
			return this.buildSecureCrashUserPrompt(context);
		}
		
		return this.buildSecureFeedbackUserPrompt(context);
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
	
	/**
	 * Builds secure user prompt for crash analysis with input validation
	 */
	private buildSecureCrashUserPrompt(context: PromptContext): string {
		const { feedback, codebaseAnalysis, recentChanges, relatedIssues } =
			context;

		if (!feedback.crashData) {
			return "No crash data available for analysis.";
		}

		const { crashData, appVersion, buildNumber, deviceInfo, submittedAt, id } =
			feedback;

		// Sanitize all user inputs through the secure prompt manager
		const appVersionSanitized = this.securePromptManager.validateUserInput(appVersion || 'unknown', 'app_version').sanitized;
		const buildNumberSanitized = this.securePromptManager.validateUserInput(buildNumber || 'unknown', 'build_number').sanitized;
		const deviceModelSanitized = this.securePromptManager.validateUserInput(deviceInfo.model || 'unknown', 'device_model').sanitized;
		const osVersionSanitized = this.securePromptManager.validateUserInput(deviceInfo.osVersion || 'unknown', 'os_version').sanitized;
		const localeSanitized = this.securePromptManager.validateUserInput(deviceInfo.locale || 'unknown', 'locale').sanitized;
		const idSanitized = this.securePromptManager.validateUserInput(id || 'unknown', 'testflight_id').sanitized;
		const crashTypeSanitized = this.securePromptManager.validateUserInput(crashData.type || 'unknown', 'crash_type').sanitized;
		
		const exceptionTypeSanitized = crashData.exceptionType ? 
			this.securePromptManager.validateUserInput(crashData.exceptionType, 'exception_type').sanitized : null;
		const exceptionMessageSanitized = crashData.exceptionMessage ? 
			this.securePromptManager.validateUserInput(crashData.exceptionMessage, 'exception_message').sanitized : null;
		const traceSanitized = this.securePromptManager.validateUserInput(crashData.trace || 'No trace available', 'crash_trace').sanitized;

		let prompt = `## 💥 CRASH REPORT ANALYSIS

### Basic Information
- **App Version**: ${appVersionSanitized} (Build ${buildNumberSanitized})
- **Device**: ${deviceModelSanitized} running ${osVersionSanitized}
- **Locale**: ${localeSanitized}
- **Crash Time**: ${submittedAt.toISOString()}
- **TestFlight ID**: ${idSanitized}

### Crash Details
- **Crash Type**: ${crashTypeSanitized}
${exceptionTypeSanitized ? `- **Exception Type**: ${exceptionTypeSanitized}` : ""}
${exceptionMessageSanitized ? `- **Exception Message**: ${exceptionMessageSanitized}` : ""}

### Stack Trace
\`\`\`
${traceSanitized}
\`\`\`

`;

		// Add codebase analysis if available
		if (codebaseAnalysis && codebaseAnalysis.relevantFiles.length > 0) {
			prompt += `### 🔍 Potentially Relevant Code Areas

`;
			for (const area of codebaseAnalysis.relevantFiles.slice(0, 3)) {
				prompt += `#### ${area.file} (Lines ${area.lines}) - ${(area.confidence * 100).toFixed(0)}% confidence
**Reason**: ${area.reason}

\`\`\`
${area.content.substring(0, 400)}${area.content.length > 400 ? "..." : ""}
\`\`\`

`;
			}
		}

		// Add recent changes if available
		if (recentChanges && recentChanges.length > 0) {
			prompt += `### 📝 Recent Changes (Last 7 days)

`;
			for (const change of recentChanges.slice(0, 2)) {
				prompt += `#### ${change.file} - ${change.author} (${change.timestamp})
\`\`\`diff
${change.diff.substring(0, 300)}${change.diff.length > 300 ? "..." : ""}
\`\`\`

`;
			}
		}

		// Add related issues if available
		if (relatedIssues && relatedIssues.length > 0) {
			prompt += `### 🔗 Related Issues

`;
			for (const issue of relatedIssues) {
				prompt += `- [${issue.platform.toUpperCase()} #${issue.number}] ${issue.title}\n`;
			}
			prompt += "\n";
		}

		prompt += `### Analysis Request

Please analyze this crash report and provide a comprehensive technical assessment. Focus on:

1. **Root Cause Identification**: What likely caused this crash?
2. **Code Area Analysis**: Which files/methods are most likely involved?
3. **Fix Strategy**: What specific steps should developers take?
4. **Priority Assessment**: How critical is this crash for users?

Provide your analysis in the specified JSON format with actionable insights for the development team.`;

		return prompt;
	}

	/**
	 * Builds secure user prompt for feedback analysis with input validation
	 */
	private buildSecureFeedbackUserPrompt(context: PromptContext): string {
		const { feedback, codebaseAnalysis, relatedIssues } = context;

		if (!feedback.screenshotData) {
			return "No screenshot data available for analysis.";
		}

		const {
			screenshotData,
			appVersion,
			buildNumber,
			deviceInfo,
			submittedAt,
			id,
		} = feedback;

		// Sanitize all user inputs
		const appVersionSanitized = this.securePromptManager.validateUserInput(appVersion || 'unknown', 'app_version').sanitized;
		const buildNumberSanitized = this.securePromptManager.validateUserInput(buildNumber || 'unknown', 'build_number').sanitized;
		const deviceModelSanitized = this.securePromptManager.validateUserInput(deviceInfo.model || 'unknown', 'device_model').sanitized;
		const osVersionSanitized = this.securePromptManager.validateUserInput(deviceInfo.osVersion || 'unknown', 'os_version').sanitized;
		const localeSanitized = this.securePromptManager.validateUserInput(deviceInfo.locale || 'unknown', 'locale').sanitized;
		const idSanitized = this.securePromptManager.validateUserInput(id || 'unknown', 'testflight_id').sanitized;
		const feedbackTextSanitized = this.securePromptManager.validateUserInput(screenshotData.text || 'No text provided', 'feedback_text').sanitized;
		
		// Sanitize screenshot filenames
		const sanitizedScreenshots = screenshotData.images.map((img, i) => {
			const fileNameSanitized = this.securePromptManager.validateUserInput(img.fileName || `screenshot_${i + 1}`, `screenshot_${i}`).sanitized;
			return `- Screenshot ${i + 1}: ${fileNameSanitized}`;
		}).join("\n");

		let prompt = `## 📱 USER FEEDBACK ANALYSIS

### Basic Information
- **App Version**: ${appVersionSanitized} (Build ${buildNumberSanitized})
- **Device**: ${deviceModelSanitized} running ${osVersionSanitized}
- **Locale**: ${localeSanitized}
- **Feedback Time**: ${submittedAt.toISOString()}
- **TestFlight ID**: ${idSanitized}

### User Feedback
**User's Message**:
> ${feedbackTextSanitized}

**Screenshots**: ${screenshotData.images.length} image(s) attached
${sanitizedScreenshots}

`;

		// Add codebase analysis if available
		if (codebaseAnalysis && codebaseAnalysis.relevantFiles.length > 0) {
			prompt += `### 🎯 Potentially Relevant Code Areas

`;
			for (const area of codebaseAnalysis.relevantFiles.slice(0, 3)) {
				prompt += `#### ${area.file} (Lines ${area.lines}) - ${(area.confidence * 100).toFixed(0)}% confidence
**Reason**: ${area.reason}

\`\`\`
${area.content.substring(0, 400)}${area.content.length > 400 ? "..." : ""}
\`\`\`

`;
			}
		}

		// Add related issues if available
		if (relatedIssues && relatedIssues.length > 0) {
			prompt += `### 🔗 Related Issues

`;
			for (const issue of relatedIssues) {
				prompt += `- [${issue.platform.toUpperCase()} #${issue.number}] ${issue.title}\n`;
			}
			prompt += "\n";
		}

		prompt += `### Analysis Request

Please analyze this user feedback and create an actionable task for the development team. Focus on:

1. **User Intent**: What is the user trying to achieve?
2. **Pain Points**: What specific problems are they experiencing?
3. **UI/UX Impact**: Which screens or components need attention?
4. **Implementation Strategy**: How should this be addressed?
5. **Business Value**: What's the potential impact of fixing this?

Provide your analysis in the specified JSON format with clear user stories and implementation guidance.`;

		return prompt;
	}
	
	/**
	 * Legacy method for backward compatibility
	 * @deprecated Use buildSecureCrashUserPrompt instead
	 */
	private buildCrashUserPrompt(context: PromptContext): string {
		console.warn('[DEPRECATED] buildCrashUserPrompt() is deprecated. Use buildSecureCrashUserPrompt() instead.');
		return this.buildSecureCrashUserPrompt(context);
	}
	
	/**
	 * Legacy method for backward compatibility
	 * @deprecated Use buildSecureFeedbackUserPrompt instead
	 */
	private buildFeedbackUserPrompt(context: PromptContext): string {
		console.warn('[DEPRECATED] buildFeedbackUserPrompt() is deprecated. Use buildSecureFeedbackUserPrompt() instead.');
		return this.buildSecureFeedbackUserPrompt(context);
	}
}

/**
 * Global prompt template manager instance
 */
let _templateManagerInstance: PromptTemplateManager | null = null;

export function getPromptTemplateManager(): PromptTemplateManager {
	if (!_templateManagerInstance) {
		_templateManagerInstance = new PromptTemplateManager();
	}
	return _templateManagerInstance;
}

/**
 * Clears the global template manager instance (useful for testing)
 */
export function clearPromptTemplateManagerInstance(): void {
	_templateManagerInstance = null;
}

/**
 * Convenience function to get secure template for context
 * @deprecated Use getSecureEnhancementTemplate instead
 */
export function getEnhancementTemplate(
	context: PromptContext,
): EnhancementTemplate {
	console.warn('[DEPRECATED] getEnhancementTemplate() is deprecated. Use getSecureEnhancementTemplate() instead.');
	const manager = getPromptTemplateManager();
	return manager.getTemplate(context);
}

/**
 * Gets secure enhancement template with input validation
 */
export function getSecureEnhancementTemplate(
	context: PromptContext,
): EnhancementTemplate {
	const manager = getPromptTemplateManager();
	return manager.getSecureTemplate(context);
}
