import * as vscode from 'vscode';
import { NestedOpenEditorsProvider, ItemType, TreeItem } from './nestedOpenEditorsProvider';

/**
 * Activates the extension
 */
export function activate(context: vscode.ExtensionContext) {
  // Create a tree provider for nested open editors
  const nestedOpenEditorsProvider = new NestedOpenEditorsProvider();
  
  // Register the provider for tree view
  const treeView = vscode.window.createTreeView('nestedOpenEditors', {
    treeDataProvider: nestedOpenEditorsProvider,
    showCollapseAll: false
  });
  
  // Track active timeouts to cancel if new event occurs before previous one completes
  let revealTimeout: NodeJS.Timeout | undefined;
  
  // Flag to track visibility of our view
  let isViewVisible = false;
  
  // Track visibility of our TreeView
  context.subscriptions.push(
    treeView.onDidChangeVisibility(e => {
      isViewVisible = e.visible;
      console.log(`TreeView visibility changed: ${isViewVisible}`);
      
      // If view becomes visible, update selection
      if (isViewVisible) {
        revealActiveEditor();
      }
    })
  );
  
  // Function to reveal active editor in tree
  const revealActiveEditor = () => {
    // Cancel previous timer if it exists
    if (revealTimeout) {
      clearTimeout(revealTimeout);
      revealTimeout = undefined;
    }
    
    // Check if our view is visible
    if (!isViewVisible) {
      return; // If panel is not visible, don't highlight
    }
    
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return;
    }
    
    // Get URI of active file
    const activeUri = activeEditor.document.uri;
    
    // Update tree
    nestedOpenEditorsProvider.refresh();
    
    // Set timer to highlight file after tree update
    revealTimeout = setTimeout(() => {
      // Check visibility again (might have changed during timer)
      if (!isViewVisible) {
        revealTimeout = undefined;
        return;
      }
      
      // Find item corresponding to active file
      const activeItem = nestedOpenEditorsProvider.findItemByUri(activeUri);
      
      // If item found, highlight it in tree
      if (activeItem) {
        console.log(`Revealing item: ${activeItem.resourceUri.fsPath}`);
        treeView.reveal(activeItem, { select: true, focus: false, expand: true });
      }
      revealTimeout = undefined;
    }, 100);
  };
  
  // Determine initial visibility (asynchronously)
  setTimeout(() => {
    isViewVisible = treeView.visible;
    console.log(`Initial TreeView visibility: ${isViewVisible}`);
    if (isViewVisible) {
      revealActiveEditor();
    }
  }, 500);
  
  // Subscribe to editor events
  const subscriptions = [
    // Editor open/close events
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        revealActiveEditor();
      }
    }),
    
    // Editor open events
    vscode.workspace.onDidOpenTextDocument(() => {
      revealActiveEditor();
    }),
    
    // Tab changes
    vscode.window.tabGroups.onDidChangeTabs(() => {
      revealActiveEditor();
    }),
    
    // Tab group changes
    vscode.window.tabGroups.onDidChangeTabGroups(() => {
      revealActiveEditor();
    }),
    
    // Window state changes
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) {
        revealActiveEditor();
      }
    }),
    
    // Editor view state changes
    vscode.window.onDidChangeTextEditorViewColumn(() => {
      revealActiveEditor();
    }),
    
    // Visible editors changes
    vscode.window.onDidChangeVisibleTextEditors(() => {
      revealActiveEditor();
    }),
    
    // Close all editors command
    vscode.commands.registerCommand('nestedOpenEditors.closeAllEditors', () => {
      vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }),
    
    // Close specific editor command
    vscode.commands.registerCommand('nestedOpenEditors.closeEditor', (item) => {
      let fileUri: vscode.Uri | undefined;
      
      if (item?.resourceUri) {
        fileUri = item.resourceUri;
      } else if (treeView.selection?.length) {
        fileUri = treeView.selection[0].resourceUri;
      }
      
      if (fileUri) {
        const tabsToClose = vscode.window.tabGroups.all
          .flatMap(group => group.tabs)
          .filter(tab => 
            tab.input instanceof vscode.TabInputText && 
            tab.input.uri.toString() === fileUri.toString()
          );
          
        if (tabsToClose.length) {
          vscode.window.tabGroups.close(tabsToClose);
        }
      }
    }),
    
    // Refresh tree command
    vscode.commands.registerCommand('nestedOpenEditors.refresh', () => {
      revealActiveEditor();
    }),
    
    // Tree view
    treeView
  ];
  
  // Add all subscriptions to context
  context.subscriptions.push(...subscriptions);
}

/**
 * Deactivates the extension
 */
export function deactivate() {} 