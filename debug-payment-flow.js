#!/usr/bin/env node

/**
 * Debug script: Trace payment flow and show actual error messages
 */

const API_BASE_URL = 'http://localhost:4000';

async function debugPaymentFlow() {
  console.log('🔍 Debugging Payment Flow\n');

  // Test with various phone numbers to identify validation issues
  const testCases = [
    {
      name: 'Valid week bundle',
      payload: {
        externalId: 'test-user-001',
        bundle: 'week',
        amount: 2000,
        phone: '0712345678',
        email: 'test@eamax.app',
        name: 'Test User',
      },
    },
    {
      name: 'Invalid phone (too short)',
      payload: {
        externalId: 'test-user-002',
        bundle: 'month',
        amount: 5000,
        phone: '071234',
        email: 'test@eamax.app',
        name: 'Test User',
      },
    },
    {
      name: 'Invalid bundle',
      payload: {
        externalId: 'test-user-003',
        bundle: 'invalid',
        amount: 5000,
        phone: '0712345678',
        email: 'test@eamax.app',
        name: 'Test User',
      },
    },
    {
      name: 'Missing phone',
      payload: {
        externalId: 'test-user-004',
        bundle: 'month',
        amount: 5000,
        email: 'test@eamax.app',
        name: 'Test User',
      },
    },
  ];

  for (const testCase of testCases) {
    console.log(`Testing: ${testCase.name}`);
    try {
      const response = await fetch(`${API_BASE_URL}/api/payments/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testCase.payload),
      });

      const data = await response.json();

      if (!response.ok) {
        console.log(`  ❌ Error (${response.status}): ${data.error}`);
        if (data.details) {
          console.log(`     Details: ${data.details}`);
        }
      } else {
        console.log(`  ✅ Success: Order ${data.orderId}`);
      }
    } catch (error) {
      console.log(`  ❌ Network error: ${error.message}`);
    }
    console.log('');
  }
}

debugPaymentFlow();
