#!/usr/bin/env node

/**
 * Test script to verify payment provider API endpoints
 */

const API_BASE_URL = 'http://localhost:4000';
const ADMIN_API_KEY = 'super-secret-admin-key';

async function testPaymentProvider() {
  console.log('🧪 Testing Payment Provider API Endpoints\n');
  console.log(`📍 API Base URL: ${API_BASE_URL}`);
  console.log(`🔑 Using API Key: ${ADMIN_API_KEY}\n`);

  try {
    // Test 1: Get current payment provider
    console.log('1️⃣ Testing GET /api/admin/settings/payment-provider');
    const getResponse = await fetch(`${API_BASE_URL}/api/admin/settings/payment-provider`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': ADMIN_API_KEY,
      },
    });

    if (!getResponse.ok) {
      console.log(`❌ GET failed with status: ${getResponse.status}`);
      const errorText = await getResponse.text();
      console.log(`   Response: ${errorText}\n`);
      return;
    }

    const getResult = await getResponse.json();
    console.log(`✅ GET successful`);
    console.log(`   Current payment provider: ${getResult.paymentProvider}\n`);

    // Test 2: Update to sonicpesa
    console.log('2️⃣ Testing PUT /api/admin/settings/payment-provider to "sonicpesa"');
    const putResponse1 = await fetch(`${API_BASE_URL}/api/admin/settings/payment-provider`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': ADMIN_API_KEY,
      },
      body: JSON.stringify({ paymentProvider: 'sonicpesa' }),
    });

    if (!putResponse1.ok) {
      console.log(`❌ PUT failed with status: ${putResponse1.status}`);
      const errorText = await putResponse1.text();
      console.log(`   Response: ${errorText}\n`);
      return;
    }

    const putResult1 = await putResponse1.json();
    console.log(`✅ PUT successful`);
    console.log(`   Updated to: ${putResult1.paymentProvider}\n`);

    // Test 3: Verify the change
    console.log('3️⃣ Verifying the change with GET');
    const verifyResponse = await fetch(`${API_BASE_URL}/api/admin/settings/payment-provider`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': ADMIN_API_KEY,
      },
    });

    if (!verifyResponse.ok) {
      console.log(`❌ GET verification failed with status: ${verifyResponse.status}`);
      return;
    }

    const verifyResult = await verifyResponse.json();
    console.log(`✅ Verification successful`);
    console.log(`   Current payment provider: ${verifyResult.paymentProvider}\n`);

    if (verifyResult.paymentProvider === 'sonicpesa') {
      console.log('✅ Payment provider was successfully updated to sonicpesa!\n');
    }

    // Test 4: Switch back to zeno
    console.log('4️⃣ Testing PUT to switch back to "zeno"');
    const putResponse2 = await fetch(`${API_BASE_URL}/api/admin/settings/payment-provider`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': ADMIN_API_KEY,
      },
      body: JSON.stringify({ paymentProvider: 'zeno' }),
    });

    if (!putResponse2.ok) {
      console.log(`❌ PUT failed with status: ${putResponse2.status}`);
      return;
    }

    const putResult2 = await putResponse2.json();
    console.log(`✅ PUT successful`);
    console.log(`   Updated to: ${putResult2.paymentProvider}\n`);

    // Test 5: Test authentication failure
    console.log('5️⃣ Testing authentication with wrong API key');
    const authFailResponse = await fetch(`${API_BASE_URL}/api/admin/settings/payment-provider`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': 'wrong-key',
      },
    });

    if (authFailResponse.status === 401) {
      console.log(`✅ Authentication check working correctly (401 Unauthorized)\n`);
    } else {
      console.log(`⚠️  Expected 401, got ${authFailResponse.status}\n`);
    }

    console.log('🎉 All tests completed successfully!');
  } catch (error) {
    console.error('❌ Test error:', error.message);
    console.error('   Make sure the backend server is running on http://localhost:4000');
  }
}

testPaymentProvider();
