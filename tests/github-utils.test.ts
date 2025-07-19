/**
 * GitHub Utilities Tests
 * Test suite for GitHub integration utilities - focuses on pure functions
 */

import { describe, test, expect } from 'bun:test';
import {
    determineFeedbackPriority,
    generateFeedbackLabels,
    formatFeedbackForGitHub,
    getPriorityLabels
} from '../src/utils/github-utils.js';
import type { ProcessedFeedbackData } from '../types/testflight.js';

describe('GitHub Utilities', () => {
    describe('determineFeedbackPriority', () => {
        test('should prioritize fatal crashes as urgent', () => {
            const feedback: ProcessedFeedbackData = {
                id: 'test-fatal-crash',
                type: 'crash',
                submittedAt: new Date(),
                appVersion: '1.0.0',
                buildNumber: '123',
                deviceInfo: {
                    family: 'iPhone',
                    model: 'iPhone 14 Pro',
                    osVersion: '17.0',
                    locale: 'en_US',
                },
                bundleId: 'com.example.test',
                crashData: {
                    trace: 'Fatal exception stack trace',
                    type: 'Exception',
                    exceptionType: 'FatalException',
                    exceptionMessage: 'Fatal error occurred',
                    logs: [],
                },
            };

            const priority = determineFeedbackPriority(feedback);
            expect(priority).toBe('urgent');
        });

        test('should prioritize memory crashes as high', () => {
            const feedback: ProcessedFeedbackData = {
                id: 'test-memory-crash',
                type: 'crash',
                submittedAt: new Date(),
                appVersion: '1.0.0',
                buildNumber: '123',
                deviceInfo: {
                    family: 'iPhone',
                    model: 'iPhone 14 Pro',
                    osVersion: '17.0',
                    locale: 'en_US',
                },
                bundleId: 'com.example.test',
                crashData: {
                    trace: 'Out of memory stack trace',
                    type: 'Exception',
                    exceptionType: 'OutOfMemoryException',
                    exceptionMessage: 'Out of memory error',
                    logs: [],
                },
            };

            const priority = determineFeedbackPriority(feedback);
            expect(priority).toBe('high');
        });

        test('should prioritize standard crashes as high', () => {
            const feedback: ProcessedFeedbackData = {
                id: 'test-standard-crash',
                type: 'crash',
                submittedAt: new Date(),
                appVersion: '1.0.0',
                buildNumber: '123',
                deviceInfo: {
                    family: 'iPhone',
                    model: 'iPhone 14 Pro',
                    osVersion: '17.0',
                    locale: 'en_US',
                },
                bundleId: 'com.example.test',
                crashData: {
                    trace: 'Standard exception stack trace',
                    type: 'Exception',
                    exceptionType: 'StandardException',
                    exceptionMessage: 'Standard error occurred',
                    logs: [],
                },
            };

            const priority = determineFeedbackPriority(feedback);
            expect(priority).toBe('high');
        });

        test('should prioritize bug reports from screenshots as high', () => {
            const feedback: ProcessedFeedbackData = {
                id: 'test-bug-screenshot',
                type: 'screenshot',
                submittedAt: new Date(),
                appVersion: '1.0.0',
                buildNumber: '123',
                deviceInfo: {
                    family: 'iPhone',
                    model: 'iPhone 14 Pro',
                    osVersion: '17.0',
                    locale: 'en_US',
                },
                bundleId: 'com.example.test',
                screenshotData: {
                    text: 'This feature is broken and not working properly',
                    images: [],
                    annotations: [],
                },
            };

            const priority = determineFeedbackPriority(feedback);
            expect(priority).toBe('high');
        });

        test('should prioritize feature requests as low', () => {
            const feedback: ProcessedFeedbackData = {
                id: 'test-feature-request',
                type: 'screenshot',
                submittedAt: new Date(),
                appVersion: '1.0.0',
                buildNumber: '123',
                deviceInfo: {
                    family: 'iPhone',
                    model: 'iPhone 14 Pro',
                    osVersion: '17.0',
                    locale: 'en_US',
                },
                bundleId: 'com.example.test',
                screenshotData: {
                    text: 'Would be nice to add a feature for better navigation',
                    images: [],
                    annotations: [],
                },
            };

            const priority = determineFeedbackPriority(feedback);
            expect(priority).toBe('low');
        });

        test('should default to normal priority', () => {
            const feedback: ProcessedFeedbackData = {
                id: 'test-normal-feedback',
                type: 'screenshot',
                submittedAt: new Date(),
                appVersion: '1.0.0',
                buildNumber: '123',
                deviceInfo: {
                    family: 'iPhone',
                    model: 'iPhone 14 Pro',
                    osVersion: '17.0',
                    locale: 'en_US',
                },
                bundleId: 'com.example.test',
                screenshotData: {
                    text: 'Some general feedback about the app',
                    images: [],
                    annotations: [],
                },
            };

            const priority = determineFeedbackPriority(feedback);
            expect(priority).toBe('normal');
        });
    });

    describe('generateFeedbackLabels', () => {
        test('should generate correct labels for crash feedback', () => {
            const feedback: ProcessedFeedbackData = {
                id: 'test-crash',
                type: 'crash',
                submittedAt: new Date(),
                appVersion: '1.2.3',
                buildNumber: '123',
                deviceInfo: {
                    family: 'iPhone',
                    model: 'iPhone 14 Pro',
                    osVersion: '17.0',
                    locale: 'en_US',
                },
                bundleId: 'com.example.test',
                crashData: {
                    trace: 'Memory exception stack trace',
                    type: 'Exception',
                    exceptionType: 'MemoryException',
                    exceptionMessage: 'Memory error occurred',
                    logs: [],
                },
            };

            const labels = generateFeedbackLabels(feedback);
            expect(labels).toContain('testflight');
            expect(labels).toContain('bug');
            expect(labels).toContain('crash');
            expect(labels).toContain('memory-issue');
            expect(labels).toContain('ios');
            expect(labels).toContain('iphone');
            expect(labels).toContain('ios-17');
            expect(labels).toContain('v1');
        });

        test('should generate correct labels for screenshot feedback', () => {
            const feedback: ProcessedFeedbackData = {
                id: 'test-screenshot',
                type: 'screenshot',
                submittedAt: new Date(),
                appVersion: '2.1.0',
                buildNumber: '456',
                deviceInfo: {
                    family: 'iPad',
                    model: 'iPad Pro',
                    osVersion: '16.5',
                    locale: 'en_US',
                },
                bundleId: 'com.example.test',
                screenshotData: {
                    text: 'The UI design could be improved for better accessibility',
                    images: [],
                    annotations: [],
                },
            };

            const labels = generateFeedbackLabels(feedback);
            expect(labels).toContain('testflight');
            expect(labels).toContain('user-feedback');
            expect(labels).toContain('ui-ux');
            expect(labels).toContain('enhancement');
            expect(labels).toContain('accessibility');
            expect(labels).toContain('ios');
            expect(labels).toContain('ipad');
            expect(labels).toContain('ios-16');
            expect(labels).toContain('v2');
        });

        test('should remove duplicate labels', () => {
            const feedback: ProcessedFeedbackData = {
                id: 'test-duplicate-labels',
                type: 'screenshot',
                submittedAt: new Date(),
                appVersion: '1.0.0',
                buildNumber: '123',
                deviceInfo: {
                    family: 'iPhone',
                    model: 'iPhone 14 Pro',
                    osVersion: '17.0',
                    locale: 'en_US',
                },
                bundleId: 'com.example.test',
                screenshotData: {
                    text: 'This is a bug with the UI and design causing performance issues',
                    images: [],
                    annotations: [],
                },
            };

            const labels = generateFeedbackLabels(feedback);
            const uniqueLabels = Array.from(new Set(labels));
            expect(labels).toEqual(uniqueLabels);
        });
    });

    describe('formatFeedbackForGitHub', () => {
        test('should format crash feedback correctly', () => {
            const feedback: ProcessedFeedbackData = {
                id: 'test-crash-format',
                type: 'crash',
                submittedAt: new Date('2023-01-01T12:00:00Z'),
                appVersion: '1.0.0',
                buildNumber: '123',
                deviceInfo: {
                    family: 'iPhone',
                    model: 'iPhone 14 Pro',
                    osVersion: '17.0',
                    locale: 'en_US',
                },
                bundleId: 'com.example.test',
                crashData: {
                    trace: 'Test stack trace\nat line 42',
                    type: 'Exception',
                    exceptionType: 'TestException',
                    exceptionMessage: 'Test error message',
                    logs: [],
                },
            };

            const result = formatFeedbackForGitHub(feedback);

            expect(result.title).toContain('💥 Crash Report');
            expect(result.title).toContain('1.0.0');
            expect(result.title).toContain('TestException');

            expect(result.body).toContain('TestFlight ID');
            expect(result.body).toContain('test-crash-format');
            expect(result.body).toContain('iPhone 14 Pro');
            expect(result.body).toContain('Stack Trace');
            expect(result.body).toContain('Test stack trace');
            expect(result.body).toContain('Priority: high');
        });

        test('should format screenshot feedback correctly', () => {
            const feedback: ProcessedFeedbackData = {
                id: 'test-screenshot-format',
                type: 'screenshot',
                submittedAt: new Date('2023-01-01T12:00:00Z'),
                appVersion: '1.0.0',
                buildNumber: '123',
                deviceInfo: {
                    family: 'iPhone',
                    model: 'iPhone 14 Pro',
                    osVersion: '17.0',
                    locale: 'en_US',
                },
                bundleId: 'com.example.test',
                screenshotData: {
                    text: 'This is user feedback about the app functionality',
                    images: [
                        {
                            url: 'https://example.com/image1.png',
                            fileName: 'screenshot1.png',
                            fileSize: 1024,
                            expiresAt: new Date('2023-01-02T12:00:00Z'),
                        }
                    ],
                    annotations: [],
                },
            };

            const result = formatFeedbackForGitHub(feedback);

            expect(result.title).toContain('📱 User Feedback');
            expect(result.title).toContain('1.0.0');
            expect(result.title).toContain('This is user feedback about the app');

            expect(result.body).toContain('TestFlight ID');
            expect(result.body).toContain('test-screenshot-format');
            expect(result.body).toContain('User Feedback');
            expect(result.body).toContain('This is user feedback about the app functionality');
            expect(result.body).toContain('Screenshots (1)');
            expect(result.body).toContain('Priority: normal');
        });
    });

    describe('getPriorityLabels', () => {
        test('should return correct labels for urgent priority', () => {
            const labels = getPriorityLabels('urgent');
            expect(labels).toContain('priority: urgent');
            expect(labels).toContain('urgent');
        });

        test('should return correct labels for high priority', () => {
            const labels = getPriorityLabels('high');
            expect(labels).toContain('priority: high');
            expect(labels).toContain('high priority');
        });

        test('should return correct labels for normal priority', () => {
            const labels = getPriorityLabels('normal');
            expect(labels).toContain('priority: normal');
        });

        test('should return correct labels for low priority', () => {
            const labels = getPriorityLabels('low');
            expect(labels).toContain('priority: low');
            expect(labels).toContain('low priority');
        });
    });
}); 