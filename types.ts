export interface ProgressState {
  active: boolean;
  status: string;
  current: number;
  total: number;
}

export interface Project {
  id: string;
  name: string;
  code: string;
  updatedAt: number;
}

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface ModalState {
  type: 'confirm' | 'prompt';
  title: string;
  description: string;
  confirmText?: string;
  isDestructive?: boolean;
  onConfirm: (val?: string) => void;
}

export interface LayerNode {
  id: string;
  tagName: string;
  className: string;
  text?: string;
  children?: LayerNode[];
  hasChildren: boolean;
}

export interface SelectedElementData {
  id: string;
  tagName: string;
  className: string;
  text: string;
  rect: { top: number; left: number; width: number; height: number; bottom: number; right: number };
  styles: {
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontFamily: string;
    borderRadius: string;
    padding: string;
    lineHeight: string;
    letterSpacing: string;
    backgroundImage: string;
    backgroundSize: string;
    backgroundPosition: string;
    backgroundRepeat: string;
    width: string;
    height: string;
    rotation: string; // stored as degrees "45"
  };
}

export interface ContextMenuState {
  x: number;
  y: number;
  id: string;
}