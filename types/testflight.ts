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
		availableInNewTerritories?: boolean;
		contentRightsDeclaration?: string;
	};
	relationships?: {
		ciProduct?: {
			data?: {
				type: "ciProducts";
				id: string;
			};
		};
		betaGroups?: {
			data: Array<{
				type: "betaGroups";
				id: string;
			}>;
		};
		preReleaseVersions?: {
			data: Array<{
				type: "preReleaseVersions";
				id: string;
			}>;
		};
		betaAppLocalizations?: {
			data: Array<{
				type: "betaAppLocalizations";
				id: string;
			}>;
		};
		builds?: {
			data: Array<{
				type: "builds";
				id: string;
			}>;
		};
		betaLicenseAgreement?: {
			data?: {
				type: "betaLicenseAgreements";
				id: string;
			};
		};
		betaAppReviewDetail?: {
			data?: {
				type: "betaAppReviewDetails";
				id: string;
			};
		};
		appInfos?: {
			data: Array<{
				type: "appInfos";
				id: string;
			}>;
		};
		appClips?: {
			data: Array<{
				type: "appClips";
				id: string;
			}>;
		};
		endUserLicenseAgreement?: {
			data?: {
				type: "endUserLicenseAgreements";
				id: string;
			};
		};
		appStoreVersions?: {
			data: Array<{
				type: "appStoreVersions";
				id: string;
			}>;
		};
		subscriptionGroups?: {
			data: Array<{
				type: "subscriptionGroups";
				id: string;
			}>;
		};
		gameCenterEnabledVersions?: {
			data: Array<{
				type: "gameCenterEnabledVersions";
				id: string;
			}>;
		};
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
		detailedLogs?: string[]; // Actual crash log content
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
		enhancedImages?: EnhancedScreenshotImage[]; // Enhanced screenshot data from detailed API
		testerNotes?: string; // Additional notes from detailed view
		submissionMethod?: "manual" | "automatic";
		systemInfo?: {
			applicationState?: "foreground" | "background" | "suspended";
			memoryPressure?: "normal" | "warning" | "critical";
			batteryLevel?: number;
			batteryState?: "unknown" | "unplugged" | "charging" | "full";
			thermalState?: "nominal" | "fair" | "serious" | "critical";
			diskSpaceRemaining?: number;
		};
	};

	testerInfo?: {
		email: string;
		firstName?: string;
		lastName?: string;
	};
}

// Detailed crash log content from /betaFeedbackCrashSubmissions/{id}/crashLog
export interface TestFlightCrashLog {
	id: string;
	type: "betaFeedbackCrashLogs";
	attributes: {
		downloadUrl: string;
		fileName: string;
		fileSize: number;
		expiresAt: string;
		crashLogFormatVersion: string;
	};
	relationships?: {
		betaFeedbackCrashSubmission?: {
			data: {
				type: "betaFeedbackCrashSubmissions";
				id: string;
			};
		};
	};
}

// Enhanced crash submission with full details
export interface DetailedTestFlightCrashReport extends TestFlightCrashReport {
	attributes: TestFlightCrashReport["attributes"] & {
		// Additional fields available in detailed view
		incidentIdentifier?: string;
		bundleShortVersionString?: string;
		bundleVersion?: string;
		codeCrashInfo?: string;
		exceptionCodes?: string;
		exceptionNote?: string;
		faultingThread?: number;
		lastExceptionBacktrace?: string;
		legacyInfo?: string;
		logCounter?: number;
		processUuid?: string;
		responsibleProcess?: string;
		storageInfo?: string;
		storeInfo?: string;
		systemInfo?: Record<string, unknown>;
		terminationReason?: string;
		vmInfo?: string;
		reportVersion?: number;
		timestamp?: string;
	};
}

// Enhanced screenshot submission with full details from /betaFeedbackScreenshotSubmissions/{id}
export interface DetailedTestFlightScreenshotFeedback extends TestFlightScreenshotFeedback {
	attributes: TestFlightScreenshotFeedback["attributes"] & {
		// Additional fields available in detailed view
		incidentIdentifier?: string;
		bundleShortVersionString?: string;
		bundleVersion?: string;
		screenshotFormatVersion?: string;
		screenshotCount?: number;
		submissionMethod?: "manual" | "automatic";
		testerNotes?: string;
		systemConfiguration?: Record<string, unknown>;
		networkConfiguration?: Record<string, unknown>;
		accessibilitySettings?: Record<string, unknown>;
		applicationState?: "foreground" | "background" | "suspended";
		memoryPressure?: "normal" | "warning" | "critical";
		batteryLevel?: number;
		batteryState?: "unknown" | "unplugged" | "charging" | "full";
		thermalState?: "nominal" | "fair" | "serious" | "critical";
		diskSpaceRemaining?: number;
		timestamp?: string;
		reportVersion?: number;
	};
}

// Apps listing response
export interface TestFlightAppsResponse extends TestFlightApiResponse<TestFlightApp> {
	// Inherits from TestFlightApiResponse
}

// App-specific crash submissions response  
export interface AppBetaFeedbackCrashSubmissionsResponse extends TestFlightApiResponse<TestFlightCrashReport> {
	// Inherits from TestFlightApiResponse
}

// App-specific screenshot submissions response
export interface AppBetaFeedbackScreenshotSubmissionsResponse extends TestFlightApiResponse<TestFlightScreenshotFeedback> {
	// Inherits from TestFlightApiResponse
}

// Single crash submission response
export interface DetailedCrashSubmissionResponse extends TestFlightSingleResponse<DetailedTestFlightCrashReport> {
	// Inherits from TestFlightSingleResponse
}

// Single screenshot submission response
export interface DetailedScreenshotSubmissionResponse extends TestFlightSingleResponse<DetailedTestFlightScreenshotFeedback> {
	// Inherits from TestFlightSingleResponse
}

// Crash log response
export interface CrashLogResponse extends TestFlightSingleResponse<TestFlightCrashLog> {
	// Inherits from TestFlightSingleResponse
}

// Crash log relationships response
export interface CrashLogRelationshipsResponse {
	data: {
		type: "betaFeedbackCrashLogs";
		id: string;
	};
	links?: {
		self?: string;
		related?: string;
	};
}

// Screenshot image metadata with enhanced properties
export interface EnhancedScreenshotImage extends ScreenshotImage {
	imageFormat?: "png" | "jpeg" | "heic";
	imageScale?: number;
	imageDimensions?: {
		width: number;
		height: number;
	};
	compressionQuality?: number;
	metadata?: Record<string, unknown>;
}
