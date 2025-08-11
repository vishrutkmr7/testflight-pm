# TestFlight PM - GitHub Action

Intelligent TestFlight feedback processing with AI-powered issue enhancement and automated issue creation for GitHub and Linear.

## ✨ Features

- 🤖 **AI-Enhanced Issues** - Intelligent issue titles, descriptions, and categorization using OpenAI, Anthropic, or Google Gemini
- 📱 **TestFlight Integration** - Process crash reports and user feedback from TestFlight automatically
- 🎯 **Multi-Platform** - Create issues in GitHub Issues or Linear
- 🔄 **Duplicate Prevention** - Smart duplicate detection to avoid creating redundant issues
- 💰 **Cost Controls** - Built-in LLM usage tracking and spending limits

## 📋 What TestFlight Data We Collect

This action uses the **App Store Connect API 4.0** (announced during WWDC25 Platforms State of the Union) to access beta tester feedback for your apps. Specifically, we retrieve:

### 🔥 **Beta Feedback Crash Submissions**
- **Crash logs** with full stack traces and exception details
- **Device information** (model, OS version, app version)
- **System state** during crash (memory, battery, thermal state)
- **Detailed crash metadata** including incident identifiers and symbols

### 📸 **Beta Feedback Screenshot Submissions**  
- **Screenshots** submitted by testers with annotations
- **Tester comments** and feedback text
- **System information** (app state, memory pressure, battery level)
- **Enhanced image metadata** (format, dimensions, compression)
- **Submission context** (manual vs automatic capture)

### 🔗 **API Endpoints Used**
- `GET /v1/apps` - List and resolve apps by Bundle ID
- `GET /v1/apps/{id}/betaFeedbackCrashSubmissions` - Get crash reports  
- `GET /v1/betaFeedbackCrashSubmissions/{id}` - Get detailed crash data
- `GET /v1/betaFeedbackCrashSubmissions/{id}/crashLog` - Download crash logs
- `GET /v1/apps/{id}/betaFeedbackScreenshotSubmissions` - Get screenshot feedback
- `GET /v1/betaFeedbackScreenshotSubmissions/{id}` - Get detailed screenshot data

> **📚 Learn More:** See [App Store Connect API 4.0 Release Notes](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-4-0-release-notes) for complete documentation on Beta Feedback Crashes and Beta Feedback Screenshots.

## 🚀 Quick Setup

### 1. Set Up App Store Connect API Access

#### Create API Key in App Store Connect

