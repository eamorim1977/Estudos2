
import React, { useState, useEffect, useCallback } from 'react';
import { Subject, StudyContent, DailyReview as DailyReviewType, ReviewItem } from './types';
import { useLocalStorage } from './hooks/useLocalStorage';
import Modal from './components/Modal';
import DailyReviewCard, { DailyReviewWelcome } from './components/DailyReviewCard';
import { PlusIcon, BookOpenIcon, BrainIcon, TrashIcon, FileTextIcon, MenuIcon, XIcon, CogIcon, FlameIcon, MindMapIcon, CoinIcon, BookmarkIcon, AlertTriangleIcon, PencilIcon, BellIcon } from './components/Icons';

// pdf.js is loaded from CDN, declare its global variable
declare const pdfjsLib: any;
// mammoth.js is loaded from CDN, declare its global variable
declare const mammoth: any;


// --- Helper Functions ---

const extractTextFromPdf = async (file: File): Promise<{doses: string[], warnings: string[]}> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    const numPages = pdf.numPages;
    const doses: string[] = [];
    const warnings: string[] = [];

    type PageElement = 
        | { type: 'text', text: string, x: number, y: number, height: number, fontName?: string } 
        | { type: 'image', dataUrl: string, y: number, width: number, height: number };

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        try {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const operatorList = await page.getOperatorList();
            const { OPS } = pdfjsLib;

            const pageElements: PageElement[] = [];

            // Step 1: Reconstruct text lines from textContent
            const linesMap = new Map<number, any[]>();
            textContent.items.forEach((item: any) => {
                const y = Math.round(item.transform[5]);
                if (!linesMap.has(y)) linesMap.set(y, []);
                linesMap.get(y)!.push(item);
            });

            Array.from(linesMap.entries())
                .sort((a, b) => b[0] - a[0]) // Sort from top to bottom
                .forEach(([y, items]) => {
                    const sortedItems = items.sort((a, b) => a.transform[4] - b.transform[4]);
                    const text = sortedItems.map(item => item.str).join(' ');
                    const x = sortedItems[0]?.transform[4] || 0;
                    const height = Math.max(...sortedItems.map(item => item.height), 0);
                    const fontName = sortedItems[0]?.fontName;
                    if (text.trim().length > 0) {
                        pageElements.push({ type: 'text', text, x, y, height, fontName });
                    }
                });

            // Step 2: Extract images from operatorList
            const matrixStack: number[][] = [];
            let currentMatrix = [1, 0, 0, 1, 0, 0];
            
            const transformMatrix = (m1: number[], m2: number[]) => [
                m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
                m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
                m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
            ];

            for (let i = 0; i < operatorList.fnArray.length; i++) {
                const op = operatorList.fnArray[i];
                const args = operatorList.argsArray[i];

                if (op === OPS.save) {
                    matrixStack.push(currentMatrix);
                } else if (op === OPS.restore) {
                    currentMatrix = matrixStack.pop() || [1, 0, 0, 1, 0, 0];
                } else if (op === OPS.transform) {
                    currentMatrix = transformMatrix(currentMatrix, args);
                } else if (op === OPS.paintImageXObject) {
                    const imgRef = args[0];
                    try {
                        const img = await page.objs.get(imgRef);
                        if (!img || !img.data) continue;
                        
                        const { width, height, data } = img;
                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');

                        if (ctx) {
                            const imageData = ctx.createImageData(width, height);
                            const rgba = new Uint8ClampedArray(width * height * 4);
                            let formatSupported = false;

                            // Handle RGB (3 bytes per pixel)
                            if (data.length === width * height * 3) {
                                for (let j = 0, k = 0; j < data.length; j += 3, k += 4) {
                                    rgba[k] = data[j];
                                    rgba[k + 1] = data[j + 1];
                                    rgba[k + 2] = data[j + 2];
                                    rgba[k + 3] = 255; // Alpha
                                }
                                imageData.data.set(rgba);
                                formatSupported = true;
                            } 
                            // Handle RGBA (4 bytes per pixel)
                            else if (data.length === width * height * 4) { 
                                imageData.data.set(data);
                                formatSupported = true;
                            }
                            // Handle Grayscale (1 byte per pixel)
                            else if (data.length === width * height) {
                                for (let j = 0, k = 0; j < data.length; j++, k += 4) {
                                    const grayValue = data[j];
                                    rgba[k] = grayValue;
                                    rgba[k + 1] = grayValue;
                                    rgba[k + 2] = grayValue;
                                    rgba[k + 3] = 255;
                                }
                                imageData.data.set(rgba);
                                formatSupported = true;
                            }
                            
                            if (formatSupported) {
                                ctx.putImageData(imageData, 0, 0);
                                const y = currentMatrix[5];
                                pageElements.push({ type: 'image', dataUrl: canvas.toDataURL(), y, width, height });
                            } else {
                                const colorSpace = img.colorspace?.name || 'desconhecido';
                                console.warn(`Unsupported image format on page ${pageNum}. Length: ${data.length}, WxH: ${width*height}, Colorspace: ${colorSpace}`);
                                warnings.push(`Não foi possível processar uma imagem na página ${pageNum}. O formato de cor (${colorSpace}) não é suportado.`);
                            }
                        }
                    } catch (e) {
                        console.warn(`Could not process an image on page ${pageNum}:`, e);
                        warnings.push(`Não foi possível processar uma imagem na página ${pageNum}. O formato pode não ser suportado ou a imagem está corrompida.`);
                    }
                }
            }

            // Step 3: Sort all elements by their Y position
            pageElements.sort((a, b) => b.y - a.y);
            
            // Step 4: Process sorted elements into doses with improved paragraph and structure detection
            const headingPath: { height: number, text: string }[] = [];
            let currentBlockLines: { text: string }[] = [];
            let lastLine: { y: number, height: number } | null = null;

            const finalizeBlock = () => {
                if (currentBlockLines.length === 0) return;
                
                // Heuristic: if more than half of lines are list items, treat as a list.
                const listItemsCount = currentBlockLines.filter(line => /^\s*([•●▪\u2022*-]|\d+\.|\w\))\s/.test(line.text.trim())).length;
                const isList = listItemsCount > 0 && listItemsCount >= currentBlockLines.length / 2;
                
                let contentText;

                if (isList) {
                    contentText = currentBlockLines.map(line => line.text.trim()).join('\n');
                } else {
                     contentText = currentBlockLines.reduce((acc, line) => {
                        const lineText = line.text.trim();
                        const accTrimmed = acc.trim();
                        if (accTrimmed.endsWith('-')) {
                            return accTrimmed.slice(0, -1) + lineText;
                        }
                        if (acc === '') return lineText;
                        return acc + ' ' + lineText;
                    }, '').trim();
                }
                
                if (contentText) {
                    const breadcrumb = headingPath.map(h => h.text).join(' > ');
                    if (breadcrumb) {
                        doses.push(`${breadcrumb}\n\n${contentText}`);
                    } else {
                        doses.push(contentText);
                    }
                }

                currentBlockLines = [];
            };

            for (const element of pageElements) {
                if (element.type === 'text') {
                    const { text, x, y, height, fontName } = element;
                    const isBold = fontName && /bold|heavy|black/i.test(fontName);
                    const trimmedText = text.trim();
                    const isListItem = /^\s*([•●▪\u2022*-]|\d+\.|\w\))\s/.test(trimmedText);
                    
                    const isLikelyHeading = !isListItem &&
                                            trimmedText.length > 2 &&
                                            trimmedText.length < 100 &&
                                            trimmedText.split(' ').length < 15 &&
                                            !/[.!?]$/.test(trimmedText) &&
                                            (isBold || x < 80);

                    let isNewBlock = false;
                    if (lastLine === null) {
                        isNewBlock = true;
                    } else {
                        const verticalGap = (lastLine.y - lastLine.height) - y;
                        if (verticalGap > height * 0.8) { 
                           isNewBlock = true;
                        }
                    }

                    if (isLikelyHeading && isNewBlock) {
                        finalizeBlock();
                        const headingText = text.trim();
                        while (headingPath.length > 0 && headingPath[headingPath.length - 1].height <= height) {
                            headingPath.pop();
                        }
                        headingPath.push({ height, text: headingText });
                        lastLine = { y, height };
                        continue;
                    }

                    if (isNewBlock) {
                        finalizeBlock();
                    }

                    currentBlockLines.push({ text });
                    lastLine = { y, height };

                } else if (element.type === 'image') {
                    finalizeBlock();
                    
                    const breadcrumb = headingPath.map(h => h.text).join(' > ');
                    let imageDose = `![Imagem do PDF](${element.dataUrl})`;
                    if (breadcrumb) {
                        imageDose = `${breadcrumb}\n\n${imageDose}`;
                    }
                    doses.push(imageDose);
                    
                    lastLine = null; // Image breaks text flow
                }
            }
            finalizeBlock(); // Final call for any remaining content
        } catch (pageError) {
             console.error(`Error processing page ${pageNum}:`, pageError);
             warnings.push(`Falha ao processar a página ${pageNum}. A página pode estar corrompida e foi ignorada.`);
        }
    }
    
    return { doses, warnings };
};

