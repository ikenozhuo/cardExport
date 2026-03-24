export const STORAGE_KEY = 'ios-card-pro-projects';

export const EDITOR_SCRIPT = `
<script>
(function() {
  let selectedEl = null;
  let hoveredEl = null;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  
  // Drag state
  let initialTranslate = { x: 0, y: 0 };
  let currentRotation = 0; // degrees
  
  const EDITOR_ID = 'ios-card-editor-style';

  function injectStyles() {
    if (document.getElementById(EDITOR_ID)) return;
    const style = document.createElement('style');
    style.id = EDITOR_ID;
    style.innerHTML = \`
      .iso-hover { outline: 2px solid #818cf8 !important; cursor: pointer; }
      .iso-selected { outline: 2px solid #4f46e5 !important; z-index: 50; }
      .iso-dragging { opacity: 0.8; cursor: grabbing !important; }
      *[contenteditable="true"] { outline: 2px dashed #f59e0b !important; cursor: text !important; }
      body { user-select: none; } 
    \`;
    document.head.appendChild(style);
  }

  function rgbToHex(rgb) {
    if (!rgb || rgb === 'rgba(0, 0, 0, 0)') return '#00000000'; // handle transparent
    if (rgb.startsWith('#')) return rgb;
    const sep = rgb.indexOf(',') > -1 ? ',' : ' ';
    const parts = rgb.substr(4).split(')')[0].split(sep);
    let r = (+parts[0]).toString(16),
        g = (+parts[1]).toString(16),
        b = (+parts[2]).toString(16);
    if (r.length === 1) r = "0" + r;
    if (g.length === 1) g = "0" + g;
    if (b.length === 1) b = "0" + b;
    return "#" + r + g + b;
  }

  // Parse Transform Matrix to get Translate X/Y and Rotation
  function getTransformData(el) {
    const style = window.getComputedStyle(el);
    const transform = style.transform;
    
    let x = 0, y = 0, rotation = 0;

    if (transform !== 'none') {
      const matrix = new WebKitCSSMatrix(transform);
      x = matrix.m41;
      y = matrix.m42;
      rotation = Math.round(Math.atan2(matrix.m12, matrix.m11) * (180/Math.PI));
    }
    
    return { x, y, rotation };
  }

  function getElementData(el) {
    const rect = el.getBoundingClientRect();
    const computed = window.getComputedStyle(el);
    const transformData = getTransformData(el);

    return {
      id: el.dataset.layerId,
      tagName: el.tagName.toLowerCase(),
      className: el.className.replace('iso-selected', '').replace('iso-hover', '').trim(),
      text: el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 ? el.innerText : '',
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right },
      styles: {
        color: rgbToHex(computed.color),
        backgroundColor: rgbToHex(computed.backgroundColor),
        fontSize: computed.fontSize,
        fontFamily: computed.fontFamily,
        borderRadius: computed.borderRadius,
        padding: computed.padding,
        lineHeight: computed.lineHeight,
        letterSpacing: computed.letterSpacing,
        backgroundImage: computed.backgroundImage,
        backgroundSize: computed.backgroundSize,
        backgroundPosition: computed.backgroundPosition,
        backgroundRepeat: computed.backgroundRepeat,
        width: computed.width,
        height: computed.height,
        rotation: transformData.rotation.toString()
      }
    };
  }

  function scanLayers(root = document.body) {
    if (!root) return [];
    const layers = [];
    
    const ensureId = (el) => {
      if (!el.dataset.layerId) {
        el.dataset.layerId = Math.random().toString(36).substr(2, 9);
      }
      return el.dataset.layerId;
    };

    Array.from(root.children).forEach(child => {
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') return;
      
      const layer = {
        id: ensureId(child),
        tagName: child.tagName.toLowerCase(),
        className: Array.from(child.classList).join(' '),
        text: (child.children.length === 0 && child.textContent.trim().length > 0) ? child.textContent.trim().substring(0, 20) : null,
        hasChildren: child.children.length > 0
      };
      if (child.children.length > 0) {
        layer.children = scanLayers(child);
      }
      layers.push(layer);
    });
    return layers;
  }

  function sendUpdate() {
    const bodyClone = document.body.cloneNode(true);
    const stripClasses = (el) => {
      el.classList.remove('iso-hover', 'iso-selected', 'iso-dragging');
      if (el.getAttribute('contenteditable')) el.removeAttribute('contenteditable');
      Array.from(el.children).forEach(stripClasses);
    };
    stripClasses(bodyClone);
    Array.from(bodyClone.querySelectorAll('script')).forEach(s => s.remove());

    window.parent.postMessage({
      type: 'CODE_UPDATE',
      html: bodyClone.innerHTML
    }, '*');
  }
  
  function sendLayers() {
    const layers = scanLayers();
    window.parent.postMessage({ type: 'LAYERS_UPDATE', layers }, '*');
  }

  // Interaction Handlers
  document.addEventListener('mouseover', (e) => {
    if (isDragging) return;
    if (hoveredEl && hoveredEl !== e.target) hoveredEl.classList.remove('iso-hover');
    hoveredEl = e.target;
    if (hoveredEl !== document.body && hoveredEl !== document.documentElement) {
      hoveredEl.classList.add('iso-hover');
      window.parent.postMessage({ type: 'HOVER_UPDATE', id: hoveredEl.dataset.layerId }, '*');
    }
  });

  document.addEventListener('mouseout', (e) => {
    if (e.target.classList.contains('iso-hover')) {
      e.target.classList.remove('iso-hover');
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;

    if (e.target === document.body || e.target === document.documentElement) {
       if (selectedEl) selectedEl.classList.remove('iso-selected');
       selectedEl = null;
       window.parent.postMessage({ type: 'SELECTION_CLEAR' }, '*');
       return;
    }
    
    if (e.target.isContentEditable) return;

    e.preventDefault();
    e.stopPropagation();

    if (selectedEl && selectedEl !== e.target) {
      selectedEl.classList.remove('iso-selected');
      if (selectedEl.getAttribute('contenteditable')) selectedEl.removeAttribute('contenteditable');
    }
    
    selectedEl = e.target;
    selectedEl.classList.add('iso-selected');
    
    window.parent.postMessage({ 
      type: 'SELECTION_UPDATE', 
      data: getElementData(selectedEl)
    }, '*');

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    
    // Capture initial transform state for dragging
    const tf = getTransformData(selectedEl);
    initialTranslate = { x: tf.x, y: tf.y };
    currentRotation = tf.rotation;

    selectedEl.classList.add('iso-dragging');
  });

  document.addEventListener('contextmenu', (e) => {
    if (e.target === document.body || e.target === document.documentElement) return;
    e.preventDefault();
    e.stopPropagation();

    if (selectedEl !== e.target) {
       if (selectedEl) selectedEl.classList.remove('iso-selected');
       selectedEl = e.target;
       selectedEl.classList.add('iso-selected');
    }

    window.parent.postMessage({
      type: 'CONTEXT_MENU_OPEN',
      x: e.clientX,
      y: e.clientY,
      id: selectedEl.dataset.layerId,
      data: getElementData(selectedEl)
    }, '*');
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging || !selectedEl) return;
    e.preventDefault();
    
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    const newX = initialTranslate.x + dx;
    const newY = initialTranslate.y + dy;
    
    // Apply transform while preserving rotation
    // Note: We apply translate first, then rotate. CSS Transform order matters.
    // If we use 'translate(x,y) rotate(deg)', axes rotate.
    // However, matrix extraction earlier treats them as absolute visual position.
    // For simplicity in this drag implementation, we construct valid CSS:
    selectedEl.style.transform = \`translate(\${newX}px, \${newY}px) rotate(\${currentRotation}deg)\`;
  });

  document.addEventListener('mouseup', () => {
    if (isDragging && selectedEl) {
      selectedEl.classList.remove('iso-dragging');
      isDragging = false;
      window.parent.postMessage({ 
        type: 'SELECTION_UPDATE', 
        data: getElementData(selectedEl)
      }, '*');
      sendUpdate(); 
    }
  });

  document.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selectedEl) {
      selectedEl.contentEditable = "true";
      selectedEl.focus();
    }
  });
  
  document.addEventListener('focusout', (e) => {
    if (e.target.isContentEditable) {
      e.target.removeAttribute('contenteditable');
      sendUpdate();
      if (selectedEl === e.target) {
         window.parent.postMessage({ 
          type: 'SELECTION_UPDATE', 
          data: getElementData(selectedEl)
        }, '*');
      }
    }
  }, true);

  window.addEventListener('message', (event) => {
    const { type, id, updates, action, elementData } = event.data;
    
    if (type === 'HIGHLIGHT_LAYER') {
      if (hoveredEl) hoveredEl.classList.remove('iso-hover');
      const el = document.querySelector(\`[data-layer-id="\${id}"]\`);
      if (el) {
        hoveredEl = el;
        el.classList.add('iso-hover');
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }
    }
    
    if (type === 'SELECT_LAYER') {
       if (selectedEl) selectedEl.classList.remove('iso-selected');
       const el = document.querySelector(\`[data-layer-id="\${id}"]\`);
       if (el) {
         selectedEl = el;
         el.classList.add('iso-selected');
         window.parent.postMessage({ 
            type: 'SELECTION_UPDATE', 
            data: getElementData(selectedEl)
          }, '*');
       }
    }

    if (type === 'UPDATE_ELEMENT') {
      const el = document.querySelector(\`[data-layer-id="\${id}"]\`);
      if (el) {
        if (updates.className !== undefined) el.className = updates.className + ' iso-selected';
        if (updates.text !== undefined) el.innerText = updates.text;
        
        // Handle Style Updates
        if (updates.style) {
          // Special handling for rotation vs transform
          if (updates.style.rotation !== undefined) {
             const rot = updates.style.rotation;
             const currentTf = getTransformData(el);
             // Preserve translation, update rotation
             el.style.transform = \`translate(\${currentTf.x}px, \${currentTf.y}px) rotate(\${rot}deg)\`;
             delete updates.style.rotation; // consume it
          }

          Object.assign(el.style, updates.style);
        }
        sendUpdate();
      }
    }

    if (type === 'ADD_ELEMENT' && elementData) {
       const newEl = document.createElement(elementData.tagName);
       newEl.dataset.layerId = Math.random().toString(36).substr(2, 9);
       
       if (elementData.className) newEl.className = elementData.className;
       if (elementData.text) newEl.innerText = elementData.text;
       if (elementData.src) newEl.src = elementData.src;
       if (elementData.style) Object.assign(newEl.style, elementData.style);

       // Determine insertion point
       let container = document.body;
       if (selectedEl && selectedEl !== document.body && selectedEl !== document.documentElement) {
          // If selected is a container-like element (div, section, etc), append inside
          // Otherwise append to its parent
          const voidTags = ['img', 'input', 'hr', 'br'];
          if (voidTags.includes(selectedEl.tagName.toLowerCase())) {
             container = selectedEl.parentNode;
          } else {
             container = selectedEl;
          }
       }
       
       container.appendChild(newEl);
       sendUpdate();
       sendLayers();
       
       // Select the new element
       setTimeout(() => {
          if (selectedEl) selectedEl.classList.remove('iso-selected');
          selectedEl = newEl;
          selectedEl.classList.add('iso-selected');
           window.parent.postMessage({ 
            type: 'SELECTION_UPDATE', 
            data: getElementData(selectedEl)
          }, '*');
       }, 50);
    }

    if (type === 'ACTION_ELEMENT') {
       const el = document.querySelector(\`[data-layer-id="\${id}"]\`);
       if (el && el.parentNode) {
         const parent = el.parentNode;
         
         if (action === 'duplicate') {
           const clone = el.cloneNode(true);
           const regenerateIds = (node) => {
             node.dataset.layerId = Math.random().toString(36).substr(2, 9);
             node.classList.remove('iso-selected', 'iso-hover');
             Array.from(node.children).forEach(regenerateIds);
           };
           regenerateIds(clone);
           parent.insertBefore(clone, el.nextElementSibling);
         } 
         else if (action === 'delete') {
           el.remove();
           if (selectedEl === el) {
             selectedEl = null;
             window.parent.postMessage({ type: 'SELECTION_CLEAR' }, '*');
           }
         }
         else if (action === 'move_up') {
            if (el.nextElementSibling) {
              parent.insertBefore(el, el.nextElementSibling.nextElementSibling);
            }
         }
         else if (action === 'move_down') {
            if (el.previousElementSibling) {
              parent.insertBefore(el, el.previousElementSibling);
            }
         }
         else if (action === 'to_front') {
            parent.appendChild(el);
         }
         else if (action === 'to_back') {
            parent.prepend(el);
         }
         
         sendUpdate();
         sendLayers();
         if (selectedEl && action !== 'delete') {
             setTimeout(() => {
                window.parent.postMessage({ 
                    type: 'SELECTION_UPDATE', 
                    data: getElementData(selectedEl)
                }, '*');
             }, 10);
         }
       }
    }
  });

  injectStyles();
  sendLayers();
  
  const observer = new MutationObserver(() => {
    sendLayers();
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();
</script>
`;

