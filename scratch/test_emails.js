import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function run() {
    console.log("SMTP HOST:", process.env.SMTP_HOST); // Should be smtp.gmail.com
    
    // Dynamically import to ensure dotenv is loaded first!
    const { sendContactFormEmail, sendLandingPageLeadEmail } = await import('../utils/email-helper');
    
    console.log("Testing contact form email to adrollsai@gmail.com and rchopra489@gmail.com...");
    try {
        const result = await sendContactFormEmail(
            "Test Lead Adrolls",
            "testlead@example.com",
            "+919999999999",
            "This is a test contact query query for AdRolls AI platform."
        );
        console.log("Contact form email result:", result);
    } catch (e) {
        console.error("Failed to send contact form email:", e);
    }

    console.log("\nTesting landing page lead email...");
    try {
        const result = await sendLandingPageLeadEmail(
            ["aparna.proestate@gmail.com", "rchopra489@gmail.com"],
            {
                name: "Aparna Dev",
                email: "aparnadev@example.com",
                phone: "+918888888888",
                city: "Chandigarh",
                source: "Landing Page - the-pro-estate",
                customQuestions: {
                    custom_question_0: "12-14 Crores",
                    custom_question_1: "Immediate purchase",
                    city: "Chandigarh" // Should be filtered out in lists
                }
            }
        );
        console.log("Landing page lead email result:", result);
    } catch (e) {
        console.error("Failed to send landing page lead email:", e);
    }
}

run();
