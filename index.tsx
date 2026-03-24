import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import Editor from '@monaco-editor/react';
import { Loader2, CheckCircle2, AlertCircle, Info, MousePointer2, X, Move, Minus, Plus, Maximize } from 'lucide-react';

import { Project, Toast, ModalState, ProgressState, SelectedElementData } from './types';
import { STORAGE_KEY, DEFAULT_CODE } from './constants';
import { handleExportAll, handleExportSingle } from './utils';
import { useEditor } from './hooks/useEditor';

import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { PropertyPopup } from './components/PropertyPopup'; 
import { ContextMenu } from './components/ContextMenu';

const App: React.FC = () => {
  // --- Global App State ---
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  
  // Layout State
  const [splitSize, setSplitSize] = useState(40);
  const [isResizing, setIsResizing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'projects' | 'layers'>('projects');

  // Canvas State
  const [canvasTransform, setCanvasTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  // UI Feedback State
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [progress, setProgress] = useState<ProgressState>({ active: false, status: '', current: 0, total: 0 });
  const [modal, setModal] = useState<ModalState | null>(null);
  const [modalInput, setModalInput] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);

  // --- Editor Hook ---
  const {
    code,
    setCode,
    history,
    undo,
    redo,
    iframeRef,
    layers,
    selectedElement,
    setSelectedElement,
    selectedLayerId,
    hoveredLayerId,
    contextMenu,
    setContextMenu,
    sendAction,
    updateProperty,
    addElement,
    handleLayerHover,
    handleLayerSelect
  } = useEditor({ 
    initialCode: DEFAULT_CODE 
  });

  // --- Effects ---
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [setContextMenu]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      } else if (e.code === 'Space' && !e.repeat && (e.target === document.body || e.target === canvasRef.current)) {
         e.preventDefault(); // Prevent scroll
         setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        setIsPanning(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [undo, redo]);

  // Center canvas initially
  useEffect(() => {
    if (canvasRef.current && iframeRef.current) {
        // Initial center attempt (simple approximation)
        setCanvasTransform({ x: 0, y: 0, scale: 0.85 });
    }
  }, []);


  // --- Helpers ---
  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // --- Canvas Interaction Logic ---
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomSensitivity = 0.001;
      const delta = -e.deltaY * zoomSensitivity;
      const newScale = Math.min(Math.max(0.1, canvasTransform.scale + delta), 5);
      
      setCanvasTransform(prev => ({ ...prev, scale: newScale }));
    } else {
      // Regular pan with wheel
      if (!isPanning) {
         setCanvasTransform(prev => ({ 
           ...prev, 
           x: prev.x - e.deltaX, 
           y: prev.y - e.deltaY 
         }));
      }
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Middle click or Space+Left Click
    if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
      e.preventDefault();
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setCanvasTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
  };

  const resetCanvas = () => {
    setCanvasTransform({ x: 0, y: 0, scale: 1 });
  };

  // --- Resizing Logic (Split Pane) ---
  const handleMouseDown = useCallback(() => {
    setIsResizing(true);
    document.body.classList.add('no-select');
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      if (isMobile) {
        const newHeight = (e.clientY / containerRef.current.offsetHeight) * 100;
        if (newHeight > 10 && newHeight < 80) setSplitSize(newHeight);
      } else {
        const newWidth = (e.clientX / containerRef.current.offsetWidth) * 100;
        if (newWidth > 15 && newWidth < 60) setSplitSize(newWidth);
      }
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.classList.remove('no-select');
    };
    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, isMobile]);

  // --- Project Actions ---
  const handleSaveProject = (asNew = false) => {
    if (currentProjectId && !asNew) {
      setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, code, updatedAt: Date.now() } : p));
      addToast('保存成功', 'success');
      return;
    }
    const defaultName = !currentProjectId 
      ? `项目 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
      : `${projects.find(p => p.id === currentProjectId)?.name || '未命名'} (副本)`;

    setModalInput(defaultName);
    setModal({
      type: 'prompt',
      title: asNew ? '另存为新项目' : '保存项目',
      description: '请输入项目名称以保存当前进度。',
      confirmText: '保存',
      onConfirm: (name) => {
        if (!name || !name.trim()) return;
        const newProject: Project = {
          id: Math.random().toString(36).substr(2, 9),
          name: name.trim(),
          code,
          updatedAt: Date.now()
        };
        setProjects(prev => [newProject, ...prev]);
        setCurrentProjectId(newProject.id);
        addToast(asNew ? '另存为成功' : '项目已创建', 'success');
      }
    });
  };

  const handleLoadProject = (project: Project) => {
    setModal({
      type: 'confirm',
      title: '加载项目',
      description: `确定要加载项目 "${project.name}" 吗？当前未保存的更改将丢失。`,
      confirmText: '加载',
      onConfirm: () => {
        setCode(project.code);
        setCurrentProjectId(project.id);
        setSidebarOpen(false);
        addToast(`已加载: ${project.name}`, 'info');
      }
    });
  };

  const handleDeleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setModal({
      type: 'confirm',
      title: '删除项目',
      description: '确定要删除这个项目吗？此操作无法撤销。',
      isDestructive: true,
      confirmText: '删除',
      onConfirm: () => {
        setProjects(prev => prev.filter(p => p.id !== id));
        if (currentProjectId === id) {
          setCurrentProjectId(null);
          addToast('当前项目已删除', 'info');
        } else {
          addToast('项目已删除', 'success');
        }
      }
    });
  };

  const handleCreateNew = () => {
    setModal({
      type: 'confirm',
      title: '新建项目',
      description: '确定要创建新项目吗？当前未保存的更改将丢失。',
      confirmText: '新建',
      onConfirm: () => {
        setCode(DEFAULT_CODE);
        setCurrentProjectId(null);
        setSidebarOpen(false);
        addToast('已新建空白项目', 'info');
      }
    });
  };

  const currentProjectName = projects.find(p => p.id === currentProjectId)?.name;

  const handleSingleExport = () => {
    if (selectedElement) {
      handleExportSingle(iframeRef, selectedElement.id, setProgress);
    }
  };

  // Adjust rects for scaled canvas
  const getAdjustedContextMenu = () => {
     if (!contextMenu || !canvasRef.current) return null;
     return contextMenu;
  };

  return (
    <div ref={containerRef} className="flex h-screen flex-col bg-slate-950 overflow-hidden relative font-sans text-slate-200">
      {/* Toast Container */}
      <div className="fixed top-20 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="flex items-center gap-2 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl shadow-xl animate-in slide-in-from-right fade-in duration-300">
            {t.type === 'success' && <CheckCircle2 className="w-5 h-5 text-green-400" />}
            {t.type === 'error' && <AlertCircle className="w-5 h-5 text-red-400" />}
            {t.type === 'info' && <Info className="w-5 h-5 text-indigo-400" />}
            <span className="text-sm font-medium text-slate-200">{t.message}</span>
          </div>
        ))}
      </div>

      <Header 
        currentProjectName={currentProjectName}
        onUndo={undo}
        onRedo={redo}
        canUndo={history.index > 0}
        canRedo={history.index < history.stack.length - 1}
        onSave={handleSaveProject}
        onExport={() => handleExportAll(iframeRef, setProgress)}
        toggleSidebar={(tab) => { setActiveTab(tab); setSidebarOpen(true); }}
        activeTab={activeTab}
        sidebarOpen={sidebarOpen}
      />

      {/* Main Layout */}
      <main className={`flex-1 flex overflow-hidden relative ${isMobile ? 'flex-col' : 'flex-row'}`}>
        
        {/* Left Column: Code Editor */}
        <div 
          className="bg-slate-900 border-slate-800 shrink-0 relative z-20"
          style={{ 
            width: isMobile ? '100%' : `${splitSize}%`, 
            height: isMobile ? `${splitSize}%` : '100%',
            borderRightWidth: isMobile ? 0 : 1,
            borderBottomWidth: isMobile ? 1 : 0
          }}
        >
          <Editor
            height="100%"
            defaultLanguage="html"
            theme="vs-dark"
            value={code}
            onChange={(val) => setCode(val || '')}
            options={{ fontSize: 13, minimap: { enabled: false }, wordWrap: 'on', padding: { top: 20 }, smoothScrolling: true }}
          />
        </div>

        {/* Resizer Handle */}
        <div 
          onMouseDown={handleMouseDown}
          className={`group transition-colors z-30 flex items-center justify-center shrink-0 ${isMobile ? 'w-full h-1.5 cursor-row-resize' : 'w-1.5 h-full cursor-col-resize'} ${isResizing ? 'bg-indigo-500' : 'bg-slate-800 hover:bg-indigo-400'}`}
        >
          <div className={`${isMobile ? 'w-12 h-[2px]' : 'w-[2px] h-8'} bg-slate-600 group-hover:bg-indigo-300 rounded-full`} />
        </div>

        {/* Center Column: Infinite Canvas */}
        <div 
          ref={canvasRef}
          className={`flex-1 h-full bg-[#1e1e2e] overflow-hidden relative flex flex-col items-center justify-center 
            ${(isPanning || isSpacePressed) ? 'cursor-grab active:cursor-grabbing' : ''}`}
          style={{ 
            backgroundImage: 'radial-gradient(#475569 1px, transparent 1px)', 
            backgroundSize: '24px 24px',
            backgroundColor: '#0f172a'
          }}
          onWheel={handleWheel}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        >
          {/* Canvas HUD */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 pointer-events-none">
             <div className="px-3 py-1.5 bg-slate-800/80 backdrop-blur rounded-full shadow-lg border border-slate-700 flex items-center gap-2 text-xs font-medium text-slate-300">
               <MousePointer2 className="w-3.5 h-3.5 text-indigo-400" />
               <span>画布模式</span>
             </div>
          </div>
          
          {/* Zoom Controls */}
          <div className="absolute bottom-6 left-6 z-10 flex items-center gap-1 bg-slate-800/90 backdrop-blur border border-slate-700 p-1 rounded-lg shadow-xl">
             <button onClick={() => setCanvasTransform(p => ({...p, scale: Math.max(0.1, p.scale - 0.1)}))} className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white"><Minus className="w-4 h-4" /></button>
             <span className="w-12 text-center text-xs font-mono text-slate-300">{Math.round(canvasTransform.scale * 100)}%</span>
             <button onClick={() => setCanvasTransform(p => ({...p, scale: Math.min(5, p.scale + 0.1)}))} className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white"><Plus className="w-4 h-4" /></button>
             <div className="w-px h-4 bg-slate-700 mx-1" />
             <button onClick={resetCanvas} className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white" title="复位 (Ctrl+0)"><Maximize className="w-4 h-4" /></button>
          </div>

          {/* Transform Layer */}
          <div 
             className="origin-center will-change-transform transition-transform duration-75"
             style={{ 
               transform: `translate(${canvasTransform.x}px, ${canvasTransform.y}px) scale(${canvasTransform.scale})`,
               width: '100%',
               height: '100%',
               display: 'flex',
               alignItems: 'center',
               justifyContent: 'center'
             }}
          >
             {/* Artboard / Iframe Wrapper */}
             <div 
               className="relative bg-transparent shadow-2xl shadow-black/50"
               style={{ 
                 width: '100%', // Use full width of container, or fixed size if preferred
                 height: '100%',
                 pointerEvents: (isPanning || isSpacePressed) ? 'none' : 'auto'
               }}
             >
                <iframe 
                  ref={iframeRef} 
                  className="w-full h-full border-none block" 
                  title="Preview" 
                  sandbox="allow-scripts allow-same-origin allow-modals" 
                />
             </div>
          </div>

          {isResizing && <div className="absolute inset-0 z-40 bg-transparent" />}

          {contextMenu && (
             <ContextMenu 
               menu={getAdjustedContextMenu()!} 
               onAction={sendAction} 
               onExport={handleSingleExport}
               onClose={() => setContextMenu(null)}
             />
          )}
        </div>

        {/* Right Column: Property Panel */}
        {!isMobile && (
          <PropertyPopup 
            element={selectedElement} 
            onUpdate={updateProperty} 
            onAction={sendAction}
            onExport={handleSingleExport}
          />
        )}
      </main>

      <Sidebar 
        isOpen={sidebarOpen}
        activeTab={activeTab}
        onClose={() => setSidebarOpen(false)}
        onChangeTab={setActiveTab}
        projects={projects}
        currentProjectId={currentProjectId}
        onLoadProject={handleLoadProject}
        onDeleteProject={handleDeleteProject}
        onCreateNew={handleCreateNew}
        onSaveAs={() => handleSaveProject(true)}
        onSave={() => handleSaveProject(false)}
        layers={layers}
        selectedLayerId={selectedLayerId}
        hoveredLayerId={hoveredLayerId}
        onSelectLayer={handleLayerSelect}
        onHoverLayer={handleLayerHover}
      />

      {/* Modals & Overlays */}
      {modal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 flex flex-col gap-4 animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start">
              <h3 className="text-lg font-bold text-white">{modal.title}</h3>
              <button onClick={() => setModal(null)} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-slate-400 text-sm">{modal.description}</p>
            {modal.type === 'prompt' && (
              <input autoFocus type="text" value={modalInput} onChange={e => setModalInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { modal.onConfirm(modalInput); setModal(null); }}} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500" placeholder="输入名称..." />
            )}
            <div className="flex gap-3 justify-end mt-2">
              <button onClick={() => setModal(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-800">取消</button>
              <button onClick={() => { modal.onConfirm(modal.type === 'prompt' ? modalInput : undefined); setModal(null); }} className={`px-4 py-2 rounded-lg text-sm font-medium text-white shadow-lg ${modal.isDestructive ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-500'}`}>{modal.confirmText || '确定'}</button>
            </div>
          </div>
        </div>
      )}

      {progress.active && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xl animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-8 flex flex-col items-center text-center">
            <Loader2 className="w-10 h-10 text-indigo-400 animate-spin mb-6" />
            <h3 className="text-xl font-bold text-white mb-2">{progress.status}</h3>
            <div className="w-full space-y-2 mt-4">
              <div className="flex justify-between text-xs text-slate-400"><span>Progress</span><span>{Math.round((progress.current/progress.total)*100)}%</span></div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${(progress.current/progress.total)*100}%` }} /></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);