1. **Sign in to App Store Connect** at [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. **Navigate to API Keys:**
   - Click **Users and Access** in the top navigation
   - Click **Integrations** tab
   - Click **App Store Connect API** section
   - Click the **"+"** button to create a new key

3. **Configure API Key:**
   - **Name:** Give it a descriptive name (e.g., "TestFlight PM GitHub Action")
   - **Access:** Select **Developer** role (minimum required for TestFlight feedback access)
   - Click **Generate**

4. **Download and Save:**
   - **Download the .p8 file** immediately (you can only download it once!)
   - **Copy the Key ID** (shown after creation)
   - **Copy the Issuer ID** (shown at the top of the API Keys page)

#### Find Your App ID

1. **In App Store Connect**, go to **My Apps**
2. **Click on your app**
3. **Go to App Information** (in the sidebar)
4. **Your App ID** is shown in the **General Information** section (a numeric ID like `1234567890`)

Alternatively, you can use your **Bundle ID** (like `com.yourcompany.yourapp`) - this action supports both!

#### Add Secrets to GitHub

Go to your repository **Settings → Secrets and variables → Actions** and add:

#### TestFlight API Access (Required)
```
TESTFLIGHT_ISSUER_ID       # Issuer ID from App Store Connect API Keys page
TESTFLIGHT_KEY_ID          # Key ID from your generated API key  
TESTFLIGHT_PRIVATE_KEY     # Full content of the downloaded .p8 file
TESTFLIGHT_APP_ID          # Your numeric App ID (optional if using Bundle ID)
TESTFLIGHT_BUNDLE_ID       # Your app's Bundle ID (optional if using App ID)
```

> **💡 Pro Tip:** You need either `TESTFLIGHT_APP_ID` OR `TESTFLIGHT_BUNDLE_ID` - the action will automatically resolve the App ID from your Bundle ID if needed.

#### Platform Secrets
**For GitHub Issues:**
```
GTHB_TOKEN                 # GitHub Personal Access Token with repo permissions
```

**For Linear:**
```
LINEAR_API_TOKEN           # Linear API Token
LINEAR_TEAM_ID             # Your Linear Team ID
```

#### AI Enhancement (Optional)
```
OPENAI_API_KEY             # OpenAI API key
ANTHROPIC_API_KEY          # Anthropic API key  
GOOGLE_API_KEY             # Google API key
```

### 2. Create Workflow File

Create `.github/workflows/testflight-pm.yml`:

```yaml
name: TestFlight Feedback Processing

on:
  schedule:
    - cron: '0 * * * *'  # Every hour
  workflow_dispatch:

jobs:
  testflight-pm:
    runs-on: ubuntu-latest
    steps:
      - uses: vishrutkmr7/testflight-pm@latest
        with:
          # Required TestFlight Configuration
          testflight_issuer_id: ${{ secrets.TESTFLIGHT_ISSUER_ID }}
          testflight_key_id: ${{ secrets.TESTFLIGHT_KEY_ID }}
          testflight_private_key: ${{ secrets.TESTFLIGHT_PRIVATE_KEY }}
          # Use EITHER app_id OR testflight_bundle_id (action will resolve automatically)
          app_id: ${{ secrets.TESTFLIGHT_APP_ID }}                    # Option 1: Numeric App ID
          # testflight_bundle_id: ${{ secrets.TESTFLIGHT_BUNDLE_ID }} # Option 2: Bundle ID (com.company.app)
          
          # Platform Configuration
          platform: 'github'
          gthb_token: ${{ secrets.GTHB_TOKEN }}
          
          # Enhancement Features
          enable_llm_enhancement: 'true'
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### 3. Run Your First Workflow

- Go to **Actions** tab in your repository
- Click on **TestFlight Feedback Processing**
- Click **Run workflow** → **Run workflow**

That's it! The action will process your TestFlight feedback and create enhanced issues.

## 🔐 Authentication & Security

### JWT Token Management
- **Algorithm:** ES256 (ECDSA with SHA-256)
- **Token Lifetime:** 20 minutes (Apple's maximum recommendation)
- **Auto-Refresh:** Tokens refresh 2 minutes before expiry
- **Secure Storage:** Private keys never logged or exposed

### Rate Limiting
- **Apple's Limits:** Monitored via `X-RateLimit-*` headers
- **Automatic Throttling:** Waits when rate limits are reached
- **Retry Logic:** Exponential backoff for failed requests
- **Best Practices:** Efficient batching and caching to minimize API calls

### API Permissions
The **Developer** role in App Store Connect provides the minimum required permissions for:
- ✅ Reading TestFlight crash submissions
- ✅ Reading TestFlight screenshot feedback  
- ✅ Accessing app metadata and builds
- ✅ Downloading crash logs and screenshots

> **🔒 Security Note:** Your private key (`.p8` file) should be stored as a GitHub repository secret and never committed to version control.

## 🤖 AI Enhancement Examples

### Without AI Enhancement
```
Title: App Crash
Body: User reported app crashed when tapping login button
Labels: bug, crash, testflight
```

### With AI Enhancement
```
Title: 💥 Authentication Crash - NSInvalidArgumentException in LoginViewController
Body: 
## Issue Summary
Critical authentication flow crash when user attempts login, likely due to null parameter validation failure.

## Technical Analysis
- **Exception Type:** NSInvalidArgumentException  
- **Component:** LoginViewController.signInButtonTapped
- **Severity:** High - Prevents app access

## Suggested Investigation Areas
- Check null validation for username/password fields
- Review AuthenticationManager error handling
- Validate network connectivity handling

## Code Areas
- `LoginViewController.swift:42-67` (0.95 confidence)
- `AuthenticationManager.swift:120-145` (0.87 confidence)
```

## 📋 Configuration Options

### Core Required Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `testflight_issuer_id` | ✅ | App Store Connect API Issuer ID |
| `testflight_key_id` | ✅ | App Store Connect API Key ID |
| `testflight_private_key` | ✅ | App Store Connect private key (.p8 file content) |
| `app_id` | ⚠️ | TestFlight App ID (required if `testflight_bundle_id` not provided) |
| `testflight_bundle_id` | ⚠️ | App Bundle ID like `com.company.app` (required if `app_id` not provided) |

> **💡 App Identification:** You must provide **either** `app_id` OR `testflight_bundle_id`. The action will automatically resolve the App ID from your Bundle ID if needed.

### Platform Options

| Input | Default | Description |
|-------|---------|-------------|
| `platform` | `github` | Where to create issues: `github`, `linear`, or `both` |
| `gthb_token` | - | GitHub token (required for GitHub) |
| `linear_api_token` | - | Linear API token (required for Linear) |
| `linear_team_id` | - | Linear team ID (required for Linear) |

### AI Enhancement Options

| Input | Default | Description |
|-------|---------|-------------|
| `enable_llm_enhancement` | `false` | Enable AI-powered issue enhancement |
| `llm_provider` | `openai` | Primary AI provider: `openai`, `anthropic`, `google` |
| `openai_api_key` | - | OpenAI API key |
| `anthropic_api_key` | - | Anthropic API key |
| `google_api_key` | - | Google API key |
| `max_llm_cost_per_run` | `2.00` | Maximum AI cost per workflow run (USD) |

## 🔧 Examples

### Multi-Platform Setup

```yaml
- uses: vishrutkmr7/testflight-pm@latest
  with:
    # Required TestFlight Configuration
    testflight_issuer_id: ${{ secrets.TESTFLIGHT_ISSUER_ID }}
    testflight_key_id: ${{ secrets.TESTFLIGHT_KEY_ID }}
    testflight_private_key: ${{ secrets.TESTFLIGHT_PRIVATE_KEY }}
    # Example using Bundle ID instead of App ID
    testflight_bundle_id: ${{ secrets.TESTFLIGHT_BUNDLE_ID }}  # e.g., com.mycompany.myapp
    
    # Platform Configuration (both GitHub and Linear)
    platform: 'both'
    gthb_token: ${{ secrets.GTHB_TOKEN }}
    linear_api_token: ${{ secrets.LINEAR_API_TOKEN }}
    linear_team_id: ${{ secrets.LINEAR_TEAM_ID }}
    
    # Enhancement Features
    enable_llm_enhancement: 'true'
    enable_codebase_analysis: 'true'
    enable_duplicate_detection: 'true'
    
    # LLM Provider Configuration
    llm_provider: 'anthropic'
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### High-Frequency Processing

```yaml
name: TestFlight Feedback Processing

on:
  schedule:
    - cron: '0 * * * *'  # Every hour
  workflow_dispatch:

jobs:
  testflight-pm:
    runs-on: ubuntu-latest
    steps:
      - uses: vishrutkmr7/testflight-pm@latest
        with:
          # Required TestFlight Configuration
          testflight_issuer_id: ${{ secrets.TESTFLIGHT_ISSUER_ID }}
          testflight_key_id: ${{ secrets.TESTFLIGHT_KEY_ID }}
          testflight_private_key: ${{ secrets.TESTFLIGHT_PRIVATE_KEY }}
          app_id: ${{ secrets.TESTFLIGHT_APP_ID }}
          
          # Platform Configuration
          platform: 'github'
          gthb_token: ${{ secrets.GTHB_TOKEN }}
          
          # Processing Configuration (process only last 2 hours to avoid duplicates)
          processing_window_hours: '2'
          
          # Enhancement Features
          enable_llm_enhancement: 'true'
          llm_provider: 'anthropic'
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## 🧪 Testing

Test the action locally before deploying:

```bash
# Clone and test locally
git clone https://github.com/vishrutkmr7/testflight-pm
cd testflight-pm
./test-action-local.sh
```

Or test in GitHub Actions with dry run mode:

```yaml
- uses: vishrutkmr7/testflight-pm@latest
  with:
    testflight_issuer_id: ${{ secrets.TESTFLIGHT_ISSUER_ID }}
    testflight_key_id: ${{ secrets.TESTFLIGHT_KEY_ID }}
    testflight_private_key: ${{ secrets.TESTFLIGHT_PRIVATE_KEY }}
    app_id: ${{ secrets.TESTFLIGHT_APP_ID }}
    platform: 'github'
    gthb_token: ${{ secrets.GTHB_TOKEN }}
    enable_llm_enhancement: 'true'
    llm_provider: 'anthropic'
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    dry_run: 'true'  # Won't create actual issues
    debug: 'true'    # Verbose logging
```

## ❓ Troubleshooting

**"TestFlight credentials invalid"**
- **Check Issuer ID:** Copy from App Store Connect → Users and Access → Integrations → App Store Connect API
- **Verify Key ID:** Copy the exact Key ID shown after creating your API key
- **Private Key Format:** Ensure the `.p8` file content includes the full header and footer:
  ```
  -----BEGIN PRIVATE KEY-----
  [your key content]
  -----END PRIVATE KEY-----
  ```
- **API Key Role:** Ensure your API key has **Developer** role (minimum required)
- **Test Locally:** Try making a direct API call to verify credentials work

**"App not found" or "Invalid Bundle ID"**
- **App ID:** Verify the numeric App ID from App Store Connect → My Apps → [Your App] → App Information
- **Bundle ID:** Ensure the Bundle ID exactly matches what's shown in App Store Connect (e.g., `com.company.app`)
- **API Access:** Confirm your API key can access the specific app (some keys are scoped to specific apps)

**"No issues created"**
- Check if there's new TestFlight feedback in the processing window
- Enable debug mode: `debug: 'true'`

**"AI enhancement failed"**
- Verify your AI provider API key is valid
- Check cost limits aren't exceeded

**"Permission denied"**
- Ensure GitHub token has `repo` permissions
- For Linear, verify the API token has write access to your team

### Getting Help

- 🐛 [Report Issues](https://github.com/vishrutkmr7/testflight-pm/issues)
- 💬 [Discussions](https://github.com/vishrutkmr7/testflight-pm/discussions)