const extractTextAsMindMapFromPdf = async (file: File): Promise<{mindMapText: string, warnings: string[]}> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    const numPages = pdf.numPages;
    const warnings: string[] = [];
    let allLines: { text: string, x: number }[] = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        try {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            const linesMap = new Map<number, any[]>();
            textContent.items.forEach((item: any) => {
                const y = Math.round(item.transform[5]);
                if (!linesMap.has(y)) linesMap.set(y, []);
                linesMap.get(y)!.push(item);
            });

            const pageLines = Array.from(linesMap.entries())
                .sort((a, b) => b[0] - a[0]) // Sort from top to bottom
                .map(([y, items]) => {
                    const sortedItems = items.sort((a, b) => a.transform[4] - b.transform[4]);
                    const text = sortedItems.map(item => item.str).join(''); // Join without space for mind maps
                    const x = sortedItems[0]?.transform[4] || 0;
                    return { text, x };
                });
            
            allLines.push(...pageLines);

        } catch (pageError) {
             console.error(`Error processing page ${pageNum}:`, pageError);
             warnings.push(`Falha ao processar a página ${pageNum}. A página pode estar corrompida e foi ignorada.`);
        }
    }
    
    if (allLines.length === 0) {
        return { mindMapText: '', warnings };
    }

    // Normalize indentation
    const minIndent = Math.min(...allLines.filter(line => line.text.trim()).map(line => line.x));
    const INDENT_WIDTH = 8; // Heuristic: average width of a space character. May need tuning.

    const mindMapText = allLines
        .filter(line => line.text.trim())
        .map(line => {
            const indentLevel = Math.round((line.x - minIndent) / INDENT_WIDTH);
            const indent = ' '.repeat(indentLevel * 2); // Use 2 spaces per level
            return indent + line.text;
        }).join('\n');

    return { mindMapText, warnings };
};

const extractTextAsMindMapFromSvg = async (file: File): Promise<{ mindMapText: string, warnings: string[] }> => {
    const svgText = await file.text();
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgText, "image/svg+xml");

    const textElements: { text: string, x: number, y: number }[] = [];
    svgDoc.querySelectorAll('text').forEach(node => {
        const x = parseFloat(node.getAttribute('x') || '0');
        const y = parseFloat(node.getAttribute('y') || '0');
        if (node.textContent && node.textContent.trim()) {
             textElements.push({ text: node.textContent.trim(), x, y });
        }
    });

    if (textElements.length === 0) {
        return { mindMapText: '', warnings: ['Nenhum elemento de texto foi encontrado no SVG.'] };
    }

    textElements.sort((a, b) => a.y - b.y || a.x - b.x);

    const minIndent = Math.min(...textElements.map(el => el.x));
    const INDENT_WIDTH = 8; 

    const mindMapText = textElements
        .map(el => {
            const indentLevel = Math.round((el.x - minIndent) / INDENT_WIDTH);
            const indent = ' '.repeat(indentLevel * 2);
            return indent + el.text;
        }).join('\n');

    return { mindMapText, warnings: [] };
};

