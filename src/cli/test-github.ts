#!/usr/bin/env bun

/**
 * GitHub Issues Testing CLI
 * Simple command-line interface for testing GitHub Issues integration and connectivity
 */

import { getConfig } from '../config/environment.js';
import { getGitHubClient, validateGitHubConfig } from '../api/github-client.js';
import {
    getGitHubIntegrationHealth,
    determineFeedbackPriority,
    generateFeedbackLabels,
    formatFeedbackForGitHub
} from '../utils/github-utils.js';

interface CliOptions {
    command: 'test-auth' | 'health-check' | 'list-issues' | 'list-labels' | 'list-milestones' | 'create-test-issue' | 'rate-limit';
    limit?: number;
    state?: 'open' | 'closed' | 'all';
    verbose?: boolean;
}

async function main() {
    console.log('🔧 GitHub Issues PM - Integration Testing CLI\n');

    let options: CliOptions | undefined;

    try {
        // Parse command line arguments
        options = parseArguments();

        // Load and validate configuration
        console.log('📋 Loading configuration...');
        const config = getConfig();
        console.log('✅ Configuration loaded successfully');

        if (config.github) {
            console.log(`   - Repository: ${config.github.owner}/${config.github.repo}`);
            console.log(`   - GitHub Token: ${config.github.token ? '✅ Set' : '❌ Missing'}\n`);
        } else {
            console.log('   - GitHub configuration: ❌ Not configured\n');
        }

        switch (options.command) {
            case 'test-auth':
                await testAuthentication();
                break;
            case 'health-check':
                await performHealthCheck();
                break;
            case 'list-issues':
                await listRecentIssues(options.limit, options.state);
                break;
            case 'list-labels':
                await listLabels();
                break;
            case 'list-milestones':
                await listMilestones();
                break;
            case 'create-test-issue':
                await createTestIssue();
                break;
            case 'rate-limit':
                await checkRateLimit();
                break;
            default:
                showUsage();
        }

    } catch (error) {
        console.error('❌ Error:', (error as Error).message);

        if (options?.verbose) {
            console.error('\n🔍 Detailed error information:');
            console.error(error);
        }

        console.error('\n💡 Common solutions:');
        console.error('   - Verify your GITHUB_TOKEN is set and valid');
        console.error('   - Check that GITHUB_OWNER and GITHUB_REPO are correct');
        console.error('   - Ensure you have appropriate permissions for the repository');
        console.error('   - Verify network connectivity to GitHub API');

        process.exit(1);
    }
}

async function testAuthentication() {
    console.log('🔐 Testing GitHub authentication and connectivity...');

    try {
        if (!validateGitHubConfig()) {
            throw new Error('GitHub configuration missing. Please set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO.');
        }

        const client = getGitHubClient();
        console.log('   - GitHub client initialized');

        // Test basic connectivity by getting rate limit
        const rateLimit = await client.getRateLimit();
        console.log('✅ Authentication successful!');
        console.log(`   - Rate Limit: ${rateLimit.remaining}/${rateLimit.limit} remaining`);
        console.log(`   - Reset Time: ${new Date(rateLimit.reset * 1000).toLocaleTimeString()}`);

        // Test repository access
        try {
            const labels = await client.getLabels();
            console.log(`   - Repository Access: ✅ (${labels.length} labels found)`);
        } catch (error) {
            console.warn('⚠️  Could not access repository labels - check repository permissions');
        }

    } catch (error) {
        console.error('❌ Authentication failed:', (error as Error).message);
        throw error;
    }
}

async function performHealthCheck() {
    console.log('🔍 Performing comprehensive GitHub integration health check...');

    try {
        const healthStatus = await getGitHubIntegrationHealth();

        console.log(`\n📊 Health Status: ${getStatusIcon(healthStatus.status)} ${healthStatus.status.toUpperCase()}`);

        if (healthStatus.details) {
            console.log('\n📋 Details:');
            if (typeof healthStatus.details === 'object') {
                Object.entries(healthStatus.details).forEach(([key, value]) => {
                    if (key === 'rateLimit' && typeof value === 'object' && value && 'remaining' in value && 'limit' in value && 'reset' in value) {
                        console.log(`   - Rate Limit: ${(value as any).remaining}/${(value as any).limit} (resets at ${(value as any).reset})`);
                    } else {
                        console.log(`   - ${key}: ${value}`);
                    }
                });
            } else {
                console.log(`   ${healthStatus.details}`);
            }
        }

        if (healthStatus.recommendations && healthStatus.recommendations.length > 0) {
            console.log('\n💡 Recommendations:');
            healthStatus.recommendations.forEach(rec => {
                console.log(`   • ${rec}`);
            });
        }

        if (healthStatus.status === 'healthy') {
            console.log('\n✅ GitHub integration is fully functional!');
        } else if (healthStatus.status === 'degraded') {
            console.log('\n⚠️  GitHub integration has some issues but is functional');
        } else {
            console.log('\n❌ GitHub integration requires attention');
        }

    } catch (error) {
        console.error('❌ Health check failed:', (error as Error).message);
        throw error;
    }
}

