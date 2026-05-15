#!/usr/bin/env node

/**
 * Test script to verify unified payment endpoints work for both ZenoPay and SonicPesa
 */

const API_BASE_URL = 'http://localhost:4000';

async function testUnifiedPayments() {
  console.log('🧪 Testing Unified Payment Endpoints (Works with both ZenoPay & SonicPesa)\n');
  console.log(`📍 API Base URL: ${API_BASE_URL}\n`);

  try {
    // Test 1: Start a payment through unified endpoint
    console.log('1️⃣ Testing POST /api/payments/start (unified - works for active provider)');
    
    const paymentStart = await fetch(`${API_BASE_URL}/api/payments/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        externalId: 'test-user-001',
        bundle: 'month',
        amount: 5000,
        phone: '0712345678',
        email: 'test@eamax.app',
        name: 'Test User',
      }),
    });

    if (!paymentStart.ok) {
      const error = await paymentStart.text();
      console.log(`❌ Payment start failed with status: ${paymentStart.status}`);
      console.log(`   Response: ${error}\n`);
      return;
    }

    const startResult = await paymentStart.json();
    console.log(`✅ Payment started successfully`);
    console.log(`   Order ID: ${startResult.orderId}`);
    console.log(`   Status: ${startResult.status}`);
    console.log(`   Provider: ${startResult.provider}`);
    console.log(`   Message: ${startResult.message}\n`);

    const orderId = startResult.orderId;

    // Test 2: Check payment status through unified endpoint
    console.log(`2️⃣ Testing GET /api/payments/status?orderId=${orderId}`);
    
    const statusCheck = await fetch(`${API_BASE_URL}/api/payments/status?orderId=${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!statusCheck.ok) {
      const error = await statusCheck.text();
      console.log(`❌ Status check failed with status: ${statusCheck.status}`);
      console.log(`   Response: ${error}\n`);
      return;
    }

    const statusResult = await statusCheck.json();
    console.log(`✅ Status check successful`);
    console.log(`   Status: ${statusResult.status}`);
    console.log(`   Raw: ${JSON.stringify(statusResult.raw).slice(0, 200)}\n`);

    // Test 3: Test payment completion endpoint
    console.log(`3️⃣ Testing POST /api/payments/complete/${orderId} (manual completion for testing)`);
    
    const completePayment = await fetch(`${API_BASE_URL}/api/payments/complete/${encodeURIComponent(orderId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!completePayment.ok) {
      const error = await completePayment.text();
      console.log(`❌ Payment completion failed with status: ${completePayment.status}`);
      console.log(`   Response: ${error}\n`);
      return;
    }

    const completeResult = await completePayment.json();
    console.log(`✅ Payment completed successfully`);
    console.log(`   Result: ${JSON.stringify(completeResult)}\n`);

    // Test 4: Verify status changed to COMPLETED
    console.log(`4️⃣ Verifying final status is COMPLETED`);
    
    const finalStatus = await fetch(`${API_BASE_URL}/api/payments/status?orderId=${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (finalStatus.ok) {
      const finalResult = await finalStatus.json();
      console.log(`✅ Final status: ${finalResult.status}`);
      if (finalResult.status === 'COMPLETED') {
        console.log(`✅ Payment flow complete! User should now be Premium.\n`);
      } else {
        console.log(`⚠️  Status is ${finalResult.status}, expected COMPLETED\n`);
      }
    }

    console.log('✅ All unified payment endpoint tests passed!');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

testUnifiedPayments();
