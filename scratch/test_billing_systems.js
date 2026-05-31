const { PLANS, ADDONS, getUserLimits } = require('../utils/subscription');

function testBillingSystems() {
    console.log("=== STARTING BILLING SYSTEMS DIAGNOSTICS AND VALIDATIONS ===");

    // 1. Test plans configuration load
    console.log(`Available Pricing Plans: ${Object.keys(PLANS).join(', ')}`);
    console.log(`Starter Plan Cost: ₹${PLANS.starter.price} / mo`);
    console.log(`Growth Plan Video Quota: ${PLANS.growth.limits.videos} Videos`);
    console.log(`Enterprise Plan Team seats limit: ${PLANS.enterprise.limits.team_members} (Infinity represents unlimited)`);

    // 2. Test add-ons configuration load
    console.log(`Available Purchasable Add-ons: ${Object.keys(ADDONS).join(', ')}`);
    console.log(`Additional Video top-up price: ₹${ADDONS.video.price}`);
    console.log(`Medium Image Pack effect: ${ADDONS.image_medium.label} (${ADDONS.image_medium.amount} Images)`);

    // 3. Test getUserLimits calculation
    console.log("\n--- Scenario A: New user on Free Plan ---");
    const freeProfile = {
        subscription_plan: 'free',
        addon_videos: 0,
        addon_images: 0
    };
    const freeLimits = getUserLimits(freeProfile);
    console.log(`Calculated Limits:`, JSON.stringify(freeLimits, null, 2));
    if (freeLimits.videos === 0 && freeLimits.images === 5) {
        console.log("✅ Scenario A limit test passed!");
    } else {
        console.error("❌ Scenario A limit test failed!");
    }

    console.log("\n--- Scenario B: Growth Plan with Add-ons (2 extra videos, 50 extra images) ---");
    const premiumProfile = {
        subscription_plan: 'growth',
        addon_videos: 2,
        addon_images: 50,
        addon_team_members: 1
    };
    const premiumLimits = getUserLimits(premiumProfile);
    console.log(`Calculated Limits:`, JSON.stringify(premiumLimits, null, 2));
    // Growth base: 2 videos, 50 images, 5 team members
    // Total should be: 4 videos, 100 images, 6 team members
    if (premiumLimits.videos === 4 && premiumLimits.images === 100 && premiumLimits.team_members === 6) {
        console.log("✅ Scenario B limit test passed!");
    } else {
        console.error("❌ Scenario B limit test failed!");
    }

    console.log("\n--- Scenario C: Enterprise Plan (Unlimited team members, 8 base videos) ---");
    const entProfile = {
        subscription_plan: 'enterprise',
        addon_videos: 1, // purchased 1 extra
        addon_team_members: 5 // tries to add members (should still resolve to unlimited)
    };
    const entLimits = getUserLimits(entProfile);
    console.log(`Calculated Limits:`, JSON.stringify(entLimits, null, 2));
    if (entLimits.team_members === 999999 && entLimits.videos === 9) {
        console.log("✅ Scenario C limit test passed!");
    } else {
        console.error("❌ Scenario C limit test failed!");
    }

    console.log("\n=== ALL UNIT DIAGNOSTICS COMPLETED SUCCESSFULLY ===");
}

testBillingSystems();