async function listRecentIssues(limit = 10, state: 'open' | 'closed' | 'all' = 'open') {
    console.log(`📋 Fetching recent GitHub issues (limit: ${limit}, state: ${state})...`);

    try {
        const client = getGitHubClient();
        const searchParams = {
            q: `repo:${client['config'].owner}/${client['config'].repo} is:issue`,
            state: state as any,
            sort: 'updated' as const,
            order: 'desc' as const,
            per_page: limit,
        };

        const searchResult = await client.searchIssues(searchParams);
        const issues = searchResult.items;

        console.log(`✅ Found ${issues.length} issues (${searchResult.total_count} total)`);

        if (issues.length === 0) {
            console.log('   No issues found in your repository');
            return;
        }

        console.log('\n📊 Recent Issues:');
        for (const issue of issues) {
            const status = getIssueStatusIcon(issue.state);
            const assignee = issue.assignee ? ` → ${issue.assignee.login}` : '';

            console.log(`   ${status} #${issue.number} - ${issue.title}`);
            console.log(`     State: ${issue.state}${assignee}`);
            console.log(`     Created: ${new Date(issue.created_at).toLocaleDateString()} by ${issue.user.login}`);

            if (issue.labels.length > 0) {
                const labelNames = issue.labels.map(l => l.name).join(', ');
                console.log(`     Labels: ${labelNames}`);
            }

            if (issue.milestone) {
                console.log(`     Milestone: ${issue.milestone.title}`);
            }

            console.log(`     URL: ${issue.html_url}\n`);
        }

    } catch (error) {
        console.error('❌ Failed to fetch GitHub issues:', (error as Error).message);
        throw error;
    }
}

async function listLabels() {
    console.log('🏷️ Fetching GitHub repository labels...');

    try {
        const client = getGitHubClient();
        const labels = await client.getLabels();

        console.log(`✅ Found ${labels.length} labels`);

        if (labels.length === 0) {
            console.log('   No labels found in your repository');
            return;
        }

        console.log('\n📊 Available Labels:');
        for (const label of labels) {
            const colorBox = `\x1b[48;2;${hexToRgb(label.color).join(';')}m   \x1b[0m`;
            console.log(`   ${colorBox} ${label.name}`);
            if (label.description) {
                console.log(`     ${label.description}`);
            }
        }

    } catch (error) {
        console.error('❌ Failed to fetch GitHub labels:', (error as Error).message);
        throw error;
    }
}

async function listMilestones() {
    console.log('🎯 Fetching GitHub repository milestones...');

    try {
        const client = getGitHubClient();
        const milestones = await client.getMilestones();

        console.log(`✅ Found ${milestones.length} milestones`);

        if (milestones.length === 0) {
            console.log('   No milestones found in your repository');
            return;
        }

        console.log('\n📊 Available Milestones:');
        for (const milestone of milestones) {
            const statusIcon = getMilestoneStatusIcon(milestone.state);
            const progress = milestone.state === 'closed' ? '✅' : milestone.due_on ? '📅' : '🔄';

            console.log(`   ${statusIcon} ${milestone.title} (#${milestone.number})`);
            console.log(`     State: ${milestone.state} | Progress: ${progress}`);

            if (milestone.description) {
                console.log(`     Description: ${milestone.description.substring(0, 100)}...`);
            }

            if (milestone.due_on) {
                console.log(`     Due: ${new Date(milestone.due_on).toLocaleDateString()}`);
            }

            console.log(`     Created: ${new Date(milestone.created_at).toLocaleDateString()}`);
            console.log(`     URL: ${milestone.html_url}\n`);
        }

    } catch (error) {
        console.error('❌ Failed to fetch GitHub milestones:', (error as Error).message);
        throw error;
    }
}

async function createTestIssue() {
    console.log('🧪 Creating a test GitHub issue...');

    try {
        const client = getGitHubClient();

        // Create a mock TestFlight feedback for testing
        const mockFeedback = {
            id: `test-${Date.now()}`,
            type: 'crash' as const,
            submittedAt: new Date(),
            appVersion: '1.0.0',
            buildNumber: '123',
            deviceInfo: {
                family: 'iPhone',
                model: 'iPhone 14 Pro',
                osVersion: '17.0',
                locale: 'en_US',
            },
            bundleId: 'com.example.testflight-pm',
            crashData: {
                trace: 'Mock stack trace for testing purposes\nat com.example.TestClass.method(TestClass.java:42)',
                type: 'Exception',
                exceptionType: 'TestException',
                exceptionMessage: 'This is a test crash for GitHub integration testing',
                logs: [],
            },
        };

        // Generate test labels and priority
        const priority = determineFeedbackPriority(mockFeedback);
        const labels = generateFeedbackLabels(mockFeedback);
        labels.push('test', 'cli-generated');

        console.log(`   - Creating issue with priority: ${getPriorityIcon(priority)}`);
        console.log(`   - Labels: ${labels.join(', ')}`);

        const { title, body } = formatFeedbackForGitHub(mockFeedback);

        const result = await client.createIssue({
            title,
            body,
            labels,
        });

        console.log('✅ Test issue created successfully!');
        console.log(`   - Issue Number: #${result.number}`);
        console.log(`   - Title: ${result.title}`);
        console.log(`   - URL: ${result.html_url}`);
        console.log(`   - State: ${result.state}`);
        console.log(`   - Labels: ${result.labels.map(l => l.name).join(', ')}`);

        console.log('\n💡 You can now view this test issue in GitHub and close it if desired.');

    } catch (error) {
        console.error('❌ Failed to create test issue:', (error as Error).message);
        throw error;
    }
}

