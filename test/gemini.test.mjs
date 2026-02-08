import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@google/genai";

function clearApiKeyEnv() {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
}

test("gemini module imports without API key", async () => {
    clearApiKeyEnv();
    const mod = await import(`../dist/gemini.js?import_no_key=${Date.now()}`);
    assert.equal(typeof mod.generateImage, "function");
});

test("generateImage returns a clear missing-key error when no API key is configured", async () => {
    clearApiKeyEnv();
    const mod = await import(`../dist/gemini.js?no_key_call=${Date.now()}`);

    await assert.rejects(
        () => mod.generateImage("a red apple on a table"),
        /GEMINI_API_KEY \(or GOOGLE_API_KEY\) environment variable is required/
    );
});

test("retry classifier treats transient API errors as retryable", async () => {
    const mod = await import(`../dist/gemini.js?retry_check=${Date.now()}`);
    const retryableError = new ApiError({ status: 503, message: "backend unavailable" });
    const nonRetryableError = new ApiError({ status: 400, message: "bad request" });

    assert.equal(mod.__test__.isRetryableGeminiError(retryableError), true);
    assert.equal(mod.__test__.isRetryableGeminiError(nonRetryableError), false);
});

test("user-facing error mapping returns actionable rate-limit message", async () => {
    const mod = await import(`../dist/gemini.js?error_map=${Date.now()}`);
    const rateLimitError = new ApiError({ status: 429, message: "quota exceeded" });

    const mapped = mod.__test__.toUserFacingGeminiError(rateLimitError);
    assert.match(mapped.message, /rate limit/i);
});
