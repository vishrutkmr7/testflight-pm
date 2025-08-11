# TestFlight PM - GitHub Action

Intelligent TestFlight feedback processing with AI-powered issue enhancement and automated issue creation for GitHub and Linear.

## ✨ Features

- 🤖 **AI-Enhanced Issues** - Intelligent issue titles, descriptions, and categorization using OpenAI, Anthropic, or Google Gemini
- 🌉 **Universal LLM Bridge** - Seamless translation between AI providers with automatic fallback and cost optimization
- 🔍 **Smart Code Analysis** - Automatically correlate feedback with relevant code areas in your repository
- 📱 **TestFlight Integration** - Process crash reports and user feedback from TestFlight automatically
- 🎯 **Multi-Platform** - Create issues in GitHub Issues or Linear
- 🔄 **Duplicate Prevention** - Smart duplicate detection to avoid creating redundant issues
- 💰 **Cost Controls** - Built-in LLM usage tracking and spending limits
- 🔒 **Secure** - All credentials stored securely in GitHub Secrets

## 🚀 Quick Setup

### 1. Add Required Secrets

Go to your repository **Settings → Secrets and variables → Actions** and add:

#### TestFlight (Required)
```
TESTFLIGHT_ISSUER_ID       # Your App Store Connect Issuer ID
TESTFLIGHT_KEY_ID          # Your App Store Connect Key ID
TESTFLIGHT_PRIVATE_KEY     # Your private key content (full .p8 file content)
TESTFLIGHT_APP_ID          # Your TestFlight App ID
```

#### Platform Secrets (Choose one or both)

**For GitHub Issues:**
```
GTHB_TOKEN                 # GitHub Personal Access Token with repo permissions
```

**For Linear:**
```
LINEAR_API_TOKEN           # Linear API Token
LINEAR_TEAM_ID             # Your Linear Team ID
```

#### AI Enhancement (Optional but Recommended)
```
OPENAI_API_KEY             # OpenAI API key for GPT-4o models (best performance)
ANTHROPIC_API_KEY          # Anthropic API key for Claude-3.5-Sonnet (excellent reasoning)
GOOGLE_API_KEY             # Google API key for Gemini-2.0-Flash (fast and cost-effective)
```

### 2. Create Workflow File

Create `.github/workflows/testflight-pm.yml`:

```yaml
name: TestFlight Issue Management

on:
  schedule:
    - cron: '0 */6 * * *'  # Run every 6 hours
  workflow_dispatch:        # Allow manual triggers

jobs:
  process-testflight-feedback:
    runs-on: ubuntu-latest
    steps:
      - name: Process TestFlight Feedback
        uses: vishrutkmr7/testflight-pm@v1
        with:
          # TestFlight Configuration
          testflight_issuer_id: ${{ secrets.TESTFLIGHT_ISSUER_ID }}
          testflight_key_id: ${{ secrets.TESTFLIGHT_KEY_ID }}
          testflight_private_key: ${{ secrets.TESTFLIGHT_PRIVATE_KEY }}
          app_id: ${{ secrets.TESTFLIGHT_APP_ID }}
          
          # Platform (choose 'github', 'linear', or 'both')
          platform: 'github'
          gthb_token: ${{ secrets.GTHB_TOKEN }}
          
          # AI Enhancement
          enable_llm_enhancement: 'true'
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          max_llm_cost_per_run: '2.00'
```

### 3. Run Your First Workflow

- Go to **Actions** tab in your repository
- Click on **TestFlight Issue Management**
- Click **Run workflow** → **Run workflow**

That's it! The action will process your TestFlight feedback and create enhanced issues.

## 📋 Configuration Options

### Core Configuration

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `testflight_issuer_id` | ✅ | - | App Store Connect API Issuer ID |
| `testflight_key_id` | ✅ | - | App Store Connect API Key ID |
| `testflight_private_key` | ✅ | - | App Store Connect private key (.p8 file content) |
| `app_id` | ✅ | - | TestFlight App ID |

