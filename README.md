# Nested Open Editors

A VS Code extension that displays open editors as a file tree, similar to the regular file explorer.

## Key Features

- **Folder Structure**: Displays open files in their hierarchical folder structure.
- **Always Expanded**: The tree is always displayed in a fully expanded view.
- **Automatic Focus**: The open file automatically gets focus and is displayed in the tree.
- **Sync with Editors**: The tree is always synchronized with open editors. When you close a file, it disappears from the tree; when you open it, it appears.
- **Close All Files**: Button to close all open editors.
- **Close Individual Files**: Ability to close an individual file using the cross icon that appears on hover.
- **Temporary Files Support**: Display of temporary files in italics, just like in the standard Open Editors view.
- **Drag and Drop Support**: Move files between folders by dragging and dropping them in the tree view.
- **Context Menu**: Standard VS Code context menu with copy path, reveal in explorer, and other file operations.

## Usage

1. Install the extension
2. Open the Explorer panel in VS Code
3. In the Explorer panel, you will see a new section "Nested Open Editors"

## Commands

- `Nested Open Editors: Close All Editors` - Close all open editors
- `Nested Open Editors: Close Editor` - Close the selected editor
- `Nested Open Editors: Refresh` - Manually refresh the tree view 