import { z } from "zod";
import { writeFile, mkdir, stat } from "fs/promises";
import path from "path";
import { homedir, tmpdir } from "os";
import { generateImage } from "./gemini.js";

const generateImageInputSchema = z.object({
    prompt: z
        .string()
        .trim()
        .min(1, "prompt is required")
        .max(4000, "prompt must be 4000 characters or fewer")
        .describe("Descriptive text prompt for generating the image"),
    save_path: z
        .string()
        .trim()
        .min(1, "save_path cannot be empty")
        .refine((value) => !value.includes("\0"), {
            message: "save_path cannot contain null bytes",
        })
        .optional()
        .describe(
            "Optional path to save the JPEG image. Supports absolute or relative paths. " +
            "If omitted, the server saves to IMAGE_OUTPUT_DIR or a default local output directory."
        ),
}).strict();

const generateImageOutputSchema = z.object({
    file_path: z.string().describe("Absolute path where the generated image was saved"),
    mime_type: z.literal("image/jpeg").describe("MIME type for generated image bytes"),
    model: z.string().describe("Gemini model used for generation"),
    text: z.string().optional().describe("Optional text response from the model"),
});

const JPEG_EXTENSIONS = new Set([".jpg", ".jpeg"]);

function buildGeneratedFileName(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const randomId = Math.random().toString(36).substring(2, 8);
    return `generated-${timestamp}-${randomId}.jpg`;
}

function expandUserPath(inputPath: string): string {
    if (inputPath === "~") {
        return homedir();
    }

    if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
        return path.join(homedir(), inputPath.slice(2));
    }

    return inputPath;
}

function normalizePathInput(inputPath: string): string {
    const expanded = expandUserPath(inputPath);
    return path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
}

function getDefaultOutputDirectories(): string[] {
    const configured = process.env.IMAGE_OUTPUT_DIR?.trim();

    const candidates = [
        configured ? normalizePathInput(configured) : null,
        path.join(homedir(), "nano-banana-images"),
        path.join(tmpdir(), "nano-banana-images"),
    ].filter((value): value is string => Boolean(value));

    return Array.from(new Set(candidates));
}

async function resolveOutputFilePath(savePath?: string, defaultDir?: string): Promise<string> {
    const targetPath = savePath ? normalizePathInput(savePath) : (defaultDir ?? getDefaultOutputDirectories()[0]);
    const ext = path.extname(targetPath);

    if (!ext) {
        await mkdir(targetPath, { recursive: true });
        return path.join(targetPath, buildGeneratedFileName());
    }

    const normalizedExt = ext.toLowerCase();
    if (!JPEG_EXTENSIONS.has(normalizedExt)) {
        throw new Error(
            `save_path must use a .jpg or .jpeg extension because this tool outputs JPEG data, got: ${ext}`
        );
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    return targetPath;
}

type SaveImageResult = {
    filePath: string;
    warning?: string;
};

async function saveImage(data: string, savePath?: string): Promise<SaveImageResult> {
    const buffer = Buffer.from(data, "base64");
    if (buffer.length === 0) {
        throw new Error("Image data is empty, nothing to save.");
    }

    const defaultDirectories = getDefaultOutputDirectories();
    const attempts: Array<{ savePath?: string; defaultDir?: string; label: string }> = [];

    if (savePath) {
        attempts.push({
            savePath,
            label: `requested save_path '${savePath}'`,
        });
    }

    const fallbackLabels =
        savePath && defaultDirectories.length > 0
            ? defaultDirectories.map((dir) => `fallback directory '${dir}'`)
            : [`default directory '${defaultDirectories[0]}'`];

    defaultDirectories.forEach((dir, index) => {
        attempts.push({
            defaultDir: dir,
            label: fallbackLabels[index] ?? `fallback directory '${dir}'`,
        });
    });

    let firstFailureMessage: string | undefined;
    let lastError: unknown;

    for (const attempt of attempts) {
        try {
            const filePath = await resolveOutputFilePath(attempt.savePath, attempt.defaultDir);
            await writeFile(filePath, buffer);

            const fileStat = await stat(filePath);
            if (fileStat.size === 0) {
                throw new Error(`File was written but is empty: ${filePath}`);
            }

            if (attempt.savePath) {
                return { filePath };
            }

            if (savePath && firstFailureMessage) {
                return {
                    filePath,
                    warning: `Requested save_path '${savePath}' failed (${firstFailureMessage}). Saved to fallback path instead.`,
                };
            }

            return { filePath };
        } catch (error: unknown) {
            if (
                attempt.savePath &&
                error instanceof Error &&
                error.message.includes("must use a .jpg or .jpeg extension")
            ) {
                throw error;
            }

            const message = error instanceof Error ? error.message : String(error);
            if (!firstFailureMessage) {
                firstFailureMessage = `${attempt.label}: ${message}`;
            }
            lastError = error;
        }
    }

    const fallbackSummary = firstFailureMessage ? ` First failure: ${firstFailureMessage}` : "";
    const lastMessage =
        lastError instanceof Error ? lastError.message : "Unknown filesystem save error.";
    throw new Error(`Failed to save generated image. ${lastMessage}.${fallbackSummary}`);
}


export const generateImageTool = {
    name: "generate_image",
    title: "Generate Image",
    description:
        "Generate an image from a text prompt using Google Gemini and save the JPEG to disk.",
    inputSchema: generateImageInputSchema,
    outputSchema: generateImageOutputSchema,
    annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
    },
    handler: async (args: z.infer<typeof generateImageInputSchema>) => {
        try {
            const result = await generateImage(args.prompt);
            const saved = await saveImage(result.data, args.save_path);

            const structuredContent: z.infer<typeof generateImageOutputSchema> = {
                file_path: saved.filePath,
                mime_type: result.mimeType as "image/jpeg",
                model: result.model,
                ...(result.text ? { text: result.text } : {}),
            };

            const statusLines = [
                ...(result.text ? [result.text] : []),
                ...(saved.warning ? [saved.warning] : []),
                `Image saved to: ${saved.filePath}`,
                `Model: ${result.model}`,
            ];

            return {
                content: [
                    {
                        type: "text" as const,
                        text: statusLines.join("\n\n"),
                    },
                    {
                        type: "image" as const,
                        data: result.data,
                        mimeType: result.mimeType,
                    },
                ],
                structuredContent,
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Error generating image: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    },
};

export const __test__ = {
    buildGeneratedFileName,
    resolveOutputFilePath,
    saveImage,
    generateImageInputSchema,
    generateImageOutputSchema,
};
