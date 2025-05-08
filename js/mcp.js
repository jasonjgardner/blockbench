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

const mcpPortSetting = new Setting("mcp_port", {
  name: "MCP Server Port",
  description: "The port on which the MCP server will run.",
  category: "application",
  type: "number",
  value: "3000",
  step: 1,
  min: 1,
  max: 65535,
  onChange: (newPort) => {
    Blockbench.showMessage(
      `MCP server port changed to ${newPort}. Please restart the application.`,
      "status_bar"
    );
    Settings.showRestartMessage(["mcp_port"]);
  },
});

const mcpEndpointSetting = new Setting("mcp_endpoint", {
  name: "MCP Server Endpoint",
  description: "The endpoint for the MCP server.",
  category: "application",
  type: "text",
  value: "/mcp",
  onChange: (newEndpoint) => {
    Blockbench.showMessage(
      `MCP server endpoint changed to ${newEndpoint}. Please restart the application.`,
      "status_bar"
    );
    Settings.showRestartMessage(["mcp_endpoint"]);
  },
});

const MCP_ICON = "../icons/mcp_icon.svg";
const MCP_ENDPOINT = mcpEndpointSetting.value ?? "/mcp";
const MCP_PORT = mcpPortSetting.value ?? 3000;

const McpStatusComponent = {
  name: "mcp-status",
  template: /* html */ `
    <div id="mcp_status_container" style="padding: 8px;">
      <div id="mcp_status_bar" style="
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 8px;
        background: rgba(0,0,0,0.2);
        border-radius: 4px;
      ">
        <svg width="10" height="10">
          <circle cx="5" cy="5" r="4" fill="#4caf50" stroke="#388e3c" stroke-width="1"/>
        </svg>
        <span style="font-size: 12px; opacity: 0.9;" :title="statusTitle">
          {{status}} <code>:{{port}}{{endpoint}}</code>
        </span>
      </div>
    </div>
  `,
  data() {
    return {
      port: MCP_PORT,
      endpoint: MCP_ENDPOINT,
      status: tl("mcp.status.running"),
      statusTitle: tl("mcp.status.running.title"),
    };
  },
};

const McpPanel = new Panel("mcp", {
  name: "Model Context Protocol",
  icon: MCP_ICON,
  condition: () => Boolean(Project),
  toolbars: [
    new Toolbar("mcp_server_settings", {
      icon: "server",
      condition: () => Boolean(Project) && MCP_PORT && MCP_ENDPOINT,
      children: [
        new Action("mcp_endpoints_action", {
          linked_setting: mcpEndpointSetting.name,
          name: "Endpoint",
        }),
        new Action("mcp_port_action", {
          linked_setting: mcpPortSetting.name,
          name: "Port",
        }),
      ],
    }),
  ],
  component: McpStatusComponent,
});

