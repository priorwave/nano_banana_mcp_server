import { ApiError, GoogleGenAI } from "@google/genai";
import sharp from "sharp";

const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image-preview";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 500;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

let cachedClient: GoogleGenAI | undefined;
let cachedApiKey: string | undefined;

function getConfiguredApiKey(): string {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY (or GOOGLE_API_KEY) environment variable is required for image generation.");
    }
    return apiKey;
}

function getModelName(): string {
    const configuredModel = process.env.GEMINI_IMAGE_MODEL?.trim();
    return configuredModel ? configuredModel : DEFAULT_IMAGE_MODEL;
}

function getClient(): GoogleGenAI {
    const apiKey = getConfiguredApiKey();

    if (!cachedClient || cachedApiKey !== apiKey) {
        cachedClient = new GoogleGenAI({ apiKey });
        cachedApiKey = apiKey;
    }

    return cachedClient;
}

function isRetryableGeminiError(error: unknown): boolean {
    if (error instanceof ApiError) {
        return RETRYABLE_STATUS_CODES.has(error.status);
    }

    const maybeError = error as { status?: number; message?: string };
    if (typeof maybeError?.status === "number" && RETRYABLE_STATUS_CODES.has(maybeError.status)) {
        return true;
    }

    const message = (maybeError?.message ?? "").toLowerCase();
    return (
        message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("etimedout") ||
        message.includes("econnreset") ||
        message.includes("temporar")
    );
}

function toUserFacingGeminiError(error: unknown): Error {
    if (error instanceof ApiError) {
        if (error.status === 401 || error.status === 403) {
            return new Error("Gemini API authentication failed. Check GEMINI_API_KEY/GOOGLE_API_KEY and permissions.");
        }

        if (error.status === 429) {
            return new Error("Gemini API rate limit reached. Please retry in a moment.");
        }

        if (error.status >= 500) {
            return new Error("Gemini API is temporarily unavailable. Please retry shortly.");
        }

        return new Error(`Gemini API request failed (status ${error.status}): ${error.message}`);
    }

    if (error instanceof Error) {
        return new Error(`Failed to generate image: ${error.message}`);
    }

    return new Error("Failed to generate image due to an unknown error.");
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates an image using the Gemini API.
 * @param prompt The prompt to generate an image for.
 * @returns A base64 encoded JPEG image.
 */
export async function generateImage(prompt: string): Promise<{ data: string; mimeType: string; text?: string; model: string }> {
    const client = getClient();
    const model = getModelName();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await client.models.generateContent({
                model,
                contents: prompt,
                config: {
                    responseModalities: ["TEXT", "IMAGE"],
                    httpOptions: {
                        timeout: REQUEST_TIMEOUT_MS,
                    },
                },
            });

            const candidate = response.candidates?.[0];
            const parts = candidate?.content?.parts;
            if (!parts || parts.length === 0) {
                throw new Error("No content parts returned from Gemini API.");
            }

            let imageData: string | undefined;
            let text: string | undefined;

            for (const part of parts) {
                if (part.inlineData?.data) {
                    imageData = part.inlineData.data;
                } else if (part.text) {
                    text = text ? `${text}\n${part.text}` : part.text;
                }
            }

            if (!imageData) {
                throw new Error("No image data found in the response.");
            }

            const jpgBuffer = await sharp(Buffer.from(imageData, "base64"))
                .jpeg({ quality: 85 })
                .toBuffer();

            return {
                data: jpgBuffer.toString("base64"),
                mimeType: "image/jpeg",
                model,
                ...(text ? { text } : {}),
            };
        } catch (error) {
            const shouldRetry = isRetryableGeminiError(error) && attempt < MAX_RETRIES;
            if (shouldRetry) {
                const backoffMs = RETRY_BACKOFF_MS * 2 ** attempt;
                await sleep(backoffMs);
                continue;
            }

            throw toUserFacingGeminiError(error);
        }
    }

    throw new Error("Failed to generate image after retry attempts.");
}

export const __test__ = {
    getConfiguredApiKey,
    getModelName,
    isRetryableGeminiError,
    toUserFacingGeminiError,
};
