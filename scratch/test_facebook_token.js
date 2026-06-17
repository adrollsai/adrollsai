const accessToken = "EAAMaVhrzxNABRnavMsRxgJ0L7HAZA8S2MxQqWOj8BYbaqQ0GaH4OYYsQ9ZAD8tIKKG73vqJ9ro836M4BHXlk95s0tYECwYB93xhH5ZAUFlJRBIELsMSRLAUDCCZA0BUGY3gZCfEgGhbkEy6rL84ZCU2CaYKgZApzZBIoJAZAn82fS4hoiRw2hwIrUpHupohKHIM0xZCJyA5pxtEI2wgNgZCaZCNzTKPaZBIhZCSILcawmDrxmRzZAzgWz8T2EXE2D2lfCSNuX05iAUB6JQwL28p8c7XOYBSQbDr9UvQGoHVUZCsP";
const wabaId = "832768439522548";

async function testPhoneNumbers() {
    console.log(`Querying phone numbers for WABA: ${wabaId}...`);
    try {
        const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/phone_numbers?access_token=${accessToken}`);
        const data = await res.json();
        console.log("Phone Numbers Result:", JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(err);
    }
}

testPhoneNumbers();
