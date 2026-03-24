import { ProgressState } from './types';

let cachedStyleContent: string | null = null;
const originalImageSources = new Map<HTMLElement, string>();

// Helper: Convert image to Base64 (handling CORS via Proxy if needed)
const convertToDataURL = async (url: string): Promise<string | null> => {
  if (url.startsWith('data:')) return url;
  
  const fetchImage = async (targetUrl: string) => {
    const res = await fetch(targetUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Fetch failed');
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  try {
    return await fetchImage(url);
  } catch (e) {
    try {
      // Fallback to proxy
      return await fetchImage(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
    } catch (err) {
      console.warn('Image conversion failed:', url);
      return null;
    }
  }
};

const prepareExport = async (iframeDoc: Document) => {
  // 1. Remove editor specific styles
  const style = iframeDoc.getElementById('ios-card-editor-style');
  if (style) {
    cachedStyleContent = style.textContent;
    style.remove();
  }

  // 2. Inline Google Fonts
  const links = Array.from(iframeDoc.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];
  const googleFontLinks = links.filter(link => link.href.includes('fonts.googleapis.com'));
  
  await Promise.all(googleFontLinks.map(async (link) => {
    try {
      const res = await fetch(link.href);
      const css = await res.text();
      const s = iframeDoc.createElement('style');
      s.textContent = css;
      iframeDoc.head.appendChild(s);
      link.remove();
    } catch (e) {}
  }));

  // 3. Process Images (Proxies for CORS)
  const images = Array.from(iframeDoc.images);
  await Promise.all(images.map(async (img) => {
    if (img.src.startsWith('data:')) return;
    originalImageSources.set(img, img.src);
    const dataUrl = await convertToDataURL(img.src);
    if (dataUrl) {
      img.src = dataUrl;
      img.removeAttribute('srcset');
      // Wait for image decode
      await new Promise(r => { 
        if (img.complete) return r(null);
        img.onload = r; 
        img.onerror = r; 
      });
    }
  }));

  // 4. Process Background Images
  const elementsWithBg = Array.from(iframeDoc.querySelectorAll('*[style*="background-image"]')) as HTMLElement[];
  await Promise.all(elementsWithBg.map(async (el) => {
    const bg = el.style.backgroundImage;
    if (bg && bg.includes('url(') && !bg.includes('data:')) {
      const match = bg.match(/url\(['"]?(https?:\/\/[^'"]+)['"]?\)/);
      if (match && match[1]) {
        originalImageSources.set(el, match[1]);
        const dataUrl = await convertToDataURL(match[1]);
        if (dataUrl) el.style.backgroundImage = `url('${dataUrl}')`;
      }
    }
  }));
};

const restoreEditor = (iframeDoc: Document) => {
  if (cachedStyleContent && !iframeDoc.getElementById('ios-card-editor-style')) {
    const style = iframeDoc.createElement('style');
    style.id = 'ios-card-editor-style';
    style.textContent = cachedStyleContent;
    iframeDoc.head.appendChild(style);
  }

  originalImageSources.forEach((src, el) => {
    if (el instanceof HTMLImageElement) {
      el.src = src;
    } else {
      el.style.backgroundImage = `url('${src}')`;
    }
  });
  originalImageSources.clear();
};

export const handleExportAll = async (
  iframeRef: React.RefObject<HTMLIFrameElement>,
  setProgress: (state: React.SetStateAction<ProgressState>) => void
) => {
  if (!iframeRef.current) return;
  const iframeDoc = iframeRef.current.contentWindow?.document;
  if (!iframeDoc) return;
  
  let cards = Array.from(iframeDoc.querySelectorAll('.bigoose-card')) as HTMLElement[];
  if (cards.length === 0) cards = Array.from(iframeDoc.querySelectorAll('[class*="w-[375px]"]')) as HTMLElement[];
  if (cards.length === 0) return alert('未找到卡片元素');

  setProgress({ active: true, status: '处理跨域资源...', current: 0, total: cards.length });
  
  try {
    await prepareExport(iframeDoc);

    // @ts-ignore
    const zip = new window.JSZip();
    const imgFolder = zip.folder("images");
    let successCount = 0;

    for (let i = 0; i < cards.length; i++) {
      try {
        const card = cards[i];
        let titleText = card.querySelector('h1, h2, h3, .font-bold')?.textContent?.trim().substring(0, 15).replace(/[\\/:*?"<>|\s]/g, "_") || `card`;
        
        // Fix: Ensure unique filename by appending index
        // This solves the issue where duplicate cards overwrote each other in the zip
        const fileName = `${titleText}_${i + 1}.png`;

        setProgress(p => ({ ...p, status: `渲染: ${fileName}...`, current: i + 1 }));
        const rect = card.getBoundingClientRect();
        
        // @ts-ignore
        const blob = await window.htmlToImage.toBlob(card, { 
          pixelRatio: 4, 
          width: rect.width, 
          height: rect.height, 
          cacheBust: true,
          style: { transform: 'none' } // Reset any transforms that might interfere
        });
        
        if (blob) {
            imgFolder.file(fileName, blob);
            successCount++;
        }
      } catch (cardError) {
        // Fix: Log error but continue loop so one bad card doesn't stop others
        console.error(`Failed to export card index ${i}:`, cardError);
      }
      await new Promise(r => setTimeout(r, 50));
    }

    if (successCount === 0) throw new Error('所有卡片导出失败，请检查浏览器控制台');

    setProgress(p => ({ ...p, status: '打包下载中...' }));
    const content = await zip.generateAsync({ type: "blob" });
    // @ts-ignore
    window.saveAs(content, `ios_cards_export_${Date.now()}.zip`);
    
  } catch (err: any) { 
    console.error(err);
    alert('导出过程出错: ' + err.message); 
  } finally { 
    if (iframeDoc) restoreEditor(iframeDoc);
    setProgress({ active: false, status: '', current: 0, total: 0 }); 
  }
};

export const handleExportSingle = async (
  iframeRef: React.RefObject<HTMLIFrameElement>,
  elementId: string,
  setProgress: (state: React.SetStateAction<ProgressState>) => void
) => {
  if (!iframeRef.current) return;
  const iframeDoc = iframeRef.current.contentWindow?.document;
  if (!iframeDoc) return;
  
  const element = iframeDoc.querySelector(`[data-layer-id="${elementId}"]`) as HTMLElement;
  if (!element) return alert('找不到元素');

  setProgress({ active: true, status: '处理资源...', current: 0, total: 1 });
  try {
    await prepareExport(iframeDoc);

    const titleText = element.querySelector('h1, h2, h3, .font-bold')?.textContent?.trim().substring(0, 15).replace(/[\\/:*?"<>|\s]/g, "_") || `element_${elementId}`;
    const rect = element.getBoundingClientRect();
    
    // @ts-ignore
    const blob = await window.htmlToImage.toBlob(element, { pixelRatio: 4, width: rect.width, height: rect.height, cacheBust: true });
    // @ts-ignore
    window.saveAs(blob, `${titleText}.png`);
  } catch (err: any) { 
    console.error(err);
    alert('导出出错: ' + err.message); 
  } finally {
    if (iframeDoc) restoreEditor(iframeDoc);
    setProgress({ active: false, status: '', current: 0, total: 0 });
  }
};