### Platform Configuration

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `platform` | ❌ | `github` | Where to create issues: `github`, `linear`, or `both` |
| `gthb_token` | ❌ | - | GitHub token (required if platform includes `github`) |
| `github_owner` | ❌ | auto-detected | GitHub repository owner |
| `github_repo` | ❌ | auto-detected | GitHub repository name |
| `linear_api_token` | ❌ | - | Linear API token (required if platform includes `linear`) |
| `linear_team_id` | ❌ | - | Linear team ID (required if platform includes `linear`) |

### AI Enhancement with Universal LLM Bridge

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `enable_llm_enhancement` | ❌ | `false` | Enable AI-powered issue enhancement |
| `llm_provider` | ❌ | `openai` | Primary AI provider: `openai`, `anthropic`, `google` |
| `llm_fallback_providers` | ❌ | `anthropic,google` | Comma-separated fallback providers with automatic translation |
| `openai_model` | ❌ | `gpt-5-mini` | **[DEPRECATED]** Model selection is now automatic - latest models only |
| `anthropic_model` | ❌ | `claude-4-sonnet` | **[DEPRECATED]** Model selection is now automatic - latest models only |
| `google_model` | ❌ | `gemini-2.5-flash` | **[DEPRECATED]** Model selection is now automatic - latest models only |
| `max_llm_cost_per_run` | ❌ | `2.00` | Maximum AI cost per workflow run (USD) |
| `max_llm_cost_per_month` | ❌ | `50.00` | Maximum AI cost per month (USD) |

The action provides intelligent AI provider management with automatic cost optimization, fallback handling, and universal error handling across OpenAI, Anthropic, and Google APIs.

### Processing Options

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `enable_duplicate_detection` | ❌ | `true` | Prevent creating duplicate issues |
| `enable_codebase_analysis` | ❌ | `true` | Analyze code to find relevant areas |
| `enable_crash_processing` | ❌ | `true` | Process crash reports |
| `enable_feedback_processing` | ❌ | `true` | Process user feedback |
| `processing_window_hours` | ❌ | `24` | Hours to look back for new feedback |
| `min_feedback_length` | ❌ | `10` | Minimum feedback text length to process |

### Labeling

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `crash_labels` | ❌ | `bug,crash,testflight` | Labels for crash issues |
| `feedback_labels` | ❌ | `enhancement,feedback,testflight` | Labels for feedback issues |
| `additional_labels` | ❌ | - | Additional labels for all issues |

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
- **Confidence:** 0.95

## Suggested Investigation Areas
- Check null validation for username/password fields
- Review AuthenticationManager error handling
- Validate network connectivity handling

## Code Areas
- `LoginViewController.swift:42-67` (0.95 confidence)
- `AuthenticationManager.swift:120-145` (0.87 confidence)
```

## 📊 Workflow Outputs

The action provides detailed outputs you can use in subsequent steps:

```yaml
- name: Process TestFlight Feedback  
  id: testflight
  uses: vishrutkmr7/testflight-pm@v1
  with:
    # ... configuration

- name: Report Results
  run: |
    echo "Issues created: ${{ steps.testflight.outputs.issues_created }}"
    echo "AI cost: ${{ steps.testflight.outputs.llm_cost_incurred }}"
    echo "Processing time: ${{ fromJSON(steps.testflight.outputs.processing_summary).processingTime }}ms"
```

Available outputs:
- `issues_created` - Number of new issues created
- `issues_updated` - Number of existing issues updated  
- `crashes_processed` - Number of crash reports processed
- `feedback_processed` - Number of feedback items processed
- `llm_requests_made` - Number of AI API calls made
- `llm_cost_incurred` - Total AI cost in USD
- `processing_summary` - JSON object with detailed results

## 🧪 Testing

### Local Testing

Test the action locally before pushing to production:

#### 1. Interactive Local Testing
```bash
# Run the interactive test script
./test-action-local.sh

