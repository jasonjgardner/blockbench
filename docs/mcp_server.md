# Model Context Protocol Server
Configure experimental MCP server under Blockbench settings: __Settings__ > __Application__ > __MCP Server Port__ and __MCP Server Endpoint__

## Installation

### Claude Desktop

__`claude_desktop_config.json`__

```json
{
  "mcpServers": {
    "blockbench": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000/mcp"
      ]
    }
  }
}
```

### VS Code

__`.vscode/mcp.json`__

```json
{
    "servers": {
        "blockbench": {
            "url": "http://localhost:3000/mcp"
        },
    }
}
```

## Development

The Streamable HTTP transport URL defaults to __http://localhost:3000/mcp__

```sh
npx @modelcontextprotocol/inspector
```