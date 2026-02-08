import { z } from "zod";
import { writeFile, mkdir, stat } from "fs/promises";
import path from "path";
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
        .min(1, "save_path is required")
        .refine((value) => !value.includes("\0"), {
            message: "save_path cannot contain null bytes",
        })
        .refine((value) => path.isAbsolute(value), {
            message: "save_path must be an absolute path",
        })
        .describe(
            "Absolute path to save the JPEG image. Can be a directory (e.g. /Users/me/images) " +
            "or a full file path ending in .jpg/.jpeg (e.g. /Users/me/images/photo.jpg)"
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

async function resolveOutputFilePath(savePath: string): Promise<string> {
    if (!path.isAbsolute(savePath)) {
        throw new Error(`save_path must be an absolute path, got: ${savePath}`);
    }

    const ext = path.extname(savePath);
    if (!ext) {
        await mkdir(savePath, { recursive: true });
        return path.join(savePath, buildGeneratedFileName());
    }

    const normalizedExt = ext.toLowerCase();
    if (!JPEG_EXTENSIONS.has(normalizedExt)) {
        throw new Error(
            `save_path must use a .jpg or .jpeg extension because this tool outputs JPEG data, got: ${ext}`
        );
    }

    await mkdir(path.dirname(savePath), { recursive: true });
    return savePath;
}

async function saveImage(data: string, savePath: string): Promise<string> {
    const filePath = await resolveOutputFilePath(savePath);

    const buffer = Buffer.from(data, "base64");
    if (buffer.length === 0) {
        throw new Error("Image data is empty, nothing to save.");
    }

    await writeFile(filePath, buffer);

    const fileStat = await stat(filePath);
    if (fileStat.size === 0) {
        throw new Error(`File was written but is empty: ${filePath}`);
    }

    return filePath;
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
            const filePath = await saveImage(result.data, args.save_path);

            const structuredContent: z.infer<typeof generateImageOutputSchema> = {
                file_path: filePath,
                mime_type: result.mimeType as "image/jpeg",
                model: result.model,
                ...(result.text ? { text: result.text } : {}),
            };

            const statusLines = [
                ...(result.text ? [result.text] : []),
                `Image saved to: ${filePath}`,
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
