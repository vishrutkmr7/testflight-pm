# TestFlight PM

**TestFlight PM** is an intelligent automation tool that securely bridges the gap between TestFlight feedback and development workflow. It automatically processes TestFlight data (crashes, bugs, screenshots, user feedback) and creates actionable development tasks in GitHub Issues or Linear, complete with repository context and code analysis.

## 🚀 Quick Start

### 1. Setup Environment

Install Bun runtime:
```bash
curl -fsSL https://bun.sh/install | bash
```

Clone and setup the project:
```bash
git clone <your-repo-url>
cd testflight-pm
bun install
```

### 2. Configure GitHub Secrets

#### App Store Connect API Setup

1. Go to [App Store Connect](https://appstoreconnect.apple.com/)
2. Navigate to **Users and Access** > **Integrations** > **App Store Connect API**
3. Click **Generate API Key**
4. Configure the key:
   - **Name**: `TestFlight PM API Key`
   - **Access**: Select appropriate permissions (minimum: App Manager)
   - **Apps**: Select your TestFlight apps
5. **Download the `.p8` file immediately** (you can only download it once)
6. Note down your **Issuer ID** and **Key ID**

#### Required GitHub Repository Secrets

Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

```
APP_STORE_CONNECT_ISSUER_ID
Value: Your issuer ID from App Store Connect
```

```
APP_STORE_CONNECT_KEY_ID  
Value: Your API key ID (e.g., 2X9R4HXF34)
```

```
APP_STORE_CONNECT_PRIVATE_KEY
Value: Complete content of your .p8 file, including headers:
-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg...
...your private key content...
-----END PRIVATE KEY-----
```

#### Optional Configuration Secrets

```
TESTFLIGHT_APP_ID=your-app-id
TESTFLIGHT_BUNDLE_ID=com.yourcompany.yourapp
GITHUB_TOKEN=your-github-personal-access-token
GITHUB_OWNER=your-github-username
GITHUB_REPO=your-repository-name
LINEAR_API_TOKEN=your-linear-api-token
LINEAR_TEAM_ID=your-linear-team-id
WEBHOOK_SECRET=random-secure-webhook-string
```

### 3. Test Your Setup

```bash
# Test authentication
bun run test:auth

# Fetch sample data
bun run test:fetch

# Run full integration test
bun run test:integration
```

## 🔐 Security Features

- **Zero Hardcoded Secrets**: All credentials stored in GitHub repository secrets
- **Secure JWT Authentication**: Industry-standard ES256 token generation
- **Error Safety**: Never exposes secrets in logs or error messages
- **Comprehensive Validation**: Strict format checking for all credentials
- **Production Ready**: Rate limiting, retry logic, and proper error handling

## 🛠️ Core Features

### TestFlight Data Fetching
- **Crash Reports**: Automatic collection with stack traces and device info
- **Screenshot Feedback**: User feedback with annotations and comments
- **Real-time Processing**: Webhook support for instant notifications
- **Historical Data**: Query feedback from specific time periods

### API Client Features
- **Rate Limiting**: Intelligent rate limit handling with automatic backoff
- **Error Recovery**: Exponential backoff and retry mechanisms
- **Type Safety**: Complete TypeScript interfaces for all data types
- **Security First**: JWT token management with automatic refresh

## 📋 Available Commands

```bash
# Testing Commands
bun test                    # Run full test suite
bun run test:auth          # Test App Store Connect authentication
bun run test:fetch         # Fetch sample TestFlight data
bun run test:integration   # Full integration test

# TestFlight CLI
bun run test:testflight test-auth                    # Test authentication
bun run test:testflight fetch-crashes --limit 10    # Get recent crashes
bun run test:testflight fetch-screenshots --days 7  # Get recent feedback
bun run test:testflight fetch-all --verbose         # Get all feedback types
```

## 🏗️ Architecture

### Core Components

```
src/
├── config/
│   └── environment.ts      # Secure configuration management
├── api/
│   ├── app-store-connect-auth.ts  # JWT authentication
│   └── testflight-client.ts       # Main API client
├── cli/
│   └── test-testflight.ts         # Testing CLI
└── utils/                          # Shared utilities

types/
└── testflight.ts           # TypeScript interfaces

tests/
└── testflight-utils.test.ts # Comprehensive test suite
```

### Security Architecture

- **Environment Configuration**: Validates and loads secrets from repository secrets
- **JWT Authentication**: Secure token generation with ES256 algorithm
- **API Client**: Rate-limited requests with automatic retry and error handling
- **Type Safety**: Complete TypeScript coverage for all data structures

## 🔧 Local Development Setup

### Environment File
Create a `.env` file in your project root (never commit this file):

```bash
APP_STORE_CONNECT_ISSUER_ID=your-issuer-id
APP_STORE_CONNECT_KEY_ID=your-key-id
APP_STORE_CONNECT_PRIVATE_KEY_PATH=./secrets/AuthKey_XXXXXXXXXX.p8

# Optional local overrides
TESTFLIGHT_APP_ID=your-app-id
TESTFLIGHT_BUNDLE_ID=com.yourcompany.yourapp
NODE_ENV=development
LOG_LEVEL=debug
```

### Private Key File (Alternative)
If you prefer using a file instead of environment variable:

1. Create a `secrets/` directory in your project root
2. Place your `.p8` file there
3. Add `secrets/` to your `.gitignore`
4. Set `APP_STORE_CONNECT_PRIVATE_KEY_PATH` in your `.env`

## 🔐 Security Best Practices

### GitHub Secrets Management
- ✅ Use repository secrets for all sensitive data
- ✅ Rotate API keys regularly
- ✅ Use least-privilege access for API keys
- ❌ Never commit credentials to your repository
- ❌ Never log or expose secret values

### Production Deployment
- Use organization secrets for shared credentials
- Set up separate secrets for staging/production environments
- Monitor API usage and rate limits
- Enable audit logging for secret access

## 🔧 Troubleshooting

### Common Issues

**Authentication Fails**
- Verify Issuer ID and Key ID are correct
- Check private key format (must include headers and footers)
- Ensure API key has sufficient permissions
- Try regenerating the API key if issues persist

**Rate Limiting**
- App Store Connect has strict rate limits
- The client implements automatic retry with backoff
- Monitor rate limit headers in responses

**Private Key Format**
```
✅ Correct format:
-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg...
-----END PRIVATE KEY-----

❌ Incorrect format:
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg...
```

### Environment Validation
The application will validate your configuration on startup and provide clear error messages for missing or invalid settings.

## 🧪 Testing

The project includes comprehensive security-focused tests:

```bash
bun test  # Runs all tests including:
          # - Environment configuration validation
          # - Authentication security testing
          # - API client functionality
          # - Security violation detection
          # - Integration testing
```

**Test Coverage:**
- ✅ Secret management and validation
- ✅ JWT authentication flow
- ✅ API client with rate limiting
- ✅ Security error handling
- ✅ TypeScript type safety

## 🔧 Development

### Project Standards

- **Runtime**: Bun (TypeScript)
- **Security**: Repository secrets for all credentials
- **Testing**: Comprehensive security validation
- **Code Quality**: DRY and SOLID principles
- **Documentation**: Complete setup and usage guides

### Contributing

1. Follow the security guidelines in `docs/SETUP.md`
2. Ensure all tests pass: `bun test`
3. Never commit credentials or secrets
4. Update documentation for new features

## 📄 License

MIT License - see LICENSE file for details.

---

## 🆘 Support

If you encounter issues:
1. Check the [troubleshooting guide](docs/SETUP.md#troubleshooting)
2. Verify all required secrets are properly configured
3. Review application logs for specific error messages
4. Ensure your App Store Connect API key has correct permissions

**Security Notice**: Keep your API credentials secure and never share them publicly. If you suspect your credentials have been compromised, immediately revoke the API key in App Store Connect and generate a new one.