# Or using npm/bun scripts
bun run test:local
```

This script will:
- Create a `.env.test` template if it doesn't exist
- Validate your configuration
- Offer different testing modes (dry-run, live test, validation only)

#### 2. Quick Validation
```bash
# Quick configuration validation (30-second timeout)
bun run test:validate

# Manual dry run with your environment
INPUT_DRY_RUN=true INPUT_DEBUG=true bun run action-entrypoint.ts
```

#### 3. Testing with nektos/act (GitHub Actions locally)

Install [nektos/act](https://github.com/nektos/act):
```bash
# macOS
brew install act

# Windows
choco install act-cli
```

Then run local GitHub Actions testing:
```bash
./test-with-act.sh
```

### GitHub Actions Testing

#### Manual Testing Workflow

Use the included test workflow to validate the action in your repository:

1. **Navigate to Actions tab** in your GitHub repository
2. **Select "Test TestFlight PM Action"** workflow
3. **Click "Run workflow"** button
4. **Configure test parameters:**
   - **Dry Run**: `true` (recommended for testing)
   - **Debug**: `true` (for verbose output)
   - **Platform**: Choose `github`, `linear`, or `both`
5. **Click "Run workflow"** to start the test

#### Required Secrets for Testing

Set up these secrets in your repository:

**Core TestFlight Configuration:**
- `TESTFLIGHT_ISSUER_ID`
- `TESTFLIGHT_KEY_ID` 
- `TESTFLIGHT_PRIVATE_KEY`
- `APP_ID`

**Platform Secrets:**
- `GTHB_TOKEN` (for GitHub issues)
- `LINEAR_API_TOKEN` (for Linear issues)
- `LINEAR_TEAM_ID` (for Linear issues)

**Optional LLM Secrets:**
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- etc.

#### Test Results

After running tests, check:
- ✅ **Action Summary**: View results in the workflow summary
- 📝 **Logs**: Check detailed logs for any errors
- 🎯 **Created Issues**: If `dry_run=false`, verify issues were created
- 📊 **Outputs**: Review action outputs (counts, costs, etc.)

### Troubleshooting Tests

#### Common Issues

**Authentication Errors:**
```bash
# Verify your tokens have correct permissions
# GitHub: repo permissions required
# Linear: full access to team required
```

**Configuration Errors:**
```bash
# Check your .env.test file format
# Ensure no spaces around = signs
# Verify base64 encoding for private keys
```

**Network/API Errors:**
```bash
# Test with shorter processing windows
INPUT_PROCESSING_WINDOW_HOURS=1

# Enable debug mode for detailed logs
INPUT_DEBUG=true
```

#### Debug Mode

Enable comprehensive debugging:
```bash
INPUT_DEBUG=true INPUT_DRY_RUN=true bun run action-entrypoint.ts
```

This provides:
- 🔍 Detailed API request/response logs
- 📊 Performance metrics
- 🏥 Health check results
- 💰 LLM usage and cost tracking

## 🔧 Advanced Examples

### Multi-Platform with Custom Labels

```yaml
- uses: vishrutkmr7/testflight-pm@v1
  with:
    testflight_issuer_id: ${{ secrets.TESTFLIGHT_ISSUER_ID }}
    testflight_key_id: ${{ secrets.TESTFLIGHT_KEY_ID }}
    testflight_private_key: ${{ secrets.TESTFLIGHT_PRIVATE_KEY }}
    app_id: ${{ secrets.TESTFLIGHT_APP_ID }}
    
    # Create issues in both GitHub and Linear
    platform: 'both'
    gthb_token: ${{ secrets.GTHB_TOKEN }}
    linear_api_token: ${{ secrets.LINEAR_API_TOKEN }}
    linear_team_id: ${{ secrets.LINEAR_TEAM_ID }}
    
    # Custom labeling
    crash_labels: 'critical,crash,ios,needs-triage'
    feedback_labels: 'enhancement,user-request,ios'
    additional_labels: 'mobile,testflight'
