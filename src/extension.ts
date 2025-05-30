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
  
  // Отслеживаем активные таймеры для отмены если новое событие произошло до выполнения предыдущего
  let revealTimeout: NodeJS.Timeout | undefined;
  
  // Флаг для отслеживания видимости нашего представления
  let isViewVisible = false;
  
  // Отслеживаем видимость нашего TreeView
  context.subscriptions.push(
    treeView.onDidChangeVisibility(e => {
      isViewVisible = e.visible;
      console.log(`TreeView visibility changed: ${isViewVisible}`);
      
      // Если представление стало видимым, обновляем выделение
      if (isViewVisible) {
        revealActiveEditor();
      }
    })
  );
  
  // Функция для выделения активного редактора в дереве
  const revealActiveEditor = () => {
    // Отменяем предыдущий таймер если он был
    if (revealTimeout) {
      clearTimeout(revealTimeout);
      revealTimeout = undefined;
    }
    
    // Проверяем, видно ли наше представление
    if (!isViewVisible) {
      return; // Если панель не видна, не делаем выделение
    }
    
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return;
    }
    
    // Получаем URI активного файла
    const activeUri = activeEditor.document.uri;
    
    // Обновляем дерево
    nestedOpenEditorsProvider.refresh();
    
    // Устанавливаем таймер для выделения файла после обновления дерева
    revealTimeout = setTimeout(() => {
      // Проверяем еще раз видимость (могла измениться за время таймера)
      if (!isViewVisible) {
        revealTimeout = undefined;
        return;
      }
      
      // Ищем элемент, соответствующий активному файлу
      const activeItem = nestedOpenEditorsProvider.findItemByUri(activeUri);
      
      // Если нашли элемент, выделяем его в дереве
      if (activeItem) {
        console.log(`Revealing item: ${activeItem.resourceUri.fsPath}`);
        treeView.reveal(activeItem, { select: true, focus: false, expand: true });
      }
      revealTimeout = undefined;
    }, 100);
  };
  
  // Определяем начальную видимость (асинхронно)
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