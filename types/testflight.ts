/**
 * TestFlight API Data Types
 * Complete TypeScript interfaces for App Store Connect API responses
 */

export interface TestFlightCrashReport {
	id: string;
	type: "betaFeedbackCrashSubmissions";
	attributes: {
		submittedAt: string;
		crashLogs: {
			url: string;
			expiresAt: string;
		}[];
		deviceFamily: string;
		deviceModel: string;
		osVersion: string;
		appVersion: string;
		buildNumber: string;
		locale: string;
		bundleId: string;

		// Crash-specific data
		crashTrace: string;
		crashType: string;
		exceptionType?: string;
		exceptionMessage?: string;
		threadState?: Record<string, unknown>;
		binaryImages?: BinaryImage[];
	};
	relationships: {
		app?: {
			data: {
				type: "apps";
				id: string;
			};
		};
		build?: {
			data: {
				type: "builds";
				id: string;
			};
		};
		tester?: {
			data: {
				type: "betaTesters";
				id: string;
			};
		};
	};
}

export interface TestFlightScreenshotFeedback {
	id: string;
	type: "betaFeedbackScreenshotSubmissions";
	attributes: {
		submittedAt: string;
		screenshots: {
			url: string;
			expiresAt: string;
			fileName: string;
			fileSize: number;
		}[];
		deviceFamily: string;
		deviceModel: string;
		osVersion: string;
		appVersion: string;
		buildNumber: string;
		locale: string;
		bundleId: string;

		// Screenshot-specific data
		feedbackText?: string;
		annotations?: ScreenshotAnnotation[];
		systemInfo?: Record<string, unknown>;
	};
	relationships: {
		app?: {
			data: {
				type: "apps";
				id: string;
			};
		};
		build?: {
			data: {
				type: "builds";
				id: string;
			};
		};
		tester?: {
			data: {
				type: "betaTesters";
				id: string;
			};
		};
	};
}

export interface BinaryImage {
	name: string;
	uuid: string;
	baseAddress: string;
	size: number;
	architecture: string;
}

export interface ScreenshotAnnotation {
	x: number;
	y: number;
	width: number;
	height: number;
	text?: string;
	type: "highlight" | "arrow" | "text" | "rectangle";
}

export interface ScreenshotImage {
	url: string;
	fileName: string;
	fileSize: number;
	expiresAt: Date;
}

export interface TestFlightApp {
	id: string;
	type: "apps";
	attributes: {
		name: string;
		bundleId: string;
		sku: string;
		primaryLocale: string;
		isOrEverWasMadeForKids: boolean;
		subscriptionStatusUrl?: string;
		subscriptionStatusUrlVersion?: string;
		subscriptionStatusUrlForSandbox?: string;
		subscriptionStatusUrlVersionForSandbox?: string;
	};
}

export interface TestFlightBuild {
	id: string;
	type: "builds";
	attributes: {
		version: string;
		uploadedDate: string;
		expirationDate: string;
		expired: boolean;
		minOsVersion: string;
		lsMinimumSystemVersion?: string;
		computedMinMacOsVersion?: string;
		iconAssetToken?: {
			templateUrl: string;
			width: number;
			height: number;
		};
		processingState: "PROCESSING" | "FAILED" | "INVALID" | "VALID";
		buildAudienceType:
			| "INTERNAL_ONLY"
			| "APP_STORE_ELIGIBLE"
			| "NOT_APPLICABLE";
		usesNonExemptEncryption?: boolean;
	};
	relationships: {
		app: {
			data: {
				type: "apps";
				id: string;
			};
		};
	};
}

export interface TestFlightTester {
	id: string;
	type: "betaTesters";
	attributes: {
		firstName?: string;
		lastName?: string;
		email: string;
		inviteType: "EMAIL" | "PUBLIC_LINK";
		state: "INVITED" | "ACCEPTED" | "INSTALLED";
	};
}

// API Response Containers
export interface TestFlightApiResponse<T> {
	data: T[];
	links?: {
		self?: string;
		first?: string;
		next?: string;
		prev?: string;
	};
	meta?: {
		paging?: {
			total: number;
			limit: number;
		};
	};
	included?: Array<TestFlightApp | TestFlightBuild | TestFlightTester>;
}

export interface TestFlightSingleResponse<T> {
	data: T;
	included?: Array<TestFlightApp | TestFlightBuild | TestFlightTester>;
}

// Query Parameters
export interface TestFlightQueryParams {
	limit?: number;
	sort?: string;
	fields?: Record<string, string>;
	filter?: Record<string, string>;
	include?: string;
}

// Webhook Event Types
export interface TestFlightWebhookEvent {
	eventType:
		| "BETA_FEEDBACK_CRASH_SUBMISSION"
		| "BETA_FEEDBACK_SCREENSHOT_SUBMISSION";
	eventTime: string;
	version: string;
	data: {
		betaFeedbackCrashSubmission?: TestFlightCrashReport;
		betaFeedbackScreenshotSubmission?: TestFlightScreenshotFeedback;
	};
}

// Error Types
export interface TestFlightApiError {
	id?: string;
	status: string;
	code: string;
	title: string;
	detail: string;
	source?: {
		pointer?: string;
		parameter?: string;
	};
}

export interface TestFlightErrorResponse {
	errors: TestFlightApiError[];
}

// Utility Types
export type TestFlightFeedbackType = "crash" | "screenshot";

export interface ProcessedFeedbackData {
	id: string;
	type: TestFlightFeedbackType;
	submittedAt: Date;
	appVersion: string;
	buildNumber: string;
	deviceInfo: {
		family: string;
		model: string;
		osVersion: string;
		locale: string;
	};
	bundleId: string;

	// Type-specific data
	crashData?: {
		trace: string;
		type: string;
		exceptionType?: string;
		exceptionMessage?: string;
		logs: Array<{
			url: string;
			expiresAt: Date;
		}>;
	};

	screenshotData?: {
		text?: string;
		images: Array<{
			url: string;
			fileName: string;
			fileSize: number;
			expiresAt: Date;
		}>;
		annotations?: ScreenshotAnnotation[];
	};

	testerInfo?: {
		email: string;
		firstName?: string;
		lastName?: string;
	};
}
