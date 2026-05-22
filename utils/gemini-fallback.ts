import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Executes a Gemini content generation call with robust retry (exponential backoff)
 * and graceful fallback to gemini-1.5-flash if the primary model (e.g., gemini-3-flash-preview)
 * is overloaded, rate-limited, or unavailable.
 */
export async function generateContentWithFallback(
    genAI: GoogleGenerativeAI,
    contents: any,
    primaryModel = "gemini-3-flash-preview",
    fallbackModel = "gemini-1.5-flash",
    maxRetries = 4,
    initialDelay = 2000
) {
    let currentModelName = primaryModel;
    let delay = initialDelay;
    
    // We keep track of attempts. If we switch models, we can reset attempts for the fallback model.
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[Gemini Helper] Attempt ${attempt}/${maxRetries} using model: ${currentModelName}`);
            const model = genAI.getGenerativeModel({ model: currentModelName });
            
            let result;
            if (typeof contents === "string") {
                result = await model.generateContent(contents);
            } else if (Array.isArray(contents)) {
                result = await model.generateContent(contents);
            } else {
                result = await model.generateContent(contents);
            }
            
            // Try to access result text to make sure it succeeded
            const responseText = result.response.text();
            if (!responseText) {
                throw new Error("Empty response from Gemini model");
            }
            
            console.log(`[Gemini Helper] Success with model: ${currentModelName}`);
            return result;
        } catch (error: any) {
            console.error(`[Gemini Helper] Attempt ${attempt} failed for model ${currentModelName}:`, error);

            const status = error.status || error.statusCode;
            const message = error.message || "";
            const isTransient = 
                status === 503 || 
                status === 429 || 
                message.includes("503") || 
                message.includes("429") || 
                message.includes("Service Unavailable") || 
                message.includes("limit") || 
                message.includes("overloaded") || 
                message.includes("demand") ||
                message.includes("busy");

            // Check if we have exhausted retries or if it is a non-transient error
            if (!isTransient || attempt === maxRetries) {
                // If we were on the primary model, try switching to the fallback model immediately
                if (currentModelName === primaryModel && fallbackModel) {
                    console.warn(`[Gemini Helper] Switching from primary model ${primaryModel} to fallback model ${fallbackModel} due to error/exhausted retries.`);
                    currentModelName = fallbackModel;
                    attempt = 0; // Next iteration will be attempt 1
                    delay = initialDelay;
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    continue;
                }
                throw error;
            }

            // For transient errors on the primary model, we can switch to the fallback model early
            // if we have failed at least 2 times (so we don't keep hitting 503s on the overloaded preview model)
            if (currentModelName === primaryModel && attempt >= 2 && fallbackModel) {
                console.warn(`[Gemini Helper] Primary model ${primaryModel} seems overloaded. Switching early to fallback model ${fallbackModel}.`);
                currentModelName = fallbackModel;
                attempt = 0; // Reset attempts for the fallback model
                delay = initialDelay;
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
            }

            console.warn(`[Gemini Helper] Transient error detected. Retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff
        }
    }
    
    throw new Error(`Gemini content generation failed after retries and fallback`);
}
