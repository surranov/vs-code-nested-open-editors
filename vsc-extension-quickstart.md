# Nested Open Editors - Developer Guide

## Project Structure

* `package.json` - Extension manifest
* `src/extension.ts` - Main extension activation code
* `src/nestedOpenEditorsProvider.ts` - Data provider for open editors tree

## Running and Debugging

* Press `F5` to open a new window with your extension loaded.
* Set breakpoints in your code for debugging.
* Find output from your extension in the `Debug Console`.

## Making Changes

* All changes are automatically recompiled and applied to the running debug window.
* When you make changes to code and save files, the extension will automatically reload.

## Packaging Extension

* To create extension package (.vsix) run: `vsce package`
* Then install it via: `code --install-extension nested-open-editors-1.0.9.vsix`