expressApp.post(MCP_ENDPOINT, async (req, res) => {
  try {
    const server = new McpServer({
      name: "Blockbench",
      version: Blockbench.version,
      capabilities: {
        logging: {},
        tools: {},
      },
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
        Undo.initEdit({
          elements: [],
          outliner: true,
        });

        const cubes = elements.map((element) => {
          const cube = new Cube({
            name: element.name,
            from: element.from,
            to: element.to,
            origin: element.origin,
            rotation: element.rotation,
          });

          cube.init();
          return cube;
        });
        Outliner.elements.push(...cubes);

        Undo.finishEdit("Agent placed cubes");
        Canvas.updateAll();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                cubes.map((cube) => ({
                  name: cube.name,
                  uuid: cube.uuid,
                  uri: `element://${cube.uuid}`,
                }))
              ),
            },
          ],
        };
      }
    );

    placeCubes.description =
      "Place cubes in Blockbench. Origin is the pivot point.";

    const assignTextureTool = server.tool(
      "assign_texture",
      {
        texture: z.string(),
        elements: z.array(z.string()),
        faces: z.array(
          z.object({
            face: z.enum(["north", "south", "east", "west", "up", "down"]),
            uv: z.tuple([z.number(), z.number(), z.number(), z.number()]),
          })
        ),
      },
      async (params) => {
        console.log(params);
        const { texture: textureId, elements: elementIds, faces } = params;

        const texture =
          Texture.all.find(
            (t) => t.uuid === textureId || t.name === textureId
          ) ?? Texture.getDefault();
        if (!texture) {
          throw new Error(`Texture with UUID or name ${textureId} not found.`);
        }

        const elements = elementIds
          .map((id) =>
            Outliner.elements.find(
              (element) => element.uuid === id || element.name === id
            )
          )
          .filter(Boolean);
        if (elements.length === 0) {
          throw new Error(
            `No elements found with UUID or name matching: ${elementIds.join(
              ", "
            )}`
          );
        }

        const results = [];

        faces.forEach((face) => {
          const { face: faceName, uv } = face;
          elements.forEach((element) => {
            element.faces[faceName].texture = texture;
            element.faces[faceName].uv = uv;

            results.push({
              name: element.name,
              uuid: element.uuid,
              face: faceName,
              texture: textureId,
              uv,
            });
          });
        });

        Canvas.updateAll();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results),
            },
          ],
        };
      }
    );

    assignTextureTool.description =
      "Assign a texture to a 3D element or elements.";

    const addMeshTool = server.tool(
      "place_mesh",
      {
        name: z.string(),
        vertices: z.array(z.tuple([z.number(), z.number(), z.number()])),
        faces: z.array(
          z.object({
            face: z.enum(["north", "south", "east", "west", "up", "down"]),
            uv: z.tuple([z.number(), z.number(), z.number(), z.number()]),
          })
        ),
        origin: z.tuple([z.number(), z.number(), z.number()]).optional(),
        rotation: z.tuple([z.number(), z.number(), z.number()]).optional(),
      },
      async ({ name, vertices, faces, origin, rotation }) => {
        Undo.initEdit({
          elements: [],
          outliner: true,
        });
        
        const mesh = new Mesh({
          name,
          origin: origin ?? [0, 0, 0],
          rotation: rotation ?? [0, 0, 0],
        });

        mesh.addVertices(vertices);

        faces.forEach(({ uv }) => {
          mesh.addFaces(new MeshFace(mesh, {
            vertices,
            uv
          }));
        });

        mesh.init();

        Canvas.updateAll();
        Undo.finishEdit("Agent placed mesh");

        Outliner.elements.push(mesh);

        return {
          content: [
            {
              type: "text",
              text: `Mesh added successfully with UUID: ${mesh.uuid}`,
            },
          ],
        };
      }
    );

    addMeshTool.description = "Add a mesh to the project.";

    const loadTextureTool = server.tool(
      "load_texture",
      {
        url: z.string(),
      },
      async ({ url }) => {
        const texture = new Texture().fromPath(url);

        Texture.all.push(texture);

        return {
          content: [
            {
              type: "text",
              text: `Texture loaded successfully with UUID: ${texture.uuid}`,
            },
            {
              resource: `texture://${texture.uuid}`,
              type: "image",
              data: texture.getBase64(),
              mimeType: "image/png",
            },
          ],
        };
      }
    );

    loadTextureTool.description = "Load a texture from a file path or URL.";

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
              type: "image",
              uri: `texture://${uuid}`,
              blob: texture.getBase64(),
              mimeType: "image/png",
            },
          ],
        };
      }
    );

    createTextureTool.description =
      "Create a new texture in Blockbench. Requires name, width, height, and data (base64 encoded image).";

    const useBarItemTool = server.tool(
      "use_bar_item",
      {
        name: z.string(),
      },
      async ({ name }) => {
        BarItems[name].trigger(new Event("click", {}));

        return {
          content: [
            {
              type: "text",
              text: `Toolbar item ${name} clicked successfully.`,
            },
          ],
        };
      }
    );

    useBarItemTool.description = "Click a toolbar item by its name.";

    const listTexturesTool = server.tool("list_textures", {}, async () => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              Texture.all.map((texture) => ({
                name: texture.name,
                uuid: texture.uuid,
                uri: `texture://${texture.uuid}`,
              }))
            ),
          },
        ],
      };
    });

    listTexturesTool.description = "List all textures in Blockbench.";

    const textureResources = server.resource(
      "texture",
      new ResourceTemplate("texture://{uuid}", {
        list: () => {
          return {
            resources: Texture.all.map((texture) => ({
              name: texture.uuid,
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
              Texture.all.find((t) => t.uuid === uuid || t.name === uuid) ??
              Texture.getDefault()
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
        project?.updateThumbnail();
        if (project.thumbnail) {
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
          throw new Error("Project thumbnail not available: " + name);
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

    const listElements = server.resource(
      "elements",
      new ResourceTemplate("element://{uuid}", {
        list: () => {
          return {
            resources: Object.entries(Outliner.elements).map(
              ([uuid, element]) => ({
                name: element.uuid,
                uri: `element://${uuid}`,
              })
            ),
          };
        },
      }),
      async (uri, { uuid }) => {
        const element = Outliner.elements.find((e) => e.uuid === uuid);
        if (element) {
          return {
            uri: uri.href,
            contents: [
              {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify({
                  faces: element.faces,
                  name: element.uuid,
                  uuid: element.uuid,
                  label: element.name,
                  type: element.type,
                }),
              },
            ],
          };
        }
      }
    );
    listElements.description = "Get element data";
    const listBarItems = server.resource(
      "bar_items",
      new ResourceTemplate("toolbar://{name}", {
        list: () => {
          return {
            resources: Object.entries(BarItems).map(([name, item]) => ({
              name,
              uri: `toolbar://${name}`,
            })),
          };
        },
      }),
      async (uri, { name }) => {
        const item = BarItems[name];
        if (item) {
          return {
            uri: uri.href,
            contents: [
              {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify({
                  name: item.name,
                  icon: item.icon,
                  tooltip: item.tooltip,
                  enabled: item.enabled,
                }),
              },
            ],
          };
        } else {
          throw new Error("Bar item not found: " + name);
        }
      }
    );
    listBarItems.description = "Get bar item data";

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
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
  console.log(`MCP server is running on port ${MCP_PORT}`);
});
