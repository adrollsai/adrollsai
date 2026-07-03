const newToken = "EAAMaVhrzxNABRwnqxEEIEOu19bVbqkvpRh4qqvQyEDPVSOfK78FBCrRwMNwZAr1klZB2aPQOZAfqv7cClBmn86uZACf4nAoJEoYVjSNo7U5cNbCCwow5qahJyBZAMxxbzB5xdgZCI0SqBZAywidLaltydfoZAhZAsxYZCu8xulb7zhFZCREppGnqABAYa0fVA8FBNdpWUmvuZCRD6N5nBSTUUggQRsTepSqmMnWIrajyf1iGZBiFRBITIKUvLbhooGzUOvDCN1uceaTtLgpsJ68BhpZBmhaVH68AtU6FJuNK7M";
const wabaId = "1777393797025557";

async function run() {
    console.log("Fetching templates for WABA:", wabaId);
    const metaUrl = `https://graph.facebook.com/v20.0/${wabaId}/message_templates`;
    
    try {
        const res = await fetch(metaUrl, {
            headers: {
                'Authorization': `Bearer ${newToken}`
            }
        });
        const data = await res.json();
        console.log("Status Code:", res.status);
        if (res.status === 200) {
            console.log("Templates List:");
            console.log(data.data.map(t => `- Name: "${t.name}" (Status: ${t.status}, Lang: ${t.language})`).join('\n'));
        } else {
            console.error("Meta WABA Templates error:", data.error);
        }
    } catch (err) {
        console.error("Fetch failed:", err);
    }
}

run().catch(console.error);
