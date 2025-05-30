import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Types of items in the tree view
 */
export enum ItemType {
  File = 'file',
  Folder = 'folder'
}

/**
 * Custom tree item that represents a file or folder in the tree view
 */
export class TreeItem extends vscode.TreeItem {
  constructor(
    public readonly resourceUri: vscode.Uri,
    public readonly type: ItemType,
    public readonly children: TreeItem[] = []
  ) {
    super(resourceUri);
    
    this.label = path.basename(resourceUri.fsPath);
    
    if (type === ItemType.File) {
      this.setupFileItem();
    } else {
      this.setupFolderItem();
    }
  }

  /**
   * Configures the tree item for a file
   */
  private setupFileItem(): void {
    this.contextValue = 'nestedOpenEditorsFile';
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    this.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [this.resourceUri]
    };
    
    // Check if file is a preview
    const isPreview = vscode.window.tabGroups.all
      .flatMap(group => group.tabs)
      .find(tab => 
        tab.input instanceof vscode.TabInputText && 
        tab.input.uri.toString() === this.resourceUri.toString() &&
        tab.isPreview
      );
      
    if (isPreview) {
      this.description = 'Preview';
    }
    
    // Standard file icon
    this.iconPath = new vscode.ThemeIcon('file');
  }

  /**
   * Configures the tree item for a folder
   */
  private setupFolderItem(): void {
    this.contextValue = 'nestedOpenEditorsFolder';
    this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

/**
 * Main tree data provider for the nested open editors view
 */
export class NestedOpenEditorsProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  private _cachedItems: TreeItem[] = [];
  private _allItemsFlat: TreeItem[] = [];
  
  /**
   * Gets all open editors as a tree
   */
  private getOpenEditors(): TreeItem[] {
    // Tree root
    const rootItems: TreeItem[] = [];
    
    // Cache of folders by their full path for quick lookup
    const folderCache = new Map<string, TreeItem>();
    
    // Get all open files from all tab groups
    const allTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
    
    // Creates or gets folder in tree, creating all parent folders as needed
    const getOrCreateFolderHierarchy = (folderPath: string): TreeItem => {
      // Check if folder already exists in cache
      const existingFolder = folderCache.get(folderPath);
      if (existingFolder) {
        return existingFolder;
      }
      
      // Get workspace folders
      const workspaceFolders = vscode.workspace.workspaceFolders || [];
      
      // Check if folder is inside workspace
      const workspaceFolder = workspaceFolders.find(wsFolder => 
        folderPath.startsWith(wsFolder.uri.fsPath)
      );
      
      // If folder is not in workspace, don't create tree element for it
      if (!workspaceFolder) {
        // Create element but don't add to tree
        const folder = new TreeItem(vscode.Uri.file(folderPath), ItemType.Folder);
        folderCache.set(folderPath, folder);
        return folder;
      }
      
      // Create new folder
      const folder = new TreeItem(vscode.Uri.file(folderPath), ItemType.Folder);
      folderCache.set(folderPath, folder);
      
      // Determine parent path
      const parentPath = path.dirname(folderPath);
      
      // If folder is workspace folder or its parent equals workspace, add to root
      if (folderPath === workspaceFolder.uri.fsPath || parentPath === workspaceFolder.uri.fsPath) {
        rootItems.push(folder);
        return folder;
      }
      
      // If no parent path (filesystem root), add to tree root
      if (parentPath === folderPath) {
        rootItems.push(folder);
        return folder;
      }
      
      // Recursively create parent folder and add current as child
      const parentFolder = getOrCreateFolderHierarchy(parentPath);
      parentFolder.children.push(folder);
      
      return folder;
    };
    
    // Process each open file
    for (const tab of allTabs) {
      if (!(tab.input instanceof vscode.TabInputText)) {
        continue;
      }
      
      const uri = tab.input.uri;
      if (uri.scheme !== 'file') {
        continue;
      }
      
      const filePath = uri.fsPath;
      const dirPath = path.dirname(filePath);
      
      // Get workspace folders
      const workspaceFolders = vscode.workspace.workspaceFolders || [];
      
      // Check if file is in workspace
      const workspaceFolder = workspaceFolders.find(wsFolder => 
        filePath.startsWith(wsFolder.uri.fsPath)
      );
      
      // If file is not in workspace, skip it
      if (!workspaceFolder) {
        continue;
      }
      
      // If file is in workspace root, add it directly to tree root
      if (dirPath === workspaceFolder.uri.fsPath) {
        const fileItem = new TreeItem(uri, ItemType.File);
        rootItems.push(fileItem);
        continue;
      }
      
      // Get or create folder hierarchy for this file
      const folderItem = getOrCreateFolderHierarchy(dirPath);
      
      // Add file to folder
      const fileItem = new TreeItem(uri, ItemType.File);
      folderItem.children.push(fileItem);
    }
    
    // Sort all folders and files
    const sortTreeItems = (items: TreeItem[]): void => {
      // Sort elements at current level
      items.sort((a, b) => {
        // Folders first, then files
        if (a.type !== b.type) {
          return a.type === ItemType.Folder ? -1 : 1;
        }
        // Within same type - alphabetically
        return a.resourceUri.fsPath.localeCompare(b.resourceUri.fsPath);
      });
      
      // Recursively sort child elements
      for (const item of items) {
        if (item.children.length > 0) {
          sortTreeItems(item.children);
        }
      }
    };
    
    // Sort tree
    sortTreeItems(rootItems);
    
    // Save result in cache
    this._cachedItems = rootItems;
    this._updateFlatItemsList();
    
    return rootItems;
  }
  
  /**
   * Updates flat list of all elements for quick search
   */
  private _updateFlatItemsList(): void {
    this._allItemsFlat = [];
    
    // Function to recursively add elements to flat list
    const addItemsRecursively = (items: TreeItem[]) => {
      for (const item of items) {
        this._allItemsFlat.push(item);
        addItemsRecursively(item.children);
      }
    };
    
    addItemsRecursively(this._cachedItems);
  }

  /**
   * Gets tree item
   */
  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Gets child elements
   */
  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      return this.getOpenEditors();
    }
    return element.children;
  }

  /**
   * Gets parent element
   */
  getParent(element: TreeItem): vscode.ProviderResult<TreeItem> {
    if (element.type === ItemType.File) {
      const parentPath = path.dirname(element.resourceUri.fsPath);
      // Find parent in flat list by path
      const parent = this._allItemsFlat.find(item => 
        item.type === ItemType.Folder && 
        item.resourceUri.fsPath === parentPath
      );
      return parent;
    } else if (element.type === ItemType.Folder) {
      const elementPath = element.resourceUri.fsPath;
      const parentPath = path.dirname(elementPath);
      
      // If parent path doesn't differ from element path - this is root
      if (parentPath === elementPath) {
        return null;
      }
      
      // Find parent in flat list
      const parent = this._allItemsFlat.find(item => 
        item.type === ItemType.Folder && 
        item.resourceUri.fsPath === parentPath
      );
      return parent;
    }
    return null;
  }

  /**
   * Returns flat list of all tree elements
   */
  getAllItems(): TreeItem[] {
    if (this._allItemsFlat.length === 0) {
      this.getOpenEditors(); // This will update caches
    }
    return this._allItemsFlat;
  }
  
  /**
   * Finds tree element by URI
   */
  findItemByUri(uri: vscode.Uri): TreeItem | undefined {
    const allItems = this.getAllItems();
    return allItems.find(item => 
      item.resourceUri.toString() === uri.toString()
    );
  }

  /**
   * Updates tree
   */
  refresh(): void {
    this._cachedItems = [];
    this._allItemsFlat = [];
    this._onDidChangeTreeData.fire();
  }
} 