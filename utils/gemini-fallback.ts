import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Executes a Gemini content generation call with robust retry (exponential backoff)
 * and graceful fallback to gemini-1.5-flash if the primary model (e.g., gemini-3-flash-preview)
 * is overloaded, rate-limited, or unavailable.
 */
export async function generateContentWithFallback(
    genAI: GoogleGenerativeAI,
    contents: any,
    primaryModel = "gemini-3.5-flash",
    fallbackModel: string | null = "gemini-3.5-flash",
    maxRetries = 4,
    initialDelay = 2000,
    generationConfig?: any
) {
    let currentModelName = primaryModel;
    let delay = initialDelay;
    
    // We keep track of attempts. If we switch models, we can reset attempts for the fallback model.
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[Gemini Helper] Attempt ${attempt}/${maxRetries} using model: ${currentModelName}`);
            const model = genAI.getGenerativeModel({ 
                model: currentModelName,
                generationConfig: generationConfig
            });
            
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
            const isNotFoundOrInvalid = status === 404 || status === 400 || message.includes("not found") || message.includes("404") || message.includes("invalid model");
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

            // If model is not found/invalid or retries exhausted, switch to fallback model if available
            if (isNotFoundOrInvalid || !isTransient || attempt === maxRetries) {
                if (currentModelName !== fallbackModel && fallbackModel) {
                    console.warn(`[Gemini Helper] Switching from model ${currentModelName} to fallback model ${fallbackModel} due to error.`);
                    currentModelName = fallbackModel;
                    attempt = 0; // Reset attempt for fallback model
                    delay = initialDelay;
                    await new Promise((resolve) => setTimeout(resolve, 500));
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
