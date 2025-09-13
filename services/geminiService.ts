
export const generateStudyAid = async (prompt: string, content: string): Promise<string> => {
    try {
        const response = await fetch('/api/gemini', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt, content }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Error from API proxy:", errorData.error, errorData.details);
            throw new Error(errorData.error || "A network error occurred.");
        }

        const data = await response.json();
        return data.text;
    } catch (error) {
        console.error("Error generating content via proxy:", error);
        return "Ocorreu um erro ao gerar o conteúdo. Por favor, tente novamente.";
    }
};
