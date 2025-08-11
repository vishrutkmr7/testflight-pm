# TestFlight PM - GitHub Action

Intelligent TestFlight feedback processing with AI-powered issue enhancement and automated issue creation for GitHub and Linear.

## ✨ Features

- 🤖 **AI-Enhanced Issues** - Intelligent issue titles, descriptions, and categorization using OpenAI, Anthropic, or Google Gemini
- 📱 **TestFlight Integration** - Process crash reports and user feedback from TestFlight automatically
- 🎯 **Multi-Platform** - Create issues in GitHub Issues or Linear
- 🔄 **Duplicate Prevention** - Smart duplicate detection to avoid creating redundant issues
- 💰 **Cost Controls** - Built-in LLM usage tracking and spending limits

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
        uses: vishrutkmr7/testflight-pm@latest
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
```

### 3. Run Your First Workflow

- Go to **Actions** tab in your repository
- Click on **TestFlight Issue Management**
- Click **Run workflow** → **Run workflow**

That's it! The action will process your TestFlight feedback and create enhanced issues.

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

| Input | Description |
|-------|-------------|
| `testflight_issuer_id` | App Store Connect API Issuer ID |
| `testflight_key_id` | App Store Connect API Key ID |
| `testflight_private_key` | App Store Connect private key (.p8 file content) |
| `app_id` | TestFlight App ID |

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
    testflight_issuer_id: ${{ secrets.TESTFLIGHT_ISSUER_ID }}
    testflight_key_id: ${{ secrets.TESTFLIGHT_KEY_ID }}
    testflight_private_key: ${{ secrets.TESTFLIGHT_PRIVATE_KEY }}
    app_id: ${{ secrets.TESTFLIGHT_APP_ID }}
    
    # Create issues in both GitHub and Linear
    platform: 'both'
    gthb_token: ${{ secrets.GTHB_TOKEN }}
    linear_api_token: ${{ secrets.LINEAR_API_TOKEN }}
    linear_team_id: ${{ secrets.LINEAR_TEAM_ID }}
    
    # Enable AI enhancement
    enable_llm_enhancement: 'true'
    openai_api_key: ${{ secrets.OPENAI_API_KEY }}
```

### High-Frequency Processing

```yaml
on:
  schedule:
    - cron: '0 * * * *'  # Every hour

jobs:
  testflight-pm:
    runs-on: ubuntu-latest
    steps:
      - uses: vishrutkmr7/testflight-pm@latest
        with:
          testflight_issuer_id: ${{ secrets.TESTFLIGHT_ISSUER_ID }}
          testflight_key_id: ${{ secrets.TESTFLIGHT_KEY_ID }}
          testflight_private_key: ${{ secrets.TESTFLIGHT_PRIVATE_KEY }}
          app_id: ${{ secrets.TESTFLIGHT_APP_ID }}
          
          platform: 'github'
          gthb_token: ${{ secrets.GTHB_TOKEN }}
          
          # Process only last 2 hours to avoid duplicates
          processing_window_hours: '2'
          enable_llm_enhancement: 'true'
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
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
    # ... your configuration
    dry_run: 'true'  # Won't create actual issues
    debug: 'true'    # Verbose logging
```

## ❓ Troubleshooting

**"TestFlight credentials invalid"**
- Verify your App Store Connect API credentials
- Ensure the private key is the complete .p8 file content

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
