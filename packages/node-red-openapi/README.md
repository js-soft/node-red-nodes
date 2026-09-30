**⚠️ This project moved to [nodefox-team(openapi-red)](https://gitlab.com/nodefox-team/openapi-red). ⚠️**

Version 3 is underway. Development takes place in the new repository. Please stay tuned.


# OpenAPI-RED

This node allows to work with APIs defined by OpenAPI 3 (Swagger). You can set parameters within the Node-RED-UI and trigger the flow from within your flow.

It is based on [swagger-js](https://github.com/swagger-api/swagger-js).

## Usage

### 1. Create a config node
Enter the URL or upload a (json or yaml) file and press the refresh button.

If your file is too large either upload it directly into the [node-red directory]/openApi or set a higher apiMaxLength limit in the settings.js

Select or add an alternative server where openAPI will send the request.

Use the development mode if you have to work with self signed or expired certificates which would be rejected otherwise.

![config node description](https://gitlab.com/2WeltenChris/openapi-red/raw/master/examples/config_node.png?raw=true "Config node")

## 2. Set the node settings

### 2.1 General settings

Set the general settings for this node like the name, the config node, the amount of outputs and how to handle if an (unexpected) error occurs. Check error handling for more details.

![node settings description](https://gitlab.com/2WeltenChris/openapi-red/raw/master/examples/node_settings.png?raw=true "Node settings")

Each field has a detailed description which can either be shown via hovering the tooltip icon or clicking on the "show description" button to show them as a static callout.

![tooltip or callout](https://gitlab.com/2WeltenChris/openapi-red/raw/master/examples/tooltip_or_callout.png?raw=true "Tooltip or callout")

### 2.1 Error handling

Error handling has been split into 2 options. 

- `Node output style`: Let you handle responses defined by your specification.
-- One output for each defined response: Either for specific response codes like '500' or '501'.
-- One output for each existing response state group: If at least one response code for a group is defined you can also get one output for each group like '5xx'
-- Classic mode: Returns always on the first output.
- `Error handling`: 
-- Separat output: Send unexpected errors or errors from the server to a new output.
-- Throw expection: Throws the error so a catch node can handle it.
-- Other output (classic mode only): Send all errors to a a new output.
-- Default (classic mode only): Send the error to the first (and only) output and let the flow handle it.

## 3. Request settings

Select the operation from your openAPI specification file. 

If the tag or the operation has a description, it will be shown here. Again you can choose between tooltip and callout.

![request_settings description](https://gitlab.com/2WeltenChris/openapi-red/raw/master/examples/request_settings.png?raw=true "Request settings")

## 4. Parameter configuration

Enter the value for the parameters which will be send to the server. Required fields are always editable, optional fields must be activated via the checkbox on the left side.

openapi-red 2.0 introduces an editor to handle your parameters. Select the editor option from the TypedInput field and receive a structured list with all keys for this object.

Each parameter or object key has an input-field corresponding to its type. You can further define that a parameter shall be read from the incoming message object or define a jsonata expression.

![parameters description](https://gitlab.com/2WeltenChris/openapi-red/raw/master/examples/parameters.png?raw=true "Parameters")

Like in version 1.x you can use the old JSON parameters view which includes a sample structure. You can set this as the value by clicking the corresponding button - either with only the required keys (set required) or with all keys (set default).

![old json example](https://gitlab.com/2WeltenChris/openapi-red/raw/master/examples/old_json.png?raw=true "Old json example")

### 4.1 Parameter filter

Use the filter button between the checkbox and the parameter name to conditionally activate the parameter. 

This can be handy if you have an array and want to filter some values.

The function has access to the `msg` object, the `value` (not for editor, array, each) and the current each value (set in the `as` input of each). It is recommended that the result is a boolean.

## 5. Headers

### 5.1 Custom headers

Add a header in either your config node, the openAPI node or in `msg.headers`. Be aware that keys set in the openAPI node will overwrite keys from the config node and keys from `msg.headers` will overwrite keys from both settings.

If you want to remove a header key set an empty value.

### 5.2 Authentification

Add your auth key into the header.

It is also possible to load certification files from your project folder (.node-red/ if projects are disabled or .node-red/projects/myProject/). Those certification files will be added to the HTTPS Agent to authorize the call.

⚠️ The `msg.openApiToken` is now depreceated and will be removed in the next major version.

`msg.headers` and `msg.openApiToken` will be deleted afterwards if you do not set the option "Keep authentification".

## Sample flow

You can find a sample flow in the node red imports where you can see some examples on how to configure the node.

![Example](https://gitlab.com/2WeltenChris/openapi-red/raw/master/examples/examples.png?raw=true "Example Node")

Or check it out with gitpod.

## Gitpod

A ready to launch gitpod setting is available. Just start it, wait till your workspace is ready and enter `npm install -g node-red`, `npm run setup` and `node-red examples/openApi-petstore.json`.

## License
This repository and the code inside it is licensed under the MIT License. Read LICENSE for more information.

## Developers

If you want to modify something inside the openApi.html file, I recommend to use [SIR](https://gitlab.com/2WeltenChris/svelte-integration-red).

With help of SIR you can handle the openApi-red.svelte file in which the code is much cleaner and easier to handle.