```

### AI-Enhanced with Multiple Providers

```yaml
- uses: vishrutkmr7/testflight-pm@v1
  with:
    testflight_issuer_id: ${{ secrets.TESTFLIGHT_ISSUER_ID }}
    testflight_key_id: ${{ secrets.TESTFLIGHT_KEY_ID }}
    testflight_private_key: ${{ secrets.TESTFLIGHT_PRIVATE_KEY }}
    app_id: ${{ secrets.TESTFLIGHT_APP_ID }}
    
    platform: 'github'
    gthb_token: ${{ secrets.GTHB_TOKEN }}
    
    # AI configuration with automatic provider fallback
    enable_llm_enhancement: 'true'
    llm_provider: 'openai'
    llm_fallback_providers: 'anthropic,google'
    
    # Latest AI models (January 2025)
    openai_model: 'gpt-5-mini'
    anthropic_model: 'claude-4-sonnet'
    google_model: 'gemini-2.5-flash'
    
    # API keys for multiple providers
    openai_api_key: ${{ secrets.OPENAI_API_KEY }}
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    google_api_key: ${{ secrets.GOOGLE_API_KEY }}
    
    # Cost controls with intelligent provider switching
    max_llm_cost_per_run: '5.00'
    max_llm_cost_per_month: '100.00'
```

**AI Provider Benefits:**
- 🔄 **Automatic Fallback**: Seamlessly switch between providers when one fails
- 💰 **Cost Optimization**: Smart provider selection based on cost and performance
- 🌐 **Latest Models**: Uses cutting-edge models from OpenAI, Anthropic, and Google
- 🛡️ **Error Handling**: Unified error handling with provider-specific translation

### High-Frequency Processing

```yaml
name: TestFlight Real-time Processing

on:
  schedule:
    - cron: '0 * * * *'  # Every hour
  workflow_dispatch:

jobs:
  testflight-pm:
    runs-on: ubuntu-latest
    steps:
      - uses: vishrutkmr7/testflight-pm@v1
        with:
          testflight_issuer_id: ${{ secrets.TESTFLIGHT_ISSUER_ID }}
          testflight_key_id: ${{ secrets.TESTFLIGHT_KEY_ID }}
          testflight_private_key: ${{ secrets.TESTFLIGHT_PRIVATE_KEY }}
          app_id: ${{ secrets.TESTFLIGHT_APP_ID }}
          
          platform: 'github'
          gthb_token: ${{ secrets.GTHB_TOKEN }}
          
          # Process only last 2 hours to avoid duplicates
          processing_window_hours: '2'
          
          # Enable all enhancements for critical issues
          enable_llm_enhancement: 'true'
          enable_codebase_analysis: 'true'
          enable_duplicate_detection: 'true'
          
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
```

## 🔒 Security Best Practices

1. **Never commit API keys** - Always use GitHub Secrets
2. **Use least privilege tokens** - GitHub tokens should only have necessary permissions
3. **Monitor costs** - Set reasonable LLM cost limits
4. **Review generated content** - AI-generated issues may need human review for sensitive projects

## ❓ Troubleshooting

### Common Issues

**"TestFlight credentials invalid"**
- Verify your App Store Connect API credentials
- Ensure the private key is the complete .p8 file content
- Check that the Issuer ID and Key ID match your App Store Connect API key

**"No issues created"**
- Check if there's new TestFlight feedback in the processing window
- Verify the app_id matches your TestFlight app
- Enable debug mode: `debug: 'true'`

**"AI enhancement failed"**
- Verify your AI provider API key is valid
- Check cost limits aren't exceeded
- Try enabling fallback providers

**"Permission denied"**
- Ensure GitHub token has `repo` permissions
- For Linear, verify the API token has write access to your team

### Getting Help

- 🐛 [Report Issues](https://github.com/vishrutkmr7/testflight-pm/issues)
- 💬 [Discussions](https://github.com/vishrutkmr7/testflight-pm/discussions)
- 📖 [Full Documentation](https://github.com/vishrutkmr7/testflight-pm/wiki)

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