async function checkRateLimit() {
    console.log('⚡ Checking GitHub API rate limit status...');

    try {
        const client = getGitHubClient();
        const rateLimit = await client.getRateLimit();

        console.log('✅ Rate limit information:');
        console.log(`   - Limit: ${rateLimit.limit} requests per hour`);
        console.log(`   - Remaining: ${rateLimit.remaining} requests`);
        console.log(`   - Used: ${rateLimit.used || (rateLimit.limit - rateLimit.remaining)} requests`);
        console.log(`   - Reset time: ${new Date(rateLimit.reset * 1000).toLocaleString()}`);

        const percentUsed = Math.round(((rateLimit.used || (rateLimit.limit - rateLimit.remaining)) / rateLimit.limit) * 100);
        const statusIcon = percentUsed > 80 ? '🔴' : percentUsed > 60 ? '🟡' : '🟢';

        console.log(`   - Usage: ${statusIcon} ${percentUsed}%`);

        if (rateLimit.remaining < 100) {
            console.log('\n⚠️  Warning: Low rate limit remaining. Consider waiting before making more requests.');
        }

    } catch (error) {
        console.error('❌ Failed to check rate limit:', (error as Error).message);
        throw error;
    }
}

// Helper functions for CLI formatting

function getStatusIcon(status: string): string {
    switch (status) {
        case 'healthy': return '✅';
        case 'degraded': return '⚠️';
        case 'unhealthy': return '❌';
        default: return '❓';
    }
}

function getIssueStatusIcon(state: string): string {
    switch (state) {
        case 'open': return '🟢';
        case 'closed': return '🔴';
        default: return '❓';
    }
}

function getPriorityIcon(priority: string): string {
    switch (priority) {
        case 'urgent': return '🔴 Urgent';
        case 'high': return '🟠 High';
        case 'normal': return '🟡 Normal';
        case 'low': return '🔵 Low';
        default: return '❓ Unknown';
    }
}

function getMilestoneStatusIcon(state: string): string {
    switch (state) {
        case 'open': return '🎯';
        case 'closed': return '✅';
        default: return '❓';
    }
}

function hexToRgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result && result[1] && result[2] && result[3] ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16)
    ] : [128, 128, 128];
}

function parseArguments(): CliOptions {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        showUsage();
        process.exit(1);
    }

    const command = args[0] as CliOptions['command'];
    const validCommands = [
        'test-auth',
        'health-check',
        'list-issues',
        'list-labels',
        'list-milestones',
        'create-test-issue',
        'rate-limit'
    ];

    if (!validCommands.includes(command)) {
        console.error(`❌ Invalid command: ${command}`);
        showUsage();
        process.exit(1);
    }

    const options: CliOptions = { command };

    // Parse additional options
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--limit' && i + 1 < args.length) {
            options.limit = parseInt(args[i + 1]!, 10);
            i++;
        } else if (arg === '--state' && i + 1 < args.length) {
            options.state = args[i + 1] as 'open' | 'closed' | 'all';
            i++;
        } else if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
        }
    }

    return options;
}

function showUsage() {
    console.log('GitHub Issues PM - Integration Testing CLI\n');
    console.log('Usage: bun run test:github <command> [options]\n');
    console.log('Commands:');
    console.log('  test-auth              Test GitHub authentication and repository access');
    console.log('  health-check           Perform comprehensive health check');
    console.log('  list-issues            List recent issues in the repository');
    console.log('  list-labels            List available issue labels');
    console.log('  list-milestones        List repository milestones');
    console.log('  create-test-issue      Create a test issue for integration testing');
    console.log('  rate-limit             Check current API rate limit status\n');
    console.log('Options:');
    console.log('  --limit <number>       Limit number of results (default: 10)');
    console.log('  --state <state>        Issue state: open, closed, all (default: open)');
    console.log('  --verbose, -v          Show detailed error information\n');
    console.log('Examples:');
    console.log('  bun run test:github test-auth');
    console.log('  bun run test:github health-check --verbose');
    console.log('  bun run test:github list-issues --limit 5 --state open');
    console.log('  bun run test:github create-test-issue');
    console.log('  bun run test:github rate-limit');
}

if (import.meta.main) {
    main();
} 