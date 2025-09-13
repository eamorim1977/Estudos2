import React, { useState } from 'react';
import { StudyContent } from '../types';
import { generateStudyAid } from '../services/geminiService';
import { BrainIcon, SparklesIcon } from './Icons';

interface DailyReviewCardProps {
    subjectName: string;
    content: StudyContent | null;
    index: number;
    total: number;
    reviewType?: 'review' | 'new';
}

const GeminiAidButton: React.FC<{ prompt: any, content: string, onResult: (result: string) => void, onLoading: (loading: boolean) => void }> = ({ prompt, content, onResult, onLoading }) => {
    const handleClick = async () => {
        onLoading(true);
        onResult('');
        const result = await generateStudyAid(prompt.prompt, content);
        onResult(result);
        onLoading(false);
    };

    return (
        <button
            onClick={handleClick}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
        >
            <SparklesIcon className="w-4 h-4" />
            {prompt.label}
        </button>
    );
};

export const DailyReviewWelcome: React.FC = () => (
    <div className="flex flex-col items-center justify-center h-full text-center bg-white p-8 rounded-xl shadow-lg border border-slate-200">
        <BrainIcon className="w-24 h-24 text-indigo-200 mb-4" />
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Bem-vindo ao seu Estudo Diário!</h2>
        <p className="text-slate-500 max-w-md">
            Adicione suas matérias e notas de estudo para começar. Cada dia, uma nova "dose" de conhecimento estará esperando por você aqui.
        </p>
    </div>
);

const renderContentWithImages = (text: string) => {
    let breadcrumb: string | null = null;
    let mainContent = text;

    // Check for our breadcrumb pattern: a single line with '>' ending in double newline
    const breadcrumbMatch = text.match(/^(.*(?: > ).*)\n\n([\s\S]*)$/);
    if (breadcrumbMatch) {
        breadcrumb = breadcrumbMatch[1];
        mainContent = breadcrumbMatch[2];
    }
    
    const renderMainContent = (content: string) => {
        // Regex to split by markdown image syntax, keeping the delimiter
        const parts = content.split(/(!\[.*?\]\(data:image\/.+?\))/g);
        
        return parts.map((part, index) => {
            const match = part.match(/!\[(.*?)\]\((data:image\/.+?)\)/);
            if (match) {
                const [, alt, src] = match;
                return (
                    <img 
                        key={index} 
                        src={src} 
                        alt={alt || 'Imagem extraída do PDF'} 
                        className="my-4 rounded-lg shadow-md max-w-full h-auto mx-auto block" 
                    />
                );
            }
            // Only render non-empty text parts
            return part ? <React.Fragment key={index}>{part}</React.Fragment> : null;
        });
    };

    return (
        <>
            {breadcrumb && (
                <p className="mb-4 text-sm font-medium text-slate-500 pb-2 border-b border-slate-200">
                    {breadcrumb}
                </p>
            )}
            {renderMainContent(mainContent)}
        </>
    );
};


const DailyReviewCard: React.FC<DailyReviewCardProps> = ({ subjectName, content, index, total, reviewType }) => {
    const [geminiResult, setGeminiResult] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const geminiPrompts = [
        { label: "Gerar Pergunta", prompt: "Com base na seguinte nota de estudo, gere uma única pergunta de múltipla escolha para testar meu entendimento. Forneça 4 opções e indique a correta." },
        { label: "Resumir em Tópicos", prompt: "Resuma o conteúdo a seguir em uma lista concisa de tópicos (bullet points), destacando as ideias principais." },
        { label: "Termos-Chave", prompt: "Identifique e explique brevemente os 3 termos ou conceitos mais importantes no texto a seguir." },
        { label: "Criar Analogia", prompt: "Crie uma analogia ou metáfora para me ajudar a lembrar do seguinte conceito:" },
    ];

    if (!content) return null;

    return (
        <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg border border-slate-200 animate-fade-in">
            <header className="mb-6">
                <div className="flex justify-between items-center">
                    <p className="text-sm font-semibold text-indigo-600 uppercase tracking-wider">
                        {subjectName}
                    </p>
                    {reviewType === 'review' && (
                        <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-1 rounded-full">REVISÃO</span>
                    )}
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">Dose de Estudo {index + 1} de {total}</h1>
            </header>
            
            <div className="bg-slate-50 p-6 rounded-lg mb-6">
                <div className="text-slate-700 text-lg whitespace-pre-wrap break-words">
                    {renderContentWithImages(content.text)}
                </div>
            </div>

            <div className="border-t border-slate-200 pt-6">
                <div className="flex items-center gap-3 mb-4">
                    <SparklesIcon className="w-6 h-6 text-indigo-500"/>
                    <h3 className="text-lg font-semibold text-slate-800">Aprimore com IA</h3>
                </div>
                <div className="flex flex-wrap gap-3 mb-4">
                    {geminiPrompts.map((prompt) => (
                        <GeminiAidButton
                            key={prompt.label}
                            prompt={prompt}
                            content={content.text}
                            onResult={setGeminiResult}
                            onLoading={setIsLoading}
                        />
                    ))}
                </div>
                {isLoading && (
                    <div className="w-full bg-slate-100 rounded-lg p-4 mt-4 animate-pulse">
                        <div className="h-4 bg-slate-300 rounded w-3/4 mb-2"></div>
                        <div className="h-4 bg-slate-300 rounded w-1/2"></div>
                    </div>
                )}
                {geminiResult && !isLoading && (
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mt-4 text-indigo-900 animate-fade-in">
                        <p className="whitespace-pre-wrap">{geminiResult}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DailyReviewCard;