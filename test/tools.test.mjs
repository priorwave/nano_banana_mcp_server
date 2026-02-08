import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const toolsModule = await import("../dist/tools.js");
const { __test__, generateImageTool } = toolsModule;

test("resolveOutputFilePath creates generated .jpg path when save_path is a directory", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "nano-banana-tools-"));

    try {
        const outputPath = await __test__.resolveOutputFilePath(tempDir);
        assert.equal(path.dirname(outputPath), tempDir);
        assert.match(path.basename(outputPath), /^generated-.*\.jpg$/);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test("resolveOutputFilePath accepts .jpg/.jpeg file paths and rejects other extensions", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "nano-banana-tools-"));

    try {
        const jpgPath = path.join(tempDir, "image.JPG");
        const jpegPath = path.join(tempDir, "image.jpeg");
        const pngPath = path.join(tempDir, "image.png");

        assert.equal(await __test__.resolveOutputFilePath(jpgPath), jpgPath);
        assert.equal(await __test__.resolveOutputFilePath(jpegPath), jpegPath);

        await assert.rejects(
            () => __test__.resolveOutputFilePath(pngPath),
            /must use a \.jpg or \.jpeg extension/
        );
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test("saveImage writes non-empty image bytes to disk", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "nano-banana-tools-"));

    try {
        const bytes = Buffer.from("synthetic-image-bytes");
        const data = bytes.toString("base64");
        const savePath = path.join(tempDir, "output.jpg");
        const saveResult = await __test__.saveImage(data, savePath);
        const filePath = saveResult.filePath;

        const fileStats = await stat(filePath);
        const fileContents = await readFile(filePath);

        assert.equal(filePath, savePath);
        assert.equal(saveResult.warning, undefined);
        assert.ok(fileStats.size > 0);
        assert.equal(Buffer.compare(fileContents, bytes), 0);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test("input schema enforces prompt and allows optional/relative save_path", () => {
    const blankPrompt = __test__.generateImageInputSchema.safeParse({
        prompt: "   ",
        save_path: "./output.jpg",
    });
    assert.equal(blankPrompt.success, false);

    const relativePath = __test__.generateImageInputSchema.safeParse({
        prompt: "draw a cat",
        save_path: "relative/output.jpg",
    });
    assert.equal(relativePath.success, true);

    const noPath = __test__.generateImageInputSchema.safeParse({
        prompt: "draw a cat",
    });
    assert.equal(noPath.success, true);
});

test("saveImage falls back to IMAGE_OUTPUT_DIR when requested save_path cannot be used", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "nano-banana-tools-"));
    const previousOutputDir = process.env.IMAGE_OUTPUT_DIR;

    try {
        const fallbackDir = path.join(tempDir, "fallback");
        process.env.IMAGE_OUTPUT_DIR = fallbackDir;

        const blockedParent = path.join(tempDir, "blocked");
        await writeFile(blockedParent, "not-a-directory");

        const bytes = Buffer.from("synthetic-image-bytes");
        const data = bytes.toString("base64");
        const invalidSavePath = path.join(blockedParent, "output.jpg");
        const saveResult = await __test__.saveImage(data, invalidSavePath);

        assert.notEqual(saveResult.filePath, invalidSavePath);
        assert.equal(path.dirname(saveResult.filePath), fallbackDir);
        assert.match(saveResult.warning ?? "", /Requested save_path/);

        const savedBytes = await readFile(saveResult.filePath);
        assert.equal(Buffer.compare(savedBytes, bytes), 0);
    } finally {
        if (previousOutputDir === undefined) {
            delete process.env.IMAGE_OUTPUT_DIR;
        } else {
            process.env.IMAGE_OUTPUT_DIR = previousOutputDir;
        }

        await rm(tempDir, { recursive: true, force: true });
    }
});

test("tool handler returns MCP error payload when generation fails", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const response = await generateImageTool.handler({
        prompt: "draw a cat",
    });

    assert.equal(response.isError, true);
    assert.equal(response.content[0].type, "text");
    assert.match(response.content[0].text, /Error generating image:/);
});