const extractTextFromDocx = async (file: File): Promise<{ doses: string[], warnings: string[] }> => {
    const arrayBuffer = await file.arrayBuffer();
    try {
        const options = {
            convertImage: mammoth.images.imgElement(function(image: any) {
                return image.read("base64").then(function(imageBuffer: string) {
                    return {
                        src: `data:${image.contentType};base64,${imageBuffer}`
                    };
                });
            })
        };
        const result = await mammoth.convertToHtml({ arrayBuffer }, options);
        const html = result.value;
        const messages = result.messages;
        
        const warnings = messages
            .filter((msg: { type: string; }) => msg.type === 'warning')
            .map((msg: { message: string; }) => msg.message);

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const body = doc.body;

        const doses: string[] = [];
        const headingPath: { level: number, text: string }[] = [];

        for (const node of Array.from(body.children)) {
            const element = node as HTMLElement;
            const tagName = element.tagName.toUpperCase();

            const levelMatch = tagName.match(/^H([1-6])$/);
            if (levelMatch) {
                const headingText = (element.textContent || '').trim();
                if (headingText) {
                    const level = parseInt(levelMatch[1], 10);
                    while (headingPath.length > 0 && headingPath[headingPath.length - 1].level >= level) {
                        headingPath.pop();
                    }
                    headingPath.push({ level, text: headingText });
                }
                continue; // Processed heading, move to next element
            }
            
            const breadcrumb = headingPath.map(h => h.text).join(' > ');
            const createDose = (content: string) => {
                if (!content) return;
                const doseText = breadcrumb ? `${breadcrumb}\n\n${content}` : content;
                doses.push(doseText);
            };

            switch (tagName) {
                case 'P':
                    createDose((element.textContent || '').trim());
                    break;
                case 'UL':
                case 'OL':
                    const listItems = Array.from(element.children)
                        .filter(child => child.tagName.toUpperCase() === 'LI')
                        .map((li, index) => {
                            const liContent = (li.textContent || '').trim();
                            if (!liContent) return null;
                            const prefix = tagName === 'UL' ? '* ' : `${index + 1}. `;
                            return `${prefix}${liContent}`;
                        })
                        // Fix: Use a type guard function to correctly filter out null values and inform TypeScript.
                        .filter((value): value is string => !!value);
                    
                    if (listItems.length > 0) {
                        createDose(listItems.join('\n'));
                    }
                    break;
                case 'IMG':
                    const img = element as HTMLImageElement;
                    const src = img.src;
                    if (src && src.startsWith('data:image')) {
                        createDose(`![Imagem do DOCX](${src})`);
                    }
                    break;
                default:
                    createDose((element.textContent || '').trim());
                    break;
            }
        }
        
        if (doses.length === 0 && warnings.length === 0) {
            if ((body.textContent || '').trim()) {
                 const rawTextDoses = (body.textContent || '').split('\n\n').filter(p => p.trim());
                 if (rawTextDoses.length > 0) {
                     warnings.push("Não foi possível identificar uma estrutura clara (títulos, parágrafos). O texto foi dividido por parágrafos.");
                     return { doses: rawTextDoses, warnings };
                 }
            }
            warnings.push("Nenhum texto foi encontrado no documento.");
        }

        return { doses, warnings };

    } catch (error: any) {
        console.error("Error processing DOCX:", error);
        return { doses: [], warnings: [`Falha ao processar o arquivo DOCX. Pode estar corrompido ou em um formato não suportado. Erro: ${error.message}`]};
    }
};



const parseStructuredText = (text: string): string[] => {
    // Normalize line endings and trim the whole text block
    const trimmedText = text.trim();
    if (!trimmedText) {
        return [];
    }
    const lines = trimmedText.split('\n');
    
    const getIndentation = (line: string): number => line.match(/^\s*/)?.[0].length ?? 0;
    
    // Check if any line has non-zero indentation
    const hasIndentation = lines.some(line => getIndentation(line) > 0);

    // --- CASE 1: Indented Text (Mind Map Logic) ---
    if (hasIndentation) {
        const lineData = lines.map(line => ({
            text: line,
            indent: getIndentation(line),
        }));

        const indentedLines = lineData.filter(l => l.indent > 0);
        if (indentedLines.length === 0) {
            return lines;
        }
        const firstBranchIndent = Math.min(...indentedLines.map(l => l.indent));

        const doses: string[] = [];
        const branchStartIndices = lineData
            .map((line, i) => (line.indent === firstBranchIndent ? i : -1))
            .filter(index => index !== -1);

        if (branchStartIndices.length > 0) {
            for (let i = 0; i < branchStartIndices.length; i++) {
                const branchStartIndex = branchStartIndices[i];
                const branchEndIndex = (i + 1 < branchStartIndices.length) 
                    ? branchStartIndices[i + 1] 
                    : lineData.length;
                
                const branchLines = lineData.slice(branchStartIndex, branchEndIndex).map(l => l.text);

                const ancestors: string[] = [];
                let currentIndent = lineData[branchStartIndex].indent;
                
                for (let j = branchStartIndex - 1; j >= 0; j--) {
                    if (lineData[j].indent < currentIndent) {
                        ancestors.unshift(lineData[j].text);
                        currentIndent = lineData[j].indent;
                    }
                }
                
                const dose = [...ancestors, ...branchLines].join('\n');
                doses.push(dose);
            }
            return doses;
        }
    }

    // --- CASE 2: Non-Indented Text (Paragraph/Block Logic for Plain Text & Markdown) ---
    const markdownLines = trimmedText.split('\n');
    const doses: string[] = [];
    const headingPath: { level: number; text: string }[] = [];
    let currentContentLines: string[] = [];

    const getHeadingLevel = (line: string): number => {
        const match = line.trim().match(/^(#+)\s/);
        return match ? match[1].length : 0;
    };
    
    const processContentBlock = () => {
        if (currentContentLines.length === 0) return;
        const content = currentContentLines.join('\n').trim();
        if (!content) {
            currentContentLines = [];
            return;
        }

        const blocks = content.split(/\n\s*\n/).filter(b => b.trim());

        blocks.forEach(block => {
            const isList = block.split('\n').every(line => /^\s*([•●▪\u2022*-]|\d+\.|\w\))\s/.test(line.trim()));
            const itemsToProcess = isList ? block.split('\n').filter(li => li.trim()) : [block];
            
            itemsToProcess.forEach(item => {
                let breadcrumbs = '';
                if (headingPath.length > 0) {
                    breadcrumbs = headingPath.map(h => h.text).join(' > ') + '\n\n';
                }
                doses.push(`${breadcrumbs}${item}`);
            });
        });

        currentContentLines = [];
    };

    for (const line of markdownLines) {
        const level = getHeadingLevel(line);

        if (level > 0) {
            processContentBlock();
            const headingText = line.trim().replace(/^#+\s/, '');
            while (headingPath.length > 0 && headingPath[headingPath.length - 1].level >= level) {
                headingPath.pop();
            }
            headingPath.push({ level, text: headingText });
        } else {
            currentContentLines.push(line);
        }
    }
    
    processContentBlock();

    if (doses.length > 0) {
        return doses;
    } else {
        return [trimmedText];
    }
};


// --- Custom Hooks ---

const useStudyStreak = () => {
    const [streakData, setStreakData] = useLocalStorage<{ streak: number, lastReviewed: string | null }>('studyStreak', { streak: 0, lastReviewed: null });

    const markAsCompleted = useCallback(() => {
        const today = new Date().toISOString().split('T')[0];
        if (streakData.lastReviewed === today) {
            return; // Already completed today
        }

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (streakData.lastReviewed === yesterdayStr) {
            setStreakData(prev => ({ streak: prev.streak + 1, lastReviewed: today }));
        } else {
            setStreakData({ streak: 1, lastReviewed: today });
        }
    }, [streakData, setStreakData]);
    
    // Check if streak should be reset if a day was missed
    useEffect(() => {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
        if (streakData.lastReviewed && streakData.lastReviewed !== todayStr) {
            const lastReviewedDate = new Date(streakData.lastReviewed);
            const diffTime = today.getTime() - lastReviewedDate.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays > 1) {
                 setStreakData(prev => ({ ...prev, streak: 0 }));
            }
        }
    }, []); // Runs once on app load

    return { streak: streakData.streak, markAsCompleted, hasCompletedToday: streakData.lastReviewed === new Date().toISOString().split('T')[0] };
};

// --- UI Components ---

const ConfirmationModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  confirmText: string;
  requiresInput?: string;
  children: React.ReactNode;
}> = ({ isOpen, onClose, onConfirm, title, confirmText, requiresInput, children }) => {
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (isOpen) {
      setInputValue('');
    }
  }, [isOpen]);

  if (!isOpen) return null;
  
  const isConfirmed = !requiresInput || inputValue === requiresInput;

  return (
    <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center" 
        onClick={onClose}
        aria-modal="true"
        role="dialog"
    >
      <div 
        className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md m-4 transform transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start">
            <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                <AlertTriangleIcon className="h-6 w-6 text-red-600" aria-hidden="true" />
            </div>
            <div className="mt-0 ml-4 text-left">
                <h3 className="text-lg leading-6 font-bold text-slate-900" id="modal-title">
                    {title}
                </h3>
                <div className="mt-2">
                    <div className="text-sm text-slate-500 space-y-2">{children}</div>
                </div>
            </div>
        </div>
        
        {requiresInput && (
          <div className="mt-4">
            <label htmlFor="confirm-input" className="block text-sm font-medium text-slate-700">
              Para confirmar, digite <span className="font-bold">{requiresInput}</span> abaixo:
            </label>
            <input
              type="text"
              id="confirm-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
        )}

        <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse gap-3">
          <button
            type="button"
            className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:w-auto sm:text-sm disabled:bg-red-300 disabled:cursor-not-allowed"
            onClick={onConfirm}
            disabled={!isConfirmed}
          >
            {confirmText}
          </button>
          <button
            type="button"
            className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:w-auto sm:text-sm"
            onClick={onClose}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};


