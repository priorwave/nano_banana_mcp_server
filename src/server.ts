import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generateImageTool } from "./tools.js";

export function createMcpServer() {
    const server = new McpServer({
        name: "nano-banana",
        version: "1.0.0",
    });

    server.registerTool(
        generateImageTool.name,
        {
            title: generateImageTool.title,
            description: generateImageTool.description,
            inputSchema: generateImageTool.inputSchema,
            outputSchema: generateImageTool.outputSchema,
            annotations: generateImageTool.annotations,
        },
        generateImageTool.handler
    );

    return server;
}
