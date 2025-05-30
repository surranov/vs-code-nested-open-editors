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
    
    // Проверяем является ли файл временным
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
    
    // Стандартная иконка для файла
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
   * Получает все открытые редакторы в виде дерева
   */
  private getOpenEditors(): TreeItem[] {
    // Корень дерева
    const rootItems: TreeItem[] = [];
    
    // Кэш папок по их полному пути для быстрого поиска
    const folderCache = new Map<string, TreeItem>();
    
    // Получаем все открытые файлы из всех групп табов
    const allTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
    
    // Создает или получает папку в дереве, создавая все родительские папки при необходимости
    const getOrCreateFolderHierarchy = (folderPath: string): TreeItem => {
      // Проверяем, есть ли уже папка в кэше
      const existingFolder = folderCache.get(folderPath);
      if (existingFolder) {
        return existingFolder;
      }
      
      // Получаем workspace папки
      const workspaceFolders = vscode.workspace.workspaceFolders || [];
      
      // Проверяем, находится ли папка внутри workspace
      const workspaceFolder = workspaceFolders.find(wsFolder => 
        folderPath.startsWith(wsFolder.uri.fsPath)
      );
      
      // Если папка не в workspace, не создаем для неё элемент дерева
      if (!workspaceFolder) {
        // Создаем элемент но не добавляем в дерево
        const folder = new TreeItem(vscode.Uri.file(folderPath), ItemType.Folder);
        folderCache.set(folderPath, folder);
        return folder;
      }
      
      // Создаем новую папку
      const folder = new TreeItem(vscode.Uri.file(folderPath), ItemType.Folder);
      folderCache.set(folderPath, folder);
      
      // Определяем родительский путь
      const parentPath = path.dirname(folderPath);
      
      // Если папка является workspace папкой или её родитель равен workspace, добавляем к корню
      if (folderPath === workspaceFolder.uri.fsPath || parentPath === workspaceFolder.uri.fsPath) {
        rootItems.push(folder);
        return folder;
      }
      
      // Если нет родительского пути (корень файловой системы), добавляем к корню дерева
      if (parentPath === folderPath) {
        rootItems.push(folder);
        return folder;
      }
      
      // Рекурсивно создаем родительскую папку и добавляем текущую как дочернюю
      const parentFolder = getOrCreateFolderHierarchy(parentPath);
      parentFolder.children.push(folder);
      
      return folder;
    };
    
    // Обработка каждого открытого файла
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
      
      // Получаем workspace папки
      const workspaceFolders = vscode.workspace.workspaceFolders || [];
      
      // Проверяем, находится ли файл в workspace
      const workspaceFolder = workspaceFolders.find(wsFolder => 
        filePath.startsWith(wsFolder.uri.fsPath)
      );
      
      // Если файл не в workspace, пропускаем его
      if (!workspaceFolder) {
        continue;
      }
      
      // Если файл находится в корне workspace, добавляем его напрямую в корень дерева
      if (dirPath === workspaceFolder.uri.fsPath) {
        const fileItem = new TreeItem(uri, ItemType.File);
        rootItems.push(fileItem);
        continue;
      }
      
      // Получаем или создаем иерархию папок для этого файла
      const folderItem = getOrCreateFolderHierarchy(dirPath);
      
      // Добавляем файл в папку
      const fileItem = new TreeItem(uri, ItemType.File);
      folderItem.children.push(fileItem);
    }
    
    // Сортируем все папки и файлы
    const sortTreeItems = (items: TreeItem[]): void => {
      // Сортируем элементы на текущем уровне
      items.sort((a, b) => {
        // Сначала папки, потом файлы
        if (a.type !== b.type) {
          return a.type === ItemType.Folder ? -1 : 1;
        }
        // В рамках одного типа - по алфавиту
        return a.resourceUri.fsPath.localeCompare(b.resourceUri.fsPath);
      });
      
      // Рекурсивно сортируем дочерние элементы
      for (const item of items) {
        if (item.children.length > 0) {
          sortTreeItems(item.children);
        }
      }
    };
    
    // Сортируем дерево
    sortTreeItems(rootItems);
    
    // Сохраняем результат в кэше
    this._cachedItems = rootItems;
    this._updateFlatItemsList();
    
    return rootItems;
  }
  
  /**
   * Обновляет плоский список всех элементов для быстрого поиска
   */
  private _updateFlatItemsList(): void {
    this._allItemsFlat = [];
    
    // Функция для рекурсивного добавления элементов в плоский список
    const addItemsRecursively = (items: TreeItem[]) => {
      for (const item of items) {
        this._allItemsFlat.push(item);
        addItemsRecursively(item.children);
      }
    };
    
    addItemsRecursively(this._cachedItems);
  }

  /**
   * Получает дерево элементов
   */
  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Получает дочерние элементы
   */
  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      return this.getOpenEditors();
    }
    return element.children;
  }

  /**
   * Получает родительский элемент
   */
  getParent(element: TreeItem): vscode.ProviderResult<TreeItem> {
    if (element.type === ItemType.File) {
      const parentPath = path.dirname(element.resourceUri.fsPath);
      // Ищем родителя в плоском списке по пути
      const parent = this._allItemsFlat.find(item => 
        item.type === ItemType.Folder && 
        item.resourceUri.fsPath === parentPath
      );
      return parent;
    } else if (element.type === ItemType.Folder) {
      const elementPath = element.resourceUri.fsPath;
      const parentPath = path.dirname(elementPath);
      
      // Если путь родителя не отличается от пути элемента - это корень
      if (parentPath === elementPath) {
        return null;
      }
      
      // Ищем родителя в плоском списке
      const parent = this._allItemsFlat.find(item => 
        item.type === ItemType.Folder && 
        item.resourceUri.fsPath === parentPath
      );
      return parent;
    }
    return null;
  }

  /**
   * Возвращает плоский список всех элементов дерева
   */
  getAllItems(): TreeItem[] {
    if (this._allItemsFlat.length === 0) {
      this.getOpenEditors(); // Это обновит кэши
    }
    return this._allItemsFlat;
  }
  
  /**
   * Находит элемент дерева по URI
   */
  findItemByUri(uri: vscode.Uri): TreeItem | undefined {
    const allItems = this.getAllItems();
    return allItems.find(item => 
      item.resourceUri.toString() === uri.toString()
    );
  }

  /**
   * Обновляет дерево
   */
  refresh(): void {
    this._cachedItems = [];
    this._allItemsFlat = [];
    this._onDidChangeTreeData.fire();
  }
} 