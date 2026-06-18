#!/usr/bin/env node

/**
 * Diagnostic script to test payment provider API
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'super-secret-admin-key';

async function diagnosePaymentProvider() {
  console.log('🔍 PAYMENT PROVIDER API DIAGNOSTIC\n');
  console.log(`📍 API Base: ${API_BASE_URL}`);
  console.log(`🔑 API Key: ${ADMIN_API_KEY}\n`);
  
  // Test 1: Check authentication
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 1: Authentication Check');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    const authTest = await fetch(`${API_BASE_URL}/api/admin/dashboard`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': ADMIN_API_KEY,
      },
    });
    
    console.log(`Status: ${authTest.status}`);
    console.log(`OK: ${authTest.ok ? '✅ YES' : '❌ NO'}`);
    
    if (!authTest.ok) {
      const text = await authTest.text();
      console.log(`Response: ${text.substring(0, 200)}`);
    } else {
      const data = await authTest.json();
      console.log(`Response contains: ${Object.keys(data).join(', ')}`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
  
  // Test 2: GET payment provider
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 2: GET /api/admin/settings/payment-provider');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    const getRes = await fetch(`${API_BASE_URL}/api/admin/settings/payment-provider`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': ADMIN_API_KEY,
      },
    });
    
    console.log(`Status: ${getRes.status}`);
    const text = await getRes.text();
    console.log(`Response: ${text}`);
    
    if (getRes.ok) {
      const data = JSON.parse(text);
      console.log(`✅ Current provider: ${data.paymentProvider}`);
    } else {
      console.log(`❌ Failed to get provider`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
  
  // Test 3: PUT payment provider (aurax)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 3: PUT /api/admin/settings/payment-provider (aurax)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    const putRes = await fetch(`${API_BASE_URL}/api/admin/settings/payment-provider`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': ADMIN_API_KEY,
      },
      body: JSON.stringify({ paymentProvider: 'aurax' }),
    });
    
    console.log(`Status: ${putRes.status}`);
    const text = await putRes.text();
    console.log(`Response: ${text}`);
    
    if (putRes.ok) {
      const data = JSON.parse(text);
      console.log(`✅ Updated to: ${data.paymentProvider}`);
    } else {
      console.log(`❌ Failed to update`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
  
  // Test 4: PUT payment provider (sonicpesa)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 4: PUT /api/admin/settings/payment-provider (sonicpesa)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    const putRes = await fetch(`${API_BASE_URL}/api/admin/settings/payment-provider`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': ADMIN_API_KEY,
      },
      body: JSON.stringify({ paymentProvider: 'sonicpesa' }),
    });
    
    console.log(`Status: ${putRes.status}`);
    const text = await putRes.text();
    console.log(`Response: ${text}`);
    
    if (putRes.ok) {
      const data = JSON.parse(text);
      console.log(`✅ Updated to: ${data.paymentProvider}`);
    } else {
      console.log(`❌ Failed to update`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
  
  // Test 5: Verify final state
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 5: Verify Final State');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    const finalRes = await fetch(`${API_BASE_URL}/api/admin/settings/payment-provider`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': ADMIN_API_KEY,
      },
    });
    
    console.log(`Status: ${finalRes.status}`);
    const text = await finalRes.text();
    console.log(`Response: ${text}`);
    
    if (finalRes.ok) {
      const data = JSON.parse(text);
      console.log(`✅ Final provider: ${data.paymentProvider}`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Diagnostic complete!\n');
}

diagnosePaymentProvider().catch(console.error);
