/**
 * TestFlight Webhook Server
 * Simple HTTP server for receiving and testing TestFlight webhook events
 */

import { createBunWebhookHandler, getWebhookReceiver } from '../api/webhook-receiver.js';
import { getConfig } from '../config/environment.js';

/**
 * Creates and starts a Bun HTTP server for webhook testing
 */
export async function startWebhookServer(): Promise<void> {
    try {
        const config = getConfig();
        const port = config.webhook?.port || 3000;
        const webhookHandler = createBunWebhookHandler();
        const receiver = getWebhookReceiver();

        const server = Bun.serve({
            port,
            fetch: async (request) => {
                const url = new URL(request.url);

                // Health check endpoint
                if (url.pathname === '/health' && request.method === 'GET') {
                    const healthResponse = receiver.healthCheck();
                    return new Response(healthResponse.body, {
                        status: healthResponse.status,
                        headers: healthResponse.headers
                    });
                }

                // Webhook endpoint
                if (url.pathname === '/webhook' && request.method === 'POST') {
                    return await webhookHandler(request);
                }

                // Default 404 response
                return new Response(
                    JSON.stringify({
                        error: 'Not found',
                        availableEndpoints: [
                            'GET /health - Health check',
                            'POST /webhook - TestFlight webhook receiver'
                        ]
                    }),
                    {
                        status: 404,
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
            },
        });

        console.log(`🚀 TestFlight Webhook Server started on http://localhost:${port}`);
        console.log(`📋 Health check: http://localhost:${port}/health`);
        console.log(`🔗 Webhook endpoint: http://localhost:${port}/webhook`);

        if (config.webhook?.secret) {
            console.log('🔐 HMAC signature verification: ENABLED');
        } else {
            console.log('⚠️  HMAC signature verification: DISABLED (no WEBHOOK_SECRET set)');
        }

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Shutting down webhook server...');
            server.stop();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            console.log('\n🛑 Shutting down webhook server...');
            server.stop();
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ Failed to start webhook server:', error);
        process.exit(1);
    }
}

/**
 * CLI command handler
 */
if (import.meta.main) {
    console.log('🎯 Starting TestFlight Webhook Server...\n');
    await startWebhookServer();
} 