const SubjectForm: React.FC<{ onSubmit: (name: string) => void; onCancel: () => void; }> = ({ onSubmit, onCancel }) => {
    const [name, setName] = useState('');
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            onSubmit(name.trim());
            setName('');
        }
    };
    return (
        <form onSubmit={handleSubmit}>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Macroeconomia" className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" autoFocus />
            <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 rounded-md text-slate-700 bg-slate-100 hover:bg-slate-200">Cancelar</button>
                <button type="submit" className="px-4 py-2 rounded-md text-white bg-indigo-600 hover:bg-indigo-700">Adicionar</button>
            </div>
        </form>
    );
};

const ContentForm: React.FC<{ onSubmit: (payload: { data: { type: 'text'; text: string } | { type: 'file'; doses: string[] } | { type: 'mindmap'; text: string }}) => void; onCancel: () => void; }> = ({ onSubmit, onCancel }) => {
    const [mode, setMode] = useState<'text' | 'file'>('text');
    const [text, setText] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [isExtracting, setIsExtracting] = useState(false);
    const [isOptimizedForMindMap, setIsOptimizedForMindMap] = useState(false);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            const fileName = selectedFile.name.toLowerCase();
            const allowedExtensions = ['.pdf', '.svg', '.docx', '.md'];
            
            const fileIsValid = allowedExtensions.some(ext => fileName.endsWith(ext));

            if (!fileIsValid) {
                setError('Tipo de arquivo não suportado. Por favor, selecione PDF, SVG, DOCX, ou MD.');
                setFile(null); return;
            }

            if (selectedFile.size > 5 * 1024 * 1024) { // 5MB limit
                setError('O arquivo é muito grande. O limite é de 5MB.');
                setFile(null); return;
            }
            setError(null);
            setWarnings([]);
            setFile(selectedFile);
            setIsOptimizedForMindMap(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (mode === 'text' && text.trim()) {
            onSubmit({ data: { type: 'text', text: text.trim() } });
            setText('');
        } else if (mode === 'file' && file) {
            setIsExtracting(true);
            setError(null);
            setWarnings([]);
            try {
                let submissionPayload: Parameters<typeof onSubmit>[0] | null = null;
                let extractionWarnings: string[] = [];
                
                const extension = `.${file.name.split('.').pop()?.toLowerCase()}`;

                switch (extension) {
                    case '.svg': {
                        const { mindMapText, warnings } = await extractTextAsMindMapFromSvg(file);
                        extractionWarnings = warnings;
                        if (mindMapText.trim()) {
                            submissionPayload = { data: { type: 'mindmap', text: mindMapText } };
                        }
                        break;
                    }
                    case '.md': {
                        const mdText = await file.text();
                        const doses = parseStructuredText(mdText);
                        if (doses.length > 0) {
                            submissionPayload = { data: { type: 'file', doses } };
                        }
                        break;
                    }
                    case '.docx': {
                        const { doses, warnings } = await extractTextFromDocx(file);
                        extractionWarnings = warnings;
                        if (doses.length > 0) {
                            if (isOptimizedForMindMap) {
                                submissionPayload = { data: { type: 'mindmap', text: doses.join('\n') } };
                            } else {
                                submissionPayload = { data: { type: 'file', doses } };
                            }
                        }
                        break;
                    }
                    case '.pdf': {
                         if (isOptimizedForMindMap) {
                            const { mindMapText, warnings } = await extractTextAsMindMapFromPdf(file);
                            extractionWarnings = warnings;
                            if (mindMapText.trim()) {
                                submissionPayload = { data: { type: 'mindmap', text: mindMapText } };
                            }
                        } else {
                            const { doses, warnings } = await extractTextFromPdf(file);
                            extractionWarnings = warnings;
                            if (doses.length > 0) {
                                submissionPayload = { data: { type: 'file', doses } };
                            }
                        }
                        break;
                    }
                }

                if (extractionWarnings.length > 0) {
                    setWarnings(extractionWarnings);
                }

                if (submissionPayload) {
                    onSubmit(submissionPayload);
                    setFile(null);
                } else {
                    if (extractionWarnings.length > 0) {
                        setError('Extração concluída com avisos, mas nenhum conteúdo foi encontrado.');
                    } else {
                        setError(`Não foi possível extrair conteúdo do arquivo. Pode estar vazio, corrompido ou em um formato não suportado.`);
                    }
                }

            } catch (err: any) {
                console.error(err);
                if (err.name === 'PasswordException') {
                    setError('Este PDF está protegido por senha e não pode ser processado.');
                } else {
                    setError('Falha ao processar o arquivo. Pode estar corrompido ou em um formato inválido.');
                }
            } finally {
                setIsExtracting(false);
            }
        }
    };

    return (
        <form onSubmit={handleSubmit}>
             <div className="flex border-b border-slate-200 mb-4">
                <button type="button" onClick={() => setMode('text')} className={`px-4 py-2 text-sm font-medium ${mode === 'text' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>Texto</button>
                <button type="button" onClick={() => setMode('file')} className={`px-4 py-2 text-sm font-medium ${mode === 'file' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>Arquivo</button>
            </div>

            {mode === 'text' && (
                <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Digite ou cole sua nota de estudo. O app irá dividir em tópicos automaticamente." className="w-full h-40 px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            )}
            
            {mode === 'file' && (
                <div className="flex flex-col items-center justify-center w-full">
                    <label htmlFor="file-upload" className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100">
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <FileTextIcon className="w-8 h-8 mb-2 text-slate-500" />
                            <p className="mb-1 text-sm text-slate-500"><span className="font-semibold">Clique para carregar</span> ou arraste</p>
                            <p className="text-xs text-slate-500">PDF, SVG, DOCX, MD (MAX. 5MB)</p>
                        </div>
                        <input id="file-upload" type="file" className="hidden" accept=".pdf,.svg,.docx,.md" onChange={handleFileChange} />
                    </label>
                    <div className="w-full mt-4">
                        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={isOptimizedForMindMap}
                                onChange={(e) => setIsOptimizedForMindMap(e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            Otimizar extração para mapa mental ou tópicos
                        </label>
                    </div>

                    {isExtracting && <p className="mt-2 text-sm text-indigo-600">Processando arquivo...</p>}
                    {file && !isExtracting && <p className="mt-2 text-sm text-slate-600">Arquivo: {file.name}</p>}
                    {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
                    {warnings.length > 0 && (
                        <div className="mt-2 w-full text-sm text-amber-800 bg-amber-100 p-3 rounded-md border border-amber-200">
                            <p className="font-semibold mb-1">Avisos:</p>
                            <ul className="list-disc list-inside space-y-1">
                                {warnings.map((warn, i) => <li key={i}>{warn}</li>)}
                            </ul>
                        </div>
                    )}
                </div>
            )}
            
            <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 rounded-md text-slate-700 bg-slate-100 hover:bg-slate-200">Cancelar</button>
                <button type="submit" className="px-4 py-2 rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300" disabled={isExtracting || (mode === 'text' && !text.trim()) || (mode === 'file' && !file)}>Salvar</button>
            </div>
        </form>
    );
};

const EditContentForm: React.FC<{
    initialContent: StudyContent;
    onSubmit: (payload: { newText: string; reprocessAsMindMap: boolean }) => void;
    onCancel: () => void;
}> = ({ initialContent, onSubmit, onCancel }) => {
    const [text, setText] = useState(initialContent.text);
    const [reprocess, setReprocess] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (text.trim()) {
            onSubmit({ newText: text.trim(), reprocessAsMindMap: reprocess });
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full h-64 px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                autoFocus
            />
            <div className="w-full mt-4">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={reprocess}
                        onChange={(e) => setReprocess(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Otimizar e dividir como mapa mental/tópicos
                </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 rounded-md text-slate-700 bg-slate-100 hover:bg-slate-200">Cancelar</button>
                <button type="submit" className="px-4 py-2 rounded-md text-white bg-indigo-600 hover:bg-indigo-700">Salvar Alterações</button>
            </div>
        </form>
    );
};


const SettingsView: React.FC = () => {
    const [dosesPerDay, setDosesPerDay] = useLocalStorage('settings_dosesPerDay', 3);
    const [notificationSettings, setNotificationSettings] = useLocalStorage('settings_notifications', {
        enabled: false,
        time: '09:00',
    });
    const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>('default');

    useEffect(() => {
        if ('Notification' in window) {
            setPermissionStatus(Notification.permission);
        }
    }, []);

    const handleToggleNotifications = async () => {
        const currentlyEnabled = notificationSettings.enabled;

        if (!currentlyEnabled) { // Trying to enable
            if (permissionStatus === 'default') {
                const permission = await Notification.requestPermission();
                setPermissionStatus(permission);
                if (permission === 'granted') {
                    setNotificationSettings(prev => ({ ...prev, enabled: true }));
                }
            } else if (permissionStatus === 'granted') {
                 setNotificationSettings(prev => ({ ...prev, enabled: true }));
            }
        } else { // Disabling
            setNotificationSettings(prev => ({ ...prev, enabled: false }));
        }
    };

    const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setNotificationSettings(prev => ({ ...prev, time: e.target.value }));
    };
    
    const getPermissionMessage = () => {
        switch (permissionStatus) {
            case 'granted':
                return <p className="text-xs text-green-600">Permissão de notificação concedida.</p>;
            case 'denied':
return <p className="text-xs text-red-600">Permissão negada. Habilite nas configurações do seu navegador.</p>;
            default:
                return <p className="text-xs text-slate-500">O navegador solicitará permissão para enviar notificações.</p>;
        }
    };


    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                <h3 className="text-lg font-medium text-slate-800 mb-2">Doses de Estudo por Dia</h3>
                <p className="text-sm text-slate-500 mb-4">Escolha quantas notas de estudo você quer revisar diariamente.</p>
                <div className="flex items-center gap-4">
                    <input
                        id="doses-slider"
                        type="range"
                        min="1"
                        max="100"
                        value={dosesPerDay}
                        onChange={(e) => setDosesPerDay(Number(e.target.value))}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="font-bold text-indigo-600 text-lg w-12 text-center">{dosesPerDay}</span>
                </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                 <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-lg font-medium text-slate-800 mb-2">Notificações de Lembrete</h3>
                        <p className="text-sm text-slate-500 mb-4">Receba um lembrete diário para não perder sua sessão de estudos.</p>
                    </div>
                     <button
                        onClick={handleToggleNotifications}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 ${
                        notificationSettings.enabled && permissionStatus === 'granted' ? 'bg-indigo-600' : 'bg-gray-200'
                        }`}
                        role="switch"
                        aria-checked={notificationSettings.enabled}
                        disabled={permissionStatus === 'denied'}
                    >
                        <span
                            aria-hidden="true"
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            notificationSettings.enabled && permissionStatus === 'granted' ? 'translate-x-5' : 'translate-x-0'
                            }`}
                        />
                    </button>
                </div>

                {getPermissionMessage()}

                {notificationSettings.enabled && permissionStatus === 'granted' && (
                    <div className="mt-4 border-t border-slate-200 pt-4">
                        <label htmlFor="reminder-time" className="block text-sm font-medium text-slate-700">Horário do lembrete:</label>
                        <input 
                            type="time" 
                            id="reminder-time"
                            value={notificationSettings.time}
                            onChange={handleTimeChange}
                            className="mt-1 block w-full max-w-xs rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        />
                    </div>
                )}
            </div>

        </div>
    );
};


// --- Main App Component ---

const App: React.FC = () => {
    const [subjects, setSubjects] = useLocalStorage<Subject[]>('subjects', []);
    const [dailyReviews, setDailyReviews] = useLocalStorage<DailyReviewType[] | null>('dailyReviews', null);
    const [reviewQueue, setReviewQueue] = useLocalStorage<ReviewItem[]>('reviewQueue', []);
    const [dosesPerDay] = useLocalStorage('settings_dosesPerDay', 3);
    const [notificationSettings] = useLocalStorage('settings_notifications', { enabled: false, time: '09:00' });
    const [lastNotificationDate, setLastNotificationDate] = useLocalStorage<string | null>('lastNotificationDate', null);
    const [progress, setProgress] = useLocalStorage<{ coins: number, reviewedDosesPerSubject: Record<string, number> }>('progress', { coins: 0, reviewedDosesPerSubject: {} });
    const { streak, markAsCompleted, hasCompletedToday } = useStudyStreak();
    
    type ActiveView = 'review' | 'subject' | 'settings';
    type TodayContent = StudyContent & { subjectName: string; subjectId: string; type: 'review' | 'new'; };

    const [activeView, setActiveView] = useState<ActiveView>('review');
    const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null);
    const [todayContents, setTodayContents] = useState<TodayContent[]>([]);
    const [currentDoseIndex, setCurrentDoseIndex] = useState(0);
    
    const [isSubjectModalOpen, setIsSubjectModalOpen] = useState(false);
    const [isContentModalOpen, setIsContentModalOpen] = useState(false);
    const [editingContent, setEditingContent] = useState<StudyContent | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const [confirmationState, setConfirmationState] = useState({
        isOpen: false,
        title: '',
        confirmText: '',
        onConfirm: () => {},
        requiresInput: undefined as string | undefined,
        children: null as React.ReactNode | null,
    });
    
    // Derived state: get the active subject object from the main subjects list
    // This ensures the displayed data is always fresh
    const activeSubject = subjects.find(s => s.id === activeSubjectId) || null;

    // Notification scheduler effect
    useEffect(() => {
        const checkTimeAndNotify = () => {
            const { enabled, time } = notificationSettings;
            const todayStr = new Date().toISOString().split('T')[0];

            if (
                enabled &&
                'Notification' in window &&
                Notification.permission === 'granted' &&
                lastNotificationDate !== todayStr
            ) {
                const now = new Date();
                const [hours, minutes] = time.split(':');
                
                if (now.getHours() === parseInt(hours) && now.getMinutes() === parseInt(minutes)) {
                    new Notification('Hora da sua dose diária de estudo!', {
                        body: 'Vamos revisar um pouco para manter o conhecimento fresco.',
                        icon: '/vite.svg'
                    });
                    setLastNotificationDate(todayStr);
                }
            }
        };

        const intervalId = setInterval(checkTimeAndNotify, 60000); // Check every minute

        return () => clearInterval(intervalId);
    }, [notificationSettings, lastNotificationDate, setLastNotificationDate]);
    
    
    const getLevel = (reviewedCount: number) => {
        if (reviewedCount < 10) return 'Iniciante';
        if (reviewedCount < 50) return 'Aprendiz';
        if (reviewedCount < 150) return 'Proficiente';
        if (reviewedCount < 300) return 'Mestre';
        return 'Especialista';
    };

    const setupDailyReview = useCallback(() => {
        const todayStr = new Date().toISOString().split('T')[0];

        const hydrateContent = (items: (DailyReviewType | ReviewItem)[]): (TodayContent | null)[] => {
            return items.map(review => {
                const subject = subjects.find(s => s.id === review.subjectId);
                if (!subject) return null;
                
                const content = subject.content.find(c => c.id === review.contentId);
                if (content) {
                    return { 
                        ...content, 
                        subjectName: subject.name, 
                        subjectId: subject.id,
                        type: 'review'
                    };
                }
                return null;
            });
        };

        if (dailyReviews && dailyReviews.length > 0 && dailyReviews[0].date === todayStr) {
            const reviewItemsToStudy = reviewQueue.slice(0, 10);
            const hydratedReviews = hydrateContent(reviewItemsToStudy).filter(Boolean) as TodayContent[];
            const hydratedNew = hydrateContent(dailyReviews).map(c => c ? {...c, type: 'new' as const} : null).filter(Boolean) as TodayContent[];
            setTodayContents([...hydratedReviews, ...hydratedNew]);
            return;
        }

        const reviewItemsToStudy = reviewQueue.slice(0, 10);
        const hydratedReviewItems = hydrateContent(reviewItemsToStudy).filter(Boolean) as TodayContent[];

        const allContent: (StudyContent & { subjectId: string; })[] = subjects.flatMap(s => 
            s.content.map(c => ({...c, subjectId: s.id}))
        );

        const contentNotInReviewQueue = allContent.filter(c => !reviewQueue.some(item => item.contentId === c.id));

        if (contentNotInReviewQueue.length > 0) {
            const shuffled = contentNotInReviewQueue.sort(() => 0.5 - Math.random());
            const newReviewsData = shuffled.slice(0, dosesPerDay);
            const newReviewsForStorage = newReviewsData.map(c => ({
                subjectId: c.subjectId,
                contentId: c.id,
                date: todayStr
            }));
            
            setDailyReviews(newReviewsForStorage);
            const hydratedNewItems = newReviewsData.map(review => {
                const subject = subjects.find(s => s.id === review.subjectId)!;
                return { ...review, subjectName: subject.name, type: 'new' as const };
            });
            setTodayContents([...hydratedReviewItems, ...hydratedNewItems]);
        } else {
             setTodayContents(hydratedReviewItems);
             setDailyReviews([]);
        }
        setCurrentDoseIndex(0);
    }, [subjects, dailyReviews, setDailyReviews, reviewQueue, dosesPerDay]);

    useEffect(() => {
        setupDailyReview();
    }, [setupDailyReview]);

    const handleAddSubject = (name: string) => {
        const newSubject: Subject = { id: crypto.randomUUID(), name, content: [] };
        setSubjects(prev => [...prev, newSubject]);
        setIsSubjectModalOpen(false);
    };
    
    const handleDeleteSubject = (subjectId: string) => {
        setSubjects(prev => prev.filter(s => s.id !== subjectId));
        setProgress(prev => {
            const newReviewedDoses = { ...prev.reviewedDosesPerSubject };
            delete newReviewedDoses[subjectId];
            return { ...prev, reviewedDosesPerSubject: newReviewedDoses };
        });
        if(activeSubjectId === subjectId) {
            setActiveSubjectId(null);
            setActiveView('review');
        }
    };

    const setupSubjectDeletion = (subjectId: string) => {
        const subject = subjects.find(s => s.id === subjectId);
        if (!subject) return;
        
        const contentCount = subject.content.length;

        setConfirmationState({
            isOpen: true,
            title: `Excluir Matéria "${subject.name}"?`,
            confirmText: 'Sim, excluir matéria',
            onConfirm: () => {
                handleDeleteSubject(subjectId);
                closeConfirmationModal();
            },
            requiresInput: subject.name,
            children: (
                <>
                    <p>Você está prestes a excluir permanentemente esta matéria e todo o seu conteúdo.</p>
                    <p className="font-semibold text-slate-700 mt-2">Isto irá apagar:</p>
                    <ul className="list-disc list-inside">
                        <li>1 Matéria</li>
                        <li>{contentCount} Nota{contentCount !== 1 ? 's' : ''} de Estudo</li>
                    </ul>
                    <p className="font-bold text-red-600 mt-2">Esta ação não pode ser desfeita.</p>
                </>
            ),
        });
    };

    const closeConfirmationModal = () => {
        setConfirmationState(prev => ({ ...prev, isOpen: false }));
    };

    const handleAddContent = (payload: { data: { type: 'text'; text: string } | { type: 'file'; doses: string[] } | { type: 'mindmap'; text: string }}) => {
        if (!activeSubject) return;
        
        const { data } = payload;
        let newContents: StudyContent[];

        switch(data.type) {
            case 'text':
            case 'mindmap':
                const doses = parseStructuredText(data.text);
                newContents = doses.map(dose => ({ id: crypto.randomUUID(), text: dose }));
                break;
            case 'file':
                newContents = data.doses.map(dose => ({ id: crypto.randomUUID(), text: dose }));
                break;
            default:
                newContents = [];
        }

        if (newContents.length === 0) {
            setIsContentModalOpen(false);
            return;
        }

        const updatedSubjects = subjects.map(s => {
            if (s.id === activeSubject.id) {
                return {
                    ...s,
                    content: [...s.content, ...newContents]
                };
            }
            return s;
        });

        setSubjects(updatedSubjects);
        setIsContentModalOpen(false);
    };
    
    const handleDeleteContent = (contentId: string) => {
        if (!activeSubject) return;
        const updatedSubjects = subjects.map(s => {
            if (s.id === activeSubject.id) {
                return {
                    ...s,
                    content: s.content.filter(c => c.id !== contentId)
                };
            }
            return s;
        });
        setSubjects(updatedSubjects);
    };

    const handleUpdateContent = (payload: { contentId: string, newText: string, reprocessAsMindMap: boolean }) => {
        if (!activeSubject) return;

        const { contentId, newText, reprocessAsMindMap } = payload;

        const updatedSubjects = subjects.map(s => {
            if (s.id === activeSubject.id) {
                if (!reprocessAsMindMap) {
                    // Simple text update
                    const newContent = s.content.map(c => c.id === contentId ? { ...c, text: newText } : c);
                    return { ...s, content: newContent };
                } else {
                    // Reprocess: remove old, add new
                    const originalContentIndex = s.content.findIndex(c => c.id === contentId);
                    if (originalContentIndex === -1) return s;

                    const newDoses = parseStructuredText(newText).map(dose => ({ id: crypto.randomUUID(), text: dose }));
                    const newContentList = [...s.content];
                    newContentList.splice(originalContentIndex, 1, ...newDoses);
                    
                    return { ...s, content: newContentList };
                }
            }
            return s;
        });

        setSubjects(updatedSubjects);
        setEditingContent(null);
    };


    const selectView = (view: ActiveView, subject: Subject | null = null) => {
        setActiveView(view);
        setActiveSubjectId(subject?.id || null);
        setIsSidebarOpen(false);
    }
    
    const completeCurrentDose = () => {
        if (currentDoseIndex >= todayContents.length) return;
        const currentDose = todayContents[currentDoseIndex];
        if (!currentDose) return;

        setProgress(prev => {
            const subjectId = currentDose.subjectId;
            const newCount = (prev.reviewedDosesPerSubject[subjectId] || 0) + 1;
            return {
                coins: prev.coins + 1,
                reviewedDosesPerSubject: {
                    ...prev.reviewedDosesPerSubject,
                    [subjectId]: newCount
                }
            };
        });

        setCurrentDoseIndex(prev => prev + 1);
    };

    const handleMarkForReview = () => {
        const currentDose = todayContents[currentDoseIndex];
        if (currentDose) {
            setReviewQueue(prev => {
                const isAlreadyInQueue = prev.some(item => item.contentId === currentDose.id);
                if (isAlreadyInQueue) return prev;
                return [...prev, { subjectId: currentDose.subjectId, contentId: currentDose.id }];
            });
        }
        completeCurrentDose();
    };

    const handleFinishReview = () => {
        markAsCompleted();
        const reviewedItemIds = todayContents
            .filter(c => c.type === 'review')
            .map(c => c.id);
        
        setReviewQueue(prev => prev.filter(item => !reviewedItemIds.includes(item.contentId)));
    };

    const SidebarContent = () => (
        <>
            <header className="p-4 border-b border-slate-200 flex items-center justify-between lg:justify-start gap-3">
                <a href="#" onClick={(e) => { e.preventDefault(); selectView('review'); }} className="flex items-center gap-3">
                     <BrainIcon className="h-8 w-8 text-indigo-600"/>
                     <h1 className="text-xl font-bold text-slate-900">Estudo Diário</h1>
                </a>
                <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-1 text-slate-500 hover:text-slate-800">
                    <XIcon className="h-6 w-6" />
                </button>
            </header>
            <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                <button onClick={() => selectView('review')} className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-md font-semibold transition-colors ${activeView === 'review' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
                    <BookOpenIcon className="h-5 w-5"/>
                    Revisão do Dia
                </button>
                 <button onClick={() => selectView('settings')} className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-md font-semibold transition-colors ${activeView === 'settings' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
                    <CogIcon className="h-5 w-5"/>
                    Configurações
                </button>
                 {streak > 0 && (
                    <div className="mt-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md flex items-center justify-center gap-2">
                        <FlameIcon className="h-5 w-5 text-amber-500" />
                        <span className="font-bold text-amber-700">{streak} dia{streak > 1 ? 's' : ''} de streak!</span>
                    </div>
                )}
                <h2 className="px-3 pt-4 pb-2 text-sm font-semibold text-slate-500 uppercase tracking-wider">Matérias</h2>
                {subjects.map(subject => (
                     <button key={subject.id} onClick={() => selectView('subject', subject)} className={`w-full text-left px-3 py-2 rounded-md font-medium transition-colors text-sm ${activeView === 'subject' && activeSubjectId === subject.id ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
                        <div className="flex justify-between items-center">
                            <span className="truncate">{subject.name}</span>
                            <span className="ml-2 flex-shrink-0 text-xs font-semibold text-indigo-700 bg-indigo-100/50 px-2 py-0.5 rounded-full">
                                {getLevel(progress.reviewedDosesPerSubject[subject.id] || 0)}
                            </span>
                        </div>
                    </button>
                ))}
            </nav>
            <div className="p-4 border-t border-slate-200">
                <button onClick={() => setIsSubjectModalOpen(true)} className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
                    <PlusIcon className="h-5 w-5"/>
                    Nova Matéria
                </button>
            </div>
        </>
    );

    const renderMainContent = () => {
        switch(activeView) {
            case 'settings':
                return <SettingsView />;
            case 'subject':
                if (!activeSubject) return null;
                return (
                    <div>
                        <div className="space-y-3 mb-6">
                            {(activeSubject.content || []).length > 0 ? (
                                [...activeSubject.content].reverse().map(c => (
                                    <div key={c.id} className="bg-white p-3 rounded-lg shadow-sm border border-slate-200 flex justify-between items-start gap-3">
                                        <p className="text-slate-700 text-sm whitespace-pre-wrap flex-1 break-words">{c.text}</p>
                                        <div className="flex-shrink-0 flex items-center gap-1">
                                            <button onClick={() => setEditingContent(c)} className="p-1.5 text-slate-400 hover:bg-indigo-100 hover:text-indigo-600 rounded-full transition-colors">
                                                <PencilIcon className="h-4 w-4"/>
                                            </button>
                                            <button onClick={() => handleDeleteContent(c.id)} className="p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600 rounded-full transition-colors">
                                                <TrashIcon className="h-4 w-4"/>
                                            </button>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center text-slate-500 py-12 bg-white rounded-lg border-2 border-dashed border-slate-200">
                                    <FileTextIcon className="mx-auto h-12 w-12 text-slate-400"/>
                                    <h3 className="mt-2 text-sm font-semibold text-slate-900">Nenhuma nota de estudo</h3>
                                    <p className="mt-1 text-sm text-slate-500">Comece adicionando seu primeiro material.</p>
                                </div>
                            )}
                        </div>
                        <button onClick={() => setIsContentModalOpen(true)} className="w-full flex items-center justify-center gap-2 px-4 py-3 text-base font-semibold text-indigo-700 bg-indigo-100 rounded-lg hover:bg-indigo-200">
                            <PlusIcon className="h-5 w-5"/>
                            Adicionar Nota de Estudo
                        </button>
                    </div>
                );
            case 'review':
            default:
                const isSessionFinished = currentDoseIndex >= todayContents.length;
                const currentDose = !isSessionFinished ? todayContents[currentDoseIndex] : null;

                 return (
                    <div>
                        {todayContents.length > 0 ? (
                            !isSessionFinished && currentDose ? (
                                <>
                                    {currentDoseIndex === 0 && (
                                        <div className="text-center mb-6 p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                                            <p className="font-semibold text-indigo-800">
                                                {todayContents.some(c => c.type === 'review') ? 
                                                 `Vamos começar com ${todayContents.filter(c => c.type === 'review').length} item(ns) para revisar.` 
                                                 : 'Nenhum item para revisar hoje. Vamos para as novas doses!'}
                                            </p>
                                        </div>
                                    )}
                                    <DailyReviewCard 
                                        key={currentDose.id} 
                                        subjectName={currentDose.subjectName} 
                                        content={currentDose} 
                                        index={currentDoseIndex} 
                                        total={todayContents.length}
                                        reviewType={currentDose.type}
                                    />
                                    <div className="mt-6 flex gap-4">
                                        <button
                                            onClick={handleMarkForReview}
                                            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-base font-semibold text-slate-700 bg-slate-200 rounded-lg hover:bg-slate-300"
                                        >
                                            <BookmarkIcon className="h-5 w-5" />
                                            Revisar Depois
                                        </button>
                                         <button
                                            onClick={completeCurrentDose}
                                            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-base font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                                        >
                                            Próxima Dose
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center bg-white p-8 rounded-xl shadow-lg border border-slate-200">
                                     <h2 className="text-2xl font-bold text-slate-800 mb-4">Sessão Concluída!</h2>
                                    {!hasCompletedToday ? (
                                        <button
                                            onClick={handleFinishReview}
                                            className="w-full max-w-sm mx-auto flex items-center justify-center gap-2 px-4 py-3 text-base font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700"
                                        >
                                            Concluir e Salvar
                                        </button>
                                    ) : (
                                        <p className="font-semibold text-green-700">Você já completou a revisão de hoje. Bom trabalho!</p>
                                    )}
                                </div>
                            )
                        ) : (
                            <DailyReviewWelcome />
                        )}
                    </div>
                );
        }
    };

    return (
        <div className="h-screen font-sans text-slate-800 bg-slate-100 flex">
            {isSidebarOpen && <div className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden" onClick={() => setIsSidebarOpen(false)}></div>}
            
            <aside className={`fixed lg:relative inset-y-0 left-0 w-64 bg-white border-r border-slate-200 flex-col z-40 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 transition-transform duration-300 ease-in-out flex`}>
                <SidebarContent />
            </aside>
            
            <main className="flex-1 flex flex-col h-screen overflow-y-auto">
                 <header className="sticky top-0 bg-white/80 backdrop-blur-sm border-b border-slate-200 p-4 flex items-center justify-between z-20">
                    <div className="flex items-center gap-2">
                         <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-1 text-slate-600 -ml-1"><MenuIcon className="h-6 w-6"/></button>
                         <h2 className="text-lg font-bold text-slate-800 truncate">
                            {activeView === 'subject' && activeSubject ? activeSubject.name : activeView === 'settings' ? 'Configurações' : 'Revisão do Dia'}
                        </h2>
                    </div>
                    <div className="flex items-center gap-3">
                         {activeView === 'review' && (
                            <div className="flex items-center gap-2 bg-white py-1 px-3 rounded-full shadow-sm border border-slate-200">
                                <CoinIcon className="h-5 w-5 text-amber-400" />
                                <span className="font-bold text-slate-700">{progress.coins}</span>
                            </div>
                        )}
                        {activeView === 'subject' && activeSubject && (
                            <>
                                <span className="text-sm font-semibold text-indigo-700 bg-indigo-100 px-3 py-1 rounded-full hidden sm:block">
                                    Nível: {getLevel(progress.reviewedDosesPerSubject[activeSubject.id] || 0)}
                                </span>
                                <button onClick={() => setupSubjectDeletion(activeSubject.id)} className="p-2 text-slate-500 hover:bg-red-100 hover:text-red-600 rounded-full transition-colors">
                                    <TrashIcon className="h-5 w-5" />
                                </button>
                            </>
                        )}
                    </div>
                </header>
                <div className="flex-1 p-4 sm:p-6 md:p-8 lg:p-10">
                    <div className="max-w-4xl mx-auto">
                        {renderMainContent()}
                    </div>
                </div>
            </main>

            <Modal isOpen={isSubjectModalOpen} onClose={() => setIsSubjectModalOpen(false)} title="Adicionar Nova Matéria">
                <SubjectForm onSubmit={handleAddSubject} onCancel={() => setIsSubjectModalOpen(false)} />
            </Modal>
            <Modal isOpen={isContentModalOpen} onClose={() => setIsContentModalOpen(false)} title="Adicionar Nota de Estudo">
                <ContentForm onSubmit={handleAddContent} onCancel={() => setIsContentModalOpen(false)} />
            </Modal>
            {editingContent && (
                <Modal isOpen={!!editingContent} onClose={() => setEditingContent(null)} title="Editar Nota de Estudo">
                    <EditContentForm 
                        initialContent={editingContent}
                        onCancel={() => setEditingContent(null)}
                        onSubmit={payload => handleUpdateContent({ contentId: editingContent.id, ...payload })}
                    />
                </Modal>
            )}
            <ConfirmationModal
                isOpen={confirmationState.isOpen}
                onClose={closeConfirmationModal}
                onConfirm={confirmationState.onConfirm}
                title={confirmationState.title}
                confirmText={confirmationState.confirmText}
                requiresInput={confirmationState.requiresInput}
            >
                {confirmationState.children}
            </ConfirmationModal>
        </div>
    );
};

export default App;
