# TestFlight PM GitHub Action

Automatically monitor TestFlight feedback and create GitHub or Linear issues from crashes and user feedback. This GitHub Action securely processes TestFlight data and creates actionable development tasks with rich context and metadata.

## 🚀 Features

- **Automated Issue Creation**: Convert TestFlight crashes and feedback into GitHub Issues or Linear tasks
- **Rich Context**: Include device info, app versions, stack traces, and user feedback
- **Secure Authentication**: Uses App Store Connect API with industry-standard security
- **Smart Filtering**: Configurable feedback types, priority detection, and duplicate prevention
- **Rate Limited**: Respects API limits with intelligent retry mechanisms

## 📋 Usage

### Basic Setup

```yaml
name: Process TestFlight Feedback
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:

jobs:
  testflight-feedback:
    runs-on: ubuntu-latest
    steps:
      - name: Process TestFlight Feedback
        uses: vishrutkmr7/testflight-pm@v1
        with:
          # Required: App Store Connect API credentials
          app-store-connect-issuer-id: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
          app-store-connect-key-id: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
          app-store-connect-private-key: ${{ secrets.APP_STORE_CONNECT_PRIVATE_KEY }}
          
          # Required: TestFlight app configuration
          testflight-bundle-id: 'com.yourcompany.yourapp'
          
          # Optional: Issue creation configuration
          create-github-issues: true
          create-linear-issues: false
```

### Advanced Configuration

```yaml
      - name: Process TestFlight Feedback
        uses: vishrutkmr7/testflight-pm@v1
        with:
          # App Store Connect Configuration
          app-store-connect-issuer-id: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
          app-store-connect-key-id: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
          app-store-connect-private-key: ${{ secrets.APP_STORE_CONNECT_PRIVATE_KEY }}
          testflight-app-id: '1234567890'
          testflight-bundle-id: 'com.yourcompany.yourapp'
          
          # Filtering Options
          feedback-types: 'all'  # 'crashes', 'screenshots', or 'all'
          monitor-since: '24h'   # Time period to check
          max-issues-per-run: 10
          
          # GitHub Issues (uses repository context by default)
          create-github-issues: true
          github-token: ${{ secrets.GITHUB_TOKEN }}
          issue-labels: 'testflight,feedback,bug'
          crash-issue-labels: 'bug,crash,urgent'
          feedback-issue-labels: 'enhancement,user-feedback'
          
          # Linear Integration (optional)
          create-linear-issues: false
          linear-api-token: ${{ secrets.LINEAR_API_TOKEN }}
          linear-team-id: ${{ secrets.LINEAR_TEAM_ID }}
          
          # Additional Options
          duplicate-detection: true
          include-device-info: true
          include-app-version: true
          dry-run: false
```

## 🔐 Required Secrets

### App Store Connect API

