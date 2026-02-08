# Nano Banana MCP Server

A local stdio MCP server for Gemini-powered image generation.

## Features

- Simple MCP to generate images with Google's Gemini image models
- Save generated output to local disk as JPEG
- Return both user-facing content and structured tool output for clients
- Run locally via stdio (no HTTP transport in this project)

## Prerequisites

- Node.js 20+
- Gemini API key from Google AI Studio

## Install

```bash
git clone https://github.com/priorwave/nano_banana_mcp_server/
cd nano-banana-mcp
npm install
npm run build
```

## Configuration

Set an API key in your shell profile:

```bash
export GEMINI_API_KEY="your-key-here"
# GOOGLE_API_KEY is also supported
```

Optional model override:

```bash
export GEMINI_IMAGE_MODEL="gemini-3-pro-image-preview"
```

Configure your MCP client to run this server locally via stdio:

```json
{
  "mcpServers": {
    "nano-banana": {
      "command": "node",
      "args": ["/absolute/path/to/nano_banana_mcp_server/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "${GEMINI_API_KEY}"
      }
    }
  }
}
```

## Tool: `generate_image`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | Yes | Prompt text for generation (1-4000 chars) |
| `save_path` | Yes | Absolute path. If directory, a timestamped `.jpg` file is created. If file path, extension must be `.jpg` or `.jpeg`. |

The tool returns:

- Text status content
- Image content
- Structured output with `file_path`, `mime_type`, `model`, and optional `text`

## Development

- Build: `npm run build`
- Start: `npm start`
- Test: `npm test`
