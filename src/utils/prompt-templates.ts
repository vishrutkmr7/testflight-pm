/**
 * LLM Prompt Templates
 * Sophisticated prompt engineering for TestFlight feedback enhancement
 */

import type { ProcessedFeedbackData } from "../../types/testflight.js";
import type { CodebaseAnalysisResult } from "../analysis/codebase-analyzer.js";

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
}

/**
 * Prompt template manager for different feedback types
 */
export class PromptTemplateManager {
    /**
     * Gets the appropriate template based on feedback type
     */
    public getTemplate(context: PromptContext): EnhancementTemplate {
        const { feedback } = context;

        if (feedback.type === "crash") {
            return this.getCrashReportTemplate(context);
        }

        return this.getUserFeedbackTemplate(context);
    }

    /**
     * Creates a crash report analysis template
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
            userPrompt: this.buildCrashUserPrompt(context),
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
            userPrompt: this.buildFeedbackUserPrompt(context),
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
     * Builds user prompt for crash analysis
     */
    private buildCrashUserPrompt(context: PromptContext): string {
        const { feedback, codebaseAnalysis, recentChanges, relatedIssues } =
            context;

        if (!feedback.crashData) {
            return "No crash data available for analysis.";
        }

        const { crashData, appVersion, buildNumber, deviceInfo, submittedAt, id } =
            feedback;

        let prompt = `## 💥 CRASH REPORT ANALYSIS

### Basic Information
- **App Version**: ${appVersion} (Build ${buildNumber})
- **Device**: ${deviceInfo.model} running ${deviceInfo.osVersion}
- **Locale**: ${deviceInfo.locale}
- **Crash Time**: ${submittedAt.toISOString()}
- **TestFlight ID**: ${id}

### Crash Details
- **Crash Type**: ${crashData.type}
${crashData.exceptionType ? `- **Exception Type**: ${crashData.exceptionType}` : ""}
${crashData.exceptionMessage ? `- **Exception Message**: ${crashData.exceptionMessage}` : ""}

### Stack Trace
\`\`\`
${crashData.trace}
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
     * Builds user prompt for feedback analysis
     */
    private buildFeedbackUserPrompt(context: PromptContext): string {
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

        let prompt = `## 📱 USER FEEDBACK ANALYSIS

### Basic Information
- **App Version**: ${appVersion} (Build ${buildNumber})
- **Device**: ${deviceInfo.model} running ${deviceInfo.osVersion}
- **Locale**: ${deviceInfo.locale}
- **Feedback Time**: ${submittedAt.toISOString()}
- **TestFlight ID**: ${id}

### User Feedback
**User's Message**:
> ${screenshotData.text || "No text provided"}

**Screenshots**: ${screenshotData.images.length} image(s) attached
${screenshotData.images.map((img, i) => `- Screenshot ${i + 1}: ${img.fileName}`).join("\n")}

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
 * Convenience function to get template for context
 */
export function getEnhancementTemplate(
    context: PromptContext,
): EnhancementTemplate {
    const manager = getPromptTemplateManager();
    return manager.getTemplate(context);
}
