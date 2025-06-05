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
    // Устанавливаем resourceUri для поддержки стандартных команд VS Code
    this.resourceUri = resourceUri;
    
    // Устанавливаем уникальный ID на основе полного пути + типа
    // Это поможет VS Code различать элементы с одинаковыми именами
    this.id = `${this.type}:${resourceUri.toString()}`;
    
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
    // Используем стандартный contextValue для поддержки встроенных команд VS Code
    this.contextValue = 'file';
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
    // Используем стандартный contextValue для поддержки встроенных команд VS Code
    this.contextValue = 'folder';
    this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

/**
 * Main tree data provider for the nested open editors view
 */
export class NestedOpenEditorsProvider implements vscode.TreeDataProvider<TreeItem>, vscode.TreeDragAndDropController<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  private _cachedItems: TreeItem[] = [];
  private _allItemsFlat: TreeItem[] = [];

  // Drag and Drop support
  readonly dropMimeTypes = ['application/vnd.code.tree.nestedOpenEditors', 'text/uri-list'];
  readonly dragMimeTypes = ['text/uri-list'];

  /**
   * Handles drag operation - определяет что можно перетаскивать
   */
  async handleDrag(source: TreeItem[], treeDataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
    // Создаем данные для передачи при перетаскивании
    const dragData = source.map(item => ({
      uri: item.resourceUri.toString(),
      type: item.type,
      label: item.label
    }));
    
    // Устанавливаем данные в transfer объект
    treeDataTransfer.set('application/vnd.code.tree.nestedOpenEditors', new vscode.DataTransferItem(dragData));
    
    // Также добавляем URI для совместимости с другими компонентами VS Code
    const uriList = source.map(item => item.resourceUri.toString()).join('\n');
    treeDataTransfer.set('text/uri-list', new vscode.DataTransferItem(uriList));
  }

  /**
   * Handles drop operation - обрабатывает сброс элементов
   */
  async handleDrop(target: TreeItem | undefined, sources: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
    // Сначала пытаемся получить данные из нашего внутреннего формата
    let draggedItems: Array<{uri: string, type: string, label: string}> = [];
    
    const internalTransferItem = sources.get('application/vnd.code.tree.nestedOpenEditors');
    if (internalTransferItem) {
      draggedItems = internalTransferItem.value as Array<{uri: string, type: string, label: string}>;
    } else {
      // Если нет внутренних данных, пытаемся получить URI из внешних источников
      const uriTransferItem = sources.get('text/uri-list');
      if (uriTransferItem) {
        const uriList = uriTransferItem.value as string;
        const uris = uriList.split('\n').filter(uri => uri.trim().length > 0);
        
        // Преобразуем URI в наш формат
        draggedItems = await Promise.all(uris.map(async (uriString) => {
          const uri = vscode.Uri.parse(uriString);
          try {
            const stat = await vscode.workspace.fs.stat(uri);
            const isDirectory = stat.type === vscode.FileType.Directory;
            return {
              uri: uriString,
              type: isDirectory ? ItemType.Folder : ItemType.File,
              label: path.basename(uri.fsPath)
            };
          } catch {
            // Если не удалось получить статистику, считаем файлом
            return {
              uri: uriString,
              type: ItemType.File,
              label: path.basename(uri.fsPath)
            };
          }
        }));
      }
    }

    if (!draggedItems || draggedItems.length === 0) {
      return;
    }

    // Определяем целевую папку
    let targetFolder: TreeItem | undefined;
    
    if (!target) {
      // Сброс в корень - не поддерживается для открытых файлов
      vscode.window.showWarningMessage('Нельзя перемещать файлы в корень дерева открытых редакторов');
      return;
    }
    
    if (target.type === ItemType.Folder) {
      targetFolder = target;
    } else if (target.type === ItemType.File) {
      // Если сбросили на файл, используем его родительскую папку
      const parentPath = path.dirname(target.resourceUri.fsPath);
      targetFolder = this._allItemsFlat.find(item => 
        item.type === ItemType.Folder && 
        item.resourceUri.fsPath === parentPath
      );
    }

    if (!targetFolder) {
      vscode.window.showErrorMessage('Не удалось определить целевую папку');
      return;
    }

    // Обрабатываем каждый перетаскиваемый элемент
    for (const draggedItem of draggedItems) {
      const sourceUri = vscode.Uri.parse(draggedItem.uri);
      
      // Проверяем, что не пытаемся переместить папку в саму себя
      if (draggedItem.type === ItemType.Folder && 
          targetFolder.resourceUri.fsPath.startsWith(sourceUri.fsPath)) {
        vscode.window.showWarningMessage(`Нельзя переместить папку "${draggedItem.label}" в саму себя`);
        continue;
      }

      // Проверяем, открыт ли файл в редакторе
      const isFileOpen = this.isFileOpenInEditor(sourceUri);
      
      if (isFileOpen) {
        // Если файл открыт, выполняем перемещение в файловой системе
        await this.moveFileToFolder(sourceUri, targetFolder.resourceUri);
      } else {
        // Если файл не открыт, предлагаем открыть его или переместить
        const action = await vscode.window.showInformationMessage(
          `Файл "${draggedItem.label}" не открыт в редакторе. Что вы хотите сделать?`,
          'Открыть файл', 'Переместить файл', 'Отмена'
        );
        
        if (action === 'Открыть файл') {
          // Открываем файл в редакторе
          await vscode.window.showTextDocument(sourceUri);
        } else if (action === 'Переместить файл') {
          // Перемещаем файл в файловой системе
          await this.moveFileToFolder(sourceUri, targetFolder.resourceUri);
        }
        // Если выбрана "Отмена", ничего не делаем
      }
    }

    // Обновляем дерево после перемещения
    this.refresh();
  }

  /**
   * Проверяет, открыт ли файл в редакторе
   */
  private isFileOpenInEditor(uri: vscode.Uri): boolean {
    const allTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
    return allTabs.some(tab => 
      tab.input instanceof vscode.TabInputText && 
      tab.input.uri.toString() === uri.toString()
    );
  }

  /**
   * Перемещает файл в указанную папку
   */
  private async moveFileToFolder(sourceUri: vscode.Uri, targetFolderUri: vscode.Uri): Promise<void> {
    try {
      const fileName = path.basename(sourceUri.fsPath);
      const targetUri = vscode.Uri.file(path.join(targetFolderUri.fsPath, fileName));
      
      // Проверяем, что целевой файл не существует
      try {
        await vscode.workspace.fs.stat(targetUri);
        const overwrite = await vscode.window.showWarningMessage(
          `Файл "${fileName}" уже существует в целевой папке. Перезаписать?`,
          'Да', 'Нет'
        );
        if (overwrite !== 'Да') {
          return;
        }
      } catch {
        // Файл не существует, можно продолжать
      }

      // Выполняем перемещение
      await vscode.workspace.fs.rename(sourceUri, targetUri, { overwrite: true });
      
      vscode.window.showInformationMessage(`Файл "${fileName}" успешно перемещен`);
    } catch (error) {
      vscode.window.showErrorMessage(`Ошибка при перемещении файла: ${error}`);
    }
  }

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
    const targetUriString = uri.toString();
    
    // Ищем точное совпадение по полному URI
    const exactMatch = allItems.find(item => 
      item.resourceUri.toString() === targetUriString
    );
    
    if (exactMatch) {
      console.log(`Found exact match for ${targetUriString}: ${exactMatch.resourceUri.toString()}`);
      return exactMatch;
    }
    
    // Если точное совпадение не найдено, логируем для отладки
    console.log(`No exact match found for ${targetUriString}. Available items:`);
    allItems.forEach(item => {
      console.log(`  - ${item.resourceUri.toString()}`);
    });
    
    return undefined;
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