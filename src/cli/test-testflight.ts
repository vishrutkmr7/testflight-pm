#!/usr/bin/env bun

/**
 * TestFlight Testing CLI
 * Simple command-line interface for testing TestFlight data fetching
 */

import { getConfig } from '../config/environment.js';
import { getAuthInstance } from '../api/app-store-connect-auth.js';
import { getTestFlightClient } from '../api/testflight-client.js';

interface CliOptions {
    command: 'test-auth' | 'fetch-crashes' | 'fetch-screenshots' | 'fetch-all';
    limit?: number;
    days?: number;
    verbose?: boolean;
}

async function main() {
    console.log('🚀 TestFlight PM - Data Fetching Test\n');

    let options: CliOptions | undefined;

    try {
        // Parse command line arguments
        options = parseArguments();

        // Load and validate configuration
        console.log('📋 Loading configuration...');
        const config = getConfig();
        console.log('✅ Configuration loaded successfully');
        console.log(`   - Environment: ${config.nodeEnv}`);
        console.log(`   - App ID: ${config.appStoreConnect.appId || 'Not specified'}`);
        console.log(`   - Bundle ID: ${config.appStoreConnect.bundleId || 'Not specified'}\n`);

        switch (options.command) {
            case 'test-auth':
                await testAuthentication();
                break;
            case 'fetch-crashes':
                await fetchCrashReports(options.limit, options.days);
                break;
            case 'fetch-screenshots':
                await fetchScreenshots(options.limit, options.days);
                break;
            case 'fetch-all':
                await fetchAllFeedback(options.limit, options.days);
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

        process.exit(1);
    }
}

async function testAuthentication() {
    console.log('🔐 Testing App Store Connect authentication...');

    try {
        const auth = getAuthInstance();
        console.log('   - Auth instance created');

        const token = await auth.getValidToken();
        console.log('✅ Authentication successful!');

        const tokenInfo = auth.getTokenInfo();
        console.log(`   - Token expires at: ${tokenInfo.expiresAt?.toISOString()}`);
        console.log(`   - Token is valid: ${tokenInfo.isValid}`);

    } catch (error) {
        console.error('❌ Authentication failed:', (error as Error).message);
        console.error('\n💡 Common solutions:');
        console.error('   - Verify your APP_STORE_CONNECT_ISSUER_ID is correct');
        console.error('   - Check that APP_STORE_CONNECT_KEY_ID matches your API key');
        console.error('   - Ensure your private key is in the correct PEM format');
        console.error('   - Verify your API key has sufficient permissions');
        throw error;
    }
}

async function fetchCrashReports(limit = 10, days = 7) {
    console.log(`📱 Fetching crash reports (limit: ${limit}, last ${days} days)...`);

    const client = getTestFlightClient();
    const since = new Date();
    since.setDate(since.getDate() - days);

    try {
        const crashes = await client.getCrashReports({
            limit,
            sort: '-submittedAt',
            filter: {
                submittedAt: `>${since.toISOString()}`,
            },
        });

        console.log(`✅ Found ${crashes.length} crash reports`);

        if (crashes.length === 0) {
            console.log('   No crash reports found for the specified period');
            return;
        }

        console.log('\n📊 Crash Report Summary:');
        for (const crash of crashes.slice(0, 5)) {
            const submittedAt = new Date(crash.attributes.submittedAt);
            console.log(`   • ${crash.attributes.crashType || 'Unknown'} on ${crash.attributes.deviceModel}`);
            console.log(`     App: ${crash.attributes.appVersion} (${crash.attributes.buildNumber})`);
            console.log(`     Submitted: ${submittedAt.toLocaleDateString()}`);
            console.log(`     OS: ${crash.attributes.osVersion}\n`);
        }

        if (crashes.length > 5) {
            console.log(`   ... and ${crashes.length - 5} more crash reports`);
        }

    } catch (error) {
        console.error('❌ Failed to fetch crash reports:', (error as Error).message);
        throw error;
    }
}

async function fetchScreenshots(limit = 10, days = 7) {
    console.log(`📸 Fetching screenshot feedback (limit: ${limit}, last ${days} days)...`);

    const client = getTestFlightClient();
    const since = new Date();
    since.setDate(since.getDate() - days);

    try {
        const screenshots = await client.getScreenshotFeedback({
            limit,
            sort: '-submittedAt',
            filter: {
                submittedAt: `>${since.toISOString()}`,
            },
        });

        console.log(`✅ Found ${screenshots.length} screenshot submissions`);

        if (screenshots.length === 0) {
            console.log('   No screenshot feedback found for the specified period');
            return;
        }

        console.log('\n📊 Screenshot Feedback Summary:');
        for (const screenshot of screenshots.slice(0, 5)) {
            const submittedAt = new Date(screenshot.attributes.submittedAt);
            console.log(`   • Feedback on ${screenshot.attributes.deviceModel}`);
            console.log(`     App: ${screenshot.attributes.appVersion} (${screenshot.attributes.buildNumber})`);
            console.log(`     Submitted: ${submittedAt.toLocaleDateString()}`);
            console.log(`     Screenshots: ${screenshot.attributes.screenshots.length}`);
            if (screenshot.attributes.feedbackText) {
                console.log(`     Text: "${screenshot.attributes.feedbackText.slice(0, 50)}..."`);
            }
            console.log('');
        }

        if (screenshots.length > 5) {
            console.log(`   ... and ${screenshots.length - 5} more screenshot submissions`);
        }

    } catch (error) {
        console.error('❌ Failed to fetch screenshot feedback:', (error as Error).message);
        throw error;
    }
}

async function fetchAllFeedback(limit = 20, days = 7) {
    console.log(`📊 Fetching all feedback (limit: ${limit}, last ${days} days)...`);

    const client = getTestFlightClient();
    const since = new Date();
    since.setDate(since.getDate() - days);

    try {
        const feedback = await client.getAllFeedback({
            limit,
            sort: '-submittedAt',
            filter: {
                submittedAt: `>${since.toISOString()}`,
            },
        });

        console.log(`✅ Found ${feedback.length} total feedback items`);

        if (feedback.length === 0) {
            console.log('   No feedback found for the specified period');
            return;
        }

        // Count by type
        const crashes = feedback.filter(f => f.type === 'crash').length;
        const screenshots = feedback.filter(f => f.type === 'screenshot').length;

        console.log(`   - Crash reports: ${crashes}`);
        console.log(`   - Screenshot feedback: ${screenshots}`);

        // Show rate limit info
        const rateLimitInfo = client.getRateLimitInfo();
        if (rateLimitInfo) {
            console.log(`\n⚡ Rate Limit Status:`);
            console.log(`   - Remaining requests: ${rateLimitInfo.remaining}/${rateLimitInfo.limit}`);
            console.log(`   - Reset time: ${rateLimitInfo.reset.toLocaleTimeString()}`);
        }

        console.log('\n📋 Recent Feedback:');
        for (const item of feedback.slice(0, 10)) {
            const icon = item.type === 'crash' ? '💥' : '📷';
            console.log(`   ${icon} ${item.type.toUpperCase()} - ${item.appVersion} (${item.buildNumber})`);
            console.log(`     Device: ${item.deviceInfo.model} (${item.deviceInfo.osVersion})`);
            console.log(`     Submitted: ${item.submittedAt.toLocaleDateString()}`);

            if (item.crashData) {
                console.log(`     Crash Type: ${item.crashData.type}`);
            }

            if (item.screenshotData?.text) {
                console.log(`     Feedback: "${item.screenshotData.text.slice(0, 50)}..."`);
            }

            console.log('');
        }

    } catch (error) {
        console.error('❌ Failed to fetch feedback:', (error as Error).message);
        throw error;
    }
}

function parseArguments(): CliOptions {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        showUsage();
        process.exit(1);
    }

    const command = args[0] as CliOptions['command'];
    const validCommands = ['test-auth', 'fetch-crashes', 'fetch-screenshots', 'fetch-all'];

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
        } else if (arg === '--days' && i + 1 < args.length) {
            options.days = parseInt(args[i + 1]!, 10);
            i++;
        } else if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
        }
    }

    return options;
}

function showUsage() {
    console.log('TestFlight PM - Data Fetching Test CLI\n');
    console.log('Usage: bun run test:testflight <command> [options]\n');
    console.log('Commands:');
    console.log('  test-auth              Test App Store Connect authentication');
    console.log('  fetch-crashes          Fetch recent crash reports');
    console.log('  fetch-screenshots      Fetch recent screenshot feedback');
    console.log('  fetch-all              Fetch all feedback types\n');
    console.log('Options:');
    console.log('  --limit <number>       Limit number of results (default: 10-20)');
    console.log('  --days <number>        Number of days to look back (default: 7)');
    console.log('  --verbose, -v          Show detailed error information\n');
    console.log('Examples:');
    console.log('  bun run test:testflight test-auth');
    console.log('  bun run test:testflight fetch-crashes --limit 5 --days 3');
    console.log('  bun run test:testflight fetch-all --verbose');
}

if (import.meta.main) {
    main();
} 