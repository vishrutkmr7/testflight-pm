/**
 * App Store Connect API Authentication
 * Secure JWT token generation and management
 */

import { getConfig } from "../config/environment.js";

export interface JwtTokenPayload {
	iss: string; // Issuer ID
	iat: number; // Issued at timestamp
	exp: number; // Expiration timestamp
	aud: string; // Audience (always "appstoreconnect-v1")
	scope?: string[]; // Optional scopes
}

export interface AuthToken {
	token: string;
	expiresAt: Date;
	issuedAt: Date;
}

/**
 * JWT Token Manager for App Store Connect API
 * Handles secure token generation, caching, and refresh
 */
export class AppStoreConnectAuth {
	private currentToken: AuthToken | null = null;
	private readonly tokenLifetimeMinutes = 20; // Apple recommends 20 minutes max
	private readonly refreshThresholdMinutes = 2; // Refresh 2 minutes before expiry

	/**
	 * Gets a valid JWT token, refreshing if necessary
	 */
	public async getValidToken(): Promise<string> {
		try {
			if (this.isTokenValid()) {
				return this.currentToken?.token;
			}

			return await this.generateNewToken();
		} catch (error) {
			throw new Error(`Failed to get valid authentication token: ${error}`);
		}
	}

	/**
	 * Forces generation of a new token (useful for testing or error recovery)
	 */
	public async refreshToken(): Promise<string> {
		this.currentToken = null;
		return await this.generateNewToken();
	}

	/**
	 * Checks if the current token is valid and not close to expiry
	 */
	private isTokenValid(): boolean {
		if (!this.currentToken) {
			return false;
		}

		const now = new Date();
		const refreshThreshold = new Date(
			this.currentToken.expiresAt.getTime() -
				this.refreshThresholdMinutes * 60 * 1000,
		);

		return now < refreshThreshold;
	}

	/**
	 * Generates a new JWT token using the configured private key
	 */
	private async generateNewToken(): Promise<string> {
		try {
			const config = getConfig();
			const { issuerId, keyId, privateKey } = config.appStoreConnect;

			const now = Math.floor(Date.now() / 1000);
			const exp = now + this.tokenLifetimeMinutes * 60;

			const payload: JwtTokenPayload = {
				iss: issuerId,
				iat: now,
				exp: exp,
				aud: "appstoreconnect-v1",
			};

			const token = await this.signJwt(payload, privateKey, keyId);

			this.currentToken = {
				token,
				issuedAt: new Date(now * 1000),
				expiresAt: new Date(exp * 1000),
			};

			return token;
		} catch (error) {
			throw new Error(`Failed to generate JWT token: ${error}`);
		}
	}

	/**
	 * Signs a JWT payload using ES256 algorithm
	 */
	private async signJwt(
		payload: JwtTokenPayload,
		privateKey: string,
		keyId: string,
	): Promise<string> {
		try {
			// JWT Header
			const header = {
				alg: "ES256",
				kid: keyId,
				typ: "JWT",
			};

			// Encode header and payload
			const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
			const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
			const message = `${encodedHeader}.${encodedPayload}`;

			// Import the private key
			const key = await crypto.subtle.importKey(
				"pkcs8",
				this.pemToArrayBuffer(privateKey),
				{
					name: "ECDSA",
					namedCurve: "P-256",
				},
				false,
				["sign"],
			);

			// Sign the message
			const signature = await crypto.subtle.sign(
				{
					name: "ECDSA",
					hash: "SHA-256",
				},
				key,
				new TextEncoder().encode(message),
			);

			// Encode signature
			const encodedSignature = this.base64UrlEncode(new Uint8Array(signature));

			return `${message}.${encodedSignature}`;
		} catch (error) {
			throw new Error(`Failed to sign JWT: ${error}`);
		}
	}

	/**
	 * Converts PEM private key to ArrayBuffer
	 */
	private pemToArrayBuffer(pem: string): ArrayBuffer {
		try {
			const pemHeader = "-----BEGIN PRIVATE KEY-----";
			const pemFooter = "-----END PRIVATE KEY-----";

			const pemContents = pem
				.replace(pemHeader, "")
				.replace(pemFooter, "")
				.replace(/\s+/g, "");

			const binaryString = atob(pemContents);
			const bytes = new Uint8Array(binaryString.length);

			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}

			return bytes.buffer;
		} catch (error) {
			throw new Error(`Failed to parse private key: ${error}`);
		}
	}

	/**
	 * Base64 URL encoding (RFC 4648)
	 */
	private base64UrlEncode(data: string | Uint8Array): string {
		let base64: string;

		if (typeof data === "string") {
			base64 = btoa(unescape(encodeURIComponent(data)));
		} else {
			base64 = btoa(String.fromCharCode.apply(null, Array.from(data)));
		}

		return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
	}

	/**
	 * Clears the current token (useful for testing or logout)
	 */
	public clearToken(): void {
		this.currentToken = null;
	}

	/**
	 * Gets current token info (for debugging - never logs the actual token)
	 */
	public getTokenInfo(): {
		isValid: boolean;
		expiresAt?: Date;
		issuedAt?: Date;
	} {
		if (!this.currentToken) {
			return { isValid: false };
		}

		return {
			isValid: this.isTokenValid(),
			expiresAt: this.currentToken.expiresAt,
			issuedAt: this.currentToken.issuedAt,
		};
	}
}

/**
 * Global authentication instance
 * Singleton pattern for token management
 */
let _authInstance: AppStoreConnectAuth | null = null;

export function getAuthInstance(): AppStoreConnectAuth {
	if (!_authInstance) {
		_authInstance = new AppStoreConnectAuth();
	}
	return _authInstance;
}

/**
 * Clears the global auth instance (useful for testing)
 */
export function clearAuthInstance(): void {
	_authInstance = null;
}