export const DEFAULT_CODE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>字体测试</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- Google Fonts 链接，跨域修复版会自动处理 -->
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&display=swap" rel="stylesheet">
    <style>
        body { 
          font-family: 'Noto Sans SC', sans-serif; 
          background: transparent;
        }
    </style>
</head>
<body class="min-h-screen flex flex-col items-center justify-center gap-12 p-12">
    <!-- 基础卡片 1 -->
    <div class="bigoose-card w-[375px] h-[600px] bg-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col border border-slate-100 relative">
        <div class="h-1/2 bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center p-8">
            <div class="w-32 h-32 bg-white/20 backdrop-blur-xl rounded-full flex items-center justify-center border border-white/30 shadow-inner">
                <span class="text-6xl text-white select-none">🎨</span>
            </div>
        </div>
        <div class="p-10 flex flex-col flex-1 justify-between">
            <div>
                <h1 class="text-3xl font-black text-slate-800 mb-4">跨域字体修复</h1>
                <p class="text-slate-500 leading-relaxed text-lg">
                    双击编辑文本，拖拽移动元素。本工具支持图层解析。
                </p>
            </div>
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 font-bold">iOS</div>
                <span class="text-slate-400 font-medium">Design System</span>
            </div>
        </div>
    </div>

    <!-- 基础卡片 2 -->
    <div class="bigoose-card w-[375px] h-[600px] bg-slate-900 rounded-[40px] shadow-2xl overflow-hidden flex flex-col relative">
        <div class="p-10 flex flex-col flex-1 justify-between">
            <div>
                <h1 class="text-3xl font-black text-white mb-4">Canvas 模式</h1>
                <p class="text-slate-400 leading-relaxed text-lg">
                    所有元素都已分层。点击右侧图层面板查看结构。
                </p>
            </div>
            <div class="aspect-video bg-indigo-500/20 rounded-2xl border border-indigo-500/30 flex items-center justify-center">
                <span class="text-4xl select-none">🚀</span>
            </div>
        </div>
    </div>
</body>
</html>`;