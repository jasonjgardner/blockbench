const { z } = require("zod");
const {
  McpServer,
  ResourceTemplate,
} = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

const expressApp = express();
expressApp.use(express.json());

const MCP_ENDPOINT = "/mcp";
const MCP_PORT = Number(Settings.get("mcp_port") ?? "3000");

expressApp.post(MCP_ENDPOINT, async (req, res) => {
  try {
    const server = new McpServer({
      name: "Blockbench",
      version: Blockbench.version,
    });

    const placeCubes = server.tool(
      "place_cubes",
      {
        elements: z.array(
          z.object({
            name: z.string(),
            origin: z.tuple([z.number(), z.number(), z.number()]),
            from: z.tuple([z.number(), z.number(), z.number()]),
            to: z.tuple([z.number(), z.number(), z.number()]),
            rotation: z.tuple([z.number(), z.number(), z.number()]),
          })
        ),
      },
      async ({ elements }) => {
        console.log("Placing cubes in Blockbench:", elements);

        Outliner.elements.push(
          ...elements.map((element) => {
            const cube = new Cube({
              name: element.name,
              from: element.from,
              to: element.to,
              origin: element.origin,
              rotation: element.rotation,
            });

            cube.init();
            return cube;
          })
        );

        return {
          content: [
            {
              type: "text",
              text: "Cubes placed successfully!",
            },
          ],
        };
      }
    );

    placeCubes.description = "Place cubes in Blockbench";

    const createTextureTool = server.tool(
      "create_texture",
      {
        name: z.string(),
        width: z.number().min(16).max(4096),
        height: z.number().min(16).max(4096),
        data: z.string(),
      },
      async ({ name, width, height, data }) => {
        const uuid = guid();
        const texture = new Texture(
          { name, width, height, source: data },
          uuid
        );

        Texture.all.push(texture);

        return {
          content: [
            {
              type: "text",
              text: `Texture created successfully with UUID: ${uuid}`,
            },
            {
              type: "texture",
              blob: texture.getBase64(),
              mimeType: "image/png",
            },
          ],
        };
      }
    );

    createTextureTool.description =
      "Create a new texture in Blockbench. Requires name, width, height, and data (base64 encoded image).";

    const textureResources = server.resource(
      "texture",
      new ResourceTemplate("texture://{uuid}", {
        list: () => {
          return {
            resources: Texture.all.map((texture) => ({
              name: texture.name,
              mimeType: "image/png",
              uri: `texture://${texture.uuid}`,
              blob: texture.getBase64(),
              uuid: texture.uuid,
            })),
          };
        },
      }),
      async (uri, { uuid }) => ({
        uri: uri.href,
        contents: [
          {
            uri: uri.href,
            mimeType: "image/png",
            blob: (
              Texture.all.find((t) => t.uuid === uuid) ?? Texture.getDefault()
            ).getBase64(),
          },
        ],
      })
    );

    textureResources.description = "Get texture data";

    const screenshotResource = server.resource(
      "screenshot_project",
      new ResourceTemplate("screenshot://{name}", {
        list: async () => {
          if (ModelProject.all.length === 0) {
            return {
              resources: [],
            };
          }

          return {
            resources: ModelProject.all.map((project) => ({
              name: project.name,
              uuid: project.uuid,
              mimeType: "image/png",
              uri: `screenshot://${project.name}`,
            })),
          };
        },
      }),
      async (uri, { name }) => {
        const project = ModelProject.all.find((p) => p.name === name);
        if (project) {
          project.updateThumbnail();
          return {
            uri: uri.href,
            contents: [
              {
                uri: uri.href,
                mimeType: "image/png",
                blob: project.thumbnail.replace("data:image/png;base64,", ""),
              },
            ],
          };
        } else {
          throw new Error("Project not found: " + name);
        }
      }
    );

    screenshotResource.description = "Get project screenshot";

    const nodesResource = server.resource(
      "project_nodes_3d",
      new ResourceTemplate("nodes://{uuid}", {
        list: () => {
          return {
            resources: Object.entries(Project.nodes_3d).map(
              ([uuid, project]) => ({
                name: project.name,
                uuid,
                uri: `nodes://${uuid}`,
              })
            ),
          };
        },
      }),
      async (uri, { uuid }) => {
        const nodes = Project.nodes_3d[uuid];

        if (nodes) {
          return {
            uri: uri.href,
            contents: [
              {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify(nodes),
              },
            ],
          };
        }
      }
    );

    nodesResource.description = "Get project nodes data";

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      console.log("Request closed");
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

expressApp.get(MCP_ENDPOINT, async (req, res) => {
  console.log("Received GET MCP request");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});

expressApp.delete(MCP_ENDPOINT, async (req, res) => {
  console.log("Received DELETE MCP request");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});

expressApp.listen(MCP_PORT, () => {
  const statusBar = document.getElementById("mcp_status_bar");
  if (statusBar) {
    statusBar.innerHTML = `<svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#4caf50" stroke="#388e3c" stroke-width="1"/></svg>
      <span style="font-size: 12px; opacity: 0.9;" title="MCP server running on port ${MCP_PORT}">MCP <code style="color:rgba(235, 235, 235, 0.75)">:${MCP_PORT}${MCP_ENDPOINT}</code></span>`;
    statusBar.style.fontSize = "12px";
    statusBar.style.display = "flex";
    statusBar.style.alignItems = "center";
    statusBar.style.gap = "4px";
    statusBar.style.padding = "2px 4px";
    statusBar.style.zIndex = "1";
  } else {
    Blockbench.showMessage(
      `MCP server is running on port ${MCP_PORT}`,
      "mcp_status_bar"
    );
  }
  console.log(`MCP server is running on port ${MCP_PORT}`);
});
