/**
 * Copyright 2015, 2016 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * 
 *  NOTICE: This file is a modified version of the original 
 *  swagger.html file an addtional override tab has been added which allows
 *  a user to completely override the generated swagger doc for an endpoint with their own JSON.(meant to aid quick custom changes)
 *  Addtionally it introduces a new tab called frosch-ork which pushes different frosch-work specific properties to the open-api
 *  doc using custom properties in the swagger doc node. 
 **/

//const swaggerUiDistPath = require('swagger-ui-dist').getAbsoluteFSPath();

const DEFAULT_TEMPLATE = {
  openapi: "3.1.0",
  info: {
    title: "My Node-RED API",
    version: "1.0.0",
    description: "A sample API",
    // You can also add 'termsOfService', 'contact', and 'license' information here
  },
  servers: [
    {
      url: "http://localhost:1880/",
      description: "Local server",
    },
  ],
  paths: {},
  components: {
    schemas: {},
    responses: {},
    parameters: {},
    securitySchemes: {},
  },
  tags: [],
  // Add more properties as needed
};

module.exports = function (RED) {
  "use strict";

  //console.log("Dev version of this flow");
  let warnedNodesNotReady = false;

  const path = require("path");

  const convToSwaggerPath = (x) => `/{${x.substring(2)}}`;
  const trimAll = (ary) => ary.map((x) => x.trim());
  const csvStrToArray = (csvStr) => (csvStr ? trimAll(csvStr.split(",")) : []);
  const ensureLeadingSlash = (url) => (url.startsWith("/") ? url : "/" + url);
  const stripTerminalSlash = (url) =>
    url.length > 1 && url.endsWith("/") ? url.slice(0, -1) : url;
  const regexColons = /\/:\w*/g;
  const mapParameter = (param) => {
    if (param["$ref"]) {
      return { $ref: param["$ref"] };
    }
    const mapped = {
      name: param.name,
      in: param.in,
      required: param.required !== undefined ? param.required : false,
      description: param.description || "",
    };
    if (param.schema) {
      mapped.schema = param.schema;
    } else if (param.type) {
      mapped.schema = { type: param.type };
      if (param.format) mapped.schema.format = param.format;
      if (param.items) mapped.schema.items = param.items;
    }
    return mapped;
  };

  RED.httpNode.get("/http-api/swagger.json", (req, res) => {
    const config = RED.settings.openapi || {};
    const {
      template = {},
      parameters: additionalParams = [],
      components: additionalComponents = {},
    } = config;
    const { httpNodeRoot } = RED.settings;

    const resp = { ...DEFAULT_TEMPLATE, ...template };
    const { basePath = httpNodeRoot } = resp;

    resp.components = resp.components || {};
    for (const key in additionalComponents) {
      resp.components[key] = {
        ...(resp.components[key] || {}),
        ...additionalComponents[key],
      };
    }

    if (Array.isArray(additionalParams)) {
      resp.components.parameters = resp.components.parameters || {};
      additionalParams.forEach((p) => {
        if (p.name && !resp.components.parameters[p.name]) {
          resp.components.parameters[p.name] = mapParameter(p);
        }
      });
    }

    resp.paths = {};

    let isOverwritten = false;
    let overwriteValue = "";

    try {
      RED.nodes.eachNode((node) => {
        const { name, type, method, swaggerDoc, url } = node;

        if (type === "http in") {
          const swaggerDocNode = RED.nodes.getNode(swaggerDoc);

          if (swaggerDocNode) {
            const endPoint = ensureLeadingSlash(
              url.replace(regexColons, convToSwaggerPath)
            );
            if (!resp.paths[endPoint]) resp.paths[endPoint] = {};

            const {
              summary =
                swaggerDocNode.summary || name || method + " " + endPoint,
              description = swaggerDocNode.description || "",
              tags = swaggerDocNode.tags || "",
              deprecated = swaggerDocNode.deprecated || false,
              parameters = swaggerDocNode.parameters || [],
              requestBody = swaggerDocNode.requestBody || {},
              override = swaggerDocNode.override || false,
              overrideValue = swaggerDocNode.overrideValue || "",
            } = swaggerDocNode;

            const aryTags = csvStrToArray(tags);

            if (override) {
              isOverwritten = true;
              overwriteValue = overrideValue;
            }

            const nodeParams = parameters.map(mapParameter);
            const globalParams = additionalParams.map(mapParameter);

            const seenParams = new Set();
            nodeParams.forEach((p) => {
              if (p.$ref) {
                const parts = p.$ref.split("/");
                const name = parts[parts.length - 1];
                if (name) seenParams.add(name);
              } else if (p.name) {
                seenParams.add(p.name);
              }
            });

            const finalParams = [...nodeParams];

            const operation = {
              summary,
              description,
              tags: aryTags,
              deprecated,
              parameters: finalParams,
              responses: {},
            };

            if (
              requestBody &&
              (requestBody.description ||
                (requestBody.content &&
                  Object.keys(requestBody.content).length > 0))
            ) {
              let rb = { ...requestBody };
              if (rb.content) {
                Object.keys(rb.content).forEach((ct) => {
                  if (typeof rb.content[ct].schema === "string") {
                    try {
                      rb.content[ct].schema = JSON.parse(rb.content[ct].schema);
                    } catch (e) {}
                  }
                });
              }
              operation.requestBody = rb;
            }

            if (
              swaggerDocNode &&
              typeof swaggerDocNode.responses === "object" &&
              swaggerDocNode.responses !== null
            ) {
              Object.keys(swaggerDocNode.responses).forEach((status) => {
                const responseDetails = swaggerDocNode.responses[status];
                operation.responses[status] = {
                  description: responseDetails.description || "No description",
                  content: {},
                };

                if (responseDetails.schema) {
                  let schema = responseDetails.schema;
                  if (typeof schema === "string") {
                    try {
                      schema = JSON.parse(schema);
                    } catch (e) {}
                  }
                  operation.responses[status].content["application/json"] = {
                    schema: schema,
                  };
                }
              });
            } else {
              console.error(
                "swaggerDocNode.responses is not an object or is null:",
                swaggerDocNode.responses
              );
            }

            resp.paths[endPoint][method.toLowerCase()] = operation;
          } else {
            console.error(
              "No Swagger Documentation node found for HTTP In node:",
              node.id
            );
          }
        }
      });
    } catch (err) {
      // Node-RED can receive HTTP requests before flow registry is fully initialized.
      if (!warnedNodesNotReady) {
        console.warn(
          "OpenAPI generation skipped because Node-RED nodes are not ready yet.",
          err && err.message ? err.message : err
        );
        warnedNodesNotReady = true;
      }
      cleanupOpenAPISpec(resp);
      res.json(resp);
      return;
    }

    if (isOverwritten) {
      res.json(JSON.parse(overwriteValue));
      return;
    }

    // Final cleanup to remove empty sections
    cleanupOpenAPISpec(resp);
    res.json(resp);
  });

  function cleanupOpenAPISpec(spec) {
    // Clean up components
    if (spec.components) {
      ["schemas", "responses", "parameters", "securitySchemes"].forEach(
        (key) => {
          if (
            spec.components[key] &&
            Object.keys(spec.components[key]).length === 0
          ) {
            delete spec.components[key];
          }
        }
      );

      // If all components are empty, remove the components object itself
      if (Object.keys(spec.components).length === 0) {
        delete spec.components;
      }
    }

    // Clean up empty tags array
    if (Array.isArray(spec.tags) && spec.tags.length === 0) {
      delete spec.tags;
    }
  }

  function SwaggerDoc(n) {
    RED.nodes.createNode(this, n);
    this.summary = n.summary;
    this.description = n.description;
    this.tags = n.tags;
    this.parameters = n.parameters;
    this.responses = n.responses;
    this.requestBody = n.requestBody; // Ensure requestBody is captured
    this.deprecated = n.deprecated;
    this.override = n.override;
    this.overrideValue = n.overrideValue;
  }
  RED.nodes.registerType("swagger-doc", SwaggerDoc);

  // Serve the main Swagger UI HTML file
  RED.httpAdmin.get("/swagger-ui/swagger-ui.html", (req, res) => {
    // Correct the path to point directly to the 'swagger-ui.html' file
    const filename = path.join(__dirname, "swagger-ui/swagger-ui.html");
    sendFile(res, filename);
  });

  // Serve i18next localization files
  RED.httpAdmin.get("/swagger-ui/i18next.min.js", (req, res) => {
    const filename = path.join(
      __dirname,
      "..",
      "node_modules",
      "i18next",
      "i18next.min.js"
    );
    sendFile(res, filename);
  });

  // Serve Swagger UI assets like CSS and JS from swagger-ui-dist
  RED.httpAdmin.get(
    "/swagger-ui/*",
    (req, res, next) => {
      // Extract the actual file name from the request params
      let filename = req.params[0];

      // If the filename is 'swagger-ui.html', redirect to the correct handler
      if (filename === "swagger-ui.html") {
        return next();
      }

      // Serve the file from swagger-ui-dist
      try {
        const basePath = require("swagger-ui-dist").getAbsoluteFSPath();
        const filePath = path.join(basePath, filename);
        sendFile(res, filePath);
      } catch (err) {
        console.error(err);
        res.status(404).send("File not found");
      }
    },
    (req, res) => {
      // Fallback handler for 'swagger-ui.html', in case the above handler is triggered
      // due to the way Express handles wildcard routes
      const filename = path.join(__dirname, "swagger", "swagger-ui.html");
      sendFile(res, filename);
    }
  );

  // Serve any other localization files
  RED.httpAdmin.get("/swagger-ui/nls/*", (req, res) => {
    const filename = path.join(__dirname, "locales", req.params[0]);
    sendFile(res, filename);
  });

  // Generic function to send files
  function sendFile(res, filePath) {
    // Implement the logic to send the file
    // For example, using Express' res.sendFile:
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error("Error sending file:", err);
        res.status(err.status || 500).send("Error sending file.");
      }
    });
  }

  // Admin endpoint to get OpenAPI components from settings
  RED.httpAdmin.get("/openapi/components", (req, res) => {
    const config = RED.settings.openapi || {};
    const template = config.template || {};
    const additionalComponents = config.components || {};

    const components = {
      ...(template.components || {}),
    };

    for (const key in additionalComponents) {
      components[key] = {
        ...(components[key] || {}),
        ...additionalComponents[key],
      };
    }

    // Merge global parameters if they are defined as an array
    if (Array.isArray(config.parameters)) {
      components.parameters = components.parameters || {};
      config.parameters.forEach((param) => {
        if (param.name && !components.parameters[param.name]) {
          components.parameters[param.name] = mapParameter(param);
        }
      });
    }

    res.json(components);
  });
};
