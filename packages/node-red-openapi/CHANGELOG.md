> **Attention:** ⚠️ means that a change breaks things. Manual adjustments will be necessary. So be careful before updating. Even data loss might occur.

## Version 2.8.0 (12th of November 2025)
- Updated dependencies
- Tinypool usage changed
- svelte store usage changed

## Version 2.7.9 (13th of October 2025)
- fixed auto collapsing on activation
- additional each type in typedInput selection fix
- searching spinner added
- Refactoring

## Version 2.7.7 + 2.7.8 (10th of October 2025)
- Refactoring ParameterEditor
- css fixes after refactoring

## Version 2.7.6 (8th of October 2025)
- Updated SIR
- Parameter editor updated
- Request settings UI fix

## Version 2.7.5 (30th of September 2025)
- Fixed error object (https://gitlab.com/2WeltenChris/openapi-red/-/issues/33)
- Updated SIR

## Version 2.7.4 (29th of July 2025)
- error message enhanced

## Version 2.7.3 (28th of July 2025)
- no operationId loading fix
- changing config loading operation error fix

## Version 2.7.2 (01st of July 2025)
- Updated swagger-js (XML bug fix)
- set result bugfix

## Version 2.7.0 + 2.7.1 (17th of June 2025)
- Added target option, where the result will be set in the message
- Output fix

## Version 2.6.3 + 2.6.4 (17th of June 2025)
- Resolve very nested schemas for the editor
- Jsonata Bugfix
- Check operation id fix (swagger client can change it)

## Version 2.6.2 (05th of June 2025)
- Switch to Array/Each fix
- Updated dependencies

## Version 2.6.1 (28th of May 2025)
- Get examples fix
- Refactoring to enable exporting the parameters editor
- Type number fix

## Version 2.6.0 (8th of May 2025)
- ⚠️ Experimental: added agent authorization in config node

## Version 2.5.7 (06th of May 2025)
- minified html

## Version 2.5.6 + 2.5.7 (06th of May 2025)
- Tooltip fixes (markdown)
- SIR update

## Version 2.5.5 (05th of May 2025)
- array in request Body fix
- css fixes
- reload specification within openApi node fix

## Version 2.5.4 (21st of March 2025)
- array multischeme fix
- each as value -> children did not receive typed input type fix

## Version 2.5.1 + 2.5.2 + 2.5.3 (20th of March 2025)
- first level parameter may were disabled
- saving custom server fix
- swagger custom server port fix

## Version 2.5.0 (19th of March 2025)
- bugfix multischeme name
- bugfix get xml payload = undefined (on multiple semicolons). Warning: with one semicolon currently it returns still a wrong object  https://github.com/swagger-api/swagger-js/issues/3844)
- array multischemes fix
- show only active parameters option added

## Version 2.3.2 (30th of January 2025)
- localhost automatically accepts self signed signatures
- naming convention fixes

## Version 2.3.1 (13th of January 2025)
- Garbage collector were missing array children

## Version 2.3.0 (07th of January 2025)
- Search parameters function added
- Bugfix receiving files were removed (send() removes Blob)

## Version 2.2.1 + 2.2.2 (19th of December 2024)
- getMultiSelectionSelectedSchema fix 
- each evaluate parameter fix

## Version 2.2.0 (17th of December 2024)
- updated dependencies
- Add Array value with schema fix
- some refactoring...
- Added each iteration for Array
- Added condition (filter) for active parameter

## Version 2.1.3 (18th of November 2024)
- update node and config node fix (add version missed)
- updated dependencies
- detect paramater as an array fix

## Version 2.1.2 (28rd of October 2024)
- update config node fix (._.)
- updated swagger-client
- fixed pet store example

## Version 2.1.1 (23rd of August 2024)
- node custom header fix,
- more debug data

## Version 2.1.0 (22nd of August 2024)
- Added custom header in config node and openApi node
- Added icons in config node
- Renamend "Set whole response to payload" to "Legacy Mode"
- updated dependencies
- Reloading specification after closing config node -> openApi node
- Fixed reloading and recreating JSON File
- ⚠️ msg.openApiToken is now depreceated (still working till next major version)
- Debug mode sends always data to flow and console tab

## Version 2.0.3 (12th of August 2024)
- Tinypool fix (1 min and 1 max thread) (Rasberry Pi CPU fix)
- Path/Method not found error fix
- urlConfig validate server fix

## Version 2.0.2 (29th of July 2024)
- added debug mode
- always set msg type on new parameters (select was preferred before -> unlogical behaviour)

## Version 2.0.1 (03rd of July 2024)
- Added NODE_EXTRA_CA_CERTS env variable to tinypool (extra self signed certificate)
- Updated dependencies

## ⚠️ Version 2.0.0 ⚠️ (29th of May 2024)
- ⚠️ Hint: manual adjustments should (for most user) not be necessarry for old nodes, but some main features like the returning msg.payload were changed when using the new version.
- msg.payload includes the request.obj object instead of the whole response. The remaining response is stated in msg.response. -> Legacy mode is available in the advanced tab.
- Renaming in UI
- If request and node settings are made, the Collapsible frame is closed by default (showing only parameters)
- Changed error handling naming from "standard" to "default"
- ⚠️ If used msg.openApi.parameters to set parameters: structure has changed from Array to Object
- refactored whole node
- ⚠️ Alternative server: using either a absolut url from the selection or combine a relative url with the default server url from the selected config node


## Version 1.2.4 (13th of September 2023)
- accepting all media types getting API specifications

## Version 1.2.3 (31st of May 2023)
- if no operation summary exists, show operation id

## Version 1.2.2 (22nd of May 2023)
- UI fix

## Version 1.2.1 (17th of May 2023) (next only)
- UI fix

## Version 1.2.0 (15th of May 2023)
- updated swagger-client (v. 3.19.7)
- added configuration node
- updated SIR

## Version 1.1.3 (11th of January 2023)
- Bugfix for Safari with new SIR version

## Version 1.1.2 (09th of January 2023)
- Experimental: Bugfix for Safari

## Version 1.1.1 (18th of October 2022)
- Bugfix Parameters with special characters

**Version 1.1.0**
- Experimental: added dev mode (ignore old/self signed certificate)
- code refactoring
- Bugfix init content request/response type
- UI Changes
- Node-Red theme compatible

**Version 1.0.9**
- updated package.json no change in code

**Version 1.0.8**
- Url Regex check removed, but url will be error if not read successfully
- Updated swagger client and SIR 
- added required version Node-RED and node.js 

**Version 1.0.7**
- Code refactoring
- UI Tweaks
- Added 'Keep authentification'
- Keep description closed 

**Version 1.0.6**
- UI Fixes
- Select from Array Bugfix
- Return correct error

**Version 1.0.5**

- removed optional chaining on server side as Node-RED still supports node.js v.12

**Version 1.0.4**

- Fixing parameters css styling

**Version 1.0.3**

- Bugfix: show request body if available, even if there are additional parameters

**Version 1.0.2**

- Added response content type as selection
- Experimental feature added: Changing server
- Updated to latest SIR version
- Grouped general and api options UI (-> can be hidden now)

**Version 1.0.1**

- Fixed #3: URL properties were interpreted as operations

**Version 1.0.0**

- UI is now based on [SIR](https://gitlab.com/2WeltenChris/svelte-integration-red)
- Bugfix: Body can now be used again with OpenAPI 3

**Version 0.1.11**

- Merged authentification and proxy request by Tristan Bastian
- added gitpod files

**Version 0.1.10**

- Content type for body is now mandatory (updated swagger-js)

**Version 0.1.9**

- Minor changes on error handling
- Code changed to StandardJs code standard

**Version 0.1.8**

- Selectable error handling

**Version 0.1.7**

- Hide value input for parameter if not active
- Minor code changes

**Version 0.1.6**

- Bugfix input default values for objects. 
- Select input for OpenAPI 3 Request Body Object. (!Experimental and will always create a json object for now!)

**Version 0.1.5**

- Error notification and stop flow if required input is missing

**Version 0.1.4**

- Bugfix: Identification of parameter type and source

**Version 0.1.3**

- Operations without a tag will be placed in default

**Version 0.1.2**

- Added git repository tag