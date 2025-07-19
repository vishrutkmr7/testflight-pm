#!/usr/bin/env bun

/**
 * Linear Testing CLI
 * Simple command-line interface for testing Linear integration and connectivity
 */

import { getConfig } from '../config/environment.js';
import { getLinearClient, validateLinearConfig } from '../api/linear-client.js';
import {
    getLinearIntegrationHealth,
    determineFeedbackPriority,
    generateFeedbackLabels,
    formatFeedbackForLinear
} from '../utils/linear-utils.js';

interface CliOptions {
    command: 'test-auth' | 'health-check' | 'list-issues' | 'list-teams' | 'list-projects' | 'list-labels' | 'create-test-issue';
    limit?: number;
    includeArchived?: boolean;
    verbose?: boolean;
}

async function main() {
    console.log('🔧 Linear PM - Integration Testing CLI\n');

    let options: CliOptions | undefined;

    try {
        // Parse command line arguments
        options = parseArguments();

        // Load and validate configuration
        console.log('📋 Loading configuration...');
        const config = getConfig();
        console.log('✅ Configuration loaded successfully');

        if (config.linear) {
            console.log(`   - Team ID: ${config.linear.teamId}`);
            console.log(`   - API Token: ${config.linear.apiToken ? '✅ Set' : '❌ Missing'}\n`);
        } else {
            console.log('   - Linear configuration: ❌ Not configured\n');
        }

        switch (options.command) {
            case 'test-auth':
                await testAuthentication();
                break;
            case 'health-check':
                await performHealthCheck();
                break;
            case 'list-issues':
                await listRecentIssues(options.limit, options.includeArchived);
                break;
            case 'list-teams':
                await listTeams();
                break;
            case 'list-projects':
                await listProjects();
                break;
            case 'list-labels':
                await listLabels();
                break;
            case 'create-test-issue':
                await createTestIssue();
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
        console.error('   - Verify your LINEAR_API_TOKEN is set and valid');
        console.error('   - Check that LINEAR_TEAM_ID is correct');
        console.error('   - Ensure you have appropriate permissions in Linear');
        console.error('   - Verify network connectivity to Linear API');

        process.exit(1);
    }
}

async function testAuthentication() {
    console.log('🔐 Testing Linear authentication and connectivity...');

    try {
        if (!validateLinearConfig()) {
            throw new Error('Linear configuration missing. Please set LINEAR_API_TOKEN and LINEAR_TEAM_ID.');
        }

        const client = getLinearClient();
        console.log('   - Linear client initialized');

        // Test basic connectivity by getting team info
        const team = await client.getTeam();
        console.log('✅ Authentication successful!');
        console.log(`   - Team: ${team.name} (${team.key})`);
        console.log(`   - Team ID: ${team.id}`);
        console.log(`   - Description: ${team.description || 'No description'}`);

        // Test user access
        try {
            const currentUser = await client.getCurrentUser();
            console.log(`   - Current user: ${currentUser.displayName} (${currentUser.email})`);
            console.log(`   - User role: ${currentUser.isAdmin ? 'Admin' : currentUser.isGuest ? 'Guest' : 'Member'}`);
        } catch (error) {
            console.warn('⚠️  Could not fetch current user information');
        }

    } catch (error) {
        console.error('❌ Authentication failed:', (error as Error).message);
        throw error;
    }
}

async function performHealthCheck() {
    console.log('🔍 Performing comprehensive Linear integration health check...');

    try {
        const healthStatus = await getLinearIntegrationHealth();

        console.log(`\n📊 Health Status: ${getStatusIcon(healthStatus.status)} ${healthStatus.status.toUpperCase()}`);

        if (healthStatus.details) {
            console.log('\n📋 Details:');
            if (typeof healthStatus.details === 'object') {
                Object.entries(healthStatus.details).forEach(([key, value]) => {
                    console.log(`   - ${key}: ${value}`);
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
            console.log('\n✅ Linear integration is fully functional!');
        } else if (healthStatus.status === 'degraded') {
            console.log('\n⚠️  Linear integration has some issues but is functional');
        } else {
            console.log('\n❌ Linear integration requires attention');
        }

    } catch (error) {
        console.error('❌ Health check failed:', (error as Error).message);
        throw error;
    }
}

async function listRecentIssues(limit = 10, includeArchived = false) {
    console.log(`📋 Fetching recent Linear issues (limit: ${limit}, include archived: ${includeArchived})...`);

    try {
        const client = getLinearClient();
        const issues = await client.getRecentIssues(limit);

        console.log(`✅ Found ${issues.length} issues`);

        if (issues.length === 0) {
            console.log('   No issues found in your Linear workspace');
            return;
        }

        console.log('\n📊 Recent Issues:');
        for (const issue of issues) {
            const status = getIssueStatusIcon(issue.state.type);
            const priority = getPriorityIcon(issue.priority);
            const assignee = issue.assignee ? ` → ${issue.assignee.displayName}` : '';

            console.log(`   ${status} ${issue.identifier} - ${issue.title}`);
            console.log(`     Priority: ${priority} | State: ${issue.state.name}${assignee}`);
            console.log(`     Created: ${new Date(issue.createdAt).toLocaleDateString()}`);

            if (issue.labels.length > 0) {
                const labelNames = issue.labels.map(l => l.name).join(', ');
                console.log(`     Labels: ${labelNames}`);
            }

            console.log(`     URL: ${issue.url}\n`);
        }

    } catch (error) {
        console.error('❌ Failed to fetch Linear issues:', (error as Error).message);
        throw error;
    }
}

async function listTeams() {
    console.log('👥 Fetching Linear teams...');

    try {
        const client = getLinearClient();

        // Get the configured team first
        const currentTeam = await client.getTeam();
        console.log('✅ Current configured team:');
        console.log(`   - Name: ${currentTeam.name} (${currentTeam.key})`);
        console.log(`   - ID: ${currentTeam.id}`);
        console.log(`   - Description: ${currentTeam.description || 'No description'}`);
        console.log(`   - Private: ${currentTeam.private ? 'Yes' : 'No'}`);
        console.log(`   - Cycles Enabled: ${currentTeam.cyclesEnabled ? 'Yes' : 'No'}`);

        // Note: Listing all teams would require additional MCP function
        console.log('\n💡 To see all teams in your workspace, use the Linear web app or CLI.');

    } catch (error) {
        console.error('❌ Failed to fetch Linear teams:', (error as Error).message);
        throw error;
    }
}

async function listProjects() {
    console.log('📁 Fetching Linear projects...');

    try {
        const client = getLinearClient();
        const projects = await client.getProjects();

        console.log(`✅ Found ${projects.length} projects`);

        if (projects.length === 0) {
            console.log('   No projects found in your team');
            return;
        }

        console.log('\n📊 Projects:');
        for (const project of projects) {
            const statusIcon = getProjectStatusIcon(project.state);
            const progress = project.completedAt ? '✅' : project.startDate ? '🔄' : '📅';

            console.log(`   ${statusIcon} ${project.name}`);
            console.log(`     State: ${project.state} | Priority: ${getPriorityIcon(project.priority)}`);
            console.log(`     Progress: ${progress}`);

            if (project.description) {
                console.log(`     Description: ${project.description.substring(0, 100)}...`);
            }

            if (project.startDate || project.targetDate) {
                const start = project.startDate ? new Date(project.startDate).toLocaleDateString() : 'Not set';
                const target = project.targetDate ? new Date(project.targetDate).toLocaleDateString() : 'Not set';
                console.log(`     Timeline: ${start} → ${target}`);
            }

            console.log(`     Team members: ${project.members.length}`);
            console.log('');
        }

    } catch (error) {
        console.error('❌ Failed to fetch Linear projects:', (error as Error).message);
        throw error;
    }
}

async function listLabels() {
    console.log('🏷️ Fetching Linear issue labels...');

    try {
        const client = getLinearClient();
        const labels = await client.getIssueLabels();

        console.log(`✅ Found ${labels.length} labels`);

        if (labels.length === 0) {
            console.log('   No labels found in your team');
            return;
        }

        console.log('\n📊 Available Labels:');
        const groupedLabels = new Map<string, typeof labels>();

        // Group labels by parent if they have one
        for (const label of labels) {
            const groupKey = label.parent?.name || 'General';
            if (!groupedLabels.has(groupKey)) {
                groupedLabels.set(groupKey, []);
            }
            groupedLabels.get(groupKey)!.push(label);
        }

        for (const [group, groupLabels] of groupedLabels) {
            console.log(`\n   📂 ${group}:`);
            for (const label of groupLabels) {
                const colorBox = `\x1b[48;2;${hexToRgb(label.color).join(';')}m   \x1b[0m`;
                console.log(`     ${colorBox} ${label.name}`);
                if (label.description) {
                    console.log(`       ${label.description}`);
                }
            }
        }

    } catch (error) {
        console.error('❌ Failed to fetch Linear labels:', (error as Error).message);
        throw error;
    }
}

async function createTestIssue() {
    console.log('🧪 Creating a test Linear issue...');

    try {
        const client = getLinearClient();

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
                exceptionMessage: 'This is a test crash for Linear integration testing',
                logs: [],
            },
        };

        // Generate test labels and priority
        const priority = determineFeedbackPriority(mockFeedback);
        const labels = generateFeedbackLabels(mockFeedback);
        labels.push('test', 'cli-generated');

        console.log(`   - Creating issue with priority: ${getPriorityIcon(priority)}`);
        console.log(`   - Labels: ${labels.join(', ')}`);

        const result = await client.createIssueFromTestFlight(mockFeedback, labels);

        console.log('✅ Test issue created successfully!');
        console.log(`   - Issue ID: ${result.identifier}`);
        console.log(`   - Title: ${result.title}`);
        console.log(`   - URL: ${result.url}`);
        console.log(`   - State: ${result.state.name}`);
        console.log(`   - Priority: ${getPriorityIcon(result.priority)}`);

        console.log('\n💡 You can now view this test issue in Linear and delete it if desired.');

    } catch (error) {
        console.error('❌ Failed to create test issue:', (error as Error).message);
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

function getIssueStatusIcon(stateType: string): string {
    switch (stateType) {
        case 'backlog': return '📋';
        case 'unstarted': return '🆕';
        case 'started': return '🔄';
        case 'completed': return '✅';
        case 'canceled': return '❌';
        default: return '❓';
    }
}

function getPriorityIcon(priority: number): string {
    switch (priority) {
        case 0: return '⚪ None';
        case 1: return '🔴 Urgent';
        case 2: return '🟠 High';
        case 3: return '🟡 Normal';
        case 4: return '🔵 Low';
        default: return '❓ Unknown';
    }
}

function getProjectStatusIcon(state: string): string {
    switch (state) {
        case 'planned': return '📋';
        case 'started': return '🚀';
        case 'completed': return '✅';
        case 'canceled': return '❌';
        case 'paused': return '⏸️';
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
        'list-teams',
        'list-projects',
        'list-labels',
        'create-test-issue'
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
        } else if (arg === '--include-archived') {
            options.includeArchived = true;
        } else if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
        }
    }

    return options;
}

function showUsage() {
    console.log('Linear PM - Integration Testing CLI\n');
    console.log('Usage: bun run test:linear <command> [options]\n');
    console.log('Commands:');
    console.log('  test-auth              Test Linear authentication and connectivity');
    console.log('  health-check           Perform comprehensive health check');
    console.log('  list-issues            List recent issues in your team');
    console.log('  list-teams             List team information');
    console.log('  list-projects          List projects in your team');
    console.log('  list-labels            List available issue labels');
    console.log('  create-test-issue      Create a test issue for integration testing\n');
    console.log('Options:');
    console.log('  --limit <number>       Limit number of results (default: 10)');
    console.log('  --include-archived     Include archived items in results');
    console.log('  --verbose, -v          Show detailed error information\n');
    console.log('Examples:');
    console.log('  bun run test:linear test-auth');
    console.log('  bun run test:linear health-check --verbose');
    console.log('  bun run test:linear list-issues --limit 5');
    console.log('  bun run test:linear create-test-issue');
}

if (import.meta.main) {
    main();
} 