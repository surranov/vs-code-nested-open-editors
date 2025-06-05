import * as vscode from 'vscode';
import * as path from 'path';
import { NestedOpenEditorsProvider, ItemType, TreeItem } from './nestedOpenEditorsProvider';

/**
 * Рекурсивно копирует папку со всем содержимым
 */
async function copyDirectoryRecursively(sourceUri: vscode.Uri, targetUri: vscode.Uri): Promise<void> {
  // Создаем целевую папку
  await vscode.workspace.fs.createDirectory(targetUri);
  
  // Читаем содержимое исходной папки
  const entries = await vscode.workspace.fs.readDirectory(sourceUri);
  
  // Копируем каждый элемент
  for (const [name, type] of entries) {
    const sourceItemUri = vscode.Uri.joinPath(sourceUri, name);
    const targetItemUri = vscode.Uri.joinPath(targetUri, name);
    
    if (type === vscode.FileType.File) {
      // Копируем файл
      await vscode.workspace.fs.copy(sourceItemUri, targetItemUri);
    } else if (type === vscode.FileType.Directory) {
      // Рекурсивно копируем подпапку
      await copyDirectoryRecursively(sourceItemUri, targetItemUri);
    }
  }
}

/**
 * Activates the extension
 */
export function activate(context: vscode.ExtensionContext) {
  // Create a tree provider for nested open editors
  const nestedOpenEditorsProvider = new NestedOpenEditorsProvider();
  
  // Register the provider for tree view
  const treeView = vscode.window.createTreeView('nestedOpenEditors', {
    treeDataProvider: nestedOpenEditorsProvider,
    showCollapseAll: false,
    canSelectMany: true,
    dragAndDropController: nestedOpenEditorsProvider
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
        console.log(`Revealing item: ${activeItem.resourceUri.fsPath} with ID: ${activeItem.id}`);
        treeView.reveal(activeItem, { select: true, focus: false, expand: true });
      } else {
        console.log(`No item found for URI: ${activeUri.toString()}`);
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

    // Контекстное меню команды
    vscode.commands.registerCommand('nestedOpenEditors.copyPath', (treeItem: TreeItem) => {
      vscode.env.clipboard.writeText(treeItem.resourceUri.fsPath);
      vscode.window.showInformationMessage(`Путь скопирован: ${treeItem.resourceUri.fsPath}`);
    }),

    vscode.commands.registerCommand('nestedOpenEditors.copyRelativePath', (treeItem: TreeItem) => {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(treeItem.resourceUri);
      if (workspaceFolder) {
        const relativePath = vscode.workspace.asRelativePath(treeItem.resourceUri, false);
        vscode.env.clipboard.writeText(relativePath);
        vscode.window.showInformationMessage(`Относительный путь скопирован: ${relativePath}`);
      } else {
        vscode.env.clipboard.writeText(treeItem.resourceUri.fsPath);
        vscode.window.showInformationMessage(`Путь скопирован: ${treeItem.resourceUri.fsPath}`);
      }
    }),

    vscode.commands.registerCommand('nestedOpenEditors.revealInOS', (treeItem: TreeItem) => {
      vscode.commands.executeCommand('revealFileInOS', treeItem.resourceUri);
    }),

    vscode.commands.registerCommand('nestedOpenEditors.openFile', (treeItem: TreeItem) => {
      vscode.commands.executeCommand('vscode.open', treeItem.resourceUri);
    }),

    vscode.commands.registerCommand('nestedOpenEditors.openToSide', (treeItem: TreeItem) => {
      vscode.commands.executeCommand('vscode.open', treeItem.resourceUri, { viewColumn: vscode.ViewColumn.Beside });
    }),

    vscode.commands.registerCommand('nestedOpenEditors.openWith', (treeItem: TreeItem) => {
      vscode.commands.executeCommand('vscode.openWith', treeItem.resourceUri);
    }),

    vscode.commands.registerCommand('nestedOpenEditors.openInTerminal', (treeItem: TreeItem) => {
      if (treeItem.type === ItemType.Folder) {
        vscode.commands.executeCommand('openInTerminal', treeItem.resourceUri);
      }
    })
  ];

  // Переменная для сравнения файлов
  let selectedForCompare: vscode.Uri | undefined = undefined;

  // Переменные для операций cut/copy/paste
  let clipboardItem: { uri: vscode.Uri; operation: 'cut' | 'copy' } | undefined = undefined;

  // Дополнительные команды для контекстного меню
  const additionalCommands = [
    vscode.commands.registerCommand('nestedOpenEditors.selectForCompare', (treeItem: TreeItem) => {
      selectedForCompare = treeItem.resourceUri;
      vscode.window.showInformationMessage(`Выбрано для сравнения: ${treeItem.label}`);
    }),

    vscode.commands.registerCommand('nestedOpenEditors.compareWithSelected', (treeItem: TreeItem) => {
      if (selectedForCompare) {
        vscode.commands.executeCommand('vscode.diff', selectedForCompare, treeItem.resourceUri, `${selectedForCompare.fsPath} ↔ ${treeItem.resourceUri.fsPath}`);
        selectedForCompare = undefined;
      } else {
        vscode.window.showWarningMessage('Сначала выберите файл для сравнения');
      }
    }),

    vscode.commands.registerCommand('nestedOpenEditors.cut', (treeItem: TreeItem) => {
      clipboardItem = { uri: treeItem.resourceUri, operation: 'cut' };
      vscode.env.clipboard.writeText(treeItem.resourceUri.fsPath);
      vscode.window.showInformationMessage(`Вырезано: ${treeItem.label}`);
    }),

    vscode.commands.registerCommand('nestedOpenEditors.copy', (treeItem: TreeItem) => {
      clipboardItem = { uri: treeItem.resourceUri, operation: 'copy' };
      vscode.env.clipboard.writeText(treeItem.resourceUri.fsPath);
      vscode.window.showInformationMessage(`Скопировано: ${treeItem.label}`);
    }),

    vscode.commands.registerCommand('nestedOpenEditors.rename', async (treeItem: TreeItem) => {
      const currentName = treeItem.label as string;
      const newName = await vscode.window.showInputBox({
        prompt: 'Введите новое имя',
        value: currentName,
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Имя не может быть пустым';
          }
          if (value.includes('/') || value.includes('\\')) {
            return 'Имя не может содержать слеши';
          }
          return undefined;
        }
      });

      if (newName && newName !== currentName) {
        const oldUri = treeItem.resourceUri;
        const newUri = vscode.Uri.joinPath(oldUri, '..', newName);
        
        try {
          await vscode.workspace.fs.rename(oldUri, newUri);
          vscode.window.showInformationMessage(`Переименовано: ${currentName} → ${newName}`);
          revealActiveEditor(); // Обновляем дерево
        } catch (error) {
          vscode.window.showErrorMessage(`Ошибка переименования: ${error}`);
        }
      }
    }),

    vscode.commands.registerCommand('nestedOpenEditors.delete', async (treeItem: TreeItem) => {
      const fileName = treeItem.label as string;
      const confirmation = await vscode.window.showWarningMessage(
        `Вы действительно хотите удалить "${fileName}"?`,
        { modal: true },
        'Удалить'
      );

      if (confirmation === 'Удалить') {
        try {
          await vscode.workspace.fs.delete(treeItem.resourceUri, { recursive: true, useTrash: true });
          vscode.window.showInformationMessage(`Удалено: ${fileName}`);
          revealActiveEditor(); // Обновляем дерево
        } catch (error) {
          vscode.window.showErrorMessage(`Ошибка удаления: ${error}`);
                 }
       }
     }),

    vscode.commands.registerCommand('nestedOpenEditors.paste', async (treeItem: TreeItem) => {
      if (!clipboardItem) {
        vscode.window.showWarningMessage('Нет элементов для вставки');
        return;
      }

      if (treeItem.type !== ItemType.Folder) {
        vscode.window.showWarningMessage('Можно вставлять только в папки');
        return;
      }

      const sourceUri = clipboardItem.uri;
      const targetFolderUri = treeItem.resourceUri;
      const fileName = sourceUri.fsPath.split('/').pop() || 'unknown';
      const targetUri = vscode.Uri.joinPath(targetFolderUri, fileName);

      try {
        if (clipboardItem.operation === 'cut') {
          // Перемещение файла
          await vscode.workspace.fs.rename(sourceUri, targetUri);
          vscode.window.showInformationMessage(`Перемещено: ${fileName}`);
          clipboardItem = undefined; // Очищаем clipboard после cut
        } else {
          // Копирование файла
          await vscode.workspace.fs.copy(sourceUri, targetUri);
          vscode.window.showInformationMessage(`Скопировано: ${fileName}`);
        }
        revealActiveEditor(); // Обновляем дерево
      } catch (error) {
        vscode.window.showErrorMessage(`Ошибка при вставке: ${error}`);
      }
    }),

    vscode.commands.registerCommand('nestedOpenEditors.newFile', async (treeItem: TreeItem) => {
      if (treeItem.type !== ItemType.Folder) {
        vscode.window.showWarningMessage('Можно создавать файлы только в папках');
        return;
      }

      const fileName = await vscode.window.showInputBox({
        prompt: 'Введите имя нового файла',
        value: 'newfile.txt',
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Имя файла не может быть пустым';
          }
          if (value.includes('/') || value.includes('\\')) {
            return 'Имя файла не может содержать слеши';
          }
          return undefined;
        }
      });

      if (fileName) {
        try {
          const newFileUri = vscode.Uri.joinPath(treeItem.resourceUri, fileName);
          await vscode.workspace.fs.writeFile(newFileUri, new Uint8Array(0)); // Создаем пустой файл
          vscode.window.showInformationMessage(`Создан файл: ${fileName}`);
          
          // Открываем новый файл в редакторе
          await vscode.commands.executeCommand('vscode.open', newFileUri);
          revealActiveEditor(); // Обновляем дерево
        } catch (error) {
          vscode.window.showErrorMessage(`Ошибка создания файла: ${error}`);
        }
      }
    }),

    vscode.commands.registerCommand('nestedOpenEditors.newFolder', async (treeItem: TreeItem) => {
      if (treeItem.type !== ItemType.Folder) {
        vscode.window.showWarningMessage('Можно создавать папки только в папках');
        return;
      }

      const folderName = await vscode.window.showInputBox({
        prompt: 'Введите имя новой папки',
        value: 'новая папка',
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Имя папки не может быть пустым';
          }
          if (value.includes('/') || value.includes('\\')) {
            return 'Имя папки не может содержать слеши';
          }
          return undefined;
        }
      });

      if (folderName) {
        try {
          const newFolderUri = vscode.Uri.joinPath(treeItem.resourceUri, folderName);
          await vscode.workspace.fs.createDirectory(newFolderUri);
          vscode.window.showInformationMessage(`Создана папка: ${folderName}`);
                   revealActiveEditor(); // Обновляем дерево
       } catch (error) {
         vscode.window.showErrorMessage(`Ошибка создания папки: ${error}`);
       }
     }
   }),

   vscode.commands.registerCommand('nestedOpenEditors.duplicate', async (treeItem: TreeItem) => {
     try {
       const sourceUri = treeItem.resourceUri;
       const sourcePath = sourceUri.fsPath;
       const parentPath = path.dirname(sourcePath);
       const baseName = path.basename(sourcePath);
       
       let duplicateName: string;
       let duplicateUri: vscode.Uri;
       let counter = 1;
       
       if (treeItem.type === ItemType.File) {
         // Для файлов: разделяем имя и расширение
         const extension = path.extname(baseName);
         const nameWithoutExtension = path.basename(baseName, extension);
         
         // Генерируем уникальное имя
         do {
           duplicateName = counter === 1 
             ? `${nameWithoutExtension} (copy)${extension}`
             : `${nameWithoutExtension} (copy ${counter})${extension}`;
           duplicateUri = vscode.Uri.file(path.join(parentPath, duplicateName));
           
           try {
             await vscode.workspace.fs.stat(duplicateUri);
             counter++; // Файл существует, увеличиваем счетчик
           } catch {
             break; // Файл не существует, можно использовать это имя
           }
         } while (counter < 100); // Защита от бесконечного цикла
         
         // Копируем файл
         await vscode.workspace.fs.copy(sourceUri, duplicateUri);
         vscode.window.showInformationMessage(`Файл продублирован: ${duplicateName}`);
         
         // Открываем дублированный файл
         await vscode.commands.executeCommand('vscode.open', duplicateUri);
         
       } else if (treeItem.type === ItemType.Folder) {
         // Для папок
         do {
           duplicateName = counter === 1 
             ? `${baseName} (copy)`
             : `${baseName} (copy ${counter})`;
           duplicateUri = vscode.Uri.file(path.join(parentPath, duplicateName));
           
           try {
             await vscode.workspace.fs.stat(duplicateUri);
             counter++; // Папка существует, увеличиваем счетчик
           } catch {
             break; // Папка не существует, можно использовать это имя
           }
         } while (counter < 100); // Защита от бесконечного цикла
         
         // Копируем папку со всем содержимым
         await copyDirectoryRecursively(sourceUri, duplicateUri);
         vscode.window.showInformationMessage(`Папка продублирована: ${duplicateName}`);
       }
       
       revealActiveEditor(); // Обновляем дерево
       
     } catch (error) {
       vscode.window.showErrorMessage(`Ошибка дублирования: ${error}`);
     }
   })
 ];

  // Add all subscriptions to context
  context.subscriptions.push(...subscriptions, ...additionalCommands, treeView);
}

/**
 * Deactivates the extension
 */
export function deactivate() {} 