1. Go to [App Store Connect](https://appstoreconnect.apple.com/)
2. Navigate to **Users and Access** → **Integrations** → **App Store Connect API**
3. Click **Generate API Key**
4. Configure the key with **App Manager** permissions
5. Download the `.p8` file immediately (only available once)
6. Add these secrets to your GitHub repository:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID from App Store Connect | `57246542-96fe-1a63-e053-0824d011072a` |
| `APP_STORE_CONNECT_KEY_ID` | Key ID from your API key | `2X9R4HXF34` |
| `APP_STORE_CONNECT_PRIVATE_KEY` | Complete content of your .p8 file | `-----BEGIN PRIVATE KEY-----\nMIGT...` |

### Optional Secrets

For Linear integration:
- `LINEAR_API_TOKEN`: Your Linear API token
- `LINEAR_TEAM_ID`: Your Linear team identifier

## 📝 Action Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `app-store-connect-issuer-id` | App Store Connect API Issuer ID | ✅ | - |
| `app-store-connect-key-id` | App Store Connect API Key ID | ✅ | - |
| `app-store-connect-private-key` | App Store Connect API Private Key | ✅ | - |
| `testflight-bundle-id` | App Bundle ID (e.g., com.company.app) | ✅ | - |
| `testflight-app-id` | TestFlight App ID | ❌ | - |
| `create-github-issues` | Create GitHub issues | ❌ | `true` |
| `create-linear-issues` | Create Linear issues | ❌ | `false` |
| `github-token` | GitHub token for creating issues | ❌ | `${{ github.token }}` |
| `github-owner` | GitHub repository owner | ❌ | Current repo owner |
| `github-repo` | GitHub repository name | ❌ | Current repo name |
| `linear-api-token` | Linear API token | ❌ | - |
| `linear-team-id` | Linear team ID | ❌ | - |
| `feedback-types` | Types to process: 'crashes', 'screenshots', 'all' | ❌ | `all` |
| `monitor-since` | Time period to check (e.g., '24h', '7d') | ❌ | `24h` |
| `max-issues-per-run` | Maximum issues to create per run | ❌ | `10` |
| `issue-labels` | Base labels for all issues | ❌ | `testflight,feedback` |
| `crash-issue-labels` | Additional labels for crash issues | ❌ | `bug,crash,urgent` |
| `feedback-issue-labels` | Additional labels for feedback issues | ❌ | `enhancement,user-feedback` |
| `duplicate-detection` | Enable duplicate issue detection | ❌ | `true` |
| `include-device-info` | Include device information in issues | ❌ | `true` |
| `include-app-version` | Include app version in issues | ❌ | `true` |
| `dry-run` | Log actions without creating issues | ❌ | `false` |

## 📊 Action Outputs

| Output | Description |
|--------|-------------|
| `issues-created` | Number of issues created |
| `crashes-processed` | Number of crashes processed |
| `feedback-processed` | Number of feedback items processed |
| `errors-encountered` | Number of errors encountered |
| `summary` | Summary of the action run |

## 📋 Example Workflows

### Process All Feedback Every 6 Hours

```yaml
name: TestFlight Feedback Monitor
on:
  schedule:
    - cron: '0 */6 * * *'

jobs:
  monitor:
    runs-on: ubuntu-latest
    steps:
      - uses: vishrutkmr7/testflight-pm@v1
        with:
          app-store-connect-issuer-id: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
          app-store-connect-key-id: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
          app-store-connect-private-key: ${{ secrets.APP_STORE_CONNECT_PRIVATE_KEY }}
          testflight-bundle-id: 'com.yourcompany.yourapp'
```

### Process Only Crashes with High Priority

```yaml
name: Critical Crash Monitor
on:
  schedule:
    - cron: '0 * * * *'  # Every hour

jobs:
  monitor-crashes:
    runs-on: ubuntu-latest
    steps:
      - uses: vishrutkmr7/testflight-pm@v1
        with:
          app-store-connect-issuer-id: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
          app-store-connect-key-id: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
          app-store-connect-private-key: ${{ secrets.APP_STORE_CONNECT_PRIVATE_KEY }}
          testflight-bundle-id: 'com.yourcompany.yourapp'
          feedback-types: 'crashes'
          crash-issue-labels: 'critical,bug,crash,urgent'
          max-issues-per-run: 5
```

### Dual Integration (GitHub + Linear)

```yaml
name: Full Integration Monitor
on:
  schedule:
    - cron: '0 8,20 * * *'  # 8 AM and 8 PM daily

jobs:
  monitor:
    runs-on: ubuntu-latest
    steps:
      - uses: vishrutkmr7/testflight-pm@v1
        with:
          app-store-connect-issuer-id: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
          app-store-connect-key-id: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
          app-store-connect-private-key: ${{ secrets.APP_STORE_CONNECT_PRIVATE_KEY }}
          testflight-bundle-id: 'com.yourcompany.yourapp'
          create-github-issues: true
          create-linear-issues: true
          linear-api-token: ${{ secrets.LINEAR_API_TOKEN }}
          linear-team-id: ${{ secrets.LINEAR_TEAM_ID }}
```

## 🔒 Security

- **Zero Hardcoded Secrets**: All credentials managed through GitHub repository secrets
- **Secure JWT Authentication**: Industry-standard ES256 token generation for App Store Connect
- **No Secret Exposure**: Credentials never appear in logs or error messages
- **Rate Limiting**: Intelligent API rate limit handling with automatic backoff
- **Input Validation**: Strict validation of all inputs and credentials

## 🛠️ Troubleshooting

### Common Issues

**Authentication Fails**
- Verify your App Store Connect API credentials are correct
- Ensure the API key has sufficient permissions (App Manager minimum)
- Check that the private key includes the full PEM format with headers

**No Issues Created**
- Verify there's TestFlight feedback in the specified time period
- Check the `dry-run` input isn't set to `true`
- Ensure the bundle ID matches your TestFlight app

**Rate Limiting**
- The action automatically handles rate limits with backoff
- Consider reducing `max-issues-per-run` if encountering persistent rate limits

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

---

**Security Notice**: Keep your App Store Connect API credentials secure. If compromised, immediately revoke the API key in App Store Connect and generate a new one.
