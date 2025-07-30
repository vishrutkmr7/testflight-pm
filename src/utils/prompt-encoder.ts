/**
 * Prompt Encoder Utility
 * Used to generate base64 encoded prompts for secure storage
 * This file is for development/maintenance only
 */

/**
 * Original prompt templates (for encoding)
 */
const ORIGINAL_PROMPTS = {
	CRASH_ANALYSIS_SYSTEM: `You are an expert software engineer analyzing iOS/mobile app crash reports from TestFlight. Your task is to create high-quality, actionable bug reports with technical analysis and relevant code area identification. Focus on: Technical root cause analysis, Stack trace interpretation, Impact assessment and severity classification, Code area identification and correlation, Reproducibility analysis, Recommended fix approaches`,
	
	FEEDBACK_ANALYSIS_SYSTEM: `You are an expert product manager and UX designer analyzing user feedback from TestFlight. Your task is to create actionable feature requests and improvement tasks with user experience insights. Focus on: User experience analysis, Feature gap identification, UI/UX improvement recommendations, Priority assessment based on user impact, Implementation complexity estimation, User journey optimization`,
	
	ENHANCEMENT_SYSTEM: `You are an expert software engineer and technical issue analyst. Your role is to enhance bug reports and feature requests with detailed technical analysis. You have access to codebase context and recent changes. Provide actionable insights and technical recommendations`,
	
	CRASH_ANALYSIS_REQUEST: `Please analyze this crash report and provide a comprehensive technical assessment. Focus on: Root Cause Identification: What likely caused this crash? Code Area Analysis: Which files/methods are most likely involved? Fix Strategy: What specific steps should developers take? Priority Assessment: How critical is this crash for users?`,
	
	FEEDBACK_ANALYSIS_REQUEST: `Please analyze this user feedback and create an actionable task for the development team. Focus on: User Intent: What is the user trying to achieve? Pain Points: What specific problems are they experiencing? UI/UX Impact: Which screens or components need attention? Implementation Strategy: How should this be addressed? Business Value: What's the potential impact of fixing this?`
};

/**
 * Encodes a prompt to base64
 */
export function encodePrompt(prompt: string): string {
	return Buffer.from(prompt, 'utf8').toString('base64');
}

/**
 * Decodes a base64 prompt
 */
export function decodePrompt(encoded: string): string {
	return Buffer.from(encoded, 'base64').toString('utf8');
}

/**
 * Generates the encoded prompts object for secure-prompts.ts
 */
export function generateEncodedPrompts(): Record<string, string> {
	const encoded: Record<string, string> = {};
	
	for (const [key, prompt] of Object.entries(ORIGINAL_PROMPTS)) {
		encoded[key] = encodePrompt(prompt);
	}
	
	return encoded;
}

/**
 * Validates that encoded prompts decode correctly
 */
export function validateEncodedPrompts(encodedPrompts: Record<string, string>): boolean {
	for (const [key, encoded] of Object.entries(encodedPrompts)) {
		try {
			const decoded = decodePrompt(encoded);
			const original = ORIGINAL_PROMPTS[key as keyof typeof ORIGINAL_PROMPTS];
			
			if (decoded !== original) {
				console.error(`Validation failed for ${key}: decoded content doesn't match original`);
				return false;
			}
		} catch (error) {
			console.error(`Validation failed for ${key}: ${error}`);
			return false;
		}
	}
	
	return true;
}

/**
 * Tests the encoding/decoding process
 */
export function testPromptEncoding(): void {
	console.log('Testing prompt encoding/decoding...');
	
	const encoded = generateEncodedPrompts();
	const isValid = validateEncodedPrompts(encoded);
	
	if (isValid) {
		console.log('✅ All prompts encoded and validated successfully');
		console.log('\nEncoded prompts (copy to secure-prompts.ts):');
		console.log(JSON.stringify(encoded, null, 2));
	} else {
		console.error('❌ Validation failed');
	}
}

// Export for testing
export { ORIGINAL_PROMPTS };